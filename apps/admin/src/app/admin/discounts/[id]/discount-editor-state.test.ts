import { describe, expect, it } from "vitest";
import type { DiscountDraftConfiguration } from "@marketplace/db/src/discount-draft";
import type { DiscountEditorDetail } from "@/features/discounts/discount-editor-contracts";
import {
  buildDraftConfiguration,
  createDiscountEditorState,
  discountEditorReducer,
  editorTabsFor,
  issuesByTab,
} from "./discount-editor-state";

function configuration(
  overrides: Partial<DiscountDraftConfiguration> = {}
): DiscountDraftConfiguration {
  return {
    draftSchemaVersion: 1,
    name: "Diskon Sepatu",
    currency: "IDR",
    minSubtotal: "0",
    startAt: "2026-03-01T10:00:00.000Z",
    endAt: null,
    benefit: { kind: "percentage_goods", paramsVersion: 1, rate: "12.5", capAmount: "20000" },
    capacity: { quotaCount: 100, budgetAmount: "1000000", perClientLimit: 1 },
    codeChanges: { proposedCodes: [], states: [] },
    ...overrides,
  };
}

function detail(
  overrides: Partial<DiscountEditorDetail> = {}
): DiscountEditorDetail {
  const empty = configuration();
  return {
    id: "11111111-1111-4111-8111-111111111111",
    key: "key",
    activationKind: "manual_only",
    state: "enabled",
    currentRevisionId: "22222222-2222-4222-8222-222222222222",
    version: 4,
    draftVersion: 7,
    policyVersion: 2,
    perClientLimit: 1,
    quotaCount: 100,
    budgetAmount: "1000000",
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    liveRevision: null,
    draftRevision: {
      id: "33333333-3333-4333-8333-333333333333",
      revisionNo: 2,
      draftVersion: 7,
      name: null,
      currency: null,
      minSubtotal: null,
      startAt: null,
      endAt: null,
      schemaVersion: 1,
      engineVersion: 1,
      publishedAt: null,
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
      benefit: null,
    },
    codes: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        maskedCode: "HE***US",
        code: "HEMAT17AGUSTUS",
        state: "active",
        version: 3,
        publishedAt: "2026-02-01T00:00:00.000Z",
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      },
    ],
    codeLiteralVisible: true,
    usage: null,
    capacitySummary: {
      basis: "global",
      consumedCount: 0,
      heldCount: 0,
      consumedAmount: "0",
      heldAmount: "0",
      availableCount: 100,
      availableAmount: "1000000",
    },
    draftConfiguration: empty,
    configurationSource: "draft",
    ...overrides,
  };
}

describe("createDiscountEditorState", () => {
  it("mengisi form dari snapshot draft dan bukan dari kolom live", () => {
    const state = createDiscountEditorState(detail());
    expect(state.form.name).toBe("Diskon Sepatu");
    expect(state.form.benefitKind).toBe("percentage_goods");
    expect(state.form.rate).toBe("12,5");
    expect(state.form.capAmount).toBe("20.000,00");
    expect(state.form.quota).toBe("100");
    expect(state.form.perClient).toBe("1");
    expect(state.dirty).toBe(false);
    expect(state.tab).toBe("pengaturan");
  });

  it("memakai heading kosong untuk Offer baru tanpa nama tersimpan", () => {
    const state = createDiscountEditorState(
      detail({ draftConfiguration: configuration({ name: null, benefit: null }) })
    );
    expect(state.form.name).toBe("");
    expect(state.form.benefitKind).toBe("");
    expect(state.heading).toBeNull();
  });

  it("mengisi target status kode dengan status live saat ini", () => {
    const state = createDiscountEditorState(detail());
    expect(state.codeStates["44444444-4444-4444-8444-444444444444"]).toEqual({
      state: "active",
      expectedCodeVersion: 3,
    });
  });
});

describe("discountEditorReducer", () => {
  it("menandai dirty pada perubahan field dan membatalkan review lama", () => {
    const initial = {
      ...createDiscountEditorState(detail()),
      review: null,
      reviewOpen: true,
    };
    const next = discountEditorReducer(initial, {
      type: "form",
      patch: { quota: "200" },
    });
    expect(next.form.quota).toBe("200");
    expect(next.dirty).toBe(true);
    expect(next.reviewOpen).toBe(false);
  });

  it("menyimpan target status kode sebagai bagian draft, bukan mutasi langsung", () => {
    const initial = createDiscountEditorState(detail());
    const next = discountEditorReducer(initial, {
      type: "code-state",
      codeId: "44444444-4444-4444-8444-444444444444",
      state: "inactive",
    });
    expect(next.codeStates["44444444-4444-4444-8444-444444444444"]?.state).toBe("inactive");
    expect(next.dirty).toBe(true);
  });

  it("menambah usulan kode hanya di draft dan dapat dihapus kembali", () => {
    const initial = createDiscountEditorState(detail());
    const added = discountEditorReducer(initial, { type: "code-add", raw: "baru2026" });
    expect(added.codeProposals).toHaveLength(1);
    expect(added.dirty).toBe(true);
    const removed = discountEditorReducer(added, {
      type: "code-remove",
      key: added.codeProposals[0]!.key,
    });
    expect(removed.codeProposals).toHaveLength(0);
    expect(removed.dirty).toBe(false);
  });

  it("mengembalikan baseline dan pesan tersimpan setelah save sukses", () => {
    const initial = discountEditorReducer(createDiscountEditorState(detail()), {
      type: "form",
      patch: { name: "Nama baru" },
    });
    const saved = discountEditorReducer(initial, {
      type: "saved",
      detail: detail({ draftConfiguration: configuration({ name: "Nama baru" }) }),
    });
    expect(saved.dirty).toBe(false);
    expect(saved.form.name).toBe("Nama baru");
    expect(saved.notice).toBe("Draft tersimpan");
  });

  it("menyimpan fieldErrors server dan membuka tab bagian yang bermasalah", () => {
    const initial = {
      ...createDiscountEditorState(detail()),
      tab: "pengaturan" as const,
    };
    const next = discountEditorReducer(initial, {
      type: "issues",
      issues: [{ path: "codeChanges.proposedCodes.0", message: "Kode tidak valid" }],
    });
    expect(next.tab).toBe("kode");
    expect(next.fieldErrors["codeChanges.proposedCodes.0"]).toBe("Kode tidak valid");
    expect(next.notice).toBe("Periksa bagian yang ditandai");
  });

  it("mempertahankan input lokal saat konflik versi dan menandai perlu muat ulang", () => {
    const dirty = discountEditorReducer(createDiscountEditorState(detail()), {
      type: "form",
      patch: { name: "Lokal" },
    });
    const conflict = discountEditorReducer(dirty, {
      type: "reload-required",
      message: "Diskon telah diubah pengguna lain. Muat versi terbaru sebelum melanjutkan.",
    });
    expect(conflict.needsReload).toBe(true);
    expect(conflict.form.name).toBe("Lokal");
    expect(conflict.dirty).toBe(true);
  });
});

describe("buildDraftConfiguration", () => {
  const base = () => createDiscountEditorState(detail()).form;

  it("mengubah teks Rupiah Indonesia menjadi canonical integer tanpa float", () => {
    const result = buildDraftConfiguration({
      ...base(),
      minSubtotal: "Rp 100.000,00",
      fixedAmount: "",
      benefitKind: "percentage_goods",
      rate: "12,5",
      capAmount: "20.000",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.configuration.minSubtotal).toBe("100000");
    expect(result.configuration.benefit).toEqual({
      kind: "percentage_goods",
      paramsVersion: 1,
      rate: "12.5",
      capAmount: "20000",
    });
  });

  it("mempertahankan draft parsial: kosong menjadi null, bukan nol", () => {
    const result = buildDraftConfiguration({
      ...base(),
      name: "  ",
      minSubtotal: "",
      benefitKind: "",
      fixedAmount: "",
      rate: "",
      capAmount: "",
      quota: "",
      budget: "",
      perClient: "",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.configuration.name).toBeNull();
    expect(result.configuration.minSubtotal).toBeNull();
    expect(result.configuration.benefit).toBeNull();
    expect(result.configuration.capacity).toEqual({
      quotaCount: null,
      budgetAmount: null,
      perClientLimit: null,
    });
  });

  it("menolak buffer tidak lengkap dengan pesan field, bukan menebak nilai", () => {
    const result = buildDraftConfiguration({
      ...base(),
      benefitKind: "fixed_goods",
      fixedAmount: "17.000,",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toContain("benefit.fixedAmount");
  });

  it("menolak pecahan Rupiah nonnol dan persen di atas 100", () => {
    const money = buildDraftConfiguration({
      ...base(),
      benefitKind: "fixed_goods",
      fixedAmount: "17.000,50",
    });
    expect(money.ok).toBe(false);
    const percent = buildDraftConfiguration({ ...base(), rate: "120" });
    expect(percent.ok).toBe(false);
  });

  it("menyertakan jadwal sebagai instant ber-offset dan menolak urutan terbalik", () => {
    const ok = buildDraftConfiguration({
      ...base(),
      startAt: "2026-03-01T10:00",
      endAt: "2026-03-02T10:00",
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.configuration.startAt).toBe("2026-03-01T03:00:00.000Z");
    const reversed = buildDraftConfiguration({
      ...base(),
      startAt: "2026-03-02T10:00",
      endAt: "2026-03-01T10:00",
    });
    expect(reversed.ok).toBe(false);
  });

  it("meneruskan usulan kode dan target status kode ke snapshot", () => {
    const state = discountEditorReducer(
      discountEditorReducer(createDiscountEditorState(detail()), {
        type: "code-add",
        raw: " baru2026 ",
      }),
      {
        type: "code-state",
        codeId: "44444444-4444-4444-8444-444444444444",
        state: "archived",
      }
    );
    const result = buildDraftConfiguration(state.form, state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.configuration.codeChanges.proposedCodes).toEqual(["BARU2026"]);
    expect(result.configuration.codeChanges.states).toEqual([
      {
        codeId: "44444444-4444-4444-8444-444444444444",
        expectedCodeVersion: 3,
        state: "archived",
      },
    ]);
  });
});

describe("navigasi bantuan", () => {
  it("tidak menampilkan tab Kode untuk kupon publik", () => {
    expect(editorTabsFor("public")).toEqual([
      "pengaturan",
      "simulasi",
      "pemakaian",
      "riwayat",
    ]);
    expect(editorTabsFor("manual_only")).toContain("kode");
  });

  it("memetakan masalah server ke tab yang harus dibuka", () => {
    expect(
      issuesByTab([
        { path: "benefit.fixedAmount", message: "a" },
        { path: "capacity.quotaCount", message: "b" },
        { path: "codeChanges.states.0", message: "c" },
      ])
    ).toEqual({ pengaturan: 2, kode: 1 });
  });
});
