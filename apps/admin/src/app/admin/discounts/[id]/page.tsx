import { DiscountOfferEditorClient } from "./discount-editor-client";

// =========================================================
// /admin/discounts/[id] — Offer detail/editor (server gate via layout)
// =========================================================
// The client editor owns form state only; every mutation and every permission
// decision is re-validated by the API and inside the write transaction.

export default async function DiscountOfferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DiscountOfferEditorClient offerId={id} />;
}
