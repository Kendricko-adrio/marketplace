import { DiscountsListClient } from "./discounts-list-client";

// =========================================================
// /admin/discounts — Offer list (server gate: discounts:view via layout)
// =========================================================
// The list shows the live revision and draft state of every public Offer. The
// detail editor at /admin/discounts/[id] owns draft save, review, publish,
// pause/archive, capacity policy, simulation, usage and history.

export default function DiscountsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Diskon</h1>
        <p className="text-muted-foreground">
          Kelola Offer publik bertipe fixed-goods: simpan draft, tinjau
          perubahan, lalu publish atau jeda. Draft tidak pernah mengubah terms
          yang sedang live.
        </p>
      </div>
      <DiscountsListClient />
    </div>
  );
}
