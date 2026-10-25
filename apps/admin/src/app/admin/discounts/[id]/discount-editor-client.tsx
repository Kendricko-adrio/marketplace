"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, PlayCircle } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/providers/auth-provider";
import { DiscountReviewDialog, type ReviewResult } from "./discount-review-dialog";

// =========================================================
// Discount Offer editor
// =========================================================
// Sections: identity/state, draft terms + benefit, capacity policy, pricing
// simulation, server review diff + publish, usage and immutable history.
// All money stays a string end-to-end; only display formatting converts.
// The review fingerprint returned by the server is the ONLY publish token, and
// it is recomputed server-side under lock, so a stale screen cannot publish.

interface Benefit {
  id: string;
  kind: string;
  scope: string;
  /** NULL untuk percentage_goods. */
  fixedAmount: string | null;
  /** NULL untuk fixed_goods. */
  rate: string | null;
  /** NULL = percentage tanpa cap. */
  capAmount: string | null;
  paramsVersion: number;
}

interface Revision {
  id: string;
  revisionNo: number;
  draftVersion: number;
  name: string | null;
  currency: string | null;
  minSubtotal: string | null;
  startAt: string | null;
  endAt: string | null;
  schemaVersion: number;
  engineVersion: number;
  publishedAt: string | null;
  benefit: Benefit | null;
}

interface Usage {
  reservedCount: number;
  consumedCount: number;
  reservedAmount: string;
  consumedAmount: string;
  version: number;
  updatedAt: string;
}

interface CodeLabel {
  id: string;
  maskedCode: string;
  code?: string;
  state: "active" | "inactive" | "archived";
  version: number;
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
}

interface Detail {
  id: string;
  key: string;
  activationKind: string;
  state: "draft" | "enabled" | "paused" | "archived";
  currentRevisionId: string | null;
  version: number;
  draftVersion: number;
  policyVersion: number;
  perClientLimit: number;
  quotaCount: number | null;
  budgetAmount: string | null;
  createdAt: string;
  updatedAt: string;
  liveRevision: Revision | null;
  draftRevision: Revision | null;
  codes: CodeLabel[];
  codeLiteralVisible: boolean;
  usage: Usage | null;
}

interface SimulationLine {
  variantId: string;
  quantity: number;
  sourceUnitPrice: string;
  effectiveUnitPrice: string;
  markdownAmount: string;
  netLineAmount: string;
  goodsDiscountAmount: string;
}

interface SimulationResult {
  simulation: true;
  offerId: string;
  draftRevisionId: string;
  draftVersion: number;
  benefit:
    | { kind: "fixed_goods"; paramsVersion: number; fixedAmount: string }
    | { kind: "percentage_goods"; paramsVersion: number; rate: string; capAmount: string | null }
    | { kind: "shipping"; paramsVersion: number; capAmount: string };
  applied: boolean;
  eligible: boolean;
  minSubtotal: string;
  breakdown: {
    subtotal: string;
    goodsDiscount: string;
    netGoods: string;
    shippingBeforeSubsidy: string;
    shippingSubsidy: string;
    shippingNet: string;
    taxableBase: string;
    ppnRatePercent: string;
    ppnAmount: string;
    total: string;
    expectedProviderPayable: string;
    lines: SimulationLine[];
  };
  notice: string;
}

interface UsageEntry {
  id: string;
  orderId: string;
  status: "reserved" | "consumed" | "released";
  activationKind: "public" | "manual_only";
  codeId: string | null;
  maskedCode: string | null;
  benefitAmount: string;
  revisionNo: number;
  policyVersion: number;
  branch: { id: string; name: string } | null;
  customer: { id: string; name: string | null } | null;
  order: {
    status: string;
    paymentStatus: string;
    fulfillmentMethod: string;
    fulfillmentBlocked: boolean;
    fulfillmentBlockedReason: string | null;
  };
  review: { latePaidReview: boolean };
  reservedAt: string;
  consumedAt: string | null;
  releasedAt: string | null;
}

interface UsageResult {
  offerId: string;
  capacity: {
    quotaCount: number | null;
    budgetAmount: string | null;
    perClientLimit: number;
  };
  usage: Usage | null;
  availability: {
    basis: "global";
    consumedCount: number;
    heldCount: number;
    consumedAmount: string;
    heldAmount: string;
    availableCount: number | null;
    availableAmount: string | null;
  };
  drift: {
    detected: boolean;
    action: "review_required" | null;
    mismatched: string[];
    projection: {
      reservedCount: number;
      consumedCount: number;
      reservedAmount: string;
      consumedAmount: string;
    };
    ledger: {
      reservedCount: number;
      consumedCount: number;
      reservedAmount: string;
      consumedAmount: string;
    };
  };
  entriesAccess: "aggregate_only" | "scoped";
  scope: { mode: "all" } | { mode: "own"; branchId: string } | null;
  entries: {
    items: UsageEntry[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  } | null;
  note: string;
}

interface HistoryEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  policyVersion: number | null;
  actor: {
    id: string | null;
    identity: string | null;
    label: string | null;
    available: boolean;
  };
  references: {
    revisionId: string | null;
    revisionNo: number | null;
    draftRevisionId: string | null;
    draftVersion: number | null;
    codeId: string | null;
    maskedCode: string | null;
  };
  changes: unknown;
  createdAt: string;
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    data?: T;
    error?: string;
    code?: string;
  };
  if (!response.ok || !body.success) {
    throw new ApiError(
      body.error ?? "Permintaan gagal",
      body.code ?? "ERROR",
      response.status
    );
  }
  return body.data as T;
}

const CODE_STATE_LABEL: Record<CodeLabel["state"], string> = {
  active: "Aktif",
  inactive: "Nonaktif",
  archived: "Arsip",
};

const STATE_LABEL: Record<Detail["state"], string> = {
  draft: "Draft",
  enabled: "Aktif",
  paused: "Dijeda",
  archived: "Diarsipkan",
};

const HISTORY_LABEL: Record<string, string> = {
  DISCOUNT_OFFER_DRAFT_CREATED: "Draft dibuat",
  DISCOUNT_OFFER_DRAFT_SAVED: "Draft disimpan",
  DISCOUNT_OFFER_PUBLISHED: "Dipublikasikan",
  DISCOUNT_OFFER_STATE_CHANGED: "Status diubah",
  DISCOUNT_OFFER_POLICY_CHANGED: "Kapasitas diubah",
};

function rupiah(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return `Rp ${Number(value).toLocaleString("id-ID")}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Stored instant -> WIB `datetime-local` value (server stays the authority). */
function toWibInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const wib = new Date(new Date(iso).getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 16);
}

/** WIB `datetime-local` value -> explicit-offset ISO instant. */
function fromWibInput(local: string): string | null {
  if (!local) return null;
  return `${local}:00+07:00`;
}

function HistoryChanges({ changes }: { changes: unknown }) {
  if (!changes || typeof changes !== "object") return null;
  const event = changes as Record<string, unknown>;
  // Render only operational fields, not request keys/fingerprints or arbitrary payloads.
  const fields = ["quotaCount", "budgetAmount", "perClientLimit", "name", "currency", "minSubtotal", "startAt", "endAt", "kind", "fixedAmount", "rate", "capAmount", "state", "revisionId", "maskedCode", "benefit"];
  function safe(value: unknown): unknown {
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => fields.includes(key)).map(([key, entry]) => [key, safe(entry)]));
  }
  const before = event.before ?? (event.fromState ? { state: event.fromState, revisionId: event.fromRevisionId } : null);
  const after = event.after ?? event.terms ?? event.capacity ?? { state: event.toState, revisionId: event.toRevisionId, maskedCode: event.maskedCode };
  return <details className="mt-2"><summary className="cursor-pointer font-medium">Lihat perubahan</summary>
    <dl className="mt-2 grid gap-3 sm:grid-cols-2">{[["Sebelum", before], ["Sesudah", after]].map(([label, value]) => <div key={String(label)} className="min-w-0 rounded-md bg-muted/30 p-3">
      <dt className="font-medium">{String(label)}</dt><dd><pre className="whitespace-pre-wrap break-all text-xs">{value ? JSON.stringify(safe(value), null, 2) : "Tidak dicatat pada event ini"}</pre></dd>
    </div>)}</dl>
  </details>;
}

export function DiscountOfferEditorClient({ offerId }: { offerId: string }) {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("discounts", "edit");
  const canCapacity = hasPermission("discount_capacity", "edit");

  const [detail, setDetail] = useState<Detail | null>(null);
  const [usage, setUsage] = useState<UsageResult | null>(null);
  const [usageStatus, setUsageStatus] = useState("");
  const [tab, setTab] = useState("aturan");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [draftForm, setDraftForm] = useState({
    name: "",
    minSubtotal: "0",
    startAt: "",
    endAt: "",
    benefitKind: "fixed_goods" as
      | "fixed_goods"
      | "percentage_goods"
      | "shipping",
    fixedAmount: "",
    rate: "",
    capAmount: "",
  });
  const [capacityForm, setCapacityForm] = useState({
    quota: "",
    budget: "",
    perClient: "1",
  });
  const [simForm, setSimForm] = useState({
    variantId: "sim-1",
    unitPrice: "150000",
    quantity: "1",
    fulfillment: "pickup" as "pickup" | "delivery",
    shipping: "0",
  });
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [savedDraftForm, setSavedDraftForm] = useState("");
  const reviewTrigger = useRef<HTMLButtonElement>(null);
  const running = useRef(false);
  const draftDirty = JSON.stringify(draftForm) !== savedDraftForm;
  const [newCode, setNewCode] = useState("");
  const [confirm, setConfirm] = useState<{
    state: "enabled" | "paused" | "archived";
    title: string;
    description: string;
  } | null>(null);

  const loadUsage = useCallback(
    async (page: number, status: string) => {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (status) params.set("status", status);
      const nextUsage = await request<UsageResult>(
        `/api/admin/discounts/${offerId}/usage?${params.toString()}`
      );
      setUsage(nextUsage);
    },
    [offerId]
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextDetail, nextHistory] = await Promise.all([
        request<Detail>(`/api/admin/discounts/${offerId}`),
        request<HistoryEntry[]>(`/api/admin/discounts/${offerId}/history`),
      ]);
      setDetail(nextDetail);
      setHistory(nextHistory);
      await loadUsage(1, "");
      setUsageStatus("");
      setNeedsReload(false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Gagal memuat offer");
    } finally {
      setLoading(false);
    }
  }, [offerId, loadUsage]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the forms aligned with the freshly loaded versions. A successful save
  // bumps the versions, so the inputs re-seed from the persisted draft.
  useEffect(() => {
    if (!detail) return;
    const source = detail.draftRevision ?? detail.liveRevision;
    const nextForm = {
      name: source?.name ?? "",
      minSubtotal: source?.minSubtotal ?? "0",
      startAt: toWibInput(source?.startAt),
      endAt: toWibInput(source?.endAt),
      benefitKind:
        source?.benefit?.kind === "percentage_goods"
          ? "percentage_goods"
          : source?.benefit?.kind === "shipping"
            ? "shipping"
            : "fixed_goods" as "fixed_goods" | "percentage_goods" | "shipping",
      fixedAmount: source?.benefit?.fixedAmount ?? "",
      rate: source?.benefit?.rate ?? "",
      capAmount: source?.benefit?.capAmount ?? "",
    };
    setDraftForm(nextForm);
    setSavedDraftForm(JSON.stringify(nextForm));
    setCapacityForm({
      quota: detail.quotaCount === null ? "" : String(detail.quotaCount),
      budget: detail.budgetAmount ?? "",
      perClient: String(detail.perClientLimit),
    });
    setSimulation(null);
    setReview(null);
  }, [detail]);

  useEffect(() => { setReview(null); }, [draftForm, capacityForm]);

  async function run(key: string, action: () => Promise<void>): Promise<void> {
    if (running.current) return;
    running.current = true;
    if (key !== "review" && key !== "publish") setReview(null);
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (caught) {
      const message =
        caught instanceof ApiError ? caught.message : "Terjadi kesalahan";
      if (caught instanceof ApiError && caught.status === 409) {
        setReview(null);
        setNeedsReload(true);
      }
      setError(message);
      toast.error(message);
    } finally {
      running.current = false;
      setBusy(null);
    }
  }

  async function saveDraft(): Promise<void> {
    if (!detail) return;
    await run("draft", async () => {
      await request<Detail>(`/api/admin/discounts/${offerId}/draft`, {
        method: "PUT",
        body: JSON.stringify({
          expectedOfferVersion: detail.version,
          expectedDraftVersion: detail.draftVersion,
          terms: {
            name: draftForm.name,
            currency: "IDR",
            minSubtotal: draftForm.minSubtotal,
            startAt: fromWibInput(draftForm.startAt),
            endAt: fromWibInput(draftForm.endAt),
            // Hanya field milik kind terpilih yang dikirim: server menolak
            // campuran fixed+percentage, bukan mengabaikannya.
            benefit:
              draftForm.benefitKind === "percentage_goods"
                ? {
                    kind: "percentage_goods",
                    paramsVersion: 1,
                    rate: draftForm.rate,
                    capAmount: draftForm.capAmount === "" ? null : draftForm.capAmount,
                  }
                : draftForm.benefitKind === "shipping"
                  ? {
                      kind: "shipping",
                      paramsVersion: 1,
                      capAmount: draftForm.capAmount,
                    }
                  : {
                      kind: "fixed_goods",
                      paramsVersion: 1,
                      fixedAmount: draftForm.fixedAmount,
                    },
          },
        }),
      });
      toast.success("Draft disimpan");
      await load();
    });
  }

  async function saveCapacity(): Promise<void> {
    if (!detail) return;
    await run("capacity", async () => {
      await request<Detail>(`/api/admin/discounts/${offerId}/policy`, {
        method: "PATCH",
        body: JSON.stringify({
          requestKey: crypto.randomUUID(),
          expectedOfferVersion: detail.version,
          expectedPolicyVersion: detail.policyVersion,
          quotaCount: capacityForm.quota ? Number(capacityForm.quota) : null,
          budgetAmount: capacityForm.budget ? capacityForm.budget : null,
          perClientLimit: Number(capacityForm.perClient),
        }),
      });
      toast.success("Kapasitas disimpan");
      await load();
    });
  }

  async function simulate(): Promise<void> {
    if (!detail) return;
    await run("simulate", async () => {
      const result = await request<SimulationResult>(
        `/api/admin/discounts/${offerId}/simulate`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedDraftVersion: detail.draftVersion,
            fulfillmentMethod: simForm.fulfillment,
            shippingCost: simForm.fulfillment === "delivery" ? simForm.shipping : "0",
            lines: [
              {
                variantId: simForm.variantId,
                unitPrice: simForm.unitPrice,
                quantity: Number(simForm.quantity),
              },
            ],
          }),
        }
      );
      setSimulation(result);
    });
  }

  async function runReview(): Promise<void> {
    if (!detail || draftDirty || needsReload || !canEdit || running.current) return;
    setReview(null);
    setReviewOpen(true);
    await run("review", async () => {
      const result = await request<ReviewResult>(
        `/api/admin/discounts/${offerId}/review`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedOfferVersion: detail.version,
            expectedDraftVersion: detail.draftVersion,
          }),
        }
      );
      setReview(result);
    });
  }

  async function publish(): Promise<void> {
    if (!detail || !review || draftDirty || needsReload || !review.canPublish) return;
    await run("publish", async () => {
      await request<Detail>(`/api/admin/discounts/${offerId}/publish`, {
        method: "POST",
        body: JSON.stringify({
          requestKey: crypto.randomUUID(),
          expectedOfferVersion: review.offerVersion,
          expectedDraftVersion: review.draftVersion,
          expectedPolicyVersion: review.policyVersion,
          reviewFingerprint: review.fingerprint,
        }),
      });
      toast.success("Promo dipublikasikan");
      setReviewOpen(false);
      setReview(null);
      await load();
    });
  }

  /**
   * Reservasi canonical terjadi di transaksi add-code; mengetik di input tidak
   * pernah menulis kode. Request key + expectedOfferVersion menjaga lost
   * response tidak menggandakan code/audit atau menimpa edit stale.
   */
  async function addManualCode(): Promise<void> {
    if (!detail) return;
    const code = newCode.trim();
    if (code.length < 3) return;
    await run("code-add", async () => {
      await request<Detail>(`/api/admin/discounts/${offerId}/codes`, {
        method: "POST",
        body: JSON.stringify({
          requestKey: crypto.randomUUID(),
          code,
          expectedOfferVersion: detail.version,
        }),
      });
      toast.success("Kode manual ditambahkan");
      setNewCode("");
      await load();
    });
  }

  async function changeCodeState(
    code: CodeLabel,
    state: "active" | "inactive" | "archived"
  ): Promise<void> {
    if (!detail) return;
    await run(`code-${code.id}`, async () => {
      await request<Detail>(
        `/api/admin/discounts/${offerId}/codes/${code.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            expectedOfferVersion: detail.version,
            expectedCodeVersion: code.version,
            state,
          }),
        }
      );
      toast.success(`Status kode: ${CODE_STATE_LABEL[state]}`);
      await load();
    });
  }

  async function changeState(
    state: "enabled" | "paused" | "archived"
  ): Promise<void> {
    if (!detail) return;
    await run("state", async () => {
      await request<Detail>(`/api/admin/discounts/${offerId}/state`, {
        method: "PATCH",
        body: JSON.stringify({
          requestKey: crypto.randomUUID(),
          expectedVersion: detail.version,
          state,
        }),
      });
      toast.success(`Status offer: ${STATE_LABEL[state]}`);
      setConfirm(null);
      await load();
    });
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Memuat offer…
      </div>
    );
  }

  if (!detail) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Offer tidak ditemukan</CardTitle>
          <CardDescription>{error ?? "Offer tidak tersedia."}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/admin/discounts">
              <ArrowLeft className="mr-2 h-4 w-4" /> Kembali ke daftar
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const simulationPanel = (<details className="rounded-lg border bg-background p-1"><summary className="cursor-pointer px-5 py-3 font-medium">Simulasi biaya</summary><Card>
        <CardHeader>
          <CardTitle>Simulasi pricing</CardTitle>
          <CardDescription>
            Memakai interface pricing yang sama dengan jalur customer. Ini
            simulasi: bukan quote, bukan order, tidak menahan stok/kapasitas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-2">
              <Label htmlFor="sim-variant">Variant ID</Label>
              <Input
                id="sim-variant"
                value={simForm.variantId}
                onChange={(event) =>
                  setSimForm((current) => ({
                    ...current,
                    variantId: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sim-price">Harga satuan (Rp)</Label>
              <Input
                id="sim-price"
                inputMode="numeric"
                value={simForm.unitPrice}
                onChange={(event) =>
                  setSimForm((current) => ({
                    ...current,
                    unitPrice: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sim-qty">Qty</Label>
              <Input
                id="sim-qty"
                inputMode="numeric"
                value={simForm.quantity}
                onChange={(event) =>
                  setSimForm((current) => ({
                    ...current,
                    quantity: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Fulfillment</Label>
              <Select
                value={simForm.fulfillment}
                onValueChange={(value) =>
                  setSimForm((current) => ({
                    ...current,
                    fulfillment: value as "pickup" | "delivery",
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pickup">Pickup</SelectItem>
                  <SelectItem value="delivery">Delivery</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sim-shipping">Ongkir (Rp)</Label>
              <Input
                id="sim-shipping"
                inputMode="numeric"
                value={simForm.shipping}
                disabled={simForm.fulfillment === "pickup"}
                onChange={(event) =>
                  setSimForm((current) => ({
                    ...current,
                    shipping: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          <Button
            onClick={() => void simulate()}
            disabled={busy !== null || !detail.draftRevision}
            variant="outline"
          >
            {busy === "simulate" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <PlayCircle className="mr-2 h-4 w-4" />
            )}
            Jalankan simulasi
          </Button>
          {!detail.draftRevision ? (
            <p className="text-sm text-muted-foreground">
              Simpan draft dengan benefit goods terlebih dahulu.
            </p>
          ) : null}

          {simulation ? (
            <div className="space-y-3">
              <div className="rounded-md border p-3 text-sm">
                <p className="font-medium">
                  {simulation.applied
                    ? "Benefit diterapkan"
                    : "Tidak diterapkan (minimum belum terpenuhi atau benefit Rp0)"}
                </p>
                <div className="mt-2 grid gap-1 sm:grid-cols-2">
                  <span>Subtotal: {rupiah(simulation.breakdown.subtotal)}</span>
                  <span>
                    Diskon barang: {rupiah(simulation.breakdown.goodsDiscount)}
                  </span>
                  <span>Net barang: {rupiah(simulation.breakdown.netGoods)}</span>
                  <span>
                    Ongkir asli: {rupiah(simulation.breakdown.shippingBeforeSubsidy)}
                  </span>
                  <span>
                    Subsidi ongkir: {rupiah(simulation.breakdown.shippingSubsidy)}
                  </span>
                  <span>
                    Ongkir net: {rupiah(simulation.breakdown.shippingNet)}
                  </span>
                  <span>
                    PPN {simulation.breakdown.ppnRatePercent}%:{" "}
                    {rupiah(simulation.breakdown.ppnAmount)}
                  </span>
                  <span className="font-semibold">
                    Total: {rupiah(simulation.breakdown.total)}
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {simulation.notice}
                </p>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Variant</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Harga source</TableHead>
                      <TableHead>Diskon</TableHead>
                      <TableHead>Net line</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {simulation.breakdown.lines.map((line) => (
                      <TableRow key={line.variantId}>
                        <TableCell>{line.variantId}</TableCell>
                        <TableCell>{line.quantity}</TableCell>
                        <TableCell>{rupiah(line.sourceUnitPrice)}</TableCell>
                        <TableCell>{rupiah(line.goodsDiscountAmount)}</TableCell>
                        <TableCell>{rupiah(line.netLineAmount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card></details>);
  const title =
    detail.liveRevision?.name ??
    detail.draftRevision?.name ??
    "Draft diskon belum lengkap";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
            <Link href="/admin/discounts">
              <ArrowLeft className="mr-2 h-4 w-4" /> Daftar diskon
            </Link>
          </Button>
          <h1 className="text-2xl font-bold text-foreground">{title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge
              variant={
                detail.state === "enabled"
                  ? "default"
                  : detail.state === "archived"
                    ? "destructive"
                    : detail.state === "paused"
                      ? "outline"
                      : "secondary"
              }
            >
              {STATE_LABEL[detail.state]}
            </Badge>
            <span>{detail.activationKind === "public" ? "Kupon publik" : "Kode promo"}</span>
            <span>{detail.liveRevision ? `Live: Revision ${detail.liveRevision.revisionNo}` : "Belum dipublish"}</span>
            {detail.draftRevision && detail.liveRevision ? <Badge variant="secondary">Ada perubahan draft</Badge> : null}
          </div>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            {detail.state === "enabled" ? (
              <Button
                variant="outline"
                onClick={() =>
                  setConfirm({
                    state: "paused",
                    title: "Jeda promo?",
                    description:
                      "Offer berhenti menerima pemakaian baru. Hold yang sudah ada tidak dibatalkan dan usage tidak di-reset.",
                  })
                }
              >
                Jeda
              </Button>
            ) : null}
            {detail.state === "paused" ? (
              <Button
                variant="outline"
                onClick={() =>
                  setConfirm({
                    state: "enabled",
                    title: "Aktifkan kembali?",
                    description:
                      "Offer kembali live memakai revision yang sudah terbit. Draft yang belum di-publish tidak otomatis diterbitkan.",
                  })
                }
              >
                Aktifkan
              </Button>
            ) : null}
            {detail.state !== "archived" ? (
              <Button
                variant="outline"
                onClick={() =>
                  setConfirm({
                    state: "archived",
                    title: "Arsipkan promo?",
                    description:
                      "Arsip bukan hard delete: identitas, revision terbit, usage, dan histori tetap disimpan.",
                  })
                }
              >
                Arsipkan
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
          {needsReload ? <Button className="ml-2" variant="outline" disabled={busy !== null} onClick={() => void load()}>Muat versi terbaru</Button> : null}
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={setTab} className="min-w-0 space-y-6">
        <div className="max-w-full overflow-x-auto">
          <TabsList aria-label="Detail promo">
            <TabsTrigger value="aturan">Aturan</TabsTrigger>
            <TabsTrigger value="kode">Kode</TabsTrigger>
            <TabsTrigger value="pemakaian">Pemakaian &amp; budget</TabsTrigger>
            <TabsTrigger value="riwayat">Riwayat</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="aturan" className="space-y-6 min-w-0">
        <Card>
          <CardHeader>
            <CardTitle><h2>Aturan promo</h2></CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <fieldset className="min-w-0 space-y-4 border-b pb-6">
              <legend className="text-sm font-semibold">Identitas promo</legend>
            <div className="space-y-2">
              <Label htmlFor="offer-name">Nama promo</Label>
              <Input
                id="offer-name"
                value={draftForm.name}
                disabled={!canEdit || busy !== null}
                onChange={(event) =>
                  setDraftForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Diskon Rp17.000 Sepatu Pilihan"
              />
            </div>
            </fieldset>
            <fieldset className="min-w-0 space-y-4 border-b pb-6">
              <legend className="text-sm font-semibold">Potongan</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="offer-min">Minimum subtotal (Rp)</Label>
                <Input
                  id="offer-min"
                  aria-describedby="offer-min-hint"
                  inputMode="numeric"
                  value={draftForm.minSubtotal}
                  disabled={!canEdit || busy !== null}
                  onChange={(event) =>
                    setDraftForm((current) => ({
                      ...current,
                      minSubtotal: event.target.value,
                    }))
                  }
                />
                <p id="offer-min-hint" className="text-xs text-muted-foreground">Dihitung setelah harga coret. Isi 0 jika tanpa minimum.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="offer-benefit-kind">Jenis benefit</Label>
                <Select
                  value={draftForm.benefitKind}
                  disabled={!canEdit || busy !== null}
                  onValueChange={(value) =>
                    setDraftForm((current) => ({
                      ...current,
                      benefitKind:
                        value === "percentage_goods"
                          ? "percentage_goods"
                          : value === "shipping"
                            ? "shipping"
                            : "fixed_goods",
                    }))
                  }
                >
                  <SelectTrigger id="offer-benefit-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed_goods">Nominal tetap (Rp)</SelectItem>
                    <SelectItem value="percentage_goods">Persentase barang</SelectItem>
                    <SelectItem value="shipping">Subsidi ongkir (cap Rp)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {draftForm.benefitKind === "fixed_goods" ? (
              <div className="space-y-2">
                <Label htmlFor="offer-fixed">Nominal potongan barang (Rp)</Label>
                <Input
                  id="offer-fixed"
                  inputMode="numeric"
                  value={draftForm.fixedAmount}
                  disabled={!canEdit || busy !== null}
                  onChange={(event) =>
                    setDraftForm((current) => ({
                      ...current,
                      fixedAmount: event.target.value,
                    }))
                  }
                  placeholder="17000"
                />
                <p className="text-xs text-muted-foreground">
                  Berlaku sekali per order, maksimal sebesar subtotal setelah harga coret.
                </p>
              </div>
            ) : draftForm.benefitKind === "shipping" ? (
              <div className="space-y-2">
                <Label htmlFor="offer-shipping-cap">Maksimum subsidi ongkir (Rp)</Label>
                <Input
                  id="offer-shipping-cap"
                  inputMode="numeric"
                  value={draftForm.capAmount}
                  disabled={!canEdit || busy !== null}
                  onChange={(event) =>
                    setDraftForm((current) => ({
                      ...current,
                      capAmount: event.target.value,
                    }))
                  }
                  placeholder="20000"
                />
                <p className="text-xs text-muted-foreground">
                  Harus lebih dari 0. Berlaku untuk delivery, maksimal sebesar ongkir; sisa subsidi tidak dapat digunakan kembali. Semua kurir.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="offer-rate">Persentase (%)</Label>
                  <Input
                    id="offer-rate"
                    inputMode="decimal"
                    value={draftForm.rate}
                    disabled={!canEdit || busy !== null}
                    onChange={(event) =>
                      setDraftForm((current) => ({
                        ...current,
                        rate: event.target.value,
                      }))
                    }
                    placeholder="10"
                  />
                  <p className="text-xs text-muted-foreground">
                    Lebih dari 0 hingga 100%, maksimal 6 angka desimal. Potongan dari subtotal setelah harga coret, dibulatkan ke bawah.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="offer-cap">Maksimum potongan (Rp, opsional)</Label>
                  <Input
                    id="offer-cap"
                    inputMode="numeric"
                    value={draftForm.capAmount}
                    disabled={!canEdit || busy !== null}
                    onChange={(event) =>
                      setDraftForm((current) => ({
                        ...current,
                        capAmount: event.target.value,
                      }))
                    }
                    placeholder="Kosongkan jika tanpa cap"
                  />
                  <p className="text-xs text-muted-foreground">
                    Batas potongan per order, bukan per barang. Kosongkan jika tanpa batas.
                  </p>
                </div>
              </div>
            )}
            </fieldset>
            <fieldset className="min-w-0 space-y-4">
              <legend className="text-sm font-semibold">Jadwal</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="offer-start">Mulai (WIB)</Label>
                <Input
                  id="offer-start"
                  aria-describedby="offer-schedule-hint"
                  type="datetime-local"
                  value={draftForm.startAt}
                  disabled={!canEdit || busy !== null}
                  onChange={(event) =>
                    setDraftForm((current) => ({
                      ...current,
                      startAt: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="offer-end">Berakhir (WIB)</Label>
                <Input
                  id="offer-end"
                  aria-describedby="offer-schedule-hint"
                  type="datetime-local"
                  value={draftForm.endAt}
                  disabled={!canEdit || busy !== null}
                  onChange={(event) =>
                    setDraftForm((current) => ({
                      ...current,
                      endAt: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <p id="offer-schedule-hint" className="text-xs text-muted-foreground">
              Berlaku mulai waktu yang dipilih dan berhenti tepat pada waktu berakhir. Kosongkan tanggal jika tanpa batas waktu.
            </p>
            </fieldset>
            <p className="text-xs text-muted-foreground">Hanya untuk customer dengan email akun store terverifikasi. Nominal dalam Rupiah utuh.</p>
            <div className="space-y-3 border-t pt-5">
              {canEdit ? <>
                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={() => void saveDraft()} disabled={busy !== null}>
                    {busy === "draft" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Simpan draft
                  </Button>
                  <Button ref={reviewTrigger} variant="outline" onClick={() => void runReview()} disabled={busy !== null || !detail.draftRevision || draftDirty || needsReload}>Review perubahan</Button>
                  {draftDirty ? <span role="status" className="text-sm text-muted-foreground">Belum disimpan — simpan draft sebelum review.</span> : null}
                </div>
                <p className="text-sm text-muted-foreground">Menyimpan draft tidak mengaktifkan promo.</p>
              </> : <p className="text-sm text-muted-foreground">Anda hanya memiliki akses lihat.</p>}
            </div>
          </CardContent>
        </Card>
        {simulationPanel}
        </TabsContent>
        <TabsContent value="pemakaian" className="space-y-6 min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Kapasitas</CardTitle>
            <CardDescription>
              Minimal satu batas, kuota atau budget, wajib diisi sebelum publish.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="offer-quota">Kuota pemakaian</Label>
                <Input
                  id="offer-quota"
                  inputMode="numeric"
                  value={capacityForm.quota}
                  disabled={!canEdit || busy !== null}
                  onChange={(event) =>
                    setCapacityForm((current) => ({
                      ...current,
                      quota: event.target.value,
                    }))
                  }
                  placeholder="kosong = tanpa kuota"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="offer-budget">Budget (Rp)</Label>
                <Input
                  id="offer-budget"
                  inputMode="numeric"
                  value={capacityForm.budget}
                  disabled={!canEdit || busy !== null}
                  onChange={(event) =>
                    setCapacityForm((current) => ({
                      ...current,
                      budget: event.target.value,
                    }))
                  }
                  placeholder="kosong = tanpa budget"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="offer-per-client">Jatah per akun</Label>
              <Input
                id="offer-per-client"
                inputMode="numeric"
                value={capacityForm.perClient}
                disabled={!canEdit || busy !== null}
                onChange={(event) =>
                  setCapacityForm((current) => ({
                    ...current,
                    perClient: event.target.value,
                  }))
                }
              />
            </div>
            {!canCapacity ? (
              <p className="text-xs text-muted-foreground">
                Tanpa grant Kapasitas Diskon, perubahan yang memperbesar kuota,
                budget, atau jatah per akun akan ditolak server.
              </p>
            ) : null}
            <p className="rounded-md border bg-muted/30 px-4 py-3 text-sm">
              Simpan kapasitas langsung berlaku pada promo live, terpisah dari draft dan publish.
            </p>
            {canEdit ? (
              <Button
                onClick={() => void saveCapacity()}
                disabled={busy !== null}
                variant="outline"
              >
                {busy === "capacity" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Simpan kapasitas
              </Button>
            ) : null}

            {usage ? (
              <div className="rounded-md border p-3 text-sm">
                <p className="font-medium">Kapasitas global (otoritas)</p>
                <p className="text-muted-foreground">
                  consumed {usage.availability.consumedCount} · held{" "}
                  {usage.availability.heldCount} · tersedia{" "}
                  {usage.availability.availableCount ?? "∞"} pemakaian
                </p>
                <p className="text-muted-foreground">
                  Amount: consumed {rupiah(usage.availability.consumedAmount)} ·
                  held {rupiah(usage.availability.heldAmount)} · tersedia{" "}
                  {usage.availability.availableAmount === null
                    ? "∞"
                    : rupiah(usage.availability.availableAmount)}
                </p>
                {usage.drift.detected ? (
                  <p className="mt-2 rounded-md border border-amber-500/60 bg-amber-50 p-2 text-xs text-amber-900">
                    Projection drift terdeteksi ({usage.drift.mismatched.join(", ")}
                    ). Mutasi kapasitas/publish ditahan untuk review; tidak ada
                    reset/rebuild otomatis. Hentikan penggunaan baru dengan pause
                    bila perlu.
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-muted-foreground">{usage.note}</p>
              </div>
            ) : null}

            {usage ? (
              <div className="space-y-3 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      Pemakaian redemption{" "}
                      {usage.entriesAccess === "aggregate_only"
                        ? "(agregat saja)"
                        : usage.scope?.mode === "own"
                          ? "(cabang Anda)"
                          : "(semua cabang)"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Global consumed/held di atas tidak sama dengan total daftar
                      yang di-scope.
                    </p>
                  </div>
                  <select
                    aria-label="Filter status pemakaian"
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                    value={usageStatus}
                    onChange={(event) => {
                      const next = event.target.value;
                      setUsageStatus(next);
                      void loadUsage(1, next);
                    }}
                  >
                    <option value="">Semua status</option>
                    <option value="reserved">Reserved</option>
                    <option value="consumed">Consumed</option>
                    <option value="released">Released</option>
                  </select>
                </div>

                {usage.entries === null ? (
                  <p className="text-sm text-muted-foreground">
                    Anda tidak memiliki grant Orders:view, jadi hanya agregat
                    global yang ditampilkan — tanpa identitas order/customer.
                  </p>
                ) : usage.entries.items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Tidak ada redemption pada filter ini.
                  </p>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Order</TableHead>
                            <TableHead>Cabang</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Benefit</TableHead>
                            <TableHead>Kode</TableHead>
                            <TableHead>Review</TableHead>
                            <TableHead>Waktu</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {usage.entries.items.map((entry) => (
                            <TableRow key={entry.id}>
                              <TableCell>
                                <Link
                                  className="font-medium underline-offset-4 hover:underline"
                                  href={`/admin/orders/${entry.orderId}`}
                                >
                                  {entry.orderId.slice(0, 8)}
                                </Link>
                                <p className="text-xs text-muted-foreground">
                                  {entry.order.status} · {entry.order.paymentStatus}{" "}
                                  · {entry.order.fulfillmentMethod}
                                </p>
                              </TableCell>
                              <TableCell>
                                {entry.branch?.name ?? "—"}
                                {entry.customer ? (
                                  <p className="text-xs text-muted-foreground">
                                    {entry.customer.name ?? "Customer"}
                                  </p>
                                ) : null}
                              </TableCell>
                              <TableCell>{entry.status}</TableCell>
                              <TableCell>
                                {rupiah(entry.benefitAmount)}
                                <p className="text-xs text-muted-foreground">
                                  rev {entry.revisionNo} · policy v
                                  {entry.policyVersion}
                                </p>
                              </TableCell>
                              <TableCell>
                                {entry.maskedCode ?? "—"}
                                <p className="text-xs text-muted-foreground">
                                  {entry.activationKind}
                                </p>
                              </TableCell>
                              <TableCell>
                                {entry.review.latePaidReview ? (
                                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
                                    late paid review
                                  </span>
                                ) : null}
                                {entry.order.fulfillmentBlocked ? (
                                  <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-900">
                                    fulfillment blocked
                                  </span>
                                ) : null}
                                {!entry.review.latePaidReview &&
                                !entry.order.fulfillmentBlocked
                                  ? "—"
                                  : null}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                reserved {formatDate(entry.reservedAt)}
                                {entry.consumedAt
                                  ? ` · consumed ${formatDate(entry.consumedAt)}`
                                  : ""}
                                {entry.releasedAt
                                  ? ` · released ${formatDate(entry.releasedAt)}`
                                  : ""}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {usage.entries.total} entry · halaman{" "}
                        {usage.entries.page}/{Math.max(1, usage.entries.totalPages)}
                      </span>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={usage.entries.page <= 1 || busy !== null}
                          onClick={() => {
                            const next = usage.entries!.page - 1;
                            void loadUsage(next, usageStatus);
                          }}
                        >
                          Sebelumnya
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            usage.entries.page >= usage.entries.totalPages ||
                            busy !== null
                          }
                          onClick={() => {
                            const next = usage.entries!.page + 1;
                            void loadUsage(next, usageStatus);
                          }}
                        >
                          Berikutnya
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
        </TabsContent>
        <TabsContent value="kode" className="space-y-6 min-w-0">
      {detail.activationKind === "manual_only" ? (
        <Card>
          <CardHeader>
            <CardTitle>Kode manual</CardTitle>
            <CardDescription>
              Semua kode berbagi kuota, budget, dan jatah per akun promo ini.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {detail.codeLiteralVisible ? (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addManualCode();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="new-code">Tambah kode</Label>
                  <Input
                    id="new-code"
                    value={newCode}
                    disabled={!canEdit || busy !== null}
                    onChange={(event) => setNewCode(event.target.value)}
                    maxLength={64}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="HEMAT17AGUSTUS"
                    className="w-64 max-w-full font-mono uppercase"
                    aria-describedby="new-code-hint"
                  />
                  <p id="new-code-hint" className="text-xs text-muted-foreground">Kode dicadangkan saat berhasil ditambahkan; tidak dapat diubah atau dipindahkan ke promo lain.</p>
                </div>
                <Button
                  type="submit"
                  disabled={!canEdit || busy !== null || newCode.trim().length < 3}
                >
                  {busy === "code-add" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Tambah
                </Button>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">
                Anda hanya dapat melihat label masked. Literal kode hanya untuk
                promo editor.
              </p>
            )}
            {detail.codes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada kode.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kode</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.codes.map((code) => (
                    <TableRow key={code.id}>
                      <TableCell className="font-mono text-xs">
                        {detail.codeLiteralVisible && code.code
                          ? code.code
                          : code.maskedCode}
                      </TableCell>
                      <TableCell>
                        <Badge variant={code.state === "active" ? "default" : "secondary"}>
                          {CODE_STATE_LABEL[code.state]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {canEdit && detail.codeLiteralVisible ? (
                          <div className="flex justify-end gap-1">
                            {code.state === "active" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy !== null}
                                onClick={() => void changeCodeState(code, "inactive")}
                              >
                                Nonaktifkan
                              </Button>
                            ) : null}
                            {code.state === "inactive" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy !== null}
                                onClick={() => void changeCodeState(code, "active")}
                              >
                                Aktifkan
                              </Button>
                            ) : null}
                            {code.state !== "archived" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy !== null}
                                onClick={() => void changeCodeState(code, "archived")}
                              >
                                Arsipkan
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : <Card><CardContent className="pt-6">Kupon publik tidak memiliki kode. Customer memilih kupon langsung di checkout.</CardContent></Card>}
        </TabsContent>
        <TabsContent value="riwayat" className="space-y-6 min-w-0">
      <Card>
        <CardHeader>
          <CardTitle>Histori audit</CardTitle>
          <CardDescription>
            Catatan perubahan promo, pelaku, dan waktunya. Riwayat tidak dapat diubah; kode tetap disamarkan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada entri.</p>
          ) : (
            <ul className="space-y-2">
              {history.map((entry) => (
                <li
                  key={entry.id}
                  className="space-y-1 rounded-md border p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {HISTORY_LABEL[entry.action] ?? entry.action}
                    </span>
                    <span className="text-muted-foreground">
                      {formatDate(entry.createdAt)} · policy v
                      {entry.policyVersion ?? "—"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Aktor:{" "}
                    {entry.actor.available
                      ? entry.actor.label ?? entry.actor.identity ?? "—"
                      : `tidak tersedia (${entry.actor.identity ?? "unknown"})`}
                  </p>
                  {entry.references.revisionId ||
                  entry.references.draftRevisionId ||
                  entry.references.codeId ? (
                    <p className="text-xs text-muted-foreground">
                      {entry.references.revisionNo !== null
                        ? `revision ${entry.references.revisionNo} · `
                        : ""}
                      {entry.references.draftVersion !== null
                        ? `draft v${entry.references.draftVersion} · `
                        : ""}
                      {entry.references.codeId
                        ? `kode ${entry.references.maskedCode ?? entry.references.codeId}`
                        : ""}
                    </p>
                  ) : null}
                  <HistoryChanges changes={entry.changes} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>

      <DiscountReviewDialog open={reviewOpen} busy={busy} error={error} needsReload={needsReload} review={review}
        liveRevisionNo={detail.liveRevision?.revisionNo ?? null} draftRevisionNo={detail.draftRevision?.revisionNo ?? null}
        capacityNotice={`Kuota ${detail.quotaCount ?? "tidak dibatasi"} · budget ${detail.budgetAmount === null ? "tidak dibatasi" : rupiah(detail.budgetAmount)} · jatah ${detail.perClientLimit}/akun. Consumed ${usage?.availability.consumedCount ?? "—"} · Hold ${usage?.availability.heldCount ?? "—"}.`}
        triggerRef={reviewTrigger}
        onOpenChange={(open) => { setReviewOpen(open); if (!open) setReview(null); }}
        onPublish={() => void publish()}
        onReload={() => { setReviewOpen(false); void load(); }} />

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={confirm?.title}
        description={confirm?.description}
        loading={busy === "state"}
        confirmLabel="Ya, lanjutkan"
        onConfirm={() => {
          if (confirm) return changeState(confirm.state);
        }}
      />
    </div>
  );
}
