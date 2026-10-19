/*
 * Prototype "Diskon & Harga Coret" untuk admin marketplace.
 *
 * Seluruh data adalah mock dan state hanya hidup di memori: reload = reset.
 * Ini bukan kode aplikasi — tidak ada API, DB, auth, provider, atau simpanan.
 * Perilaku mengikuti wireframe tiket 06 (.scratch/discounts/wireframe-06-...md).
 */

/* ---------------- Tipe ---------------- */

type PersonaKey = "hq" | "manager" | "viewer";
type BenefitKind = "percent_goods" | "fixed_goods" | "shipping_subsidy";
type PromoChannel = "public" | "manual";
type PromoStatus = "live" | "paused";
type UsageStatus = "Consumed" | "Reserved" | "Released";
type OrdersScope = "all" | "bandung" | "jakarta";
type ViewName = "produk" | "import" | "diskon" | "promo" | "simulasi" | "audit";
type PromoTab = "aturan" | "kode" | "pemakaian" | "riwayat";
type ImportPhase =
  | "idle"
  | "preview"
  | "applying"
  | "interrupted"
  | "done"
  | "retry-preview"
  | "retry-done";
type ImportHaltReason = "none" | "simulated-disconnect" | "permission-revoked";
type ImportRowStatus = "valid" | "invalid" | "applied" | "unchanged" | "failed";
type PriceAction = "set_price" | "restore_base";
type ToastTone = "ok" | "warn" | "error";

interface Capabilities {
  hargaEdit: boolean;
  promoEdit: boolean;
  kapasitasEdit: boolean;
}

interface Persona {
  key: PersonaKey;
  name: string;
  role: string;
  branch: string;
  ordersScope: OrdersScope;
  scopeLabel: string;
  caps: Capabilities;
}

interface Sku {
  sku: string;
  name: string;
  base: number;
  target: number | null;
}

interface Benefit {
  kind: BenefitKind;
  percent: number | null;
  cap: number | null;
  amount: number | null;
}

interface Capacity {
  quota: number | null;
  budget: number | null;
  perAccount: number;
}

interface PromoCode {
  code: string;
  active: boolean;
}

interface UsageEntry {
  orderId: string;
  branch: string;
  status: UsageStatus;
  amount: number;
  at: string;
}

interface UsageSummary {
  quotaConsumed: number;
  quotaHold: number;
  budgetConsumed: number;
  budgetHold: number;
}

interface Promo {
  id: string;
  name: string;
  channel: PromoChannel;
  status: PromoStatus;
  revision: number;
  benefit: Benefit;
  minSubtotal: number;
  startAt: string;
  endAt: string;
  capacity: Capacity;
  codes: PromoCode[];
  usage: UsageEntry[];
  summary: UsageSummary;
}

interface PromoDraft {
  promoId: string;
  baseRevision: number;
  name: string;
  benefit: Benefit;
  minSubtotal: number;
  startAt: string;
  endAt: string;
}

interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  action: string;
  target: string;
  before: string;
  after: string;
  ref: string;
  promoId: string | null;
}

interface ImportRow {
  row: number;
  sku: string;
  action: PriceAction;
  price: number | null;
  raw: string | null;
  status: ImportRowStatus;
  reason: string;
}

interface ImportBatch {
  id: string;
  parentId: string | null;
  rows: ImportRow[];
  createdAt: string;
}

interface ImportFlow {
  phase: ImportPhase;
  batch: ImportBatch | null;
  retryBatch: ImportBatch | null;
  forcedInterruptDone: boolean;
  /** Actor yang memulai atau melanjutkan apply; audit tidak memakai persona penonton. */
  applyActor: string | null;
  /** Alasan batch berhenti di tengah: interupsi simulasi atau izin dicabut. */
  haltReason: ImportHaltReason;
}

interface PriceRow {
  sku: string;
  name: string;
  base: number;
  current: number;
  next: number | null;
  action: PriceAction;
  valid: boolean;
  reason: string;
}

interface DiffRow {
  label: string;
  before: string;
  after: string;
  changed: boolean;
}

interface GoodsSim {
  goods: number;
  percent: number;
  cap: number;
  shipping: number;
  fee: number;
  taxRate: number;
}

interface ShippingSim {
  goods: number;
  shipping: number;
  subsidy: number;
  fee: number;
  taxRate: number;
}

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

type DialogState =
  | { kind: "manual"; targetSkus: string[]; value: string; error: string | null }
  | { kind: "bulk"; targetSkus: string[]; percent: string; step: "input" | "review"; error: string | null }
  | { kind: "price-review"; rows: PriceRow[]; reason: string; label: string; source: string }
  | { kind: "promo-review" }
  | { kind: "stale" }
  | { kind: "add-code"; value: string; error: string | null };

interface AppState {
  persona: PersonaKey;
  view: ViewName;
  diskonChannel: PromoChannel;
  promoId: string | null;
  promoTab: PromoTab;
  search: string;
  selectedSkus: string[];
  skus: Sku[];
  promos: Promo[];
  draft: PromoDraft | null;
  benefitKindChoice: BenefitKind | null;
  staleNotice: string | null;
  capacityError: string | null;
  capacityNotice: string | null;
  importFlow: ImportFlow;
  audit: AuditEntry[];
  dialog: DialogState | null;
  toasts: ToastItem[];
  simGoods: GoodsSim;
  simShipping: ShippingSim;
}

/* ---------------- Helper ---------------- */

const idr = new Intl.NumberFormat("id-ID");
const stampFormat = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Jakarta",
});

let clock = new Date("2025-08-14T10:30:00+07:00");
let auditSeq = 0;
let toastSeq = 0;
let applyTimer: number | null = null;

function rp(value: number): string {
  return "Rp " + idr.format(Math.round(value));
}

function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

function esc(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function num(value: string, fallback: number): number {
  const digits = String(value).replace(/[^0-9]/g, "");
  if (digits === "") return fallback;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nextStamp(): string {
  clock = new Date(clock.getTime() + 60000);
  return stampFormat.format(clock) + " WIB";
}

function pad3(value: number): string {
  return String(value).padStart(3, "0");
}

function disabledIf(condition: boolean, reason: string): string {
  return condition ? ` disabled title="${esc(reason)}"` : "";
}

function badge(text: string, cls: string): string {
  return `<span class="badge ${cls}">${esc(text)}</span>`;
}

function alertBox(tone: "info" | "warn" | "error" | "success" | "sim", inner: string): string {
  const role = tone === "error" ? ' role="alert"' : "";
  return `<div class="alert alert-${tone}"${role}>${inner}</div>`;
}

function actionBtn(label: string, action: string, cls: string, blockedReason: string, extra: string): string {
  const disabled = blockedReason === "" ? "" : ` disabled title="${esc(blockedReason)}"`;
  return `<button class="btn ${cls}" data-action="${action}"${extra}${disabled}>${label}</button>`;
}

function q(selector: string): HTMLElement | null {
  return document.querySelector(selector);
}

function qValue(selector: string, fallback: string): string {
  const el = q(selector) as HTMLInputElement | null;
  if (!el) return fallback;
  return el.value;
}

function icon(name: string): string {
  const paths: Record<string, string> = {
    produk: '<path d="M3 7.5 12 3l9 4.5v9L12 21 3 16.5z"/><path d="M3 7.5 12 12l9-4.5"/><path d="M12 12v9"/>',
    diskon: '<path d="M20.6 13.4 12 22 2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.6"/>',
    audit: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h6"/><path d="M10 16h6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
    bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    dot: '<circle cx="12" cy="12" r="3.2"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  };
  const body = paths[name] ?? "";
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/* ---------------- Persona ---------------- */

const PERSONAS: Persona[] = [
  {
    key: "hq",
    name: "Rani Putri",
    role: "HQ",
    branch: "Semua cabang",
    ordersScope: "all",
    scopeLabel: "Orders:view semua cabang",
    caps: { hargaEdit: true, promoEdit: true, kapasitasEdit: true },
  },
  {
    key: "manager",
    name: "Dedi Saputra",
    role: "Admin",
    branch: "Bandung",
    ordersScope: "bandung",
    scopeLabel: "Orders:view cabang Bandung",
    caps: { hargaEdit: false, promoEdit: true, kapasitasEdit: false },
  },
  {
    key: "viewer",
    name: "Sari Wulandari",
    role: "Admin",
    branch: "Jakarta",
    ordersScope: "jakarta",
    scopeLabel: "Orders:view cabang Jakarta",
    caps: { hargaEdit: false, promoEdit: false, kapasitasEdit: false },
  },
];

function currentPersona(): Persona {
  const found = PERSONAS.find((p) => p.key === state.persona);
  return found ?? PERSONAS[0];
}

function capReason(needed: "hargaEdit" | "promoEdit" | "kapasitasEdit"): string {
  const persona = currentPersona();
  const label =
    needed === "hargaEdit" ? "Harga:edit" : needed === "promoEdit" ? "Promo:edit" : "Kapasitas:edit";
  return `Butuh ${label}. Persona simulasi "${persona.name}" tidak memilikinya.`;
}

/* ---------------- Fixture ---------------- */

function buildSkus(): Sku[] {
  const curated: Sku[] = [
    { sku: "SHOE-BLACK-42", name: "Shoe Black 42", base: 300000, target: 150000 },
    { sku: "SHOE-WHITE-40", name: "Shoe White 40", base: 200000, target: null },
    { sku: "SHOE-RED-39", name: "Shoe Red 39", base: 180000, target: null },
    { sku: "SANDAL-TAN-41", name: "Sandal Tan 41", base: 240000, target: 216000 },
    { sku: "BOOT-BROWN-43", name: "Boot Brown 43", base: 420000, target: null },
    { sku: "SLIPPER-GREY-38", name: "Slipper Grey 38", base: 120000, target: 96000 },
    { sku: "JACKET-OLIVE-M", name: "Jacket Olive M", base: 150000, target: 200000 },
    { sku: "TOTE-CANVAS", name: "Tote Canvas", base: 150000, target: null },
  ];
  const generated: Sku[] = [];
  for (let i = 9; i <= 100; i += 1) {
    generated.push({
      sku: "SKU-MOCK-" + pad3(i),
      name: "Produk Contoh " + pad3(i),
      base: 90000 + i * 5000,
      target: null,
    });
  }
  return curated.concat(generated);
}

function buildPromos(): Promo[] {
  return [
    {
      id: "P-001",
      name: "HEMAT AGUSTUS",
      channel: "public",
      status: "live",
      revision: 3,
      benefit: { kind: "percent_goods", percent: 10, cap: 20000, amount: null },
      minSubtotal: 100000,
      startAt: "2025-08-01",
      endAt: "",
      capacity: { quota: 100, budget: 2000000, perAccount: 1 },
      codes: [],
      usage: [
        { orderId: "ORD-2025-1187", branch: "Jakarta", status: "Consumed", amount: 20000, at: "12 Agu 2025 10.02 WIB" },
        { orderId: "ORD-2025-1188", branch: "Bandung", status: "Consumed", amount: 20000, at: "12 Agu 2025 11.40 WIB" },
        { orderId: "ORD-2025-1191", branch: "Jakarta", status: "Reserved", amount: 20000, at: "13 Agu 2025 09.15 WIB" },
        { orderId: "ORD-2025-1194", branch: "Surabaya", status: "Consumed", amount: 20000, at: "13 Agu 2025 14.22 WIB" },
        { orderId: "ORD-2025-1196", branch: "Jakarta", status: "Reserved", amount: 20000, at: "14 Agu 2025 08.30 WIB" },
        { orderId: "ORD-2025-1199", branch: "Bandung", status: "Released", amount: 20000, at: "14 Agu 2025 09.05 WIB" },
      ],
      summary: { quotaConsumed: 90, quotaHold: 10, budgetConsumed: 1800000, budgetHold: 200000 },
    },
    {
      id: "P-002",
      name: "POTONGAN TETAP",
      channel: "manual",
      status: "live",
      revision: 2,
      benefit: { kind: "fixed_goods", percent: null, cap: null, amount: 25000 },
      minSubtotal: 150000,
      startAt: "2025-07-15",
      endAt: "2025-09-30",
      capacity: { quota: 50, budget: 1250000, perAccount: 1 },
      codes: [
        { code: "HEMATFIX25", active: true },
        { code: "HEMATFIX25LAMA", active: false },
      ],
      usage: [
        { orderId: "ORD-2025-1171", branch: "Bandung", status: "Consumed", amount: 25000, at: "11 Agu 2025 13.10 WIB" },
        { orderId: "ORD-2025-1183", branch: "Jakarta", status: "Consumed", amount: 25000, at: "12 Agu 2025 15.45 WIB" },
      ],
      summary: { quotaConsumed: 31, quotaHold: 4, budgetConsumed: 775000, budgetHold: 100000 },
    },
    {
      id: "P-003",
      name: "ONGKIR HEMAT",
      channel: "manual",
      status: "paused",
      revision: 1,
      benefit: { kind: "shipping_subsidy", percent: null, cap: null, amount: 20000 },
      minSubtotal: 0,
      startAt: "2025-08-05",
      endAt: "",
      capacity: { quota: 200, budget: 4000000, perAccount: 2 },
      codes: [{ code: "ONGKIRHEMAT", active: true }],
      usage: [
        { orderId: "ORD-2025-1162", branch: "Jakarta", status: "Consumed", amount: 20000, at: "10 Agu 2025 09.20 WIB" },
        { orderId: "ORD-2025-1175", branch: "Jakarta", status: "Released", amount: 20000, at: "11 Agu 2025 17.02 WIB" },
      ],
      summary: { quotaConsumed: 42, quotaHold: 0, budgetConsumed: 840000, budgetHold: 0 },
    },
  ];
}

function buildAudit(): AuditEntry[] {
  return [
    {
      id: 4,
      at: "14 Agu 2025 08.30 WIB",
      actor: "Sistem (reservation)",
      action: "Hold reservation dibuat",
      target: "ORD-2025-1196",
      before: "Tersedia kuota 1",
      after: "Tersedia kuota 0",
      ref: "Revision 3",
      promoId: "P-001",
    },
    {
      id: 3,
      at: "13 Agu 2025 11.15 WIB",
      actor: "Dedi Saputra",
      action: "Pause promo",
      target: "ONGKIR HEMAT",
      before: "Live",
      after: "Pause",
      ref: "Revision 1",
      promoId: "P-003",
    },
    {
      id: 2,
      at: "12 Agu 2025 09.30 WIB",
      actor: "Rani Putri",
      action: "Ubah kapasitas",
      target: "HEMAT AGUSTUS",
      before: "Budget Rp 1.500.000",
      after: "Budget Rp 2.000.000",
      ref: "Revision 3",
      promoId: "P-001",
    },
    {
      id: 1,
      at: "11 Agu 2025 14.02 WIB",
      actor: "Rani Putri",
      action: "Publish revisi 3",
      target: "HEMAT AGUSTUS",
      before: "10% barang, cap Rp 25.000",
      after: "10% barang, cap Rp 20.000",
      ref: "Revision 3",
      promoId: "P-001",
    },
  ];
}

function createInitialState(): AppState {
  clock = new Date("2025-08-14T10:30:00+07:00");
  auditSeq = 4;
  toastSeq = 0;
  return {
    persona: "hq",
    view: "produk",
    diskonChannel: "public",
    promoId: null,
    promoTab: "aturan",
    search: "",
    selectedSkus: [],
    skus: buildSkus(),
    promos: buildPromos(),
    draft: null,
    benefitKindChoice: null,
    staleNotice: null,
    capacityError: null,
    capacityNotice: null,
    importFlow: {
      phase: "idle",
      batch: null,
      retryBatch: null,
      forcedInterruptDone: false,
      applyActor: null,
      haltReason: "none",
    },
    audit: buildAudit(),
    dialog: null,
    toasts: [],
    simGoods: { goods: 450000, percent: 10, cap: 20000, shipping: 30000, fee: 0, taxRate: 11 },
    simShipping: { goods: 150000, shipping: 30000, subsidy: 20000, fee: 0, taxRate: 11 },
  };
}

let state: AppState = createInitialState();

/* ---------------- State turunan ---------------- */

function websitePrice(sku: Sku): number {
  if (sku.target === null) return sku.base;
  return Math.min(sku.target, sku.base);
}

function markdownActive(sku: Sku): boolean {
  return sku.target !== null && sku.target < sku.base;
}

function targetInactive(sku: Sku): boolean {
  return sku.target !== null && sku.target >= sku.base;
}

function findSku(id: string): Sku | undefined {
  return state.skus.find((s) => s.sku === id);
}

function findPromo(id: string | null): Promo | undefined {
  if (id === null) return undefined;
  return state.promos.find((p) => p.id === id);
}

function currentPromo(): Promo | undefined {
  return findPromo(state.promoId);
}

function filteredSkus(): Sku[] {
  const term = state.search.trim().toLowerCase();
  if (term === "") return state.skus;
  return state.skus.filter(
    (s) => s.sku.toLowerCase().includes(term) || s.name.toLowerCase().includes(term)
  );
}

function benefitLabel(benefit: Benefit): string {
  if (benefit.kind === "percent_goods") {
    const cap = benefit.cap === null ? "" : `, cap ${rp(benefit.cap)}`;
    return `${benefit.percent ?? 0}% barang${cap}`;
  }
  if (benefit.kind === "fixed_goods") {
    return `Nominal barang ${rp(benefit.amount ?? 0)}`;
  }
  return `Subsidi ongkir ${rp(benefit.amount ?? 0)}`;
}

function channelLabel(channel: PromoChannel): string {
  return channel === "public" ? "Kupon publik" : "Kode manual";
}

function quotaAvailable(promo: Promo): number | null {
  if (promo.capacity.quota === null) return null;
  return promo.capacity.quota - promo.summary.quotaConsumed - promo.summary.quotaHold;
}

function budgetAvailable(promo: Promo): number | null {
  if (promo.capacity.budget === null) return null;
  return promo.capacity.budget - promo.summary.budgetConsumed - promo.summary.budgetHold;
}

function addAudit(entry: {
  actor: string;
  action: string;
  target: string;
  before: string;
  after: string;
  ref: string;
  promoId: string | null;
}): void {
  auditSeq += 1;
  state.audit.unshift({
    id: auditSeq,
    at: nextStamp(),
    actor: entry.actor,
    action: entry.action,
    target: entry.target,
    before: entry.before,
    after: entry.after,
    ref: entry.ref,
    promoId: entry.promoId,
  });
}

function toast(message: string, tone: ToastTone): void {
  toastSeq += 1;
  const id = toastSeq;
  state.toasts.push({ id, message, tone });
  if (state.toasts.length > 3) state.toasts = state.toasts.slice(-3);
  renderToasts();
  window.setTimeout(() => {
    state.toasts = state.toasts.filter((t) => t.id !== id);
    renderToasts();
  }, 6500);
}

function maskCode(code: string): string {
  if (code.length <= 4) return "••••";
  return code.slice(0, 2) + "••••" + code.slice(-2);
}

function shownCode(code: string): string {
  return currentPersona().caps.promoEdit ? code : maskCode(code);
}

/* ---------------- Root ---------------- */

const root = document.getElementById("root") as HTMLDivElement;
const modalRoot = document.getElementById("modal-root") as HTMLDivElement;
const toastRoot = document.getElementById("toast-root") as HTMLDivElement;

function render(): void {
  const persona = currentPersona();
  const promo = currentPromo();
  if (state.view === "promo" && !promo) {
    state.view = "diskon";
  }
  if (state.view === "import" && !persona.caps.hargaEdit) {
    state.view = "produk";
  }
  root.innerHTML =
    renderBanner(persona) +
    `<div class="app-shell">` +
    renderSidebar(persona) +
    `<div class="app-main">` +
    renderHeader(persona) +
    `<main class="app-content" id="app-content">${renderView()}</main>` +
    `</div></div>`;
  renderDialog();
}

function renderToasts(): void {
  toastRoot.innerHTML = state.toasts
    .map((t) => `<div class="toast toast-${t.tone}">${esc(t.message)}</div>`)
    .join("");
}

function renderBanner(persona: Persona): string {
  const options = PERSONAS.map(
    (p) =>
      `<option value="${p.key}"${p.key === persona.key ? " selected" : ""}>${esc(p.name)} — ${esc(
        p.role
      )} • ${esc(p.branch)}</option>`
  ).join("");
  return `<div class="proto-banner" role="region" aria-label="Status prototype">
    <span class="proto-dot" aria-hidden="true"></span>
    <strong>Prototype</strong>
    <span>• data simulasi • tidak tersimpan</span>
    <span class="proto-banner-note">Simulasi UI front-end — bukan bukti RBAC atau otorisasi server.</span>
    <span class="proto-banner-spacer"></span>
    <label class="proto-persona">Persona (simulasi)
      <select data-action="persona" aria-label="Pilih persona simulasi">${options}</select>
    </label>
    <button class="btn btn-outline btn-sm" data-action="reset-demo">Reset demo</button>
  </div>`;
}

function capChip(label: string, on: boolean): string {
  return `<span class="chip ${on ? "chip-on" : "chip-off"}" title="${esc(label)}: ${
    on ? "tersedia" : "tidak tersedia"
  } pada persona simulasi">${on ? "✓" : "✕"} ${esc(label)}</span>`;
}

function renderSidebar(persona: Persona): string {
  const produkActive = state.view === "produk" || state.view === "import";
  const diskonActive = state.view === "diskon" || state.view === "promo" || state.view === "simulasi";
  const importReason = persona.caps.hargaEdit ? "" : capReason("hargaEdit");
  const lockedReason =
    "Menu ini sengaja tidak berfungsi pada prototype. Hanya Produk, Diskon, dan Riwayat & audit yang disimulasikan.";

  const lockedItems = [
    "Pesanan",
    "Review Jubelio",
    "Customer",
    "Notifikasi",
    "Cabang",
    "Analitik",
    "Homepage",
    "Halaman",
    "Pengguna",
    "Footer",
    "Hak Akses",
  ]
    .map(
      (label) =>
        `<button class="nav-item" type="button" disabled title="${esc(lockedReason)}">${icon(
          "dot"
        )}<span>${esc(label)}</span></button>`
    )
    .join("");

  return `<aside class="sidebar">
    <div class="sidebar-brand">Admin<span>Panel</span></div>
    <nav class="sidebar-nav" aria-label="Navigasi admin">
      <div class="nav-group">
        <button class="nav-item" type="button" data-action="nav-produk" aria-current="${
          produkActive ? "page" : "false"
        }">${icon("produk")}<span>Produk</span></button>
        <button class="nav-sub" type="button" data-action="nav-produk"${
          state.view === "produk" ? ' aria-current="page"' : ""
        }>Harga coret</button>
        <button class="nav-sub" type="button" data-action="nav-import"${disabledIf(
          importReason !== "",
          importReason
        )}${state.view === "import" ? ' aria-current="page"' : ""}>Import &amp; batch</button>
      </div>
      <div class="nav-group">
        <button class="nav-item" type="button" data-action="nav-diskon" aria-current="${
          diskonActive ? "page" : "false"
        }">${icon("diskon")}<span>Diskon</span></button>
        <button class="nav-sub" type="button" data-action="nav-disken-public"${
          state.view === "diskon" && state.diskonChannel === "public" ? ' aria-current="page"' : ""
        }>Kupon publik</button>
        <button class="nav-sub" type="button" data-action="nav-disken-manual"${
          state.view === "diskon" && state.diskonChannel === "manual" ? ' aria-current="page"' : ""
        }>Kode promo</button>
        <button class="nav-sub" type="button" data-action="nav-simulasi"${
          state.view === "simulasi" ? ' aria-current="page"' : ""
        }>Simulasi biaya</button>
      </div>
      <button class="nav-item" type="button" data-action="nav-audit" aria-current="${
        state.view === "audit" ? "page" : "false"
      }">${icon("audit")}<span>Riwayat &amp; audit</span></button>
      ${lockedItems}
      <p class="nav-hint">Menu abu-abu di luar cakupan prototype ini.</p>
    </nav>
    <div class="sidebar-user">
      <div class="sidebar-user-row">
        <div class="avatar" aria-hidden="true">${esc(persona.name.charAt(0))}</div>
        <div class="sidebar-user-text">
          <div class="user-name">${esc(persona.name)}</div>
          <div class="user-meta">${esc(persona.role)} • ${esc(persona.branch)}</div>
        </div>
      </div>
      <div class="caps-row">
        ${capChip("Harga edit", persona.caps.hargaEdit)}
        ${capChip("Promo edit", persona.caps.promoEdit)}
        ${capChip("Kapasitas", persona.caps.kapasitasEdit)}
        ${capChip(
          persona.ordersScope === "all" ? "Orders semua cabang" : "Orders " + persona.branch,
          true
        )}
      </div>
    </div>
  </aside>`;
}

function renderHeader(persona: Persona): string {
  return `<header class="app-header">
    <h1>Admin Dashboard</h1>
    <div class="header-meta">
      <span class="badge badge-outline">${esc(persona.scopeLabel)}</span>
      <button class="btn-icon" type="button" disabled title="Notifikasi tidak disimulasikan pada prototype ini." aria-label="Notifikasi (tidak tersedia)">${icon(
        "bell"
      )}</button>
    </div>
  </header>`;
}

function renderView(): string {
  if (state.view === "produk") return renderProduk();
  if (state.view === "import") return renderImport();
  if (state.view === "diskon") return renderDiskon();
  if (state.view === "promo") return renderPromoDetail();
  if (state.view === "simulasi") return renderSimulasi();
  return renderAudit();
}

/* ---------------- View: Produk ---------------- */

function renderSkuRow(sku: Sku): string {
  const persona = currentPersona();
  const active = markdownActive(sku);
  const inactive = targetInactive(sku);
  const website = websitePrice(sku);
  const checked = state.selectedSkus.includes(sku.sku);

  const statusBadge = active
    ? badge("Aktif", "badge-accent")
    : inactive
    ? badge("Target nonaktif", "badge-destructive")
    : badge("Tanpa markdown", "badge-outline");

  const targetCell =
    sku.target === null
      ? `<span class="muted">—</span>`
      : inactive
      ? `<s class="strike">${rp(sku.target)}</s>`
      : `<span class="price-now">${rp(sku.target)}</span>`;

  const websiteCell = active
    ? `<span class="price-now">${rp(website)}</span><span class="price-was">${rp(sku.base)}</span>`
    : `<span class="price-now">${rp(website)}</span>`;

  const editReason = !persona.caps.hargaEdit
    ? capReason("hargaEdit")
    : "";
  const restoreReason = !persona.caps.hargaEdit
    ? capReason("hargaEdit")
    : sku.target === null
    ? "SKU ini tidak punya Markdown untuk di-restore."
    : "";

  return `<tr>
    <td class="col-check"><input class="check" type="checkbox" data-action="toggle-sku" value="${esc(
      sku.sku
    )}"${checked ? " checked" : ""} aria-label="Pilih ${esc(sku.sku)}"></td>
    <td class="mono">${esc(sku.sku)}</td>
    <td>${esc(sku.name)}</td>
    <td class="num">${rp(sku.base)}</td>
    <td class="num">${websiteCell}</td>
    <td class="num">${targetCell}</td>
    <td>${statusBadge}</td>
    <td>
      <div class="row-right">
        ${actionBtn("Ubah", "sku-manual", "btn-outline btn-xs", editReason, ` data-sku="${esc(sku.sku)}"`)}
        ${actionBtn(
          "Restore",
          "sku-restore",
          "btn-ghost btn-xs",
          restoreReason,
          ` data-sku="${esc(sku.sku)}"`
        )}
      </div>
    </td>
  </tr>`;
}

function renderSkuRegion(): string {
  const rows = filteredSkus();
  const body =
    rows.length === 0
      ? `<tr><td class="table-empty" colspan="8">Tidak ada SKU yang cocok dengan pencarian.</td></tr>`
      : rows.map(renderSkuRow).join("");
  return `<div class="table-scroll">
      <table class="table">
        <thead>
          <tr>
            <th class="col-check"><input class="check" type="checkbox" disabled title="Pilih semua hasil filter sengaja tidak disediakan. Centang SKU satu per satu; pilihan dipertahankan saat pindah tampilan." aria-label="Pilih semua (tidak tersedia)"></th>
            <th>SKU</th>
            <th>Nama</th>
            <th class="num">Base Jubelio</th>
            <th class="num">Harga website</th>
            <th class="num">Target tersimpan</th>
            <th>Status</th>
            <th class="num">Aksi</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <p class="table-note">${rows.length} dari ${state.skus.length} SKU ditampilkan. ${
    state.selectedSkus.length
  } SKU dipilih; pilihan dipertahankan saat pindah tampilan dan tidak ada tombol pilih semua hasil filter.</p>`;
}

function renderProduk(): string {
  const persona = currentPersona();
  const selected = state.selectedSkus.length;
  const selectedWithMarkdown = state.selectedSkus.filter((id) => {
    const sku = findSku(id);
    return sku !== undefined && sku.target !== null;
  }).length;
  const inactive = state.skus.filter(targetInactive);
  const batch = state.importFlow.batch;

  const manualReason = !persona.caps.hargaEdit
    ? capReason("hargaEdit")
    : selected === 0
    ? "Pilih minimal satu SKU terlebih dahulu."
    : "";
  const restoreReason = !persona.caps.hargaEdit
    ? capReason("hargaEdit")
    : selectedWithMarkdown === 0
    ? "Pilih minimal satu SKU yang masih punya Markdown."
    : "";
  const importReason = persona.caps.hargaEdit ? "" : capReason("hargaEdit");
  const resultReason = batch === null ? "Belum ada batch import pada sesi ini." : "";

  const inactiveRows =
    inactive.length === 0
      ? `<p class="list-note">Tidak ada SKU dengan target tersimpan ≥ base saat ini.</p>`
      : `<div class="table-scroll short">
          <table class="table">
            <thead>
              <tr><th>SKU</th><th class="num">Base terbaru</th><th class="num">Target tersimpan</th><th class="num">Harga website</th></tr>
            </thead>
            <tbody>
              ${inactive
                .map(
                  (sku) => `<tr>
                    <td class="mono">${esc(sku.sku)}</td>
                    <td class="num">${rp(sku.base)}</td>
                    <td class="num"><s class="strike">${rp(sku.target ?? 0)}</s></td>
                    <td class="num">${rp(websitePrice(sku))}</td>
                  </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>`;

  return `
    <div class="page-head">
      <div>
        <h2 class="page-title">Produk</h2>
        <p class="page-sub">Katalog mengikuti Jubelio sebagai source of truth. Harga coret (Markdown) berlaku untuk semua cabang: harga akhir tetap, bukan campaign, tanpa tanggal akhir, tanpa harga per cabang.</p>
      </div>
      <div class="page-head-actions">
        ${badge("Harga global • semua cabang", "badge-outline")}
        ${badge("Bukan campaign", "badge-outline")}
      </div>
    </div>

    ${alertBox(
      "info",
      `<div><strong>Batas kewenangan (disimulasikan).</strong> Operasi harga global butuh <span class="mono">Harga:view</span> + <span class="mono">Harga:edit</span> dan view Produk seluruh cabang. Stok dan detail Produk tetap mengikuti scope cabang existing; izin harga tidak memberi view Produk seluruh cabang secara otomatis.</div>`
    )}

    <section class="card">
      <div class="card-head">
        <h3 class="card-title">Harga coret</h3>
        <p class="card-desc">Manual, bulk, dan import selalu melewati review sebelum apply. Setiap baris sukses langsung live — batch bukan transaksi atomik penuh.</p>
      </div>
      <div class="card-body">
        <div class="toolbar">
          <div class="search-wrap">
            ${icon("search")}
            <input class="input" type="search" placeholder="Cari SKU atau nama produk" value="${esc(
              state.search
            )}" data-action="search" aria-label="Cari SKU atau nama produk">
          </div>
          <span class="badge badge-accent">${selected} SKU dipilih</span>
          <div class="toolbar-group">
            ${actionBtn("Ubah manual", "manual-open", "btn-sm", manualReason, "")}
            ${actionBtn("Ubah massal (% dari base)", "bulk-open", "btn-outline btn-sm", manualReason, "")}
            ${actionBtn("Restore terpilih", "restore-open", "btn-outline btn-sm", restoreReason, "")}
            ${actionBtn("Import Excel (simulasi)", "nav-import", "btn-secondary btn-sm", importReason, "")}
            ${actionBtn(
              batch === null ? "Hasil import" : "Hasil import " + batch.id,
              "nav-import",
              "btn-outline btn-sm",
              resultReason,
              ""
            )}
            ${actionBtn(
              "Export terpilih",
              "noop",
              "btn-outline btn-sm",
              "Export .xlsx nyata di luar cakupan prototype: tidak ada file, parser, atau provider.",
              ""
            )}
            <button class="btn btn-ghost btn-sm" type="button" data-action="clear-selection"${disabledIf(
              selected === 0,
              "Belum ada SKU yang dipilih."
            )}>Bersihkan pilihan</button>
          </div>
        </div>
        <div id="sku-region">${renderSkuRegion()}</div>
        <p class="list-note">Tombol nonaktif: <strong>Export terpilih</strong> (tidak ada file nyata), <strong>pilih semua hasil filter</strong> (keputusan tiket 05), serta aksi harga untuk persona tanpa <span class="mono">Harga:edit</span>. Tooltip pada tombol menjelaskan alasannya.</p>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <h3 class="card-title">Target nonaktif (base ≤ target)</h3>
        <p class="card-desc">Base terbaru turun sampai ≤ target tersimpan, sehingga Markdown tidak efektif. Harga website mengikuti base terbaru dan target tidak dihitung ulang.</p>
      </div>
      <div class="card-body">
        ${alertBox(
          "warn",
          `<div><strong>${inactive.length} SKU</strong> memiliki target tersimpan yang tidak aktif. Harga website dan target tersimpan sengaja ditampilkan terpisah agar tidak terbaca sebagai diskon yang berlaku.</div>`
        )}
        ${inactiveRows}
        <p class="list-note">Menghapus Markdown (restore) mengikuti base terbaru. Restore selalu melalui review dan menyebutkan bahwa Markdown terbaru akan dihapus.</p>
      </div>
    </section>`;
}

/* ---------------- View: Import ---------------- */

function tally(rows: ImportRow[]): { applied: number; unchanged: number; failed: number; pending: number } {
  let applied = 0;
  let unchanged = 0;
  let failed = 0;
  let pending = 0;
  for (const row of rows) {
    if (row.status === "applied") applied += 1;
    else if (row.status === "unchanged") unchanged += 1;
    else if (row.status === "invalid" || row.status === "failed") failed += 1;
    else pending += 1;
  }
  return { applied, unchanged, failed, pending };
}

function batchStatus(rows: ImportRow[]): string {
  const t = tally(rows);
  if (t.pending > 0) return "belum final";
  if (t.failed > 0) return t.applied + t.unchanged > 0 ? "PARTIALLY APPLIED" : "FAILED";
  return "APPLIED";
}

function buildSampleBatch(): ImportBatch {
  const excluded = ["SHOE-BLACK-42", "SHOE-WHITE-40", "SHOE-RED-39"];
  const pool = state.skus.filter((s) => excluded.indexOf(s.sku) === -1);
  const restoreTargets = ["SANDAL-TAN-41", "SLIPPER-GREY-38"];
  const rows: ImportRow[] = [];
  const invalidByRow: Record<number, ImportRow> = {
    8: {
      row: 8,
      sku: "UNKNOWN-SKU-404",
      action: "set_price",
      price: 120000,
      raw: null,
      status: "invalid",
      reason: "SKU tidak ditemukan",
    },
    9: {
      row: 9,
      sku: "SHOE-WHITE-40",
      action: "set_price",
      price: 250000,
      raw: null,
      status: "invalid",
      reason: "Target ≥ base terbaru (Rp 200.000)",
    },
    10: {
      row: 10,
      sku: "SHOE-RED-39",
      action: "set_price",
      price: null,
      raw: "=B2*0.8",
      status: "invalid",
      reason: "Formula tidak diterima",
    },
  };

  let poolIndex = 0;
  for (let rowNo = 1; rowNo <= 100; rowNo += 1) {
    const invalid = invalidByRow[rowNo];
    if (invalid) {
      rows.push(invalid);
      continue;
    }
    const sku = pool[poolIndex];
    poolIndex += 1;
    if (!sku) continue;
    if (restoreTargets.indexOf(sku.sku) !== -1) {
      rows.push({
        row: rowNo,
        sku: sku.sku,
        action: "restore_base",
        price: null,
        raw: null,
        status: "valid",
        reason: "",
      });
      continue;
    }
    rows.push({
      row: rowNo,
      sku: sku.sku,
      action: "set_price",
      price: roundHalfUp((sku.base * 85) / 100),
      raw: null,
      status: "valid",
      reason: "",
    });
  }
  return { id: "B001", parentId: null, rows: rows, createdAt: nextStamp() };
}

function buildRetryBatch(parent: ImportBatch): ImportBatch {
  const fixed: ImportRow[] = [
    {
      row: 8,
      sku: "SANDAL-TAN-41",
      action: "set_price",
      price: 190000,
      raw: null,
      status: "valid",
      reason: "Diperbaiki: SKU valid, target < base",
    },
    {
      row: 9,
      sku: "SHOE-WHITE-40",
      action: "set_price",
      price: 160000,
      raw: null,
      status: "valid",
      reason: "Diperbaiki: target di bawah base Rp 200.000",
    },
    {
      row: 10,
      sku: "SHOE-RED-39",
      action: "set_price",
      price: 150000,
      raw: null,
      status: "valid",
      reason: "Diperbaiki: angka, bukan formula",
    },
  ];
  return { id: "B002", parentId: parent.id, rows: fixed, createdAt: nextStamp() };
}

function applyImportRow(row: ImportRow): void {
  const sku = findSku(row.sku);
  if (!sku) {
    row.status = "failed";
    row.reason = "SKU tidak ditemukan saat apply";
    return;
  }
  if (row.action === "restore_base") {
    if (sku.target === null) {
      row.status = "unchanged";
      row.reason = "Tidak berubah: tidak ada Markdown";
      return;
    }
    sku.target = null;
    row.status = "applied";
    row.reason = "Markdown dihapus; harga mengikuti base terbaru";
    return;
  }
  const price = row.price ?? 0;
  if (price <= 0 || price >= sku.base) {
    row.status = "failed";
    row.reason = `Target ≥ base terbaru (${rp(sku.base)})`;
    return;
  }
  sku.target = price;
  row.status = "applied";
  row.reason = "Diterapkan";
}

function stopApplyTimer(): void {
  if (applyTimer !== null) {
    window.clearInterval(applyTimer);
    applyTimer = null;
  }
}

function beginApply(): void {
  const batch = state.importFlow.batch;
  if (!batch) return;
  if (!currentPersona().caps.hargaEdit) {
    toast(capReason("hargaEdit"), "warn");
    return;
  }
  state.importFlow.applyActor = currentPersona().name;
  state.importFlow.haltReason = "none";
  state.importFlow.phase = "applying";
  render();
  applyTimer = window.setInterval(() => {
    const flow = state.importFlow;
    const current = flow.batch;
    if (!current) {
      stopApplyTimer();
      return;
    }
    // Current policy diperiksa lagi sebelum setiap baris: bila izin berubah,
    // penulisan berikutnya berhenti dan baris yang sudah committed tetap ada.
    if (!currentPersona().caps.hargaEdit) {
      stopApplyTimer();
      flow.phase = "interrupted";
      flow.haltReason = "permission-revoked";
      render();
      toast(
        "Harga:edit tidak lagi tersedia. Penulisan berikutnya dihentikan; baris yang sudah committed tetap tercatat.",
        "warn"
      );
      return;
    }
    const nextRow = current.rows.find((r) => r.status === "valid");
    if (!nextRow) {
      finishApply();
      return;
    }
    applyImportRow(nextRow);
    const t = tally(current.rows);
    if (!flow.forcedInterruptDone && t.applied >= 60) {
      flow.forcedInterruptDone = true;
      flow.phase = "interrupted";
      flow.haltReason = "simulated-disconnect";
      stopApplyTimer();
      render();
      return;
    }
    const region = document.getElementById("import-region");
    if (region) region.innerHTML = renderImportProgress();
  }, 45);
}

function finishApply(): void {
  stopApplyTimer();
  const flow = state.importFlow;
  const batch = flow.batch;
  if (!batch) return;
  flow.phase = "done";
  flow.haltReason = "none";
  const t = tally(batch.rows);
  addAudit({
    actor: flow.applyActor ?? currentPersona().name,
    action: `Import ${batch.id} selesai`,
    target: "Harga coret (batch)",
    before: "—",
    after: `${t.applied} diterapkan • ${t.unchanged} tidak berubah • ${t.failed} gagal`,
    ref: `Batch ${batch.id}`,
    promoId: null,
  });
  render();
  toast(`Batch ${batch.id} selesai: ${t.applied} diterapkan, ${t.failed} gagal.`, "ok");
}

function renderImportSummary(): string {
  const flow = state.importFlow;
  if (!flow.batch) return "";
  const b1 = flow.batch;
  const t1 = tally(b1.rows);
  const retry = flow.retryBatch;
  const t2 = retry === null ? null : tally(retry.rows);
  return `<section class="card">
      <div class="card-head">
        <h3 class="card-title">Batch import</h3>
        <p class="card-desc">Batch adalah pengelompokan tindakan administratif, bukan campaign dan bukan jaminan atomik.</p>
      </div>
      <div class="card-body">
        <div class="table-scroll short">
          <table class="table">
            <thead>
              <tr><th>Batch</th><th>Asal</th><th>Status</th><th class="num">Diterapkan</th><th class="num">Tidak berubah</th><th class="num">Gagal</th><th class="num">Belum selesai</th><th>Dibuat</th></tr>
            </thead>
            <tbody>
              <tr>
                <td class="mono">${b1.id}</td>
                <td>—</td>
                <td>${badge(batchStatus(b1.rows), t1.pending > 0 ? "badge-outline" : t1.failed > 0 ? "badge-destructive" : "badge-accent")}</td>
                <td class="num">${t1.applied}</td>
                <td class="num">${t1.unchanged}</td>
                <td class="num">${t1.failed}</td>
                <td class="num">${t1.pending}</td>
                <td class="small">${esc(b1.createdAt)}</td>
              </tr>
              ${
                retry === null || t2 === null
                  ? ""
                  : `<tr>
                      <td class="mono">${retry.id}</td>
                      <td class="mono">${retry.parentId ?? "—"}</td>
                      <td>${badge(batchStatus(retry.rows), t2.failed > 0 ? "badge-destructive" : "badge-accent")}</td>
                      <td class="num">${t2.applied}</td>
                      <td class="num">${t2.unchanged}</td>
                      <td class="num">${t2.failed}</td>
                      <td class="num">${t2.pending}</td>
                      <td class="small">${esc(retry.createdAt)}</td>
                    </tr>`
              }
            </tbody>
          </table>
        </div>
      </div>
    </section>`;
}

function renderImportRowsTable(rows: ImportRow[], short: boolean): string {
  const body = rows
    .map((row) => {
      const isProblem = row.status === "invalid" || row.status === "failed";
      const statusText = isProblem ? row.reason : row.status === "applied" ? "Diterapkan" : row.status === "unchanged" ? "Tidak berubah" : "Valid";
      return `<tr>
        <td class="num">${row.row}</td>
        <td class="mono">${esc(row.sku)}</td>
        <td class="mono">${row.action}</td>
        <td class="num">${row.raw !== null ? esc(row.raw) : row.price === null ? "—" : rp(row.price)}</td>
        <td>${isProblem ? badge("Gagal", "badge-destructive") : row.status === "applied" ? badge("Diterapkan", "badge-accent") : row.status === "unchanged" ? badge("Tidak berubah", "badge-outline") : badge("Valid", "badge-outline")}</td>
        <td class="small">${esc(statusText)}</td>
      </tr>`;
    })
    .join("");
  return `<div class="table-scroll${short ? " short" : ""}">
      <table class="table">
        <thead>
          <tr><th class="num">Baris</th><th>SKU</th><th>Action</th><th class="num">Target</th><th>Status</th><th>Alasan</th></tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function renderImportProgress(): string {
  const flow = state.importFlow;
  const batch = flow.batch;
  if (!batch) return "";
  const t = tally(batch.rows);
  const finalTotal = t.applied + t.unchanged + t.failed + t.pending;
  const percent = finalTotal === 0 ? 0 : Math.round((t.applied / finalTotal) * 100);
  const halted = flow.phase === "interrupted";
  const permissionHalt = halted && flow.haltReason === "permission-revoked";
  const actor = flow.applyActor ?? "—";

  let haltNotice = `<p class="list-note">Proses berjalan foreground dan bounded. Jangan tutup hasil sebagai sukses final selama masih ada baris pending.</p>`;
  if (permissionHalt) {
    haltNotice = alertBox(
      "error",
      `<div><strong>Apply dihentikan: izin Harga:edit tidak lagi tersedia.</strong> ${t.applied} baris sudah committed dan tetap berlaku; ${t.pending} baris belum selesai tanpa rollback. Batch dimulai oleh ${esc(
        actor
      )}; lanjutkan dengan persona yang punya Harga:edit.</div>`
    );
  } else if (halted) {
    haltNotice = alertBox(
      "warn",
      `<div><strong>SIMULASI: koneksi apply terputus setelah ${t.applied} baris diterapkan.</strong> Status batch belum final: ${t.pending} baris belum selesai, baris yang sudah sukses tidak diulang dan tidak ada rollback seluruh batch.</div>`
    );
  }

  return `<div class="stack-sm" id="import-progress">
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
        <div class="progress-bar" style="width:${percent}%"></div>
      </div>
      <div class="stat-grid">
        <div class="stat"><div class="stat-label">Diterapkan</div><div class="stat-value">${t.applied}</div></div>
        <div class="stat"><div class="stat-label">Tidak berubah</div><div class="stat-value">${t.unchanged}</div></div>
        <div class="stat"><div class="stat-label">Gagal</div><div class="stat-value">${t.failed}</div></div>
        <div class="stat"><div class="stat-label">Belum selesai</div><div class="stat-value">${t.pending}</div></div>
      </div>
      ${haltNotice}
      <div class="row">
        ${
          halted
            ? actionBtn(
                "Lanjutkan request yang sama (resume)",
                "import-resume",
                "btn-sm",
                currentPersona().caps.hargaEdit ? "" : capReason("hargaEdit"),
                ""
              )
            : `<button class="btn btn-sm" type="button" disabled title="Tunggu proses selesai.">Memproses…</button>`
        }
        ${actionBtn("Tutup sebagai sukses", "noop", "btn-outline btn-sm", "Masih ada baris belum selesai; hasil belum final.", "")}
      </div>
    </div>`;
}

function renderImportResult(): string {
  const batch = state.importFlow.batch;
  if (!batch) return "";
  const t = tally(batch.rows);
  return `<div class="stack-sm">
      <div class="row-between">
        <div class="badge-row">
          ${badge(batchStatus(batch.rows), "badge-destructive")}
          <span class="small muted">Batch ${batch.id} • dibuat ${esc(batch.createdAt)}</span>
        </div>
        <div class="row">
          ${actionBtn("Download laporan gagal (CSV)", "import-csv", "btn-outline btn-sm", "", "")}
          ${actionBtn("Lihat riwayat & audit", "nav-audit", "btn-ghost btn-sm", "", "")}
        </div>
      </div>
      <div class="stat-grid">
        <div class="stat"><div class="stat-label">Diterapkan</div><div class="stat-value">${t.applied}</div><div class="stat-sub">langsung live per baris</div></div>
        <div class="stat"><div class="stat-label">Tidak berubah</div><div class="stat-value">${t.unchanged}</div><div class="stat-sub">bukan perubahan fiktif</div></div>
        <div class="stat"><div class="stat-label">Gagal</div><div class="stat-value">${t.failed}</div><div class="stat-sub">tidak menulis apa pun</div></div>
        <div class="stat"><div class="stat-label">Belum selesai</div><div class="stat-value">${t.pending}</div><div class="stat-sub">tidak diklaim sukses</div></div>
      </div>
      ${alertBox(
        "warn",
        `<div><strong>Hasil partial.</strong> ${t.applied} baris diterapkan dan ${t.failed} baris gagal tanpa perubahan. Laporan memuat nomor baris, SKU, action, target, status, dan alasan error. File Excel asli tidak diarsipkan.</div>`
      )}
      <div class="row">
        ${actionBtn(
          "Retry 3 baris gagal → batch B002",
          "import-retry-open",
          "btn-sm",
          state.importFlow.retryBatch === null ? "" : "Batch B002 sudah dibuat pada sesi ini.",
          ""
        )}
        ${actionBtn("Mulai ulang simulasi import", "import-reset", "btn-outline btn-sm", "", "")}
      </div>
      <p class="list-note">CSV dibuat di browser hanya untuk memperagakan laporan; bukan file .xlsx dan tidak ada file yang diunggah. Retry memakai batch baru yang terhubung ke batch asal sehingga 97 baris sukses tidak diulang.</p>
    </div>`;
}

function renderRetryPreview(): string {
  const retry = state.importFlow.retryBatch;
  const parent = state.importFlow.batch;
  if (!retry || !parent) return "";
  return `<div class="stack-sm">
      ${alertBox(
        "info",
        `<div><strong>Batch baru ${retry.id} (asal ${parent.id}).</strong> Hanya 3 baris gagal yang diperbaiki. Melalui preview dan apply lagi; 97 baris sukses di ${parent.id} tidak diulang.</div>`
      )}
      ${renderImportRowsTable(retry.rows, true)}
      <div class="row">
        ${actionBtn("Terapkan 3 baris (B002)", "import-retry-apply", "btn-sm", "", "")}
        ${actionBtn("Batalkan retry", "import-retry-cancel", "btn-outline btn-sm", "", "")}
      </div>
    </div>`;
}

function renderImportRetryDone(): string {
  const retry = state.importFlow.retryBatch;
  if (!retry) return "";
  const t = tally(retry.rows);
  return `<div class="stack-sm">
      ${alertBox(
        "success",
        `<div><strong>Batch ${retry.id} (asal ${retry.parentId}) selesai:</strong> ${t.applied} diterapkan, ${t.failed} gagal. Riwayat batch asal tetap utuh dan tidak dihitung ulang.</div>`
      )}
      ${renderImportRowsTable(retry.rows, true)}
      <div class="row">
        ${actionBtn("Lihat riwayat & audit", "nav-audit", "btn-outline btn-sm", "", "")}
        ${actionBtn("Mulai ulang simulasi import", "import-reset", "btn-ghost btn-sm", "", "")}
      </div>
    </div>`;
}

function renderImport(): string {
  const persona = currentPersona();
  const flow = state.importFlow;
  const loadReason = persona.caps.hargaEdit ? "" : capReason("hargaEdit");

  const idle = `<div class="stack-sm">
      <div class="row">
        ${actionBtn("Muat contoh 100 baris (contoh100)", "import-load-sample", "btn-sm", loadReason, "")}
        ${actionBtn(
          "Pilih file .xlsx",
          "noop",
          "btn-outline btn-sm",
          "Upload dan parser .xlsx nyata di luar cakupan prototype: tidak ada file yang dibaca.",
          ""
        )}
        ${actionBtn(
          "Template kosong (.xlsx)",
          "noop",
          "btn-outline btn-sm",
          "Template berversi .xlsx tidak dibuat pada prototype ini.",
          ""
        )}
      </div>
      <p class="list-note">Tombol contoh memuat 100 baris mock di memori (bukan parsing Excel). Template berversi: <span class="mono">sku</span> (teks), <span class="mono">action</span> (set_price/restore_base), <span class="mono">new_price</span> (angka bulat rupiah). Batas awal: 1.000 baris, file 5 MiB, dekompresi 25 MiB.</p>
    </div>`;

  let body = idle;
  if (flow.phase === "preview" && flow.batch) {
    const t = tally(flow.batch.rows);
    body = `<div class="stack-sm">
        ${alertBox(
          "sim",
          `<div><strong>SIMULASI.</strong> Preview 100 baris: ${t.pending} valid, ${t.failed} invalid. File rusak, header salah, sheet tambahan, atau macro akan menolak seluruh file; di prototype ini tidak ada file nyata.</div>`
        )}
        ${renderImportRowsTable(flow.batch.rows, false)}
        <div class="row">
          ${actionBtn("Terapkan " + t.pending + " baris valid", "import-apply", "btn-sm", "", "")}
          ${actionBtn("Kembali", "import-reset", "btn-outline btn-sm", "", "")}
        </div>
        <p class="list-note">Baris invalid tidak menulis perubahan. SKU duplikat dalam satu file akan menggagalkan semua baris SKU tersebut; file contoh ini memakai SKU unik.</p>
      </div>`;
  } else if (flow.phase === "applying" || flow.phase === "interrupted") {
    body = renderImportProgress();
  } else if (flow.phase === "done") {
    body = renderImportResult();
  } else if (flow.phase === "retry-preview") {
    body = renderRetryPreview();
  } else if (flow.phase === "retry-done") {
    body = renderImportRetryDone();
  }

  return `
    <div class="page-head">
      <div>
        <h2 class="page-title">Import &amp; batch harga coret</h2>
        <p class="page-sub">Import mengubah harga website untuk semua cabang. Upload hanya staging/validasi; perubahan live terjadi saat apply, per baris.</p>
      </div>
      <div class="page-head-actions">${badge("SIMULASI — tanpa file nyata", "badge-solid")}</div>
    </div>
    <section class="card">
      <div class="card-head">
        <h3 class="card-title">Import Excel (simulasi)</h3>
        <p class="card-desc">Contoh terkunci: 100 baris → 97 diterapkan, 3 gagal, lalu retry subset sebagai batch B002 yang terhubung ke B001.</p>
      </div>
      <div class="card-body">
        <div id="import-region">${body}</div>
      </div>
    </section>
    ${renderImportSummary()}
    <section class="card">
      <div class="card-head">
        <h3 class="card-title">Catatan kontrak</h3>
        <p class="card-desc">Ringkasan aturan yang diperagakan prototype ini.</p>
      </div>
      <div class="card-body">
        <ul class="list-note">
          <li>Apply memakai base/Markdown terbaru tanpa review ulang; target valid diterapkan, target tidak valid gagal per baris.</li>
          <li>Proses terputus bukan sukses final: status batch menjadi acuan, resume tidak mengulang baris committed.</li>
          <li>Perbaikan subset gagal melalui batch baru yang terhubung ke batch asal, lalu preview/apply lagi.</li>
          <li>Izin diperiksa kembali saat apply/resume; baris yang sudah committed tetap dilaporkan.</li>
        </ul>
      </div>
    </section>`;
}

/* ---------------- View: Diskon ---------------- */

function renderDiskon(): string {
  const channel: PromoChannel = state.diskonChannel;
  const promos = state.promos.filter((p) => p.channel === channel);
  const canEdit = currentPersona().caps.promoEdit;

  const body = promos
    .map((promo) => {
      const quota = quotaAvailable(promo);
      const budget = budgetAvailable(promo);
      const codeCell =
        promo.channel === "manual"
          ? promo.codes
              .map((c) => `<span class="mono">${esc(shownCode(c.code))}</span>${c.active ? "" : badge("nonaktif", "badge-outline")}`)
              .join(", ")
          : `<span class="muted">—</span>`;
      return `<tr>
        <td><strong>${esc(promo.name)}</strong><div class="small muted mono">${promo.id}</div></td>
        <td>${esc(channelLabel(promo.channel))}</td>
        <td>${esc(benefitLabel(promo.benefit))}</td>
        <td>${promo.status === "live" ? badge("Live", "badge-accent") : badge("Pause", "badge-outline")}</td>
        <td class="num">${promo.revision}</td>
        <td class="num">${quota === null ? "—" : quota}</td>
        <td class="num">${budget === null ? "—" : rp(budget)}</td>
        <td>${codeCell}</td>
        <td><div class="row-right">${actionBtn("Buka detail", "open-promo", "btn-outline btn-xs", "", ` data-promo="${promo.id}"`)}</div></td>
      </tr>`;
    })
    .join("");

  return `
    <div class="page-head">
      <div>
        <h2 class="page-title">Diskon</h2>
        <p class="page-sub">Satu promo = satu identitas, satu benefit, dan satu jalur (kupon publik atau kode manual). Kode dan kupon berbagi satu slot promosi per order.</p>
      </div>
      <div class="page-head-actions">
        ${badge("Satu benefit per promo", "badge-outline")}
        ${badge(canEdit ? "Kode lengkap terlihat" : "Kode disamarkan", canEdit ? "badge-accent" : "badge-outline")}
      </div>
    </div>

    <section class="card">
      <div class="card-head">
        <h3 class="card-title">Daftar promo</h3>
        <p class="card-desc">Kupon publik dipilih customer tanpa prior claim. Kode manual diaktifkan dengan memasukkan kode; keduanya memakai slot yang sama.</p>
      </div>
      <div class="card-body">
        <div class="tabs" role="tablist" aria-label="Jalur promo">
          <button class="tab" role="tab" type="button" aria-selected="${channel === "public"}" data-action="diskon-channel" data-channel="public">Kupon publik (${state.promos.filter((p) => p.channel === "public").length})</button>
          <button class="tab" role="tab" type="button" aria-selected="${channel === "manual"}" data-action="diskon-channel" data-channel="manual">Kode promo (${state.promos.filter((p) => p.channel === "manual").length})</button>
        </div>
        ${alertBox(
          "info",
          `<div><strong>Satu slot.</strong> Kupon barang atau kode manual (barang maupun subsidi ongkir) memakai slot yang sama, bukan slot tambahan. Markdown tetap berlaku dan tidak memakai slot.</div>`
        )}
        <div class="table-scroll">
          <table class="table">
            <thead>
              <tr><th>Nama promo</th><th>Jalur</th><th>Benefit</th><th>Status</th><th class="num">Revision</th><th class="num">Kuota tersedia</th><th class="num">Budget tersedia</th><th>Kode</th><th class="num">Aksi</th></tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>
        <p class="list-note">${
          canEdit
            ? "Persona ini punya Promo:edit sehingga literal kode lengkap terlihat. Kewenangan kapasitas tetap diperiksa terpisah."
            : "Persona ini tidak punya Promo:edit. Literal kode tidak dikirim ke tampilan maupun atribut DOM — hanya label tersamarkan."
        }</p>
      </div>
    </section>`;
}

/* ---------------- View: Detail promo ---------------- */

function renderPromoTabs(promo: Promo): string {
  const tabs: PromoTab[] = ["aturan", "kode", "pemakaian", "riwayat"];
  const labels: Record<PromoTab, string> = {
    aturan: "Aturan",
    kode: "Kode",
    pemakaian: "Pemakaian & budget",
    riwayat: "Riwayat",
  };
  return `<div class="tabs" role="tablist" aria-label="Detail promo">
    ${tabs
      .map(
        (tab) =>
          `<button class="tab" role="tab" type="button" aria-selected="${state.promoTab === tab}" data-action="promo-tab" data-tab="${tab}">${labels[tab]}</button>`
      )
      .join("")}
  </div>`;
}

function draftFromPromo(promo: Promo): PromoDraft {
  return {
    promoId: promo.id,
    baseRevision: promo.revision,
    name: promo.name,
    benefit: {
      kind: promo.benefit.kind,
      percent: promo.benefit.percent,
      cap: promo.benefit.cap,
      amount: promo.benefit.amount,
    },
    minSubtotal: promo.minSubtotal,
    startAt: promo.startAt,
    endAt: promo.endAt,
  };
}

function ensureDraft(promo: Promo): PromoDraft {
  if (!state.draft || state.draft.promoId !== promo.id) {
    state.draft = draftFromPromo(promo);
  }
  return state.draft;
}

function hasDraftChanges(promo: Promo): boolean {
  const draft = state.draft;
  if (!draft || draft.promoId !== promo.id) return false;
  return draftDiff(promo, draft).some((row) => row.changed);
}

function draftDiff(promo: Promo, draft: PromoDraft): DiffRow[] {
  const rows: DiffRow[] = [];
  const push = (label: string, before: string, after: string): void => {
    rows.push({ label: label, before: before, after: after, changed: before !== after });
  };
  push("Nama promo", promo.name, draft.name);
  push("Benefit", benefitLabel(promo.benefit), benefitLabel(draft.benefit));
  push("Minimum subtotal", rp(promo.minSubtotal), rp(draft.minSubtotal));
  push("Mulai (WIB)", promo.startAt === "" ? "—" : promo.startAt, draft.startAt === "" ? "—" : draft.startAt);
  push("Akhir (WIB)", promo.endAt === "" ? "Tanpa tanggal akhir" : promo.endAt, draft.endAt === "" ? "Tanpa tanggal akhir" : draft.endAt);
  return rows;
}

function renderBenefitFields(kind: BenefitKind, benefit: Benefit): string {
  if (kind === "percent_goods") {
    return `<label class="field">
        <span class="field-label">Persentase barang (%)</span>
        <input class="input" type="number" min="1" max="99" step="1" data-field="benefit-percent" value="${benefit.percent ?? 10}">
      </label>
      <label class="field">
        <span class="field-label">Cap rupiah (kosongkan = tanpa cap)</span>
        <input class="input" type="number" min="0" step="1000" data-field="benefit-cap" value="${benefit.cap === null ? "" : benefit.cap}">
        <span class="field-hint">Cap membatasi potongan barang per order, bukan persentase kuota.</span>
      </label>`;
  }
  if (kind === "fixed_goods") {
    return `<label class="field">
        <span class="field-label">Nominal potongan barang (Rp)</span>
        <input class="input" type="number" min="0" step="1000" data-field="benefit-amount" value="${benefit.amount ?? 25000}">
      </label>`;
  }
  return `<label class="field">
      <span class="field-label">Subsidi ongkir (Rp)</span>
      <input class="input" type="number" min="0" step="1000" data-field="benefit-amount" value="${benefit.amount ?? 20000}">
      <span class="field-hint">Hanya untuk order delivery. Subsidi ditanggung merchant dan tidak mengurangi ongkir yang ditagih kurir.</span>
    </label>`;
}

function renderPromoForm(promo: Promo): string {
  const persona = currentPersona();
  const source = ensureDraft(promo);
  const kind: BenefitKind = state.benefitKindChoice ?? source.benefit.kind;
  const editReason = persona.caps.promoEdit ? "" : capReason("promoEdit");

  return `<fieldset class="fieldset">
      <legend>Identitas &amp; jalur</legend>
      <div class="form-grid">
        <label class="field">
          <span class="field-label">Nama promo</span>
          <input class="input" type="text" data-field="promo-name" value="${esc(source.name)}"${disabledIf(
            !persona.caps.promoEdit,
            editReason
          )}>
        </label>
        <label class="field">
          <span class="field-label">Jalur promo</span>
          <input class="input" type="text" value="${esc(channelLabel(promo.channel))}" disabled title="Jalur tidak dapat diubah setelah promo dibuat.">
          <span class="field-hint">Kupon publik tidak memiliki kode. Kode manual dapat memiliki beberapa kode yang berbagi kapasitas.</span>
        </label>
      </div>
    </fieldset>

    <fieldset class="fieldset">
      <legend>Benefit (satu per promo)</legend>
      <div class="form-grid">
        <label class="field">
          <span class="field-label">Jenis benefit</span>
          <select class="select" data-action="benefit-kind" data-field="benefit-kind"${disabledIf(
            !persona.caps.promoEdit,
            editReason
          )}>
            <option value="percent_goods"${kind === "percent_goods" ? " selected" : ""}>Persentase barang (+ cap opsional)</option>
            <option value="fixed_goods"${kind === "fixed_goods" ? " selected" : ""}>Nominal barang</option>
            <option value="shipping_subsidy"${kind === "shipping_subsidy" ? " selected" : ""}>Subsidi ongkir (delivery)</option>
          </select>
          <span class="field-hint">Tidak ada stacking atau benefit kedua dalam satu promo.</span>
        </label>
        <div id="benefit-fields" class="form-grid">${renderBenefitFields(kind, source.benefit)}</div>
      </div>
    </fieldset>

    <fieldset class="fieldset">
      <legend>Syarat &amp; masa berlaku</legend>
      <div class="form-grid">
        <label class="field">
          <span class="field-label">Minimum subtotal barang setelah Markdown (Rp)</span>
          <input class="input" type="number" min="0" step="1000" data-field="min-subtotal" value="${source.minSubtotal}"${disabledIf(
            !persona.caps.promoEdit,
            editReason
          )}>
        </label>
        <label class="field">
          <span class="field-label">Mulai (WIB, opsional)</span>
          <input class="input" type="date" data-field="start-at" value="${esc(source.startAt)}"${disabledIf(
            !persona.caps.promoEdit,
            editReason
          )}>
        </label>
        <label class="field">
          <span class="field-label">Akhir (WIB, opsional)</span>
          <input class="input" type="date" data-field="end-at" value="${esc(source.endAt)}"${disabledIf(
            !persona.caps.promoEdit,
            editReason
          )}>
        </label>
        <label class="field">
          <span class="field-label">Syarat customer</span>
          <input class="input" type="text" value="Akun store dengan email terverifikasi" disabled title="Syarat identitas customer tidak dapat diubah dari layar ini.">
        </label>
      </div>
      <p class="field-hint">Benefit barang bersifat general untuk seluruh barang order setelah Markdown — tanpa targeting produk, kategori, atau brand pada fase awal.</p>
    </fieldset>`;
}

function readBenefit(fallback: Benefit): Benefit {
  const kindEl = q('[data-field="benefit-kind"]') as HTMLSelectElement | null;
  const kind: BenefitKind = kindEl ? (kindEl.value as BenefitKind) : fallback.kind;
  if (kind === "percent_goods") {
    const percent = num(qValue('[data-field="benefit-percent"]', String(fallback.percent ?? 10)), fallback.percent ?? 10);
    const capRaw = qValue('[data-field="benefit-cap"]', fallback.cap === null ? "" : String(fallback.cap)).trim();
    return { kind: kind, percent: percent, cap: capRaw === "" ? null : num(capRaw, 0), amount: null };
  }
  const amount = num(qValue('[data-field="benefit-amount"]', String(fallback.amount ?? 0)), fallback.amount ?? 0);
  return { kind: kind, percent: null, cap: null, amount: amount };
}

function collectDraft(promo: Promo): PromoDraft {
  const base = ensureDraft(promo);
  return {
    promoId: promo.id,
    baseRevision: base.baseRevision,
    name: qValue('[data-field="promo-name"]', base.name).trim() || base.name,
    benefit: readBenefit(base.benefit),
    minSubtotal: num(qValue('[data-field="min-subtotal"]', String(base.minSubtotal)), base.minSubtotal),
    startAt: qValue('[data-field="start-at"]', base.startAt),
    endAt: qValue('[data-field="end-at"]', base.endAt),
  };
}

function renderPromoAturan(promo: Promo): string {
  const persona = currentPersona();
  const editReason = persona.caps.promoEdit ? "" : capReason("promoEdit");
  const dirty = hasDraftChanges(promo);

  return `<div class="stack">
      ${
        state.staleNotice === null
          ? ""
          : alertBox(
              "error",
              `<div><strong>Konflik versi.</strong> ${esc(state.staleNotice)}</div>`
            )
      }
      ${
        dirty
          ? alertBox(
              "warn",
              `<div><strong>Draft perubahan belum dipublish.</strong> Promo live tetap revision ${promo.revision}. Publish baru berlaku setelah review diff dan tekan Publish.</div>`
            )
          : ""
      }
      <div class="stack" id="promo-form">
        ${renderPromoForm(promo)}
      </div>
      <div class="row">
        ${actionBtn("Simpan draft", "draft-save", "btn-sm", editReason, "")}
        ${actionBtn("Review perubahan", "draft-review", "btn-secondary btn-sm", editReason, "")}
        ${actionBtn("Batalkan draft", "draft-discard", "btn-outline btn-sm", editReason, "")}
        ${actionBtn(
          "Simulasikan admin lain mengubah promo",
          "simulate-stale",
          "btn-ghost btn-sm",
          editReason,
          ""
        )}
      </div>
      <ul class="list-note">
        <li>Draft tidak mengubah aturan live maupun snapshot order yang sudah mendapat hold.</li>
        <li>Versi stale ditolak: muat versi terbaru lalu review ulang. Tidak ada tombol force-overwrite.</li>
        <li>Publish menaikkan revision; rename, revisi, atau kode baru tidak mereset pemakaian.</li>
      </ul>
    </div>`;
}

function renderPromoKode(promo: Promo): string {
  const persona = currentPersona();
  const canEdit = persona.caps.promoEdit;
  if (promo.channel === "public") {
    return alertBox(
      "info",
      `<div><strong>Kupon publik tidak memiliki kode.</strong> Customer memilih kupon ini langsung di checkout tanpa prior claim. Untuk kode yang harus dimasukkan, gunakan promo dengan jalur kode manual.</div>`
    );
  }
  const rows = promo.codes
    .map(
      (code) => `<tr>
        <td class="mono">${esc(shownCode(code.code))}</td>
        <td>${code.active ? badge("Aktif", "badge-accent") : badge("Nonaktif", "badge-outline")}</td>
        <td class="num">${
          canEdit
            ? actionBtn("Nonaktifkan", "code-deactivate", "btn-ghost btn-xs", code.active ? "" : "Kode sudah nonaktif.", ` data-code="${esc(code.code)}"`)
            : actionBtn("Nonaktifkan", "noop", "btn-ghost btn-xs", capReason("promoEdit"), "")
        }</td>
      </tr>`
    )
    .join("");

  return `<div class="stack">
      ${
        canEdit
          ? ""
          : alertBox(
              "info",
              `<div><strong>Kode disamarkan.</strong> Persona ini tidak punya Promo:edit. Literal kode tidak dirender ke DOM, riwayat, maupun audit.</div>`
            )
      }
      <div class="table-scroll short">
        <table class="table">
          <thead><tr><th>Kode</th><th>Status</th><th class="num">Aksi</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="row">
        ${actionBtn("Tambah kode", "code-add-open", "btn-sm", canEdit ? "" : capReason("promoEdit"), "")}
      </div>
      <ul class="list-note">
        <li>Semua kode pada promo yang sama berbagi kuota, budget, dan jatah akun.</li>
        <li>Kode dinonaktifkan/diarsipkan, bukan dihapus; literal kode dapat dipakai ulang tanpa mereset riwayat.</li>
        <li>Audit mencatat jumlah kode aktif, bukan literal kode.</li>
      </ul>
    </div>`;
}

function renderPromoPemakaian(promo: Promo): string {
  const persona = currentPersona();
  const quota = quotaAvailable(promo);
  const budget = budgetAvailable(promo);
  const scope = persona.ordersScope;
  const visible = promo.usage.filter((u) => {
    if (scope === "all") return true;
    if (scope === "jakarta") return u.branch === "Jakarta";
    return u.branch === "Bandung";
  });
  const hidden = promo.usage.length - visible.length;
  const capReasonText = persona.caps.kapasitasEdit ? "" : capReason("kapasitasEdit");

  const usageRows = visible
    .map(
      (entry) => `<tr>
        <td class="mono">${esc(entry.orderId)}</td>
        <td>${esc(entry.branch)}</td>
        <td>${esc(benefitLabel(promo.benefit))}</td>
        <td>${
          entry.status === "Consumed"
            ? badge("Consumed", "badge-accent")
            : entry.status === "Reserved"
            ? badge("Hold", "badge-outline")
            : badge("Released", "badge-outline")
        }</td>
        <td class="num">${rp(entry.amount)}</td>
        <td class="small">${esc(entry.at)}</td>
      </tr>`
    )
    .join("");

  return `<div class="stack">
      ${alertBox(
        "info",
        `<div><strong>Ringkasan global, daftar terbatas izin.</strong> Angka kuota/budget adalah total promo. Daftar di bawah dibatasi ${esc(
          persona.scopeLabel
        )} dan bukan total global: ${hidden} order di luar scope tidak ditampilkan. Tidak ada identitas customer pada ringkasan.</div>`
      )}

      <div class="stat-grid">
        <div class="stat"><div class="stat-label">Kuota</div><div class="stat-value">${promo.capacity.quota === null ? "—" : promo.capacity.quota}</div><div class="stat-sub">batas global</div></div>
        <div class="stat"><div class="stat-label">Consumed</div><div class="stat-value">${promo.summary.quotaConsumed}</div><div class="stat-sub">pemakaian final</div></div>
        <div class="stat"><div class="stat-label">Hold</div><div class="stat-value">${promo.summary.quotaHold}</div><div class="stat-sub">reservation aktif</div></div>
        <div class="stat"><div class="stat-label">Tersedia</div><div class="stat-value">${quota === null ? "—" : quota}</div><div class="stat-sub">kuota − consumed − hold</div></div>
      </div>
      <div class="stat-grid">
        <div class="stat"><div class="stat-label">Budget</div><div class="stat-value">${promo.capacity.budget === null ? "—" : rp(promo.capacity.budget)}</div><div class="stat-sub">batas global</div></div>
        <div class="stat"><div class="stat-label">Consumed</div><div class="stat-value">${rp(promo.summary.budgetConsumed)}</div><div class="stat-sub">benefit aktual</div></div>
        <div class="stat"><div class="stat-label">Hold</div><div class="stat-value">${rp(promo.summary.budgetHold)}</div><div class="stat-sub">ditahan</div></div>
        <div class="stat"><div class="stat-label">Tersedia</div><div class="stat-value">${budget === null ? "—" : rp(budget)}</div><div class="stat-sub">budget − consumed − hold</div></div>
      </div>

      <fieldset class="fieldset">
        <legend>Kapasitas promo</legend>
        ${
          persona.caps.kapasitasEdit
            ? ""
            : alertBox(
                "warn",
                `<div><strong>Read-only untuk persona ini.</strong> ${esc(
                  capReasonText
                )} Draft benefit tetap bisa disiapkan, tetapi kapasitas tidak dapat ditetapkan/dinaikkan dari sini.</div>`
              )
        }
        <div class="form-grid">
          <label class="field">
            <span class="field-label">Kuota penggunaan</span>
            <input class="input" type="number" min="0" step="1" data-field="cap-quota" value="${promo.capacity.quota === null ? "" : promo.capacity.quota}"${disabledIf(
              !persona.caps.kapasitasEdit,
              capReasonText
            )}>
          </label>
          <label class="field">
            <span class="field-label">Budget (Rp)</span>
            <input class="input" type="number" min="0" step="1000" data-field="cap-budget" value="${promo.capacity.budget === null ? "" : promo.capacity.budget}"${disabledIf(
              !persona.caps.kapasitasEdit,
              capReasonText
            )}>
          </label>
          <label class="field">
            <span class="field-label">Jatah per akun</span>
            <input class="input" type="number" min="1" step="1" data-field="cap-per-account" value="${promo.capacity.perAccount}"${disabledIf(
              !persona.caps.kapasitasEdit,
              capReasonText
            )}>
          </label>
        </div>
        ${
          state.capacityError === null
            ? ""
            : alertBox("error", `<div><strong>Perubahan kapasitas ditolak.</strong> ${esc(state.capacityError)}</div>`)
        }
        ${
          state.capacityNotice === null
            ? ""
            : alertBox("success", `<div>${esc(state.capacityNotice)}</div>`)
        }
        <div class="row">
          ${actionBtn(
            "Terapkan kapasitas",
            "capacity-apply",
            "btn-sm",
            persona.caps.kapasitasEdit ? "" : capReason("kapasitasEdit"),
            ""
          )}
        </div>
        <ul class="list-note">
          <li>Penurunan limit di bawah consumed + hold terkait ditolak dengan alasan jelas.</li>
          <li>Minimal satu batas global (kuota atau budget) wajib diisi; menghapus keduanya ditolak.</li>
          <li>Tidak ada tombol reset pemakaian, release hold paksa, refund, atau retry provider di layar ini.</li>
        </ul>
      </fieldset>

      <div class="table-scroll short">
        <table class="table">
          <thead>
            <tr><th>Order</th><th>Cabang</th><th>Benefit</th><th>Status</th><th class="num">Nominal</th><th>Waktu</th></tr>
          </thead>
          <tbody>${
            usageRows === ""
              ? `<tr><td class="table-empty" colspan="6">Tidak ada pemakaian dalam scope cabang Anda.</td></tr>`
              : usageRows
          }</tbody>
        </table>
      </div>
      <p class="list-note">${hidden} order di luar ${esc(persona.scopeLabel)} tidak ditampilkan. Detail order mengikuti workflow Orders existing beserta guards-nya, bukan bypass kewenangan baru.</p>
    </div>`;
}

function renderPromoRiwayat(promo: Promo): string {
  const rows = state.audit.filter((entry) => entry.promoId === promo.id);
  return `<div class="table-scroll">
      <table class="table">
        <thead><tr><th>Waktu</th><th>Actor</th><th>Tindakan</th><th>Sebelum → sesudah</th><th>Revision/batch</th></tr></thead>
        <tbody>${
          rows.length === 0
            ? `<tr><td class="table-empty" colspan="5">Belum ada riwayat untuk promo ini.</td></tr>`
            : rows
                .map(
                  (entry) => `<tr>
                    <td class="small nowrap">${esc(entry.at)}</td>
                    <td>${esc(entry.actor)}</td>
                    <td>${esc(entry.action)}</td>
                    <td class="small">${esc(entry.before)} → ${esc(entry.after)}</td>
                    <td class="small mono">${esc(entry.ref)}</td>
                  </tr>`
                )
                .join("")
        }</tbody>
      </table>
    </div>
    <p class="list-note">Histori tidak memiliki operasi hapus administratif. Literal kode tidak dicatat pada riwayat.</p>`;
}

function renderPromoDetail(): string {
  const promo = currentPromo();
  if (!promo) return renderDiskon();
  const persona = currentPersona();
  const editReason = persona.caps.promoEdit ? "" : capReason("promoEdit");
  const dirty = hasDraftChanges(promo);

  let tabBody = renderPromoAturan(promo);
  if (state.promoTab === "kode") tabBody = renderPromoKode(promo);
  else if (state.promoTab === "pemakaian") tabBody = renderPromoPemakaian(promo);
  else if (state.promoTab === "riwayat") tabBody = renderPromoRiwayat(promo);

  return `
    <div>
      <button class="btn btn-ghost btn-sm" type="button" data-action="nav-diskon">← Daftar diskon</button>
    </div>
    <div class="page-head">
      <div>
        <h2 class="page-title">${esc(promo.name)}</h2>
        <p class="page-sub">Detail promo: aturan, kode, pemakaian/budget, dan riwayat dalam satu identitas promo.</p>
      </div>
      <div class="page-head-actions">
        ${badge(channelLabel(promo.channel), "badge-outline")}
        ${promo.status === "live" ? badge("Live", "badge-accent") : badge("Pause", "badge-outline")}
        ${badge("Live: Revision " + promo.revision, "badge-default")}
        ${dirty ? badge("Draft belum dipublish", "badge-destructive") : ""}
      </div>
    </div>
    <div class="row">
      ${actionBtn(
        promo.status === "live" ? "Pause promo" : "Lanjutkan promo",
        "toggle-status",
        "btn-outline btn-sm",
        editReason,
        ""
      )}
      <span class="small muted">${esc(benefitLabel(promo.benefit))} • minimum ${rp(
    promo.minSubtotal
  )} • jatah ${promo.capacity.perAccount}/akun</span>
    </div>
    <section class="card">
      <div class="card-body">
        ${renderPromoTabs(promo)}
        <div>${tabBody}</div>
      </div>
    </section>`;
}

/* ---------------- View: Simulasi ---------------- */

interface GoodsResult {
  grossDiscount: number;
  discount: number;
  netGoods: number;
  tax: number;
  total: number;
}

function computeGoodsSim(input: GoodsSim): GoodsResult {
  const grossDiscount = roundHalfUp((input.goods * input.percent) / 100);
  const discount = input.cap > 0 ? Math.min(grossDiscount, input.cap) : grossDiscount;
  const netGoods = input.goods - discount;
  const tax = Math.ceil((netGoods * input.taxRate) / 100);
  const total = netGoods + tax + input.shipping + input.fee;
  return { grossDiscount: grossDiscount, discount: discount, netGoods: netGoods, tax: tax, total: total };
}

interface ShippingResult {
  subsidyApplied: number;
  netShipping: number;
  tax: number;
  total: number;
}

function computeShippingSim(input: ShippingSim): ShippingResult {
  const subsidyApplied = Math.min(input.shipping, input.subsidy);
  const netShipping = input.shipping - subsidyApplied;
  const tax = Math.ceil((input.goods * input.taxRate) / 100);
  const total = input.goods + tax + netShipping + input.fee;
  return { subsidyApplied: subsidyApplied, netShipping: netShipping, tax: tax, total: total };
}

function renderGoodsResult(): string {
  const sim = state.simGoods;
  const result = computeGoodsSim(sim);
  return `<div class="money-list">
      <div class="money-row"><span>Barang setelah Markdown</span><span>${rp(sim.goods)}</span></div>
      <div class="money-row"><span>Kupon barang ${sim.percent}%${sim.cap > 0 ? `, cap ${rp(sim.cap)}` : ""}</span><span>−${rp(result.discount)}</span></div>
      <div class="money-row strong"><span>Net barang</span><span>${rp(result.netGoods)}</span></div>
      <div class="money-row"><span>PPN barang (${sim.taxRate}%)</span><span>${rp(result.tax)}</span></div>
      <div class="money-row"><span>Ongkir sebelum subsidi</span><span>${rp(sim.shipping)}</span></div>
      <div class="money-row"><span>Service fee</span><span>${rp(sim.fee)}</span></div>
      <div class="money-row total"><span>Total pembayaran (termasuk PPN)</span><span>${rp(result.total)}</span></div>
    </div>
    <p class="field-hint">PPN dihitung dari total barang setelah Markdown dan kupon barang; ongkir dan service fee tidak masuk dasar PPN. Pembulatan PPN ke atas ke rupiah utuh.</p>`;
}

function renderShippingResult(): string {
  const sim = state.simShipping;
  const result = computeShippingSim(sim);
  return `<div class="money-list">
      <div class="money-row"><span>Barang setelah Markdown</span><span>${rp(sim.goods)}</span></div>
      <div class="money-row"><span>PPN barang (${sim.taxRate}%)</span><span>${rp(result.tax)}</span></div>
      <div class="money-row"><span>Ongkir sebelum subsidi</span><span>${rp(sim.shipping)}</span></div>
      <div class="money-row"><span>Subsidi merchant</span><span>−${rp(result.subsidyApplied)}</span></div>
      <div class="money-row strong"><span>Net ongkir customer</span><span>${rp(result.netShipping)}</span></div>
      <div class="money-row"><span>Service fee</span><span>${rp(sim.fee)}</span></div>
      <div class="money-row total"><span>Total pembayaran (termasuk PPN)</span><span>${rp(result.total)}</span></div>
    </div>
    <p class="field-hint">Subsidi ongkir ditanggung merchant; biaya kurir tetap dicatat penuh dan terpisah. Subsidi tidak masuk potongan barang.</p>`;
}

function renderSimulasi(): string {
  const goods = state.simGoods;
  const shipping = state.simShipping;
  return `
    <div class="page-head">
      <div>
        <h2 class="page-title">Simulasi komponen biaya</h2>
        <p class="page-sub">Preview tidak menahan kuota/budget dan tidak membuat reservation. Setiap komponen ditampilkan terpisah; angka dapat diubah untuk melihat efeknya.</p>
      </div>
      <div class="page-head-actions">${badge("SIMULASI — tidak reserve", "badge-solid")}</div>
    </div>

    <section class="card">
      <div class="card-head">
        <h3 class="card-title">Kupon barang 10% dengan cap</h3>
        <p class="card-desc">Contoh: barang Rp 450.000, cap Rp 20.000 → net barang Rp 430.000, PPN 11% Rp 47.300, ongkir Rp 30.000, fee Rp 0 → total Rp 507.300.</p>
      </div>
      <div class="card-body">
        <div class="form-grid">
          <label class="field"><span class="field-label">Barang setelah Markdown (Rp)</span>
            <input class="input" type="number" min="0" step="1000" data-action="sim-input" data-scope="goods" data-field="goods" value="${goods.goods}">
          </label>
          <label class="field"><span class="field-label">Persentase barang (%)</span>
            <input class="input" type="number" min="0" max="100" step="1" data-action="sim-input" data-scope="goods" data-field="percent" value="${goods.percent}">
          </label>
          <label class="field"><span class="field-label">Cap (Rp, 0 = tanpa cap)</span>
            <input class="input" type="number" min="0" step="1000" data-action="sim-input" data-scope="goods" data-field="cap" value="${goods.cap}">
          </label>
          <label class="field"><span class="field-label">Ongkir sebelum subsidi (Rp)</span>
            <input class="input" type="number" min="0" step="1000" data-action="sim-input" data-scope="goods" data-field="shipping" value="${goods.shipping}">
          </label>
          <label class="field"><span class="field-label">Service fee (Rp)</span>
            <input class="input" type="number" min="0" step="1000" data-action="sim-input" data-scope="goods" data-field="fee" value="${goods.fee}">
          </label>
        </div>
        <div id="sim-goods-result">${renderGoodsResult()}</div>
        <div class="row">
          ${badge("Slot aktif: Kupon barang", "badge-accent")}
          <span class="small muted">Markdown (harga coret) tetap berlaku dan tidak memakai slot.</span>
        </div>
        ${alertBox(
          "warn",
          `<div><strong>Satu slot.</strong> Kode manual atau subsidi ongkir memakai slot yang sama, bukan slot tambahan. Prototype ini tidak menjanjikan dua benefit aktif sekaligus.</div>`
        )}
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <h3 class="card-title">Subsidi ongkir (offer terpisah)</h3>
        <p class="card-desc">Contoh: barang Rp 150.000, ongkir Rp 30.000, subsidi Rp 20.000, PPN Rp 16.500 → total Rp 176.500. Subsidi ongkir adalah benefit tersendiri, bukan gabungan dengan potongan barang.</p>
      </div>
      <div class="card-body">
        <div class="form-grid">
          <label class="field"><span class="field-label">Barang setelah Markdown (Rp)</span>
            <input class="input" type="number" min="0" step="1000" data-action="sim-input" data-scope="shipping" data-field="goods" value="${shipping.goods}">
          </label>
          <label class="field"><span class="field-label">Ongkir sebelum subsidi (Rp)</span>
            <input class="input" type="number" min="0" step="1000" data-action="sim-input" data-scope="shipping" data-field="shipping" value="${shipping.shipping}">
          </label>
          <label class="field"><span class="field-label">Subsidi merchant (Rp)</span>
            <input class="input" type="number" min="0" step="1000" data-action="sim-input" data-scope="shipping" data-field="subsidy" value="${shipping.subsidy}">
          </label>
          <label class="field"><span class="field-label">Service fee (Rp)</span>
            <input class="input" type="number" min="0" step="1000" data-action="sim-input" data-scope="shipping" data-field="fee" value="${shipping.fee}">
          </label>
        </div>
        <div id="sim-shipping-result">${renderShippingResult()}</div>
        <div class="row">
          ${badge("Slot aktif: Subsidi ongkir", "badge-accent")}
          <span class="small muted">Promo ini tidak dapat digabung dengan kupon/kode barang pada order yang sama.</span>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <h3 class="card-title">Yang tidak dilakukan preview</h3>
        <p class="card-desc">Dipertahankan agar preview tidak disalahartikan sebagai reservasi atau janji dua benefit.</p>
      </div>
      <div class="card-body">
        <ul class="list-note">
          <li>Preview tidak menahan kuota, budget, atau jatah akun; reservation terjadi saat order dibuat.</li>
          <li>Held dan consumed dipisahkan; budget memakai benefit aktual penuh, tanpa diskon parsial mengikuti sisa budget.</li>
          <li>PPN tidak dikenakan pada ongkir/service fee menurut keputusan tiket 04.</li>
          <li>Markdown, potongan barang, ongkir, subsidi, PPN, dan fee ditampilkan sebagai komponen berbeda.</li>
        </ul>
      </div>
    </section>`;
}

/* ---------------- View: Audit ---------------- */

function renderAudit(): string {
  const rows = state.audit
    .map(
      (entry) => `<tr>
        <td class="small nowrap">${esc(entry.at)}</td>
        <td>${esc(entry.actor)}</td>
        <td>${esc(entry.action)}</td>
        <td>${esc(entry.target)}</td>
        <td class="small">${esc(entry.before)} → ${esc(entry.after)}</td>
        <td class="small mono">${esc(entry.ref)}</td>
      </tr>`
    )
    .join("");

  return `
    <div class="page-head">
      <div>
        <h2 class="page-title">Riwayat &amp; audit</h2>
        <p class="page-sub">Audit mencatat actor, waktu, target, revision/batch, dan diff sebelum → sesudah. Histori tidak memiliki operasi hapus administratif.</p>
      </div>
      <div class="page-head-actions">${badge(state.audit.length + " entri simulasi", "badge-outline")}</div>
    </div>
    <section class="card">
      <div class="card-head">
        <h3 class="card-title">Audit event</h3>
        <p class="card-desc">Entri dibuat dari aksi di prototype ini; tidak ada penulisan ke database.</p>
      </div>
      <div class="card-body">
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th>Waktu</th><th>Actor</th><th>Tindakan</th><th>Target</th><th>Sebelum → sesudah</th><th>Revision/batch</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <ul class="list-note">
          <li>Event harga/promo bersifat global dan membutuhkan all-branch audit pada spec sebenarnya.</li>
          <li>Literal kode tidak pernah dicatat pada log umum; identifikasi memakai ID promo dan label tersamarkan.</li>
          <li>Layar audit di prototype ini hanya memperagakan tampilan, bukan enforcement.</li>
        </ul>
      </div>
    </section>`;
}

/* ---------------- Dialog ---------------- */

function renderDialog(): void {
  const dialog = state.dialog;
  if (!dialog) {
    modalRoot.innerHTML = "";
    document.body.classList.remove("no-scroll");
    return;
  }
  modalRoot.innerHTML = renderDialogContent(dialog);
  document.body.classList.add("no-scroll");
  const focusTarget = modalRoot.querySelector("[data-autofocus]") as HTMLElement | null;
  if (focusTarget) focusTarget.focus();
}

function dialogShell(title: string, subtitle: string, body: string, foot: string, small: boolean): string {
  return `<div class="dialog-overlay" data-overlay="1">
    <div class="dialog${small ? " dialog-sm" : ""}" role="dialog" aria-modal="true" aria-label="${esc(
    title
  )}" data-autofocus tabindex="-1">
      <div class="dialog-head">
        <div class="dialog-head-text">
          <div class="dialog-title">${esc(title)}</div>
          <div class="dialog-sub">${esc(subtitle)}</div>
        </div>
        <button class="btn-icon" type="button" data-action="dialog-close" aria-label="Tutup dialog">${icon(
          "close"
        )}</button>
      </div>
      <div class="dialog-body">${body}</div>
      <div class="dialog-foot">${foot}</div>
    </div>
  </div>`;
}

function deltaCell(row: PriceRow): string {
  const next = row.next === null ? row.base : row.next;
  const delta = next - row.current;
  if (row.action === "restore_base") {
    return `<span class="small">Restore ke base ${rp(row.base)}</span>`;
  }
  if (delta === 0) return `<span class="small muted">Tidak berubah</span>`;
  if (delta > 0) return `<span class="delta-up">NAIK ${rp(delta)}</span>`;
  return `<span class="delta-down">TURUN ${rp(Math.abs(delta))}</span>`;
}

function renderPriceReview(dialog: { rows: PriceRow[]; reason: string; label: string; source: string }): string {
  const rows = dialog.rows;
  const valid = rows.filter((r) => r.valid);
  const invalid = rows.filter((r) => !r.valid);
  const body = rows
    .map(
      (row) => `<tr>
        <td class="mono">${esc(row.sku)}<div class="small muted">${esc(row.name)}</div></td>
        <td class="num">${rp(row.base)}</td>
        <td class="num">${rp(row.current)}</td>
        <td class="num">${
          row.action === "restore_base"
            ? `<span class="small">— (restore)</span>`
            : row.next === null
            ? "—"
            : rp(row.next)
        }</td>
        <td>${deltaCell(row)}</td>
        <td>${row.valid ? badge("Valid", "badge-outline") : badge("Gagal", "badge-destructive")}${
        row.valid ? "" : `<div class="small muted">${esc(row.reason)}</div>`
      }</td>
      </tr>`
    )
    .join("");

  const warnings = [
    "Apply memakai base/Markdown terbaru; target tidak dihitung ulang dan target tidak valid gagal per baris.",
    "Harga sukses langsung live per baris; batch bukan transaksi atomik penuh.",
  ];
  if (dialog.source === "restore") {
    warnings.push("Restore menghapus Markdown terbaru dan harga mengikuti base terbaru.");
  }
  if (dialog.source === "bulk") {
    warnings.push("Shortcut persentase dari BASE menghasilkan harga akhir tetap, bukan diskon berkelanjutan.");
  }

  return dialogShell(
    "Review perubahan harga — " + rows.length + " SKU",
    "Berlaku untuk semua cabang • " + dialog.label,
    `<div class="badge-row">
      ${badge(valid.length + " baris valid", "badge-accent")}
      ${invalid.length > 0 ? badge(invalid.length + " baris gagal", "badge-destructive") : ""}
      ${badge("Harga global", "badge-outline")}
    </div>
    <div class="table-scroll">
      <table class="table">
        <thead>
          <tr><th>SKU</th><th class="num">Base</th><th class="num">Website kini</th><th class="num">Target</th><th>Dampak</th><th>Validasi</th></tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <ul class="list-note">${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
    <label class="field">
      <span class="field-label">Alasan bisnis (opsional)</span>
      <input class="input" type="text" data-field="business-reason" value="${esc(
        dialog.reason
      )}" placeholder="Contoh: clearance stok lama">
    </label>`,
    `${actionBtn("Kembali", "dialog-close", "btn-outline btn-sm", "", "")}
     ${actionBtn(
       invalid.length === 0
         ? "Terapkan " + valid.length + " SKU"
         : "Terapkan " + valid.length + " baris valid",
       "price-apply",
       "btn-sm",
       valid.length === 0 ? "Tidak ada baris valid untuk diterapkan." : "",
       ""
     )}`,
    false
  );
}

function renderDialogContent(dialog: DialogState): string {
  if (dialog.kind === "manual") {
    const first = dialog.targetSkus.length === 1 ? findSku(dialog.targetSkus[0]) : undefined;
    return dialogShell(
      "Ubah harga coret manual",
      dialog.targetSkus.length + " SKU dipilih • seluruh cabang",
      `<div class="table-scroll short">
        <table class="table">
          <thead><tr><th>SKU</th><th class="num">Base</th><th class="num">Website kini</th><th class="num">Target tersimpan</th></tr></thead>
          <tbody>${dialog.targetSkus
            .map((id) => {
              const sku = findSku(id);
              if (!sku) return "";
              return `<tr><td class="mono">${esc(sku.sku)}</td><td class="num">${rp(sku.base)}</td><td class="num">${rp(
                websitePrice(sku)
              )}</td><td class="num">${sku.target === null ? "—" : rp(sku.target)}</td></tr>`;
            })
            .join("")}</tbody>
        </table>
      </div>
      <label class="field">
        <span class="field-label">Target harga website (Rp, angka bulat)</span>
        <input class="input" type="number" min="1" step="1000" data-field="manual-target" data-autofocus value="${esc(
          dialog.value
        )}" placeholder="${first ? String(roundHalfUp((first.base * 80) / 100)) : "150000"}">
        <span class="field-hint">Target harus lebih dari 0 dan lebih rendah dari base setiap SKU. Kenaikan harga akan ditampilkan eksplisit pada review.</span>
      </label>
      ${dialog.error === null ? "" : alertBox("error", `<div>${esc(dialog.error)}</div>`)}
      <p class="list-note">Nilai ini adalah harga akhir tetap, bukan persentase berkelanjutan. Review wajib ditampilkan sebelum apply.</p>`,
      `${actionBtn("Batal", "dialog-close", "btn-outline btn-sm", "", "")}
       ${actionBtn("Lihat review", "manual-review", "btn-sm", "", "")}`,
      true
    );
  }

  if (dialog.kind === "bulk") {
    const percent = num(dialog.percent, 20);
    const preview = dialog.targetSkus
      .map((id) => {
        const sku = findSku(id);
        if (!sku) return "";
        const next = roundHalfUp((sku.base * (100 - percent)) / 100);
        const delta = next - websitePrice(sku);
        return `<tr>
          <td class="mono">${esc(sku.sku)}</td>
          <td class="num">${rp(sku.base)}</td>
          <td class="num">${rp(websitePrice(sku))}</td>
          <td class="num">${rp(next)}</td>
          <td>${delta === 0 ? "Tidak berubah" : delta > 0 ? `<span class="delta-up">NAIK ${rp(delta)}</span>` : `<span class="delta-down">TURUN ${rp(Math.abs(delta))}</span>`}</td>
        </tr>`;
      })
      .join("");
    return dialogShell(
      "Ubah massal harga coret",
      dialog.targetSkus.length + " SKU dipilih • shortcut persentase dari BASE",
      `<label class="field">
        <span class="field-label">Persentase dari Base Price (%)</span>
        <input class="input" type="number" min="1" max="99" step="1" data-field="bulk-percent" data-autofocus value="${esc(
          dialog.percent
        )}">
        <span class="field-hint">Hasil adalah harga akhir tetap yang dibekukan saat preview; bukan diskon persentase berkelanjutan.</span>
      </label>
      <div class="table-scroll short">
        <table class="table">
          <thead><tr><th>SKU</th><th class="num">Base</th><th class="num">Website kini</th><th class="num">Target hasil</th><th>Dampak</th></tr></thead>
          <tbody>${preview}</tbody>
        </table>
      </div>
      ${dialog.error === null ? "" : alertBox("error", `<div>${esc(dialog.error)}</div>`)}
      <p class="list-note">Contoh kontrak: SHOE-BLACK-42 base Rp 300.000, website kini Rp 150.000, shortcut 20% → target Rp 240.000 (NAIK Rp 90.000). Kenaikan tidak disamarkan sebagai diskon tambahan.</p>`,
      `${actionBtn("Batal", "dialog-close", "btn-outline btn-sm", "", "")}
       ${actionBtn("Lihat review", "bulk-review", "btn-sm", "", "")}`,
      false
    );
  }

  if (dialog.kind === "price-review") {
    return renderPriceReview(dialog);
  }

  if (dialog.kind === "promo-review") {
    const promo = currentPromo();
    const draft = state.draft;
    if (!promo || !draft) {
      return dialogShell(
        "Review perubahan promo",
        "Tidak ada draft",
        `<p class="list-note">Draft tidak ditemukan. Muat ulang detail promo.</p>`,
        actionBtn("Tutup", "dialog-close", "btn-outline btn-sm", "", ""),
        true
      );
    }
    const rows = draftDiff(promo, draft);
    const changed = rows.filter((r) => r.changed);
    return dialogShell(
      "Review perubahan promo",
      `${promo.name} • live revision ${promo.revision} → draft revision ${draft.baseRevision + 1}`,
      `<div class="table-scroll short">
        <table class="table">
          <thead><tr><th>Field</th><th>Live (revision ${promo.revision})</th><th>Draft</th></tr></thead>
          <tbody>${rows
            .map(
              (row) => `<tr>
                <td>${esc(row.label)}${row.changed ? " " + badge("berubah", "badge-accent") : ""}</td>
                <td class="small">${esc(row.before)}</td>
                <td class="small">${row.changed ? `<strong>${esc(row.after)}</strong>` : esc(row.after)}</td>
              </tr>`
            )
            .join("")}</tbody>
        </table>
      </div>
      ${alertBox(
        "warn",
        `<div><strong>Berlaku untuk order baru saja.</strong> Order yang sudah mendapat hold mempertahankan snapshot; consumed/hold dan riwayat tidak direset oleh publish.</div>`
      )}
      <p class="list-note">${changed.length} field berubah. Publish menaikkan revision menjadi ${
        draft.baseRevision + 1
      } dan tidak menimpa revision sebelumnya.</p>`,
      `${actionBtn("Batalkan", "dialog-close", "btn-outline btn-sm", "", "")}
       ${actionBtn("Publish revision " + (draft.baseRevision + 1), "publish", "btn-sm", changed.length === 0 ? "Tidak ada perubahan." : "", "")}`,
      false
    );
  }

  if (dialog.kind === "stale") {
    const promo = currentPromo();
    return dialogShell(
      "Perubahan ditolak — promo berubah",
      "Versi stale tidak dapat dipublish",
      `${alertBox(
        "error",
        `<div><strong>Tidak ada penimpaan.</strong> ${
          promo
            ? `Promo <strong>${esc(promo.name)}</strong> kini revision ${promo.revision}, sedangkan form Anda berbasis revision ${
                state.draft === null ? "?" : state.draft.baseRevision
              }.`
            : ""
        } Review Anda ditolak; muat versi terbaru lalu review ulang.</div>`
      )}
      <ul class="list-note">
        <li>Draft lama akan dibuang saat versi terbaru dimuat.</li>
        <li>Tidak ada tombol force-overwrite atau merge otomatis.</li>
        <li>Perubahan admin lain sudah tercatat di riwayat promo.</li>
      </ul>`,
      `${actionBtn("Muat versi terbaru", "stale-reload", "btn-sm", "", "")}
       ${actionBtn("Tutup", "dialog-close", "btn-outline btn-sm", "", "")}`,
      true
    );
  }

  return dialogShell(
    "Tambah kode promo",
    "Kode baru berbagi kuota, budget, dan jatah akun promo ini",
    `<label class="field">
      <span class="field-label">Literal kode</span>
      <input class="input" type="text" data-field="new-code" data-autofocus value="${esc(
        dialog.value
      )}" placeholder="HEMATSEPT">
      <span class="field-hint">Kode tidak ditampilkan pada riwayat/audit umum. Hanya pengelola promo yang melihat literalnya.</span>
    </label>
    ${dialog.error === null ? "" : alertBox("error", `<div>${esc(dialog.error)}</div>`)}`,
    `${actionBtn("Batal", "dialog-close", "btn-outline btn-sm", "", "")}
     ${actionBtn("Tambah kode", "code-add-submit", "btn-sm", "", "")}`,
    true
  );
}

/* ---------------- Aksi: umum ---------------- */

function closeDialog(): void {
  state.dialog = null;
  renderDialog();
}

function applyPersona(key: PersonaKey): void {
  state.persona = key;
  state.dialog = null;
  state.benefitKindChoice = null;
  state.capacityError = null;
  state.capacityNotice = null;
  const persona = currentPersona();
  if (state.view === "import" && !persona.caps.hargaEdit) {
    state.view = "produk";
    toast("Persona ini tidak punya Harga:edit. Kembali ke Produk (read-only).", "warn");
  }
  render();
}

function resetDemo(): void {
  stopApplyTimer();
  state = createInitialState();
  render();
  renderToasts();
  toast("Demo direset ke data awal. Semua perubahan di memori dibuang.", "ok");
}

/* ---------------- Aksi: harga ---------------- */

function priceRowsManual(targetSkus: string[], target: number): PriceRow[] {
  const rows: PriceRow[] = [];
  for (const id of targetSkus) {
    const sku = findSku(id);
    if (!sku) continue;
    let valid = true;
    let reason = "";
    if (target <= 0) {
      valid = false;
      reason = "Target harus lebih dari 0";
    } else if (target >= sku.base) {
      valid = false;
      reason = `Target ≥ base (${rp(sku.base)})`;
    }
    rows.push({
      sku: sku.sku,
      name: sku.name,
      base: sku.base,
      current: websitePrice(sku),
      next: target,
      action: "set_price",
      valid: valid,
      reason: reason,
    });
  }
  return rows;
}

function priceRowsBulk(targetSkus: string[], percent: number): PriceRow[] {
  const rows: PriceRow[] = [];
  for (const id of targetSkus) {
    const sku = findSku(id);
    if (!sku) continue;
    const next = roundHalfUp((sku.base * (100 - percent)) / 100);
    let valid = true;
    let reason = "";
    if (percent <= 0 || percent >= 100) {
      valid = false;
      reason = "Persentase harus 1–99";
    } else if (next <= 0 || next >= sku.base) {
      valid = false;
      reason = `Target hasil ≥ base (${rp(sku.base)})`;
    }
    rows.push({
      sku: sku.sku,
      name: sku.name,
      base: sku.base,
      current: websitePrice(sku),
      next: next,
      action: "set_price",
      valid: valid,
      reason: reason,
    });
  }
  return rows;
}

function priceRowsRestore(targetSkus: string[]): PriceRow[] {
  const rows: PriceRow[] = [];
  for (const id of targetSkus) {
    const sku = findSku(id);
    if (!sku) continue;
    const valid = sku.target !== null;
    rows.push({
      sku: sku.sku,
      name: sku.name,
      base: sku.base,
      current: websitePrice(sku),
      next: null,
      action: "restore_base",
      valid: valid,
      reason: valid ? "" : "Tidak ada Markdown",
    });
  }
  return rows;
}

function applyPriceRows(rows: PriceRow[], refLabel: string): void {
  const actor = currentPersona().name;
  const reasonInput = qValue('[data-field="business-reason"]', "").trim();
  let applied = 0;
  let unchanged = 0;
  let skipped = 0;
  for (const row of rows) {
    if (!row.valid) {
      skipped += 1;
      continue;
    }
    const sku = findSku(row.sku);
    if (!sku) {
      skipped += 1;
      continue;
    }
    const before = websitePrice(sku);
    if (row.action === "restore_base") {
      if (sku.target === null) {
        skipped += 1;
        continue;
      }
      sku.target = null;
    } else {
      if (sku.target === row.next) {
        unchanged += 1;
        continue;
      }
      sku.target = row.next;
    }
    const after = websitePrice(sku);
    addAudit({
      actor: actor,
      action: row.action === "restore_base" ? "Restore harga coret" : "Ubah harga coret",
      target: sku.sku,
      before: rp(before),
      after: rp(after) + (after > before ? " (harga naik)" : ""),
      ref: refLabel + (reasonInput === "" ? "" : " • alasan: " + reasonInput),
      promoId: null,
    });
    applied += 1;
  }

  const appliedSkus = rows.filter((r) => r.valid).map((r) => r.sku);
  state.selectedSkus = state.selectedSkus.filter((id) => appliedSkus.indexOf(id) === -1);
  state.dialog = null;
  state.view = "produk";
  const unchangedNote = unchanged > 0 ? ` ${unchanged} baris tidak berubah (target sama) dan tidak dicatat sebagai perubahan.` : "";
  const skippedNote = skipped > 0 ? ` ${skipped} baris gagal/dilewati dan tidak menulis perubahan.` : "";
  toast(
    `${applied} SKU diterapkan langsung per baris.${unchangedNote}${skippedNote}`,
    skipped > 0 ? "warn" : "ok"
  );
  render();
}

/* ---------------- Aksi: import ---------------- */

function loadSampleBatch(): void {
  const batch = buildSampleBatch();
  state.importFlow = {
    phase: "preview",
    batch: batch,
    retryBatch: null,
    forcedInterruptDone: false,
    applyActor: null,
    haltReason: "none",
  };
  render();
  toast("100 baris contoh dimuat: 97 valid, 3 invalid. Ini simulasi, bukan parsing Excel.", "ok");
}

function applyRetry(): void {
  const retry = state.importFlow.retryBatch;
  const parent = state.importFlow.batch;
  if (!retry || !parent) return;
  if (!currentPersona().caps.hargaEdit) {
    toast(capReason("hargaEdit"), "warn");
    return;
  }
  for (const row of retry.rows) {
    if (row.status === "valid") applyImportRow(row);
  }
  const t = tally(retry.rows);
  addAudit({
    actor: currentPersona().name,
    action: `Retry batch ${retry.id} (asal ${parent.id})`,
    target: "Harga coret (subset gagal)",
    before: "3 baris gagal pada " + parent.id,
    after: `${t.applied} diterapkan • ${t.failed} gagal`,
    ref: `Batch ${retry.id} ← ${parent.id}`,
    promoId: null,
  });
  state.importFlow.phase = "retry-done";
  render();
  toast(`Batch ${retry.id} diterapkan: ${t.applied} baris. 97 baris sukses ${parent.id} tidak diulang.`, "ok");
}

function downloadFailedCsv(): void {
  const batch = state.importFlow.batch;
  if (!batch) return;
  const failed = batch.rows.filter((r) => r.status === "invalid" || r.status === "failed");
  const cell = (value: string): string => {
    if (value.indexOf(",") !== -1 || value.indexOf('"') !== -1) {
      return '"' + value.replace(/"/g, '""') + '"';
    }
    return value;
  };
  const lines = ["row,sku,action,target,status,reason"];
  for (const row of failed) {
    lines.push(
      [
        String(row.row),
        cell(row.sku),
        row.action,
        row.price === null ? "" : String(row.price),
        "gagal",
        cell(row.reason),
      ].join(",")
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "laporan-gagal-" + batch.id + ".csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast("Laporan CSV simulasi diunduh. File dibuat di browser — bukan .xlsx dan bukan arsip file asli.", "ok");
}

/* ---------------- Aksi: promo ---------------- */

function navigatePromo(promoId: string): void {
  const promo = findPromo(promoId);
  state.promoId = promoId;
  state.promoTab = "aturan";
  state.view = "promo";
  state.staleNotice = null;
  state.capacityError = null;
  state.capacityNotice = null;
  state.benefitKindChoice = null;
  state.draft = promo ? draftFromPromo(promo) : null;
  render();
}

function saveDraft(): void {
  const promo = currentPromo();
  if (!promo) return;
  if (!currentPersona().caps.promoEdit) {
    toast(capReason("promoEdit"), "warn");
    return;
  }
  state.draft = collectDraft(promo);
  state.benefitKindChoice = null;
  render();
  toast("Draft tersimpan. Promo live tetap revision " + promo.revision + " sampai publish.", "ok");
}

function reviewDraft(): void {
  const promo = currentPromo();
  if (!promo) return;
  if (!currentPersona().caps.promoEdit) {
    toast(capReason("promoEdit"), "warn");
    return;
  }
  const draft = collectDraft(promo);
  const changed = draftDiff(promo, draft).filter((r) => r.changed);
  if (changed.length === 0) {
    toast("Tidak ada perubahan untuk direview.", "warn");
    return;
  }
  state.draft = draft;
  if (draft.baseRevision !== promo.revision) {
    state.dialog = { kind: "stale" };
    render();
    return;
  }
  state.dialog = { kind: "promo-review" };
  render();
}

function publishDraft(): void {
  const promo = currentPromo();
  const draft = state.draft;
  if (!promo || !draft) return;
  if (!currentPersona().caps.promoEdit) {
    toast(capReason("promoEdit"), "warn");
    return;
  }
  if (draft.baseRevision !== promo.revision) {
    state.dialog = { kind: "stale" };
    render();
    return;
  }
  const before = benefitLabel(promo.benefit) + " • minimum " + rp(promo.minSubtotal);
  promo.name = draft.name;
  promo.benefit = draft.benefit;
  promo.minSubtotal = draft.minSubtotal;
  promo.startAt = draft.startAt;
  promo.endAt = draft.endAt;
  promo.revision = draft.baseRevision + 1;
  const after = benefitLabel(promo.benefit) + " • minimum " + rp(promo.minSubtotal);
  addAudit({
    actor: currentPersona().name,
    action: "Publish revisi " + promo.revision,
    target: promo.name,
    before: before,
    after: after,
    ref: "Revision " + promo.revision,
    promoId: promo.id,
  });
  state.draft = draftFromPromo(promo);
  state.dialog = null;
  state.benefitKindChoice = null;
  render();
  toast(
    "Revisi " + promo.revision + " dipublish. Order lama mempertahankan snapshot; usage tidak direset.",
    "ok"
  );
}

function simulateStaleEdit(): void {
  const promo = currentPromo();
  if (!promo) return;
  if (!currentPersona().caps.promoEdit) {
    toast(capReason("promoEdit"), "warn");
    return;
  }
  const before = "minimum " + rp(promo.minSubtotal) + " • revision " + promo.revision;
  promo.minSubtotal = promo.minSubtotal + 10000;
  promo.revision = promo.revision + 1;
  addAudit({
    actor: "Admin HQ lain (simulasi)",
    action: "Ubah syarat minimum (revision " + promo.revision + ")",
    target: promo.name,
    before: before,
    after: "minimum " + rp(promo.minSubtotal) + " • revision " + promo.revision,
    ref: "Revision " + promo.revision,
    promoId: promo.id,
  });
  state.staleNotice =
    "Admin lain baru mengubah promo ini menjadi revision " +
    promo.revision +
    " (minimum " +
    rp(promo.minSubtotal) +
    "). Draft di form ini masih berbasis revision " +
    (state.draft === null ? "?" : state.draft.baseRevision) +
    ".";
  render();
  toast("Perubahan admin lain disimulasikan. Review perubahan akan ditolak sampai memuat versi terbaru.", "warn");
}

function reloadLatestPromo(): void {
  const promo = currentPromo();
  if (!promo) return;
  state.draft = draftFromPromo(promo);
  state.staleNotice = null;
  state.dialog = null;
  state.benefitKindChoice = null;
  render();
  toast("Versi terbaru dimuat; form mengikuti revision " + promo.revision + ".", "ok");
}

function discardDraft(): void {
  const promo = currentPromo();
  if (!promo) return;
  state.draft = draftFromPromo(promo);
  state.staleNotice = null;
  state.benefitKindChoice = null;
  render();
  toast("Draft dibuang; form kembali ke promo live revision " + promo.revision + ".", "ok");
}

function togglePromoStatus(): void {
  const promo = currentPromo();
  if (!promo) return;
  if (!currentPersona().caps.promoEdit) {
    toast(capReason("promoEdit"), "warn");
    return;
  }
  const before = promo.status === "live" ? "Live" : "Pause";
  promo.status = promo.status === "live" ? "paused" : "live";
  addAudit({
    actor: currentPersona().name,
    action: promo.status === "paused" ? "Pause promo" : "Lanjutkan promo",
    target: promo.name,
    before: before,
    after: promo.status === "paused" ? "Pause" : "Live",
    ref: "Revision " + promo.revision,
    promoId: promo.id,
  });
  render();
  toast(
    promo.status === "paused"
      ? "Promo di-pause. Reservation baru berhenti; usage, hold, dan snapshot order lama tidak berubah."
      : "Promo aktif kembali. Usage dan riwayat tidak direset.",
    "ok"
  );
}

function applyCapacity(): void {
  const promo = currentPromo();
  if (!promo) return;
  if (!currentPersona().caps.kapasitasEdit) {
    toast(capReason("kapasitasEdit"), "warn");
    return;
  }
  const quotaRaw = qValue('[data-field="cap-quota"]', "").trim();
  const budgetRaw = qValue('[data-field="cap-budget"]', "").trim();
  const perAccount = num(qValue('[data-field="cap-per-account"]', String(promo.capacity.perAccount)), promo.capacity.perAccount);
  const quota: number | null = quotaRaw === "" ? null : num(quotaRaw, 0);
  const budget: number | null = budgetRaw === "" ? null : num(budgetRaw, 0);
  const committedQuota = promo.summary.quotaConsumed + promo.summary.quotaHold;
  const committedBudget = promo.summary.budgetConsumed + promo.summary.budgetHold;

  const errors: string[] = [];
  if (quota === null && budget === null) {
    errors.push("Minimal satu batas global (kuota atau budget) wajib diisi.");
  }
  if (quota !== null && quota < committedQuota) {
    errors.push(
      "Kuota " +
        quota +
        " ditolak: lebih kecil dari komitmen consumed " +
        promo.summary.quotaConsumed +
        " + hold " +
        promo.summary.quotaHold +
        " = " +
        committedQuota +
        "."
    );
  }
  if (budget !== null && budget < committedBudget) {
    errors.push(
      "Budget " + rp(budget) + " ditolak: lebih kecil dari komitmen consumed " + rp(promo.summary.budgetConsumed) + " + hold " + rp(promo.summary.budgetHold) + " = " + rp(committedBudget) + "."
    );
  }
  if (perAccount < 1) {
    errors.push("Jatah per akun minimal 1.");
  }

  if (errors.length > 0) {
    state.capacityError = errors.join(" ");
    state.capacityNotice = null;
    render();
    toast("Perubahan kapasitas ditolak. Tidak ada angka yang berubah.", "error");
    return;
  }

  const before =
    "Kuota " +
    (promo.capacity.quota === null ? "—" : promo.capacity.quota) +
    " • Budget " +
    (promo.capacity.budget === null ? "—" : rp(promo.capacity.budget)) +
    " • Jatah " +
    promo.capacity.perAccount;
  promo.capacity = { quota: quota, budget: budget, perAccount: perAccount };
  const after =
    "Kuota " +
    (quota === null ? "—" : quota) +
    " • Budget " +
    (budget === null ? "—" : rp(budget)) +
    " • Jatah " +
    perAccount;
  addAudit({
    actor: currentPersona().name,
    action: "Ubah kapasitas",
    target: promo.name,
    before: before,
    after: after,
    ref: "Revision " + promo.revision,
    promoId: promo.id,
  });
  state.capacityError = null;
  state.capacityNotice = "Kapasitas diperbarui: " + after + ". Usage dan hold tidak berubah.";
  render();
  toast("Kapasitas diperbarui. Consumed/hold tetap " + committedQuota + " kuota.", "ok");
}

function addCode(): void {
  const promo = currentPromo();
  const dialog = state.dialog;
  if (!promo || !dialog || dialog.kind !== "add-code") return;
  if (!currentPersona().caps.promoEdit) {
    toast(capReason("promoEdit"), "warn");
    return;
  }
  const literal = qValue('[data-field="new-code"]', "").trim().toUpperCase();
  if (literal.length < 3) {
    state.dialog = { kind: "add-code", value: literal, error: "Kode minimal 3 karakter." };
    render();
    return;
  }
  if (promo.codes.some((c) => c.code === literal)) {
    state.dialog = { kind: "add-code", value: literal, error: "Kode tersebut sudah ada pada promo ini." };
    render();
    return;
  }
  const activeBefore = promo.codes.filter((c) => c.active).length;
  promo.codes.push({ code: literal, active: true });
  const activeAfter = promo.codes.filter((c) => c.active).length;
  addAudit({
    actor: currentPersona().name,
    action: "Tambah kode promo",
    target: promo.name,
    before: "kode aktif " + activeBefore,
    after: "kode aktif " + activeAfter,
    ref: "Revision " + promo.revision,
    promoId: promo.id,
  });
  state.dialog = null;
  render();
  toast("Kode ditambahkan dan berbagi kapasitas promo. Literal tidak dicatat di audit.", "ok");
}

function deactivateCode(literal: string): void {
  const promo = currentPromo();
  if (!promo) return;
  if (!currentPersona().caps.promoEdit) {
    toast(capReason("promoEdit"), "warn");
    return;
  }
  const code = promo.codes.find((c) => c.code === literal);
  if (!code || !code.active) return;
  code.active = false;
  addAudit({
    actor: currentPersona().name,
    action: "Nonaktifkan kode promo",
    target: promo.name,
    before: "kode aktif " + (promo.codes.filter((c) => c.active).length + 1),
    after: "kode aktif " + promo.codes.filter((c) => c.active).length,
    ref: "Revision " + promo.revision,
    promoId: promo.id,
  });
  render();
  toast("Kode dinonaktifkan (tidak dihapus). Riwayat pemakaian tidak berubah.", "ok");
}

/* ---------------- Event ---------------- */

function handleAction(action: string, el: HTMLElement): void {
  if (action === "reset-demo") {
    resetDemo();
    return;
  }
  if (action === "nav-produk") {
    state.view = "produk";
    state.dialog = null;
    render();
    return;
  }
  if (action === "nav-import") {
    if (!currentPersona().caps.hargaEdit) {
      toast(capReason("hargaEdit"), "warn");
      return;
    }
    state.view = "import";
    state.dialog = null;
    render();
    return;
  }
  if (action === "nav-diskon") {
    state.view = "diskon";
    state.dialog = null;
    render();
    return;
  }
  if (action === "nav-disken-public") {
    state.view = "diskon";
    state.diskonChannel = "public";
    state.dialog = null;
    render();
    return;
  }
  if (action === "nav-disken-manual") {
    state.view = "diskon";
    state.diskonChannel = "manual";
    state.dialog = null;
    render();
    return;
  }
  if (action === "nav-simulasi") {
    state.view = "simulasi";
    state.dialog = null;
    render();
    return;
  }
  if (action === "nav-audit") {
    state.view = "audit";
    state.dialog = null;
    render();
    return;
  }
  if (action === "diskon-channel") {
    const channel = el.getAttribute("data-channel");
    state.diskonChannel = channel === "manual" ? "manual" : "public";
    render();
    return;
  }
  if (action === "open-promo") {
    const id = el.getAttribute("data-promo");
    if (id) navigatePromo(id);
    return;
  }
  if (action === "promo-tab") {
    const tab = el.getAttribute("data-tab");
    state.promoTab =
      tab === "kode" ? "kode" : tab === "pemakaian" ? "pemakaian" : tab === "riwayat" ? "riwayat" : "aturan";
    state.capacityError = null;
    state.capacityNotice = null;
    render();
    return;
  }
  if (action === "clear-selection") {
    state.selectedSkus = [];
    render();
    return;
  }
  if (action === "manual-open") {
    if (!currentPersona().caps.hargaEdit) {
      toast(capReason("hargaEdit"), "warn");
      return;
    }
    if (state.selectedSkus.length === 0) {
      toast("Pilih minimal satu SKU terlebih dahulu.", "warn");
      return;
    }
    state.dialog = { kind: "manual", targetSkus: state.selectedSkus.slice(), value: "", error: null };
    render();
    return;
  }
  if (action === "sku-manual") {
    if (!currentPersona().caps.hargaEdit) {
      toast(capReason("hargaEdit"), "warn");
      return;
    }
    const id = el.getAttribute("data-sku");
    if (!id) return;
    state.dialog = { kind: "manual", targetSkus: [id], value: "", error: null };
    render();
    return;
  }
  if (action === "bulk-open") {
    if (!currentPersona().caps.hargaEdit) {
      toast(capReason("hargaEdit"), "warn");
      return;
    }
    if (state.selectedSkus.length === 0) {
      toast("Pilih minimal satu SKU terlebih dahulu.", "warn");
      return;
    }
    state.dialog = { kind: "bulk", targetSkus: state.selectedSkus.slice(), percent: "20", step: "input", error: null };
    render();
    return;
  }
  if (action === "restore-open") {
    if (!currentPersona().caps.hargaEdit) {
      toast(capReason("hargaEdit"), "warn");
      return;
    }
    const withMarkdown = state.selectedSkus.filter((id) => {
      const sku = findSku(id);
      return sku !== undefined && sku.target !== null;
    });
    if (withMarkdown.length === 0) {
      toast("Pilih minimal satu SKU yang masih punya Markdown.", "warn");
      return;
    }
    state.dialog = {
      kind: "price-review",
      rows: priceRowsRestore(withMarkdown),
      reason: "",
      label: "Restore Markdown terpilih",
      source: "restore",
    };
    render();
    return;
  }
  if (action === "sku-restore") {
    if (!currentPersona().caps.hargaEdit) {
      toast(capReason("hargaEdit"), "warn");
      return;
    }
    const id = el.getAttribute("data-sku");
    if (!id) return;
    state.dialog = {
      kind: "price-review",
      rows: priceRowsRestore([id]),
      reason: "",
      label: "Restore Markdown satu SKU",
      source: "restore",
    };
    render();
    return;
  }
  if (action === "manual-review") {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== "manual") return;
    const raw = qValue('[data-field="manual-target"]', "");
    const target = num(raw, 0);
    if (raw.trim() === "" || target <= 0) {
      state.dialog = { kind: "manual", targetSkus: dialog.targetSkus, value: raw, error: "Isi target harga berupa angka bulat lebih dari 0." };
      render();
      return;
    }
    state.dialog = {
      kind: "price-review",
      rows: priceRowsManual(dialog.targetSkus, target),
      reason: "",
      label: "Target manual " + rp(target),
      source: "manual",
    };
    render();
    return;
  }
  if (action === "bulk-review") {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== "bulk") return;
    const raw = qValue('[data-field="bulk-percent"]', "20");
    const percent = num(raw, 0);
    if (percent <= 0 || percent >= 100) {
      state.dialog = {
        kind: "bulk",
        targetSkus: dialog.targetSkus,
        percent: raw,
        step: "input",
        error: "Persentase harus antara 1 dan 99.",
      };
      render();
      return;
    }
    state.dialog = {
      kind: "price-review",
      rows: priceRowsBulk(dialog.targetSkus, percent),
      reason: "",
      label: "Shortcut " + percent + "% dari BASE",
      source: "bulk",
    };
    render();
    return;
  }
  if (action === "price-apply") {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== "price-review") return;
    applyPriceRows(dialog.rows, dialog.label);
    return;
  }
  if (action === "dialog-close") {
    closeDialog();
    return;
  }
  if (action === "import-load-sample") {
    if (!currentPersona().caps.hargaEdit) {
      toast(capReason("hargaEdit"), "warn");
      return;
    }
    loadSampleBatch();
    return;
  }
  if (action === "import-apply") {
    if (!currentPersona().caps.hargaEdit) {
      toast(capReason("hargaEdit"), "warn");
      return;
    }
    beginApply();
    return;
  }
  if (action === "import-resume") {
    if (!currentPersona().caps.hargaEdit) {
      toast(capReason("hargaEdit"), "warn");
      return;
    }
    beginApply();
    return;
  }
  if (action === "import-reset") {
    stopApplyTimer();
    state.importFlow = {
      phase: "idle",
      batch: null,
      retryBatch: null,
      forcedInterruptDone: false,
      applyActor: null,
      haltReason: "none",
    };
    render();
    return;
  }
  if (action === "import-csv") {
    downloadFailedCsv();
    return;
  }
  if (action === "import-retry-open") {
    const parent = state.importFlow.batch;
    if (!parent) return;
    state.importFlow.retryBatch = buildRetryBatch(parent);
    state.importFlow.phase = "retry-preview";
    render();
    return;
  }
  if (action === "import-retry-apply") {
    applyRetry();
    return;
  }
  if (action === "import-retry-cancel") {
    state.importFlow.retryBatch = null;
    state.importFlow.phase = "done";
    render();
    return;
  }
  if (action === "draft-save") {
    saveDraft();
    return;
  }
  if (action === "draft-review") {
    reviewDraft();
    return;
  }
  if (action === "draft-discard") {
    discardDraft();
    return;
  }
  if (action === "publish") {
    publishDraft();
    return;
  }
  if (action === "stale-reload") {
    reloadLatestPromo();
    return;
  }
  if (action === "simulate-stale") {
    simulateStaleEdit();
    return;
  }
  if (action === "toggle-status") {
    togglePromoStatus();
    return;
  }
  if (action === "capacity-apply") {
    applyCapacity();
    return;
  }
  if (action === "code-add-open") {
    if (!currentPersona().caps.promoEdit) {
      toast(capReason("promoEdit"), "warn");
      return;
    }
    state.dialog = { kind: "add-code", value: "", error: null };
    render();
    return;
  }
  if (action === "code-add-submit") {
    addCode();
    return;
  }
  if (action === "code-deactivate") {
    const code = el.getAttribute("data-code");
    if (code) deactivateCode(code);
    return;
  }
  if (action === "noop") {
    return;
  }
}

function handleChange(el: HTMLElement): void {
  const action = el.getAttribute("data-action");
  if (action === "persona") {
    const value = (el as HTMLSelectElement).value;
    const key: PersonaKey = value === "manager" ? "manager" : value === "viewer" ? "viewer" : "hq";
    applyPersona(key);
    return;
  }
  if (action === "toggle-sku") {
    const input = el as HTMLInputElement;
    const id = input.value;
    if (input.checked) {
      if (state.selectedSkus.indexOf(id) === -1) state.selectedSkus.push(id);
    } else {
      state.selectedSkus = state.selectedSkus.filter((s) => s !== id);
    }
    render();
    return;
  }
  if (action === "benefit-kind") {
    const value = (el as HTMLSelectElement).value;
    const kind: BenefitKind =
      value === "fixed_goods" ? "fixed_goods" : value === "shipping_subsidy" ? "shipping_subsidy" : "percent_goods";
    state.benefitKindChoice = kind;
    const promo = currentPromo();
    const region = document.getElementById("benefit-fields");
    if (promo && region) {
      const source = ensureDraft(promo);
      region.innerHTML = renderBenefitFields(kind, source.benefit);
    }
    return;
  }
}

function handleSearch(input: HTMLInputElement): void {
  state.search = input.value;
  const region = document.getElementById("sku-region");
  if (region) region.innerHTML = renderSkuRegion();
}

function handleSimInput(input: HTMLInputElement): void {
  const scope = input.getAttribute("data-scope");
  const field = input.getAttribute("data-field");
  const value = num(input.value, 0);
  if (scope === "goods") {
    if (field === "goods") state.simGoods.goods = value;
    else if (field === "percent") state.simGoods.percent = value;
    else if (field === "cap") state.simGoods.cap = value;
    else if (field === "shipping") state.simGoods.shipping = value;
    else if (field === "fee") state.simGoods.fee = value;
    const region = document.getElementById("sim-goods-result");
    if (region) region.innerHTML = renderGoodsResult();
    return;
  }
  if (scope === "shipping") {
    if (field === "goods") state.simShipping.goods = value;
    else if (field === "shipping") state.simShipping.shipping = value;
    else if (field === "subsidy") state.simShipping.subsidy = value;
    else if (field === "fee") state.simShipping.fee = value;
    const region = document.getElementById("sim-shipping-result");
    if (region) region.innerHTML = renderShippingResult();
  }
}

function bindEvents(): void {
  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const el = target.closest("[data-action]") as HTMLElement | null;
    if (!el) return;
    if (el.hasAttribute("disabled")) return;
    const action = el.getAttribute("data-action") ?? "";
    handleAction(action, el);
  });

  root.addEventListener("change", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const action = target.getAttribute("data-action");
    if (action === null) return;
    handleChange(target);
  });

  root.addEventListener("input", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const action = target.getAttribute("data-action");
    if (action === "search") handleSearch(target as HTMLInputElement);
    else if (action === "sim-input") handleSimInput(target as HTMLInputElement);
  });

  modalRoot.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.getAttribute("data-overlay") === "1") {
      closeDialog();
      return;
    }
    const el = target.closest("[data-action]") as HTMLElement | null;
    if (!el || el.hasAttribute("disabled")) return;
    handleAction(el.getAttribute("data-action") ?? "", el);
  });

  modalRoot.addEventListener("change", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.getAttribute("data-action") !== null) handleChange(target);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.dialog !== null) {
      closeDialog();
    }
  });
}

/* ---------------- Boot ---------------- */

bindEvents();
render();
