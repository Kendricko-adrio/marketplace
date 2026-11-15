"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface HistoryEntry {
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

export const HISTORY_LABEL: Record<string, string> = {
  DISCOUNT_OFFER_DRAFT_CREATED: "Draft dibuat",
  DISCOUNT_OFFER_DRAFT_SAVED: "Draft disimpan",
  DISCOUNT_OFFER_PUBLISHED: "Diterbitkan",
  DISCOUNT_OFFER_STATE_CHANGED: "Status diubah",
  DISCOUNT_OFFER_POLICY_CHANGED: "Kapasitas diubah",
  DISCOUNT_CODE_ADDED: "Kode ditambahkan",
  DISCOUNT_CODE_STATE_CHANGED: "Status kode diubah",
};

function formatDate(value: string): string {
  return new Date(value).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function rupiah(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  return `Rp ${BigInt(value).toLocaleString("id-ID")}`;
}

/** Perubahan dibaca manusiawi; request key, fingerprint, dan JSON mentah tidak ditampilkan. */
function describeChanges(changes: unknown): string[] {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return [];
  const event = changes as Record<string, unknown>;
  const lines: string[] = [];
  const before = (event.before ?? {}) as Record<string, unknown>;
  const after = (event.after ?? {}) as Record<string, unknown>;
  const money = (key: string) => rupiah(after[key]) ?? rupiah(before[key]);

  for (const [key, label] of [
    ["name", "Nama"],
    ["quotaCount", "Kuota"],
    ["perClientLimit", "Batas per customer"],
    ["state", "Status"],
  ] as const) {
    const previous = before[key];
    const next = after[key] ?? (key === "state" ? event.toState : undefined);
    if (next === undefined) continue;
    if (JSON.stringify(previous) === JSON.stringify(next)) continue;
    lines.push(`${label}: ${previous ?? "—"} → ${next}`);
  }
  for (const [key, label] of [
    ["budgetAmount", "Budget"],
    ["minSubtotal", "Minimum belanja"],
  ] as const) {
    const previous = rupiah(before[key]);
    const next = rupiah(after[key]);
    if (!previous && !next) continue;
    if (previous === next) continue;
    lines.push(`${label}: ${previous ?? "—"} → ${next ?? "—"}`);
  }
  const benefit = after.benefit ?? (after.kind ? after : null);
  if (benefit && typeof benefit === "object") {
    const row = benefit as Record<string, unknown>;
    if (row.kind === "fixed_goods") lines.push(`Potongan: nominal ${money("fixedAmount") ?? "—"}`);
    if (row.kind === "percentage_goods") lines.push(`Potongan: ${row.rate}% barang`);
    if (row.kind === "shipping") lines.push(`Potongan: subsidi ongkir maks ${money("capAmount") ?? "—"}`);
  }
  if (event.policyVersionAfter !== undefined) {
    lines.push(`Versi aturan: ${event.policyVersionAfter}`);
  }
  if (Array.isArray(event.codes)) {
    lines.push(`${event.codes.length} kode awal disiapkan`);
  }
  return lines;
}

export function DiscountHistoryList(props: { entries: HistoryEntry[] }) {
  if (props.entries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Riwayat</h2>
          </CardTitle>
          <CardDescription>Perubahan promo, pelaku, dan waktunya.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Belum ada riwayat.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Riwayat</h2>
        </CardTitle>
        <CardDescription>
          Catatan permanen; tidak dapat diubah dan kode tetap disamarkan.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {props.entries.map((entry) => {
            const details = describeChanges(entry.changes);
            return (
              <li key={entry.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {HISTORY_LABEL[entry.action] ?? "Perubahan promo"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(entry.createdAt)} WIB
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Oleh{" "}
                  {entry.actor.available
                    ? entry.actor.label ?? entry.actor.identity ?? "admin"
                    : "admin yang tidak lagi tersedia"}
                  {entry.references.revisionNo !== null
                    ? ` · revision ${entry.references.revisionNo}`
                    : ""}
                  {entry.references.draftVersion !== null
                    ? ` · draft v${entry.references.draftVersion}`
                    : ""}
                </p>
                {details.length ? (
                  <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
                    {details.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
