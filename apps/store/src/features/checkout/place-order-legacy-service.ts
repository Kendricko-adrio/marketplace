import { loadBranch } from "@/features/checkout/place-order-repository";
import {
  InsufficientStockError,
  PromoReservationError,
  RouteLogError,
  classifyPlaceOrderError,
} from "@/features/checkout/place-order-errors";
import { db } from "@/db";
import { CheckoutReviewRequiredError } from "@/lib/checkout-review";
import { pickupDateToInstant, validatePickupSlot } from "@/lib/pickup-validation";
import { createPayment } from "@/lib/midtrans";
import { PricingContractError, type PricingSnapshot } from "@/lib/versioned-pricing";
import { mapOfferReasonToHttp, type PublicOfferCandidate } from "@/lib/discount-selection";
import {
  insertRedemptionReservation,
  lockAndEvaluateOfferReservation,
  writeOrderDiscountAllocations,
} from "@/lib/discount-reservation";
import { projectMarkdownPrice } from "@marketplace/db/src/markdown-pricing";
import { buildPlacePaymentItemDetails } from "@/features/checkout/place-order-pricing";
import { createModuleLogger } from "@/lib/logger";
import { claimAndFailOrder } from "@/lib/order-finalize";
import { initializeReservedOrderPayment } from "@/lib/payment-initialization";
import { loadRevalidatedNewDestination } from "@/lib/delivery-quote-data";
import type { DeliverySnapshotPayload } from "@marketplace/db/src/schema";
import type { OrderPricing } from "@/lib/order-pricing";
import { dispatchJubelioSalesCreate } from "@/lib/jubelio-sales-lifecycle";
import {
  lockCheckoutOwner,
  loadAcceptedCheckoutRequest,
  loadFreshClient,
  loadFreshVariants,
  loadFreshMarkdown,
  loadFreshBranch,
  loadAddress,
  loadFreshCartItems,
  holdBranchStock,
  loadHoldStockSnapshot,
  loadOrderBranch,
  releaseHoldsOnReject,
  failOrderOnReject,
  persistPaymentRedirect,
  deleteCheckedOutCartItem,
  insertOrder,
  insertOrderItem,
  insertCheckoutRequest,
  recordSalesIntent,
  saveCheckoutAddress,
} from "@/features/checkout/place-order-repository";
import { runCheckoutTransaction } from "@/lib/checkout-transaction";
import { finalizeRejectedCheckoutCreate } from "@/lib/checkout-recovery";
import {
  AcceptedCheckoutReplay,
  CheckoutRequestConflictError,
  findAcceptedCheckout,
  type CheckoutRecovery,
} from "@/lib/checkout-request";

import type { DeliveryPlaceOrderData } from "./place-order-input";
import type { PlaceOrderSelectedItem } from "./place-order-repository";
import type { JubelioSalesOrderCreateRequest } from "@marketplace/db/src/schema";

const log = createModuleLogger("checkout-place-order");

export interface PlaceOrderLegacyInput {
  actor: { id: string; name?: string | null }; recovery: CheckoutRecovery;
  selectedItems: PlaceOrderSelectedItem[]; selectedItemIds: string[]; cart: { id: string };
  branchId: string; branch: Awaited<ReturnType<typeof loadBranch>>;
  pricingSnapshot: PricingSnapshot | null; pricing: OrderPricing; offerCandidate: PublicOfferCandidate | null;
  isDelivery: boolean; deliverySnapshot: DeliverySnapshotPayload | null; deliveryBody: DeliveryPlaceOrderData | null;
  verifiedNewAddress: Awaited<ReturnType<typeof loadRevalidatedNewDestination>> | null;
  pickupDate: string | null; pickupTime: string | null; phone: string; email: string;
  effectiveOf: (item: { variantId: string; variantPrice: string }) => string;
  markdownRevisionOf: (item: { variantId: string }) => string | null;
  orderId: string; createReference: string; createRequest: JubelioSalesOrderCreateRequest;
  paymentStartedAt: Date; expiresAt: Date; ttlMinutes: number; total: number;
  paymentItemDetails: ReturnType<typeof buildPlacePaymentItemDetails>;
  stockCheck: { observedAt: Date }; createLegacyPayment: typeof createPayment;
}

export async function placeOrderLegacy({
  actor,
  recovery,
  selectedItems,
  selectedItemIds,
  cart,
  branchId,
  branch,
  pricingSnapshot,
  pricing,
  offerCandidate,
  isDelivery,
  deliverySnapshot,
  deliveryBody,
  verifiedNewAddress,
  pickupDate,
  pickupTime,
  phone,
  email,
  effectiveOf,
  markdownRevisionOf,
  orderId,
  createReference,
  createRequest,
  paymentStartedAt,
  expiresAt,
  ttlMinutes,
  total,
  paymentItemDetails,
  stockCheck,
  createLegacyPayment,
}: PlaceOrderLegacyInput) {
  try {
    await runCheckoutTransaction(!!pricingSnapshot, async (tx, step) => {
      if (pricingSnapshot) {
        // Owner → sorted source variants → order → sorted stock → intent.
        // No provider HTTP while locks are held. Re-read after the quote:
        // stale source/parcel/cart inputs require a fresh customer review.
        await step(() => lockCheckoutOwner(tx, actor.id));
        if (recovery.identity) {
          const identity = recovery.identity;
          const [accepted] = await step(() => loadAcceptedCheckoutRequest(tx, identity));
          if (accepted) {
            if (accepted.fingerprint !== recovery.identity.fingerprint) throw new CheckoutRequestConflictError();
            throw new AcceptedCheckoutReplay();
          }
        }
        if (offerCandidate) {
          // Lock group 3 BEFORE group 4/5: Offer identity → global usage →
          // client usage, then authoritative re-evaluation under those locks.
          // Two reservations for the SAME Offer serialize on the Offer row,
          // so the second sees the first commit's capacity instead of
          // overselling. The insert happens after the order exists (FK).
          const candidate = offerCandidate;
          const [freshClient] = await step(() => loadFreshClient(tx, actor.id));
          const decision = await lockAndEvaluateOfferReservation(tx, {
            clientId: actor.id,
            verifiedEmail: freshClient?.emailVerified ?? false,
            candidate: candidate,
            subtotalAfterMarkdown: pricingSnapshot.subtotal,
            fulfillmentMethod: isDelivery ? "delivery" : "pickup",
            shippingBeforeSubsidy: isDelivery ? pricingSnapshot.shippingBeforeSubsidy : "0",
          });
          if (!decision.ok) {
            const mapped = mapOfferReasonToHttp(decision.reason);
            throw new PromoReservationError(
              mapped.status, mapped.code, decision.message, decision.reason
            );
          }
        }
        const freshVariants = await step(() => loadFreshVariants(tx, selectedItems.map((item) => item.variantId)));
        // Lock order group 4 continues: variant/source rows first, then the
        // current Markdown pointer. A concurrent apply/source sync therefore
        // serializes against this commit instead of slipping a different
        // price into an order reviewed under the old projection.
        const freshMarkdownRows = await step(() => loadFreshMarkdown(tx, selectedItems.map((item) => item.variantId)));
        const freshMarkdown = new Map(
          freshMarkdownRows.map((row) => [row.variantId, row] as const)
        );
        const [freshBranch] = await step(() => loadFreshBranch(tx, branchId));
        if (!freshBranch || freshBranch.status !== "aktif" || freshBranch.jubelioLocationId !== branch[0].jubelioLocationId ||
            (!isDelivery && !validatePickupSlot(freshBranch.operatingHours, pickupDate!, pickupTime!).ok)) {
          throw new CheckoutReviewRequiredError();
        }
        if (deliverySnapshot) {
          const origin = deliverySnapshot.origin;
          if (freshBranch.name !== origin.name || freshBranch.shippingPhone !== origin.phone ||
              freshBranch.shippingAddress !== origin.address || freshBranch.shippingPostalCode !== origin.zipcode ||
              freshBranch.shippingAreaId !== origin.areaId) throw new CheckoutReviewRequiredError();
          if (deliveryBody && "addressId" in deliveryBody) {
            const addressId = deliveryBody.addressId;
            const [currentAddress] = await step(() => loadAddress(tx, addressId, actor.id));
            const address = deliverySnapshot.address;
            if (!currentAddress || currentAddress.firstName !== address.recipientName || currentAddress.phone !== address.phone ||
                currentAddress.fullAddress !== address.fullAddress || currentAddress.provinceId !== address.provinceId ||
                currentAddress.cityId !== address.cityId || currentAddress.districtId !== address.districtId ||
                currentAddress.areaId !== address.areaId || currentAddress.postalCode !== address.postalCode) throw new CheckoutReviewRequiredError();
          }
        }
        const freshCart = await step(() => loadFreshCartItems(tx, cart.id, selectedItemIds));
        for (const item of selectedItems) {
          const variant = freshVariants.find((row) => row.id === item.variantId);
          const selected = freshCart.find((row) => row.id === item.cartItemId);
          if (!variant || variant.price !== item.variantPrice || variant.jubelioItemId !== item.jubelioItemId ||
              JSON.stringify(variant.parcelDimensions) !== JSON.stringify(item.parcelDimensions) ||
              !selected || selected.variantId !== item.variantId || selected.branchId !== item.branchId || selected.quantity !== item.quantity) {
            throw new PricingContractError("PRICING_INPUT_INVALID", "Harga atau keranjang berubah. Periksa kembali pesanan.");
          }
          // Reviewed Markdown must still be the current one. A source change
          // alone can keep the same target active; the effective price and
          // revision identity both have to match the review.
          const current = freshMarkdown.get(item.variantId);
          let freshEffective = variant.price;
          let freshRevisionId: string | null = null;
          try {
            const projection = projectMarkdownPrice({
              sourceUnitPrice: variant.price,
              storedTargetUnitPrice: current?.targetUnitPrice ?? null,
              markdownRevisionId: current?.revisionId ?? null,
            });
            freshEffective = projection.effectiveUnitPrice;
            freshRevisionId = projection.markdownRevisionId;
          } catch {
            throw new CheckoutReviewRequiredError();
          }
          if (freshEffective !== effectiveOf(item) || freshRevisionId !== markdownRevisionOf(item)) {
            throw new CheckoutReviewRequiredError();
          }
        }
      }
      // Save only after the final quote has been approved, atomically with
      // the order. A failed quote never mutates the address book.
      const savedAddressId = await saveCheckoutAddress({ tx, step, clientId: actor.id, isDelivery, deliveryBody, verifiedNewAddress });
      // ===== Create the order =====
      await step(() => insertOrder(tx, {
        id: orderId,
        userId: actor.id,
        branchId,
        addressId: savedAddressId ?? (isDelivery && deliveryBody && "addressId" in deliveryBody ? deliveryBody.addressId : null),
        status: "pending_payment",
        paymentMethod: null,
        paymentStatus: "pending",
        // Spec penyelarasan status/notifikasi/email: order baru memberi marker
        // komunikasi 1 supaya worker tidak pernah memproyeksikan order lama.
        orderCommunicationVersion: 1,
        // Delivery rows carry NO pickup slots and their immutable snapshot;
        // pickup rows keep the legacy columns (default method: pickup).
        fulfillmentMethod: isDelivery ? "delivery" : "pickup",
        deliverySnapshot: isDelivery ? deliverySnapshot : null,
        pickupDate: isDelivery ? null : pickupDateToInstant(pickupDate!),
        pickupTime: isDelivery ? null : pickupTime!,
        contactPhone: phone,
        contactEmail: email,
        subtotal: pricing.subtotal,
        shippingCost: pricing.shippingCost,
        discount: pricing.discount,
        serviceFee: pricing.serviceFee,
        ppnRate: pricing.ppnRatePercent,
        ppnAmount: pricing.ppnAmount,
        total: pricing.total,
        ...(pricingSnapshot ? {
          pricingContractVersion: pricingSnapshot.pricingContractVersion,
          pricingEngineVersion: pricingSnapshot.pricingEngineVersion,
          providerContractVersion: pricingSnapshot.providerContractVersion,
          pricingCurrency: pricingSnapshot.currency,
          sourceGoodsSubtotal: pricingSnapshot.sourceGoodsSubtotal,
          markdownTotal: pricingSnapshot.markdownTotal,
          netGoods: pricingSnapshot.netGoods,
          shippingBeforeSubsidy: pricingSnapshot.shippingBeforeSubsidy,
          shippingSubsidy: pricingSnapshot.shippingSubsidy,
          merchantFunding: pricingSnapshot.merchantFunding,
          taxableBase: pricingSnapshot.taxableBase,
          expectedProviderPayable: pricingSnapshot.expectedProviderPayable,
          providerQuotedShippingCost: pricingSnapshot.providerQuotedShippingCost,
          providerBilledShippingCost: pricingSnapshot.providerBilledShippingCost,
          pricingSnapshot,
        } : {}),
        expiresAt,
      }));

      // ===== One Redemption for this order (reserved), atomic with the
      // order/items/stock/intent/receipt. The Offer lock acquired above is
      // still held, so counters and capacity move together in ONE commit. =====
      let reservedRedemptionId: string | null = null;
      if (offerCandidate && pricingSnapshot) {
        const candidate = offerCandidate;
        const inserted = await step(() => insertRedemptionReservation(tx, {
          orderId,
          clientId: actor.id,
          candidate,
          deadline: expiresAt,
          pricing: pricingSnapshot!,
        }));
        reservedRedemptionId = inserted.redemptionId;
        log.info(
          `redemption reserved atomically with order: redemption ${inserted.redemptionId}, offer ${candidate.offerId}, benefit ${candidate.benefitAmount}`
        );
      }

      // ===== Create order items (with real product names) =====
      const orderItemIdByVariant = new Map<string, string>();
      for (const item of [...selectedItems].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
        const line = pricingSnapshot?.lines.find((line) => line.variantId === item.variantId);
        const orderItemId = crypto.randomUUID();
        orderItemIdByVariant.set(item.variantId, orderItemId);
        await step(() => insertOrderItem(tx, {
          id: orderItemId,
          orderId,
          variantId: item.variantId,
          productName: item.productName,
          variantInfo: `${item.variantColor || ""} ${item.variantSize || ""}`.trim(),
          price: line?.effectiveUnitPrice ?? item.variantPrice,
          quantity: item.quantity,
          ...(line ? {
            pricingContractVersion: 1,
            sourceUnitPrice: line.sourceUnitPrice,
            markdownAmount: line.markdownAmount,
            goodsDiscountAmount: line.goodsDiscountAmount,
            netLineAmount: line.netLineAmount,
            markdownRevisionId: line.markdownRevisionId,
          } : {}),
        }));
      }

      // ===== Per-line allocation evidence: Markdown is a SEPARATE component
      // from the Offer slot, and a zero allocation is never stored. =====
      if (pricingSnapshot) {
        if (offerCandidate && !reservedRedemptionId) {
          throw new Error("Redemption missing while writing offer allocations");
        }
        await writeOrderDiscountAllocations(tx, {
          orderId,
          orderItemIdByVariant,
          pricing: pricingSnapshot,
          redemption:
            reservedRedemptionId && offerCandidate
              ? { id: reservedRedemptionId, benefitId: offerCandidate.benefitId }
              : null,
        });
      }

      // ===== Atomically hold stock BEFORE the SO POST =====
      // Conditional UPDATE: only increments pending_remote_stock if enough
      // sellable stock remains (provider available − holds ≥ qty) and a
      // provider snapshot exists (fail closed). 0 rows means another
      // concurrent checkout took the last units → throw to roll back.
      for (const item of [...selectedItems].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
        const held = await step(() => holdBranchStock(tx, branchId, item.variantId, item.quantity, stockCheck.observedAt));
        if (held.length === 0) {
          const snapshot = await step(() => loadHoldStockSnapshot(tx, branchId, item.variantId));
          throw new InsufficientStockError(
            item.productName,
            snapshot[0]?.availableStock == null || snapshot[0]?.providerStockSyncedAt?.getTime() !== stockCheck.observedAt.getTime()
          );
        }
        log.info(
          `local SO hold created: variant ${item.variantId}, quantity ${item.quantity}, order ${orderId}`
        );
      }

      // ===== Persist the create intent BEFORE any provider POST =====
      await step(() => recordSalesIntent(tx, {
        orderId,
        type: "create",
        reference: createReference,
        payload: { type: "create", create: createRequest },
      }));
      if (recovery.identity) {
        const identity = recovery.identity;
        await step(() => insertCheckoutRequest(tx, {
          id: crypto.randomUUID(), clientId: identity.clientId,
          requestKey: identity.requestKey, fingerprint: identity.fingerprint,
          orderId, result: { version: 1, orderId },
        }));
      }
    });
    recovery.committed = true;

    // Provider call stays OUTSIDE the DB transaction: exactly one SO create
    // POST, confirmed via GET before Midtrans is involved.
    log.info(`Jubelio sales order create dispatched (order ${orderId})`);
    const createOutcome = await dispatchJubelioSalesCreate({
      orderId,
      create: createRequest,
    });
    log.info(`Jubelio sales order create completed (order ${orderId}, status ${createOutcome.status})`);

    if (createOutcome.status !== "confirmed") {
      if (createOutcome.status === "rejected") {
        // Definitive pre-apply rejection: release the hold, fail the order.
        if (recovery.identity) await finalizeRejectedCheckoutCreate(orderId);
        else await db.transaction(async (tx) => {
          const orderRows = await loadOrderBranch(tx, orderId);
          const orderBranchId = orderRows[0]?.branchId;
          if (orderBranchId) {
            for (const item of selectedItems) {
              await releaseHoldsOnReject(tx, orderBranchId, item.variantId, item.quantity);
            }
          }
          await failOrderOnReject(tx, orderId, createOutcome.message);
        });
        return { kind: "legacy-sales-rejected" as const };
      }
      // manual_review / in_flight: the create may have been applied or is
      // still unknown. Keep the hold, keep the order pending, never retry.
      const message =
        "Pesanan sedang diproses. Tim kami akan mengonfirmasi ketersediaan stok — silakan cek status pesanan atau hubungi kami.";
      return { kind: "legacy-sales-pending" as const, message };
    }

    const initialized = await initializeReservedOrderPayment({
      create: () => createLegacyPayment(orderId, total, {
        first_name: actor.name || "Customer", email, phone,
      }, paymentItemDetails, ttlMinutes, paymentStartedAt),
      persist: async (paymentResult) => {
        await db.transaction(async (tx) => {
          await persistPaymentRedirect(tx, orderId, paymentResult.redirectUrl);

          for (const itemId of selectedItemIds) {
            await deleteCheckedOutCartItem(tx, itemId, cart.id);
          }
        });
      },
      compensate: async () => {
        await claimAndFailOrder(
          orderId,
          "Payment initialization failed",
          "initialization_error"
        );
        log.error(
          `order ${orderId}: payment initialization failed; sales-order cancel dispatched`,
          new RouteLogError("payment initialization failed")
        );
      },
    });

    const midtransResult = initialized.payment;
    if (initialized.persistenceError) {
      log.error(
        `order ${orderId}: payment created but local metadata needs reconciliation`,
        new RouteLogError("payment metadata persistence failed")
      );
    }

    log.info(
      `order placed successfully: order ${orderId}, total ${pricing.total}, ppn ${pricing.ppnAmount} @ ${pricing.ppnRatePercent}%, redirect ${midtransResult.redirectUrl ? "ada" : "kosong"}`
    );
    if (recovery.identity) {
      const accepted = await findAcceptedCheckout(recovery.identity);
      if (!accepted) throw new Error("Accepted checkout tidak ditemukan setelah commit.");
      return { kind: "accepted" as const, result: accepted, replay: false };
    }
    return { kind: "legacy-success" as const, orderId, redirectUrl: midtransResult.redirectUrl, token: midtransResult.token };
  } catch (checkoutError) {
    if (recovery.identity && (recovery.committed || checkoutError instanceof AcceptedCheckoutReplay)) {
      log.error(
        `checkout completion interrupted; reading retained result (committed ${!!recovery.committed})`
      );
      const accepted = await findAcceptedCheckout(recovery.identity);
      if (accepted) return { kind: "accepted" as const, result: accepted, replay: !recovery.committed };
      throw checkoutError;
    }
    const decision = classifyPlaceOrderError("legacy", checkoutError);
    if (decision.kind === "rethrow" || decision.kind === "translate-review") throw decision.error;
    return { kind: "legacy-failure" as const, error: checkoutError, hasIdentity: !!recovery.identity };
  }
}
