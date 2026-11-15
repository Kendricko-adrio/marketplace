import {
  canonicalizePromoCode,
} from "@marketplace/db/src/discount-code";
import {
  parseDiscountDraftConfiguration,
  type DiscountDraftConfiguration,
  type DiscountDraftIssue,
} from "@marketplace/db/src/discount-draft";
import type { DiscountEditorDetail } from "@/features/discounts/discount-editor-contracts";
import {
  formatMoneyInput,
  formatPercentInput,
  parseMoneyInput,
  parsePercentInput,
} from "./discount-number-format";

/**
 * State editor: SATU snapshot konfigurasi tingkat halaman (Pengaturan + Kode
 * berbagi state ini). Field uang/persen menyimpan teks yang sedang diketik
 * supaya buffer tidak lengkap (mis. `17.000,`) tidak berubah diam-diam; payload
 * canonical dibangun hanya saat save/review/simulasi.
 */

export type EditorTab = "pengaturan" | "kode" | "simulasi" | "pemakaian" | "riwayat";

export const EDITOR_TAB_LABEL: Record<EditorTab, string> = {
  pengaturan: "Pengaturan",
  kode: "Kode",
  simulasi: "Simulasi",
  pemakaian: "Pemakaian",
  riwayat: "Riwayat",
};

export interface DiscountEditorForm {
  name: string;
  minSubtotal: string;
  startAt: string;
  endAt: string;
  benefitKind: "" | "fixed_goods" | "percentage_goods" | "shipping";
  fixedAmount: string;
  rate: string;
  capAmount: string;
  quota: string;
  budget: string;
  perClient: string;
}

export interface CodeProposal {
  /** Key lokal baris draft; bukan identitas server. */
  key: string;
  raw: string;
}

export interface CodeStateTarget {
  state: "active" | "inactive" | "archived";
  expectedCodeVersion: number;
}

export interface DiscountEditorState {
  detail: DiscountEditorDetail;
  form: DiscountEditorForm;
  codeProposals: CodeProposal[];
  codeStates: Record<string, CodeStateTarget>;
  /** Buffer input kode baru; disimpan di state agar pindah tab tidak menghapusnya. */
  newCode: string;
  baseline: string;
  dirty: boolean;
  tab: EditorTab;
  fieldErrors: Record<string, string>;
  needsReload: boolean;
  notice: string | null;
  review: unknown | null;
  reviewOpen: boolean;
  exitHref: string | null;
  /** Nama live bila sudah publish, nama draft bila belum; null = belum bernama. */
  heading: string | null;
  status: "idle" | "saving" | "reviewing" | "publishing";
}

export type DiscountEditorEvent =
  | { type: "form"; patch: Partial<DiscountEditorForm> }
  | { type: "code-add"; raw: string }
  | { type: "new-code"; value: string }
  | { type: "code-remove"; key: string }
  | { type: "code-state"; codeId: string; state: CodeStateTarget["state"] }
  | { type: "tab"; tab: EditorTab }
  | { type: "saved"; detail: DiscountEditorDetail }
  | { type: "issues"; issues: DiscountDraftIssue[]; message?: string }
  | { type: "review-open" }
  | { type: "review-close" }
  | { type: "review-success"; review: unknown }
  | { type: "reload-required"; message: string }
  | { type: "reloaded"; detail: DiscountEditorDetail }
  | { type: "exit-intent"; href: string }
  | { type: "exit-cancel" }
  | { type: "status"; status: DiscountEditorState["status"] }
  | { type: "notice"; notice: string | null }
  | { type: "error"; message: string };

/** WIB `datetime-local` -> instant ber-offset; server tetap otoritas. */
export function toWibInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const wib = new Date(new Date(iso).getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 16);
}

export function fromWibInput(local: string): string | null {
  return local ? `${local}:00+07:00` : null;
}

export function editorTabsFor(activationKind: string): EditorTab[] {
  // Kupon publik tidak mempunyai kode: tab Kode tidak dirender sama sekali.
  return activationKind === "manual_only"
    ? ["pengaturan", "kode", "simulasi", "pemakaian", "riwayat"]
    : ["pengaturan", "simulasi", "pemakaian", "riwayat"];
}

export function formFromConfiguration(
  configuration: DiscountDraftConfiguration
): DiscountEditorForm {
  const benefit = configuration.benefit;
  return {
    name: configuration.name ?? "",
    minSubtotal: formatMoneyInput(configuration.minSubtotal, false),
    startAt: toWibInput(configuration.startAt),
    endAt: toWibInput(configuration.endAt),
    benefitKind: benefit?.kind ?? "",
    fixedAmount: formatMoneyInput(
      benefit?.kind === "fixed_goods" ? benefit.fixedAmount : null,
      false
    ),
    rate: formatPercentInput(benefit?.kind === "percentage_goods" ? benefit.rate : null),
    capAmount: formatMoneyInput(
      benefit === null || benefit.kind === "fixed_goods" ? null : benefit.capAmount,
      false
    ),
    quota: configuration.capacity.quotaCount?.toString() ?? "",
    budget: formatMoneyInput(configuration.capacity.budgetAmount, false),
    // Nilai awal 1 mengikuti existing; batas per customer wajib diisi saat publish.
    perClient: configuration.capacity.perClientLimit?.toString() ?? "1",
  };
}

export function codeStatesFromDetail(
  detail: DiscountEditorDetail
): Record<string, CodeStateTarget> {
  const staged = new Map(
    detail.draftConfiguration.codeChanges.states.map((change) => [change.codeId, change])
  );
  return Object.fromEntries(
    detail.codes.map((code): [string, CodeStateTarget] => [
      code.id,
      {
        state:
          (staged.get(code.id)?.state as CodeStateTarget["state"] | undefined) ??
          (code.state as CodeStateTarget["state"]),
        expectedCodeVersion:
          staged.get(code.id)?.expectedCodeVersion ?? code.version,
      },
    ])
  );
}

/** Usulan kode tersimpan ikut dipulihkan supaya draft tidak kehilangan staging. */
export function codeProposalsFromDetail(
  detail: DiscountEditorDetail
): CodeProposal[] {
  return detail.draftConfiguration.codeChanges.proposedCodes.map((raw) => ({
    key: raw,
    raw,
  }));
}

export function serializeEditorDraft(
  form: DiscountEditorForm,
  codeProposals: CodeProposal[],
  codeStates: Record<string, CodeStateTarget>
): string {
  return JSON.stringify({ form, codeProposals, codeStates });
}

export function createDiscountEditorState(
  detail: DiscountEditorDetail
): DiscountEditorState {
  const form = formFromConfiguration(detail.draftConfiguration);
  const codeStates = codeStatesFromDetail(detail);
  const codeProposals = codeProposalsFromDetail(detail);
  return {
    detail,
    form,
    codeProposals,
    codeStates,
    newCode: "",
    baseline: serializeEditorDraft(form, codeProposals, codeStates),
    dirty: false,
    tab: "pengaturan",
    fieldErrors: {},
    needsReload: false,
    notice: null,
    review: null,
    reviewOpen: false,
    exitHref: null,
    status: "idle",
    heading: detail.liveRevision?.name ?? detail.draftConfiguration.name ?? null,
  };
}

function resaved(state: DiscountEditorState, detail: DiscountEditorDetail): DiscountEditorState {
  const form = formFromConfiguration(detail.draftConfiguration);
  const codeStates = codeStatesFromDetail(detail);
  const codeProposals = codeProposalsFromDetail(detail);
  return {
    ...state,
    detail,
    form,
    codeProposals,
    codeStates,
    newCode: "",
    baseline: serializeEditorDraft(form, codeProposals, codeStates),
    dirty: false,
    fieldErrors: {},
    needsReload: false,
    review: null,
    reviewOpen: false,
    exitHref: null,
    status: "idle",
    heading: detail.liveRevision?.name ?? detail.draftConfiguration.name ?? null,
  };
}

export function discountEditorReducer(
  state: DiscountEditorState,
  event: DiscountEditorEvent
): DiscountEditorState {
  if (!state) {
    // Satu-satunya event yang boleh membangun state awal adalah detail pertama.
    return event.type === "reloaded"
      ? createDiscountEditorState(event.detail)
      : (state as unknown as DiscountEditorState);
  }
  switch (event.type) {
    case "new-code":
      return { ...state, newCode: event.value };
    case "form": {
      const form = { ...state.form, ...event.patch } as DiscountEditorForm;
      return {
        ...state,
        form,
        dirty: serializeEditorDraft(form, state.codeProposals, state.codeStates) !== state.baseline,
        review: null,
        reviewOpen: false,
        fieldErrors: {},
        notice: null,
      };
    }
    case "code-add": {
      const proposals = [
        ...state.codeProposals,
        { key: globalThis.crypto.randomUUID(), raw: event.raw },
      ];
      return {
        ...state,
        codeProposals: proposals,
        dirty: serializeEditorDraft(state.form, proposals, state.codeStates) !== state.baseline,
        review: null,
        reviewOpen: false,
        fieldErrors: {},
        notice: null,
      };
    }
    case "code-remove": {
      const proposals = state.codeProposals.filter((row) => row.key !== event.key);
      return {
        ...state,
        codeProposals: proposals,
        dirty: serializeEditorDraft(state.form, proposals, state.codeStates) !== state.baseline,
        fieldErrors: {},
        notice: null,
      };
    }
    case "code-state": {
      const current = state.codeStates[event.codeId];
      if (!current) return state;
      const codeStates = {
        ...state.codeStates,
        [event.codeId]: { ...current, state: event.state },
      };
      return {
        ...state,
        codeStates,
        dirty: serializeEditorDraft(state.form, state.codeProposals, codeStates) !== state.baseline,
        review: null,
        reviewOpen: false,
        fieldErrors: {},
        notice: null,
      };
    }
    case "tab":
      return { ...state, tab: event.tab };
    case "saved":
      if (!event.detail.draftConfiguration) return state;
      return { ...resaved(state, event.detail), notice: "Draft tersimpan" };
    case "reloaded": {
      // Respons tanpa snapshot draft (mis. read model legacy) tidak boleh
      // menimpa state editor yang sudah memakai snapshot.
      if (!event.detail.draftConfiguration) return state;
      // Muat ulang tidak boleh menghapus input lokal yang belum disimpan.
      const newer =
        event.detail.version !== state.detail.version ||
        event.detail.draftVersion !== state.detail.draftVersion;
      if (state.dirty) {
        return newer ? { ...state, needsReload: true } : state;
      }
      return { ...resaved(state, event.detail), notice: null };
    }
    case "issues": {
      const fieldErrors = Object.fromEntries(
        event.issues.map((issue) => [issue.path, issue.message])
      );
      const counts = issuesByTab(event.issues);
      const firstTab = (["kode", "pengaturan"] as EditorTab[]).find(
        (tab) => (counts[tab] ?? 0) > 0
      );
      return {
        ...state,
        fieldErrors,
        tab: firstTab ?? state.tab,
        notice: event.message ?? "Periksa bagian yang ditandai",
        status: "idle",
      };
    }
    case "review-open":
      return { ...state, reviewOpen: true, review: null, status: "reviewing" };
    case "review-close":
      return { ...state, reviewOpen: false, status: "idle" };
    case "review-success":
      return { ...state, review: event.review, reviewOpen: true, status: "idle" };
    case "reload-required":
      return { ...state, needsReload: true, status: "idle", notice: event.message, reviewOpen: false, review: null };
    case "exit-intent":
      return { ...state, exitHref: event.href };
    case "exit-cancel":
      return { ...state, exitHref: null };
    case "status":
      return { ...state, status: event.status };
    case "notice":
      return { ...state, notice: event.notice };
    case "error":
      return { ...state, status: "idle", notice: event.message };
    default:
      return state;
  }
}

export type BuildConfigurationResult =
  | { ok: true; configuration: DiscountDraftConfiguration }
  | { ok: false; issues: DiscountDraftIssue[] };

function parseCountInput(text: string, path: string): { value: number | null; issue?: DiscountDraftIssue } {
  const trimmed = text.trim();
  if (!trimmed) return { value: null };
  if (!/^\d+$/.test(trimmed) || Number(trimmed) < 1 || Number(trimmed) > 2147483647) {
    return {
      value: null,
      issue: { path, message: "Masukkan bilangan bulat dari 1 hingga 2147483647" },
    };
  }
  return { value: Number(trimmed) };
}

function moneyIssue(result: { status: string; message?: string }, path: string): DiscountDraftIssue | null {
  if (result.status === "invalid" && result.message) return { path, message: result.message };
  if (result.status === "incomplete") {
    return { path, message: "Gunakan format seperti Rp 100.000,00" };
  }
  return null;
}

/**
 * Form -> snapshot canonical. Field kosong menjadi null (bukan 0), buffer tidak
 * lengkap menjadi issue field (bukan tebakan), dan hasil akhirnya tetap
 * divalidasi parser snapshot yang sama dengan server.
 */
export function buildDraftConfiguration(
  form: DiscountEditorForm,
  codes?: Pick<DiscountEditorState, "codeProposals" | "codeStates">
): BuildConfigurationResult {
  const issues: DiscountDraftIssue[] = [];
  const minSubtotal = parseMoneyInput(form.minSubtotal);
  const minIssue = moneyIssue(minSubtotal, "minSubtotal");
  if (minIssue) issues.push(minIssue);

  let benefit: DiscountDraftConfiguration["benefit"] = null;
  if (form.benefitKind === "fixed_goods") {
    const fixed = parseMoneyInput(form.fixedAmount);
    const issue = moneyIssue(fixed, "benefit.fixedAmount");
    if (issue) issues.push(issue);
    benefit = {
      kind: "fixed_goods",
      paramsVersion: 1,
      fixedAmount: fixed.status === "valid" ? fixed.canonical : null,
    };
  } else if (form.benefitKind === "percentage_goods") {
    const rate = parsePercentInput(form.rate);
    const rateIssue = moneyIssue(rate, "benefit.rate");
    if (rateIssue) issues.push(rateIssue);
    const cap = parseMoneyInput(form.capAmount);
    const capIssue = moneyIssue(cap, "benefit.capAmount");
    if (capIssue) issues.push(capIssue);
    benefit = {
      kind: "percentage_goods",
      paramsVersion: 1,
      rate: rate.status === "valid" ? rate.canonical : null,
      capAmount: cap.status === "valid" ? cap.canonical : null,
    };
  } else if (form.benefitKind === "shipping") {
    const cap = parseMoneyInput(form.capAmount);
    const capIssue = moneyIssue(cap, "benefit.capAmount");
    if (capIssue) issues.push(capIssue);
    benefit = {
      kind: "shipping",
      paramsVersion: 1,
      capAmount: cap.status === "valid" ? cap.canonical : null,
    };
  }

  const quota = parseCountInput(form.quota, "capacity.quotaCount");
  if (quota.issue) issues.push(quota.issue);
  const budget = parseMoneyInput(form.budget);
  const budgetIssue = moneyIssue(budget, "capacity.budgetAmount");
  if (budgetIssue) issues.push(budgetIssue);
  const perClient = parseCountInput(form.perClient, "capacity.perClientLimit");
  if (perClient.issue) issues.push(perClient.issue);

  const proposedCodes = (codes?.codeProposals ?? []).map((row) => {
    const canonical = canonicalizePromoCode(row.raw);
    if (!canonical) {
      issues.push({
        path: "codeChanges.proposedCodes",
        message: "Kode tidak valid atau duplikat dalam draft",
      });
    }
    return row.raw;
  });
  const states = Object.entries(codes?.codeStates ?? {}).map(([codeId, target]) => ({
    codeId,
    expectedCodeVersion: target.expectedCodeVersion,
    state: target.state,
  }));

  if (issues.length) return { ok: false, issues };

  const parsed = parseDiscountDraftConfiguration({
    draftSchemaVersion: 1,
    name: form.name.trim() || null,
    currency: "IDR",
    minSubtotal: minSubtotal.status === "valid" ? minSubtotal.canonical : null,
    startAt: fromWibInput(form.startAt),
    endAt: fromWibInput(form.endAt),
    benefit,
    capacity: {
      quotaCount: quota.value,
      budgetAmount: budget.status === "valid" ? budget.canonical : null,
      perClientLimit: perClient.value,
    },
    codeChanges: { proposedCodes, states },
  });
  return parsed.success
    ? { ok: true, configuration: parsed.configuration }
    : { ok: false, issues: parsed.issues };
}

export function issuesByTab(
  issues: readonly DiscountDraftIssue[]
): Partial<Record<EditorTab, number>> {
  const counts: Partial<Record<EditorTab, number>> = {};
  for (const issue of issues) {
    const tab: EditorTab = issue.path.startsWith("codeChanges") ? "kode" : "pengaturan";
    counts[tab] = (counts[tab] ?? 0) + 1;
  }
  return counts;
}
