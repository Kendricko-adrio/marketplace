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
  const [usageStatus, setUsageStatus] = useState("");
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
    setDraftForm({
      name: source?.name ?? "",
      minSubtotal: source?.minSubtotal ?? "0",
      startAt: toWibInput(source?.startAt),
      endAt: toWibInput(source?.endAt),
      benefitKind:
        source?.benefit?.kind === "percentage_goods"
          ? "percentage_goods"
          : source?.benefit?.kind === "shipping"
            ? "shipping"
            : "fixed_goods",
      fixedAmount: source?.benefit?.fixedAmount ?? "",
      rate: source?.benefit?.rate ?? "",
      capAmount: source?.benefit?.capAmount ?? "",
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
                <p className="text-xs text-muted-foreground">
                  Sekali per order, di-clip ke subtotal setelah Markdown.
                </p>
              </div>
            ) : draftForm.benefitKind === "shipping" ? (
              <div className="space-y-2">
                <Label htmlFor="offer-shipping-cap">Cap subsidi ongkir (Rp)</Label>
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
                  Wajib positif. Subsidi = min(ongkir sebelum subsidi, cap);
                  hanya delivery dengan ongkir positif, sisa hangus, tanpa
                  pembatasan kurir.
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
                    &gt;0 sampai 100, maksimal 6 digit pecahan. Benefit
                    dibulatkan floor dari subtotal setelah Markdown.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="offer-cap">Cap (Rp, opsional)</Label>
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
                    Cap berlaku sekali per order, bukan per baris/unit.
                  </p>
                </div>
              </div>
            )}
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
              Benefit goods version1: nominal tetap atau persentase dengan cap
              opsional. Subsidi ongkir dan kode manual dikelola terpisah.
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

      {detail.activationKind === "manual_only" ? (
        <Card>
          <CardHeader>
            <CardTitle>Kode manual</CardTitle>
            <CardDescription>
              Literal kode direservasi saat transaksi berhasil dan tidak dapat
              diubah atau dipindah ke Offer lain. Semua kode berbagi quota,
              budget, dan jatah akun Offer ini; viewer hanya melihat label
              masked.
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
                    className="w-64 font-mono uppercase"
                  />
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
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Histori audit</CardTitle>
          <CardDescription>
            Immutable: draft, publish, status, dan perubahan kapasitas/kode
            tercatat dengan revision, policy version, dan aktor saat aksi
            terjadi. Literal kode tidak pernah ditulis ke histori.
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
