"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { getStatusTone } from "@marketplace/ui/src/lib/status-presentation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/providers/auth-provider";
import type { DiscountEditorDetail } from "@/features/discounts/discount-editor-contracts";
import { DiscountCodesSection } from "./discount-codes-section";
import {
  EDITOR_TAB_LABEL,
  buildDraftConfiguration,
  createDiscountEditorState,
  discountEditorReducer,
  editorTabsFor,
  type EditorTab,
} from "./discount-editor-state";
import {
  DiscountHistoryList,
  type HistoryEntry,
} from "./discount-history-list";
import { DiscountReviewDialog, type ReviewResult } from "./discount-review-dialog";
import { DiscountSettingsSection } from "./discount-settings-section";
import {
  DiscountSimulationPanel,
  type SimulationForm,
  type SimulationResult,
} from "./discount-simulation-panel";

const STATE_LABEL: Record<string, string> = {
  draft: "Draft",
  enabled: "Aktif",
  paused: "Dijeda",
  archived: "Diarsipkan",
};

const FIELD_ID: Record<string, string> = {
  name: "discount-name",
  minSubtotal: "discount-min-subtotal",
  startAt: "discount-start",
  endAt: "discount-end",
  benefit: "discount-benefit-kind",
  "benefit.kind": "discount-benefit-kind",
  "benefit.fixedAmount": "discount-fixed-amount",
  "benefit.rate": "discount-rate",
  "benefit.capAmount": "discount-cap",
  "capacity.quotaCount": "discount-quota",
  "capacity.budgetAmount": "discount-budget",
  "capacity.perClientLimit": "discount-per-client",
  capacity: "discount-quota",
};

interface UsageEntry {
  id: string;
  orderId: string;
  status: "reserved" | "consumed" | "released";
  maskedCode: string | null;
  benefitAmount: string;
  revisionNo: number;
  branch: { id: string; name: string } | null;
  customer: { id: string; name: string | null } | null;
  order: { status: string; paymentStatus: string };
  reservedAt: string;
}

interface UsageResult {
  availability: {
    consumedCount: number;
    heldCount: number;
    consumedAmount: string;
    heldAmount: string;
    availableCount: number | null;
    availableAmount: string | null;
  };
  drift: { detected: boolean; mismatched: string[] };
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

class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly fieldErrors?: { path: string; message: string }[]
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
    fieldErrors?: { path: string; message: string }[];
  };
  if (!response.ok || !body.success) {
    throw new ApiError(
      body.error ?? "Permintaan gagal",
      body.code ?? "ERROR",
      response.status,
      body.fieldErrors
    );
  }
  return body.data as T;
}

function rupiah(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return `Rp ${BigInt(value).toLocaleString("id-ID")}`;
}

function formatDate(value: string): string {
  return `${new Date(value).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  })} WIB`;
}

export function DiscountOfferEditorClient({ offerId }: { offerId: string }) {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("discounts", "edit");

  const [state, dispatch] = useReducer(
    discountEditorReducer,
    null as unknown as ReturnType<typeof createDiscountEditorState>
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageResult | null>(null);
  const [usageStatus, setUsageStatus] = useState("");
  const [usagePage, setUsagePage] = useState(1);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [simForm, setSimForm] = useState<SimulationForm>({
    variantId: "sim-1",
    unitPrice: "150000",
    quantity: "1",
    fulfillment: "pickup",
    shipping: "0",
  });
  const [confirmState, setConfirmState] = useState<"enabled" | "paused" | "archived" | null>(null);
  const running = useRef(false);
  const reviewTrigger = useRef<HTMLButtonElement>(null);

  const loadUsage = useCallback(
    async (page: number, status: string) => {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (status) params.set("status", status);
      const next = await request<UsageResult>(
        `/api/admin/discounts/${offerId}/usage?${params.toString()}`
      );
      setUsage(next);
      setUsagePage(page);
    },
    [offerId]
  );

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [detail, entries] = await Promise.all([
        request<DiscountEditorDetail>(`/api/admin/discounts/${offerId}`),
        request<HistoryEntry[]>(`/api/admin/discounts/${offerId}/history`),
      ]);
      setHistory(entries);
      setSimulation(null);
      setReview(null);
      await loadUsage(1, "");
      setUsageStatus("");
      dispatch({ type: "reloaded", detail });
    } catch (caught) {
      setLoadError(caught instanceof ApiError ? caught.message : "Gagal memuat diskon");
    } finally {
      setLoading(false);
    }
  }, [offerId, loadUsage]);

  const initialLoad = useRef(false);

  useEffect(() => {
    // Muat sekali per editor: efek ganda (Strict Mode) tidak boleh
    // memuat ulang dan menimpa input yang sedang diketik.
    if (initialLoad.current) return;
    initialLoad.current = true;
    void load();
  }, [load]);

  // Peringatan browser untuk refresh/tutup tab; tidak menjanjikan pemulihan input.
  useEffect(() => {
    if (!state?.dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state?.dirty]);

  async function saveDraft(): Promise<DiscountEditorDetail | null> {
    if (!state || !canEdit) return null;
    const built = buildDraftConfiguration(state.form, state);
    if (!built.ok) {
      dispatch({ type: "issues", issues: built.issues });
      focusFirstIssue(built.issues);
      return null;
    }
    dispatch({ type: "status", status: "saving" });
    try {
      const detail = await request<DiscountEditorDetail>(
        `/api/admin/discounts/${offerId}/draft`,
        {
          method: "PUT",
          body: JSON.stringify({
            requestKey: crypto.randomUUID(),
            expectedOfferVersion: state.detail.version,
            expectedDraftVersion: state.detail.draftVersion,
            configuration: built.configuration,
          }),
        }
      );
      dispatch({ type: "saved", detail });
      setReview(null);
      toast.success("Draft tersimpan");
      return detail;
    } catch (caught) {
      handleFailure(caught, "Gagal menyimpan draft. Coba lagi.");
      return null;
    }
  }

  function focusFirstIssue(issues: readonly { path: string }[]): void {
    const target = issues
      .map((issue) => FIELD_ID[issue.path] ?? (issue.path.startsWith("codeChanges") ? "new-code" : undefined))
      .find(Boolean);
    if (!target) return;
    const element = document.getElementById(target);
    element?.focus();
  }

  function handleFailure(caught: unknown, fallback: string): void {
    if (caught instanceof ApiError) {
      if (caught.status === 409 && caught.code === "STALE_REVISION") {
        dispatch({ type: "reload-required", message: caught.message });
        return;
      }
      if (caught.fieldErrors?.length) {
        dispatch({ type: "issues", issues: caught.fieldErrors, message: caught.message });
        focusFirstIssue(caught.fieldErrors);
        toast.error(caught.message);
        return;
      }
      dispatch({ type: "error", message: caught.message });
      toast.error(caught.message);
      return;
    }
    dispatch({ type: "error", message: fallback });
    toast.error(fallback);
  }

  async function reviewNow(): Promise<void> {
    if (!state || !canEdit || running.current) return;
    running.current = true;
    setReviewError(null);
    dispatch({ type: "review-open" });
    try {
      let detail = state.detail;
      if (state.dirty) {
        const saved = await saveDraft();
        if (!saved) {
          dispatch({ type: "review-close" });
          return;
        }
        detail = saved;
      }
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
      dispatch({ type: "review-success", review: result });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409 && caught.code === "STALE_REVISION") {
        dispatch({ type: "reload-required", message: caught.message });
      }
      setReviewError(
        caught instanceof ApiError && caught.fieldErrors?.length
          ? caught.message
          : "Draft tersimpan, tetapi review gagal dimuat. Coba lagi."
      );
    } finally {
      running.current = false;
    }
  }

  async function publish(): Promise<void> {
    if (!state || !review || running.current) return;
    running.current = true;
    dispatch({ type: "status", status: "publishing" });
    try {
      const detail = await request<DiscountEditorDetail>(
        `/api/admin/discounts/${offerId}/publish`,
        {
          method: "POST",
          body: JSON.stringify({
            requestKey: crypto.randomUUID(),
            expectedOfferVersion: review.offerVersion,
            expectedDraftVersion: review.draftVersion,
            expectedPolicyVersion: review.policyVersion,
            reviewFingerprint: review.fingerprint,
          }),
        }
      );
      dispatch({ type: "review-close" });
      setReview(null);
      dispatch({ type: "reloaded", detail });
      toast.success("Diskon dipublish");
      await load();
    } catch (caught) {
      handleFailure(caught, "Gagal mempublikasikan diskon. Coba lagi.");
    } finally {
      dispatch({ type: "status", status: "idle" });
      running.current = false;
    }
  }

  async function simulate(): Promise<void> {
    if (!state) return;
    setSimulationError(null);
    dispatch({ type: "status", status: "saving" });
    try {
      let detail = state.detail;
      if (state.dirty) {
        const saved = await saveDraft();
        if (!saved) return;
        detail = saved;
      }
      const quantity = Number(simForm.quantity);
      if (!/^\d+$/.test(simForm.unitPrice) || !Number.isInteger(quantity) || quantity < 1) {
        throw new ApiError("Isi harga satuan dan jumlah dengan angka bulat", "INPUT_INVALID", 400);
      }
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
                quantity,
              },
            ],
          }),
        }
      );
      setSimulation(result);
    } catch (caught) {
      if (caught instanceof ApiError && caught.fieldErrors?.length) {
        dispatch({ type: "issues", issues: caught.fieldErrors, message: caught.message });
        focusFirstIssue(caught.fieldErrors);
      }
      setSimulationError(
        caught instanceof ApiError ? caught.message : "Simulasi gagal. Coba lagi."
      );
    } finally {
      dispatch({ type: "status", status: "idle" });
    }
  }

  async function changeState(next: "enabled" | "paused" | "archived"): Promise<void> {
    if (!state) return;
    dispatch({ type: "status", status: "saving" });
    try {
      const detail = await request<DiscountEditorDetail>(
        `/api/admin/discounts/${offerId}/state`,
        {
          method: "PATCH",
          body: JSON.stringify({
            requestKey: crypto.randomUUID(),
            expectedVersion: state.detail.version,
            state: next,
          }),
        }
      );
      dispatch({ type: "reloaded", detail });
      setConfirmState(null);
      toast.success(`Status diskon: ${STATE_LABEL[next]}`);
    } catch (caught) {
      handleFailure(caught, "Gagal mengubah status diskon");
    } finally {
      dispatch({ type: "status", status: "idle" });
    }
  }

  if (loading) {
    return (
      <p role="status" className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Memuat diskon…
      </p>
    );
  }

  if (!state) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Diskon tidak ditemukan</CardTitle>
          <CardDescription>{loadError ?? "Diskon tidak tersedia."}</CardDescription>
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

  const detail = state.detail;
  const archived = detail.state === "archived";
  const disabled = !canEdit || archived || state.status !== "idle";
  const tabs = editorTabsFor(detail.activationKind);
  const heading = state.heading ?? "Buat diskon";
  const hasDraftChange = detail.liveRevision !== null && detail.draftRevision !== null;
  const simulationStale =
    simulation !== null && simulation.draftVersion !== detail.draftVersion;

  const actionBar = canEdit && !archived ? (
    <div className="space-y-3 border-t pt-5">
      <p role="status" className="text-sm text-muted-foreground">
        {state.dirty ? "Perubahan belum disimpan" : state.notice ?? "Draft tersimpan"}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => void saveDraft()} disabled={state.status !== "idle"}>
          {state.status === "saving" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Simpan draft
        </Button>
        <Button
          ref={reviewTrigger}
          onClick={() => void reviewNow()}
          disabled={state.status !== "idle"}
        >
          Lanjut ke publish
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Menyimpan draft tidak mengaktifkan diskon. Perubahan berlaku setelah publish.
      </p>
    </div>
  ) : (
    <p className="border-t pt-5 text-sm text-muted-foreground">
      {archived
        ? "Diskon diarsipkan dan tidak dapat diubah."
        : "Anda hanya dapat melihat diskon."}
    </p>
  );

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/admin/discounts"
            className="mb-2 -ml-2 inline-flex items-center text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
            onClick={(event) => {
              if (!state.dirty) return;
              event.preventDefault();
              dispatch({ type: "exit-intent", href: "/admin/discounts" });
            }}
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Daftar diskon
          </Link>
          <h1 className="text-2xl font-bold text-foreground">{heading}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge tone={getStatusTone("offer", detail.state)}>
              {STATE_LABEL[detail.state]}
            </StatusBadge>
            <span>{detail.activationKind === "public" ? "Kupon publik" : "Kode promo"}</span>
            {hasDraftChange ? <Badge variant="secondary">Ada draft</Badge> : null}
          </div>
        </div>
        {canEdit && !archived ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={state.status !== "idle"}>
                Tindakan <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {detail.state === "enabled" ? (
                <DropdownMenuItem onSelect={() => requestLifecycle("paused")}>
                  Jeda diskon
                </DropdownMenuItem>
              ) : null}
              {detail.state === "paused" ? (
                <DropdownMenuItem onSelect={() => requestLifecycle("enabled")}>
                  Aktifkan kembali
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => requestLifecycle("archived")}>
                Arsipkan diskon
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {loadError ? (
        <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          {loadError}
          <Button className="ml-2" variant="outline" size="sm" onClick={() => void load()}>
            Coba lagi
          </Button>
        </p>
      ) : null}

      {state.needsReload ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          <span>{state.notice}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (state.dirty && !window.confirm("Buang input lokal dan muat versi terbaru?")) return;
              void load();
            }}
          >
            Muat versi terbaru
          </Button>
        </div>
      ) : null}

      <Tabs
        value={state.tab}
        onValueChange={(value) => dispatch({ type: "tab", tab: value as EditorTab })}
        className="min-w-0 space-y-6"
      >
        <div className="max-w-full overflow-x-auto">
          <TabsList aria-label="Bagian diskon">
            {tabs.map((tab) => (
              <TabsTrigger key={tab} value={tab}>
                {EDITOR_TAB_LABEL[tab]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="pengaturan" className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Pengaturan</h2>
              </CardTitle>
              <CardDescription>
                Satu draft untuk seluruh konfigurasi; belum berlaku sebelum publish.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {state.notice && state.notice !== "Draft tersimpan" ? (
                <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
                  {state.notice}
                </p>
              ) : null}
              <DiscountSettingsSection
                form={state.form}
                disabled={disabled}
                fieldErrors={state.fieldErrors}
                onChange={(patch) => dispatch({ type: "form", patch })}
              />
              {actionBar}
            </CardContent>
          </Card>
        </TabsContent>

        {tabs.includes("kode") ? (
          <TabsContent value="kode" className="min-w-0 space-y-6">
            <DiscountCodesSection
              state={state}
              disabled={disabled}
              onAdd={(raw) => dispatch({ type: "code-add", raw })}
              onRemove={(key) => dispatch({ type: "code-remove", key })}
              onNewCodeChange={(value) => dispatch({ type: "new-code", value })}
              onStateChange={(codeId, next) => dispatch({ type: "code-state", codeId, state: next })}
            />
            {actionBar}
          </TabsContent>
        ) : null}

        <TabsContent value="simulasi" className="min-w-0 space-y-6">
          <DiscountSimulationPanel
            form={simForm}
            onFormChange={(patch) => setSimForm((current) => ({ ...current, ...patch }))}
            result={simulation}
            stale={simulationStale}
            dirty={state.dirty}
            busy={state.status === "saving"}
            disabled={!canEdit || archived}
            error={simulationError}
            onRun={() => void simulate()}
          />
          {actionBar}
        </TabsContent>

        <TabsContent value="pemakaian" className="min-w-0 space-y-6">
          <UsagePanel
            usage={usage}
            status={usageStatus}
            page={usagePage}
            loading={usage === null}
            onStatusChange={(status) => {
              setUsageStatus(status);
              void loadUsage(1, status);
            }}
            onPageChange={(page) => void loadUsage(page, usageStatus)}
            liveQuota={detail.quotaCount}
            liveBudget={detail.budgetAmount}
            perClientLimit={detail.perClientLimit}
            unpublishable={detail.liveRevision === null}
          />
        </TabsContent>

        <TabsContent value="riwayat" className="min-w-0 space-y-6">
          <DiscountHistoryList entries={history} />
        </TabsContent>
      </Tabs>

      <DiscountReviewDialog
        open={state.reviewOpen}
        busy={state.status === "publishing" ? "publish" : review === null ? "review" : null}
        review={review}
        error={reviewError}
        needsReload={state.needsReload}
        firstPublish={detail.liveRevision === null}
        stateAfter={detail.state}
        triggerRef={reviewTrigger}
        onOpenChange={(open) => {
          if (!open) dispatch({ type: "review-close" });
          else dispatch({ type: "review-open" });
        }}
        onPublish={() => void publish()}
        onReload={() => {
          dispatch({ type: "review-close" });
          void load();
        }}
      />

      <ExitGuard
        open={state.exitHref !== null}
        saving={state.status === "saving"}
        onStay={() => dispatch({ type: "exit-cancel" })}
        onDiscard={() => {
          const href = state.exitHref;
          dispatch({ type: "exit-cancel" });
          if (href) router.push(href);
        }}
        onSaveAndLeave={async () => {
          const href = state.exitHref;
          const saved = await saveDraft();
          if (saved && href) {
            dispatch({ type: "exit-cancel" });
            router.push(href);
          }
        }}
      />

      <ConfirmDialog
        open={confirmState !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmState(null);
        }}
        title={
          confirmState === "paused"
            ? "Jeda diskon?"
            : confirmState === "enabled"
              ? "Aktifkan kembali?"
              : "Arsipkan diskon?"
        }
        description={
          confirmState === "paused"
            ? "Diskon berhenti menerima pemakaian baru. Pemakaian yang sudah tercatat tidak dibatalkan."
            : confirmState === "enabled"
              ? "Diskon kembali memakai konfigurasi yang sudah terbit; draft yang belum dipublish tidak otomatis diterbitkan."
              : "Arsip bukan hapus permanen: identitas, revision terbit, pemakaian, dan riwayat tetap disimpan."
        }
        loading={state.status === "saving"}
        confirmLabel="Ya, lanjutkan"
        onConfirm={() => {
          if (confirmState) return changeState(confirmState);
        }}
      />
    </div>
  );

  function requestLifecycle(next: "enabled" | "paused" | "archived"): void {
    if (state.dirty) {
      // Lifecycle bukan field draft: minta simpan atau buang input, lalu
      // batalkan aksi ini (pengguna tidak dikejutkan oleh mutasi diam-diam).
      dispatch({
        type: "notice",
        notice:
          "Simpan draft atau buang perubahan sebelum mengubah status diskon.",
      });
      return;
    }
    setConfirmState(next);
  }
}

function ExitGuard(props: {
  open: boolean;
  saving: boolean;
  onStay: () => void;
  onDiscard: () => void;
  onSaveAndLeave: () => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? null : props.onStay())}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md">
        <DialogHeader>
          <DialogTitle>Perubahan belum disimpan</DialogTitle>
          <DialogDescription>
            Simpan draft agar perubahan tidak hilang, atau buang input lokal.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:flex-col sm:items-stretch">
          <Button variant="outline" onClick={props.onStay} disabled={props.saving}>
            Tetap mengedit
          </Button>
          <Button variant="outline" onClick={props.onDiscard} disabled={props.saving}>
            Buang perubahan
          </Button>
          <Button onClick={props.onSaveAndLeave} disabled={props.saving}>
            {props.saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Simpan draft dan keluar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UsagePanel(props: {
  usage: UsageResult | null;
  status: string;
  page: number;
  loading: boolean;
  liveQuota: number | null;
  liveBudget: string | null;
  perClientLimit: number;
  unpublishable: boolean;
  onStatusChange: (status: string) => void;
  onPageChange: (page: number) => void;
}) {
  const { usage } = props;
  if (props.loading || !usage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Pemakaian saat ini</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat pemakaian…
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Pemakaian saat ini</h2>
        </CardTitle>
        <CardDescription>
          Angka live untuk seluruh cabang. Konfigurasi batas ada di Pengaturan.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border p-3">
            <p className="text-muted-foreground">Kuota</p>
            <p className="font-medium">
              {props.liveQuota === null ? "Tanpa batas" : props.liveQuota}
            </p>
            <p className="text-xs text-muted-foreground">
              Terpakai {usage.availability.consumedCount} · ditahan {usage.availability.heldCount}
            </p>
            <p className="text-xs text-muted-foreground">
              Tersedia {usage.availability.availableCount ?? "tanpa batas"} dari{" "}
              {props.liveQuota ?? "tanpa batas"}
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-muted-foreground">Budget</p>
            <p className="font-medium">
              {props.liveBudget === null ? "Tanpa batas" : rupiah(props.liveBudget)}
            </p>
            <p className="text-xs text-muted-foreground">
              Terpakai {rupiah(usage.availability.consumedAmount)} · ditahan{" "}
              {rupiah(usage.availability.heldAmount)}
            </p>
            <p className="text-xs text-muted-foreground">
              Tersedia {rupiah(usage.availability.availableAmount)} dari{" "}
              {props.liveBudget === null ? "tanpa batas" : rupiah(props.liveBudget)}
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-muted-foreground">Batas per customer</p>
            <p className="font-medium">{props.perClientLimit}</p>
            <p className="text-xs text-muted-foreground">
              {props.unpublishable ? "Belum berlaku" : "Berlaku pada pemakaian baru"}
            </p>
          </div>
        </div>

        {usage.drift.detected ? (
          <p className="rounded-md border border-amber-500/60 p-3 text-xs">
            Pemakaian tidak sesuai catatan ({usage.drift.mismatched.join(", ")}). Perubahan
            kapasitas dan publish ditahan sampai diperiksa admin.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">
            Pemakaian{" "}
            {usage.entriesAccess === "aggregate_only"
              ? "(ringkasan)"
              : usage.scope?.mode === "own"
                ? "(cabang Anda)"
                : "(semua cabang)"}
          </p>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Status
            <select
              aria-label="Filter status pemakaian"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={props.status}
              onChange={(event) => props.onStatusChange(event.target.value)}
            >
              <option value="">Semua</option>
              <option value="reserved">Ditahan</option>
              <option value="consumed">Terpakai</option>
              <option value="released">Dilepas</option>
            </select>
          </label>
        </div>

        {usage.entries === null ? (
          <p className="text-muted-foreground">
            Anda tidak memiliki akses daftar pesanan, jadi hanya ringkasan yang tampil.
          </p>
        ) : usage.entries.items.length === 0 ? (
          <p className="text-muted-foreground">Belum ada pemakaian pada filter ini.</p>
        ) : (
          <>
            <div className="max-w-full overflow-x-auto rounded-md border">
              <Table aria-label="Daftar pemakaian">
                <TableHeader>
                  <TableRow>
                    <TableHead>Pesanan</TableHead>
                    <TableHead>Cabang</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Potongan</TableHead>
                    <TableHead>Kode</TableHead>
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
                          {entry.order.status} · {entry.order.paymentStatus}
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
                      <TableCell>
                        {entry.status === "reserved"
                          ? "Ditahan"
                          : entry.status === "consumed"
                            ? "Terpakai"
                            : "Dilepas"}
                      </TableCell>
                      <TableCell>{rupiah(entry.benefitAmount)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {entry.maskedCode ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(entry.reservedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                Halaman {usage.entries.page} dari {Math.max(1, usage.entries.totalPages)} ·{" "}
                {usage.entries.total} pemakaian
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={usage.entries.page <= 1}
                  onClick={() => props.onPageChange(usage.entries!.page - 1)}
                >
                  Sebelumnya
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={usage.entries.page >= usage.entries.totalPages}
                  onClick={() => props.onPageChange(usage.entries!.page + 1)}
                >
                  Berikutnya
                </Button>
              </div>
            </div>
          </>
        )}
        <p className="text-xs text-muted-foreground">{usage.note}</p>
      </CardContent>
    </Card>
  );
}
