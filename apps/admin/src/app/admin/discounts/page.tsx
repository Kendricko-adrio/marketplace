import { DiscountsListClient } from "./discounts-list-client";

// =========================================================
// /admin/discounts — Offer list (server gate: discounts:view via layout)
// =========================================================
// The list shows the live revision and draft state of every public Offer. The
// detail editor at /admin/discounts/[id] owns draft save, review, publish,
// pause/archive, capacity policy, simulation, usage and history.

export default function DiscountsPage() {
  return (
    <div className="min-w-0 space-y-6">
      <div className="max-w-3xl space-y-1">
        <h1 className="text-2xl font-bold text-foreground">Diskon</h1>
        <p className="text-sm text-muted-foreground">
          Kelola kupon publik dan kode promo.
        </p>
      </div>
      <DiscountsListClient />
    </div>
  );
}
