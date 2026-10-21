"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Loader2, PlayCircle, XCircle } from "lucide-react";
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
import { useAuth } from "@/providers/auth-provider";

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
  fixedAmount: string;
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
  usage: Usage | null;
}

interface ReviewValidation {
  code: string;
  ok: boolean;
  message: string;
}

interface ReviewResult {
  offerId: string;
  offerVersion: number;
  draftVersion: number;
  policyVersion: number;
  liveRevisionId: string | null;
  draftRevisionId: string;
  stateAfter: string;
  validations: ReviewValidation[];
  canPublish: boolean;
  fingerprint: string;
  diff: {
    terms: Array<{ field: string; live: unknown; draft: unknown }>;
    benefit: { live: unknown; draft: unknown };
    capacity: { live: unknown; draft: unknown };
  };
  simulation: false;
  notice: string;
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
  benefit: { kind: string; paramsVersion: number; fixedAmount: string };
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

interface UsageResult {
  offerId: string;
  capacity: {
    quotaCount: number | null;
    budgetAmount: string | null;
    perClientLimit: number;
  };
  usage: Usage | null;
  remaining: { count: number | null; amount: string | null };
  note: string;
}

interface HistoryEntry {
  id: string;
  action: string;
  actorId: string | null;
  policyVersion: number | null;
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

const STATE_LABEL: Record<Detail["state"], string> = {
  draft: "Draft",
  enabled: "Aktif",
  paused: "Dijeda",
  archived: "Diarsipkan",
};

const VALIDATION_LABEL: Record<string, string> = {
  TERMS_COMPLETE: "Terms lengkap",
  BENEFIT_VALID: "Benefit fixed-goods valid",
  CAPACITY_BOUND: "Minimal satu batas kapasitas",
  WINDOW_ORDERED: "Jendela waktu valid",
  CODE_FREE: "Offer publik tanpa kode",
  LIVE_TERMS_IMMUTABLE: "Terms live tidak berubah",
};

const FIELD_LABEL: Record<string, string> = {
  name: "Nama",
  currency: "Mata uang",
  minSubtotal: "Minimum subtotal",
  startAt: "Mulai",
  endAt: "Berakhir",
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

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function DiscountOfferEditorClient({ offerId }: { offerId: string }) {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("discounts", "edit");
  const canCapacity = hasPermission("discount_capacity", "edit");

  const [detail, setDetail] = useState<Detail | null>(null);
  const [usage, setUsage] = useState<UsageResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [draftForm, setDraftForm] = useState({
    name: "",
    minSubtotal: "0",
    startAt: "",
    endAt: "",
    fixedAmount: "",
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
  const [confirm, setConfirm] = useState<{
    state: "enabled" | "paused" | "archived";
    title: string;
    description: string;
  } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextDetail, nextUsage, nextHistory] = await Promise.all([
        request<Detail>(`/api/admin/discounts/${offerId}`),
        request<UsageResult>(`/api/admin/discounts/${offerId}/usage`),
        request<HistoryEntry[]>(`/api/admin/discounts/${offerId}/history`),
      ]);
      setDetail(nextDetail);
      setUsage(nextUsage);
      setHistory(nextHistory);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Gagal memuat offer");
    } finally {
      setLoading(false);
    }
  }, [offerId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the forms aligned with the freshly loaded versions. A successful save
  // bumps the versions, so the inputs re-seed from the persisted draft.
  useEffect(() => {
    if (!detail) return;
    const source = detail.draftRevision ?? detail.liveRevision;
    setDraftForm({
      name: source?.name ?? "",
      minSubtotal: source?.minSubtotal ?? "0",
      startAt: toWibInput(source?.startAt),
      endAt: toWibInput(source?.endAt),
      fixedAmount: source?.benefit?.fixedAmount ?? "",
    });
    setCapacityForm({
      quota: detail.quotaCount === null ? "" : String(detail.quotaCount),
      budget: detail.budgetAmount ?? "",
      perClient: String(detail.perClientLimit),
    });
    setSimulation(null);
    setReview(null);
  }, [detail]);

  async function run(key: string, action: () => Promise<void>): Promise<void> {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (caught) {
      const message =
        caught instanceof ApiError ? caught.message : "Terjadi kesalahan";
      setError(message);
      toast.error(message);
    } finally {
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
            benefit: {
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
    if (!detail) return;
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
    if (!detail || !review) return;
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
      toast.success("Offer dipublikasikan");
      setReview(null);
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
            <span>Offer {detail.key.slice(0, 8)}</span>
            <span>·</span>
            <span>v{detail.version}</span>
            <span>·</span>
            <span>draft v{detail.draftVersion}</span>
            <span>·</span>
            <span>policy v{detail.policyVersion}</span>
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
                    title: "Jeda offer?",
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
                    title: "Arsipkan offer?",
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
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Terms draft</CardTitle>
            <CardDescription>
              Draft terpisah dari revision live. Menyimpan draft tidak mengubah
              terms yang dilihat customer. Nominal dalam Rupiah utuh.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="offer-name">Nama offer</Label>
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
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="offer-min">Minimum subtotal (Rp)</Label>
                <Input
                  id="offer-min"
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
              </div>
              <div className="space-y-2">
                <Label htmlFor="offer-fixed">Nominal fixed-goods (Rp)</Label>
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
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="offer-start">Mulai (WIB, inklusif)</Label>
                <Input
                  id="offer-start"
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
                <Label htmlFor="offer-end">Berakhir (WIB, eksklusif)</Label>
                <Input
                  id="offer-end"
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
            <p className="text-xs text-muted-foreground">
              Hanya benefit fixed-goods publik yang didukung. Percentage,
              subsidi ongkir, dan kode manual belum tersedia.
            </p>
            {canEdit ? (
              <Button onClick={() => void saveDraft()} disabled={busy !== null}>
                {busy === "draft" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Simpan draft
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Anda hanya memiliki akses lihat.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Kapasitas</CardTitle>
            <CardDescription>
              Minimal satu batas (kuota atau budget) wajib ada sebelum publish.
              Perubahan yang memperbesar kapasitas memerlukan grant Kapasitas
              Diskon.
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
                <p className="font-medium">Proyeksi usage</p>
                <p className="text-muted-foreground">
                  reserved {usage.usage?.reservedCount ?? 0} · consumed{" "}
                  {usage.usage?.consumedCount ?? 0} · sisa{" "}
                  {usage.remaining.count ?? "∞"} pemakaian
                </p>
                <p className="text-muted-foreground">
                  Amount: reserved {rupiah(usage.usage?.reservedAmount ?? "0")} ·
                  consumed {rupiah(usage.usage?.consumedAmount ?? "0")} · sisa{" "}
                  {usage.remaining.amount === null
                    ? "∞"
                    : rupiah(usage.remaining.amount)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{usage.note}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
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
              Simpan draft dengan benefit fixed-goods terlebih dahulu.
            </p>
          ) : null}

          {simulation ? (
            <div className="space-y-3">
              <div className="rounded-md border p-3 text-sm">
                <p className="font-medium">
                  {simulation.applied
                    ? "Benefit diterapkan"
                    : "Tidak memenuhi minimum — benefit tidak diterapkan"}
                </p>
                <div className="mt-2 grid gap-1 sm:grid-cols-2">
                  <span>Subtotal: {rupiah(simulation.breakdown.subtotal)}</span>
                  <span>
                    Diskon barang: {rupiah(simulation.breakdown.goodsDiscount)}
                  </span>
                  <span>Net barang: {rupiah(simulation.breakdown.netGoods)}</span>
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
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Review &amp; publish</CardTitle>
          <CardDescription>
            Review menghitung diff server-side dan fingerprint versi. Publish
            memakai fingerprint itu dan menolak (409) bila draft berubah setelah
            review.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void runReview()}
              disabled={busy !== null || !detail.draftRevision}
              variant="outline"
            >
              {busy === "review" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Review draft
            </Button>
            {review ? (
              <Button
                onClick={() => void publish()}
                disabled={busy !== null || !review.canPublish}
              >
                {busy === "publish" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Publish offer
              </Button>
            ) : null}
          </div>

          {review ? (
            <div className="space-y-4">
              <div className="space-y-1">
                {review.validations.map((validation) => (
                  <div
                    key={validation.code}
                    className="flex items-start gap-2 text-sm"
                  >
                    {validation.ok ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 text-destructive" />
                    )}
                    <span>
                      <span className="font-medium">
                        {VALIDATION_LABEL[validation.code] ?? validation.code}
                      </span>
                      {" — "}
                      <span className="text-muted-foreground">
                        {validation.message}
                      </span>
                    </span>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Field</TableHead>
                      <TableHead>Live</TableHead>
                      <TableHead>Draft</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {review.diff.terms.map((entry) => (
                      <TableRow key={entry.field}>
                        <TableCell className="font-medium">
                          {FIELD_LABEL[entry.field] ?? entry.field}
                        </TableCell>
                        <TableCell>{display(entry.live)}</TableCell>
                        <TableCell>{display(entry.draft)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <p className="text-xs text-muted-foreground">
                Review {review.canPublish ? "siap publish" : "belum siap publish"}
                {" · "}fingerprint {review.fingerprint.slice(0, 12)}… ·{" "}
                {review.notice}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Jalankan review untuk melihat diff dan validasi sebelum publish.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histori audit</CardTitle>
          <CardDescription>
            Immutable: draft, publish, status, dan perubahan kapasitas tercatat
            dengan policy version saat aksi terjadi.
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
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                >
                  <span className="font-medium">
                    {HISTORY_LABEL[entry.action] ?? entry.action}
                  </span>
                  <span className="text-muted-foreground">
                    {formatDate(entry.createdAt)} · policy v
                    {entry.policyVersion ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

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
