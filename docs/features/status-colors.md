# Warna status semantik (store & admin)

Satu bahasa warna untuk status di storefront dan admin dashboard. Dokumen ini
adalah referensi permanen kontraknya: token, mapping domain, aturan fallback,
komponen, dan cara menambah status baru.

- Spesifikasi dan acceptance: [`.scratch/ux-design/plan/semantic-status-colors-spec.md`](../../.scratch/ux-design/plan/semantic-status-colors-spec.md)
- Audit awal dan rasio palet: [`.scratch/ux-design/research/status-colors-audit.md`](../../.scratch/ux-design/research/status-colors-audit.md)
- Pedoman agent: [`.agents/skills/ux-design/SKILL.md`](../../.agents/skills/ux-design/SKILL.md) bagian G

## 1. Tujuan dan batas

**Tujuan.** Status yang maknanya sama tampil sama di seluruh surface (store,
admin, list, detail, notifikasi), dan status yang maknanya berbeda tidak
disamakan. Warna tidak pernah menjadi satu-satunya pembeda: label teks selalu
ada.

**Bukan scope.** Lifecycle order/payment/shipment, reservation stok, eligibility
checkout, permission/RBAC, penyeragaman bahasa label, dan redesign layout.
Perubahan warna tidak boleh mengubah perilaku bisnis apa pun.

## 2. Token

Delapan tone: `waiting`, `progress`, `ready`, `info`, `success`, `error`,
`cancelled`, `neutral`. Setiap tone punya tiga token **opaque**:

```
--status-<tone>-background
--status-<tone>-foreground
--status-<tone>-border
```

Definisinya ada di **dua** file dan nilainya wajib identik:

- `apps/store/src/app/globals.css` (`:root` untuk light, `.dark` untuk dark)
- `apps/admin/src/app/globals.css` (`:root` dan `.dark`)

| Tone | Light (bg / teks / border) | Dark (bg / teks / border) | Kontras light → dark |
|---|---|---|---|
| waiting | `#FFF7ED` / `#9A3412` / `#FED7AA` | `#431407` / `#FED7AA` / `#9A3412` | 6.88 → 11.56 |
| progress | `#FEF3C7` / `#92400E` / `#FDE68A` | `#451A03` / `#FDE68A` / `#92400E` | 6.37 → 12.03 |
| ready | `#F0FDFA` / `#115E59` / `#99F6E4` | `#042F2E` / `#99F6E4` / `#115E59` | 7.27 → 11.48 |
| info | `#EFF6FF` / `#1E40AF` / `#BFDBFE` | `#172554` / `#BFDBFE` / `#1E40AF` | 8.01 → 10.34 |
| success | `#ECFDF5` / `#065F46` / `#A7F3D0` | `#022C22` / `#A7F3D0` / `#065F46` | 7.29 → 11.81 |
| error | `#FEF2F2` / `#991B1B` / `#FECACA` | `#450A0A` / `#FECACA` / `#991B1B` | 7.60 → 11.16 |
| cancelled | `#FFF1F2` / `#9F1239` / `#FECDD3` | `#4C0519` / `#FECDD3` / `#9F1239` | 7.30 → 11.08 |
| neutral | `#F1F5F9` / `#334155` / `#CBD5E1` | `#0F172A` / `#CBD5E1` / `#475569` | 9.45 → 12.02 |

Semua pasangan teks/background ≥ 4.5:1 (SC 1.4.3 untuk `text-xs`). Rasio di
tabel adalah hitungan palet; bukti yang berlaku adalah **computed style hasil
render** yang diukur di `e2e/store/status-colors-mock.spec.ts` dan
`e2e/admin/status-colors-mock.spec.ts`.

Token tidak boleh dipakai langsung dengan hex di komponen. Kelas statis per
tone dipusatkan di `packages/ui/src/lib/status-styles.ts`.

## 3. Resolver domain

`packages/ui/src/lib/status-presentation.ts` (murni: tanpa DB/auth/provider/Next
API) adalah satu-satunya sumber mapping.

```ts
getStatusTone(domain: StatusDomain, value: string | null | undefined): StatusTone
```

Contoh pemakaian:

```tsx
<StatusBadge tone={getStatusTone("order", order.status)}>
  {ORDER_STATUS_LABELS[order.status] ?? "Status pesanan belum tersedia"}
</StatusBadge>
```

Domain dipisahkan karena string yang sama punya arti berbeda: `active` untuk
admin user ≠ `active` untuk kode diskon, `completed` untuk order ≠ `completed`
untuk offer, `cancel` (hasil checkout) ≠ `cancelled` (lifecycle order).

| Domain | Nilai → tone |
|---|---|
| `order` | pending_payment→waiting, processing→progress, ready_for_pickup→ready, completed→success, cancelled→cancelled, failed_payment→error |
| `payment` | pending→waiting, paid→success, failed→error |
| `product` | aktif→success, habis→progress, arsip→neutral |
| `branch` | aktif→success, nonaktif→neutral |
| `stock-visibility` | unavailable→progress, unconfirmed→info |
| `onboarding` | completed→success, pending→waiting |
| `email-verification` | verified→success, unverified→waiting |
| `email-verification-flow` | verifying→progress, success→success, error→error |
| `admin-user` | active→success, reset_required→progress |
| `role` | archived→neutral |
| `offer` | draft→neutral, enabled→success, paused→progress, archived→neutral |
| `discount-code` | active→success, inactive→neutral, archived→neutral |
| `redemption` | reserved→waiting, consumed→success, released→neutral |
| `markdown` | invalid_source→error, active→success, inactive_target→progress, absent→neutral |
| `price-row` | pending→waiting, applied→success, unchanged→neutral, failed→error |
| `checkout-result` | success→success, pending→waiting, cancel→error |
| `checkout-attempt` | preparing/compensating/processing/manual_review→progress, rejected→error, promoted→neutral |
| `stock-operation` | pending/in_flight/reconciling/manual_review→progress, applied/committed→success, failed→error |
| `sales-operation` | intent/dispatched_unknown/manual_review→progress, confirmed→success, rejected→error, aborted→cancelled |
| `cms-page` | published→success, draft→neutral |
| `homepage-content` | inactive→neutral |
| `promo-selection` | applied→success (hanya badge "Dipakai") |
| `delivery-stage` | label `projectDeliveryStage` — lihat tabel di bawah |
| `tracking` | normalized provider status — lihat tabel di bawah |

### 3.1 Delivery stage (21 output `projectDeliveryStage`)

| Label | Tone |
|---|---|
| Menunggu pembayaran | waiting |
| Verifikasi pembayaran | progress |
| Verifikasi tertunda | progress |
| Siapkan barang | progress |
| Barang siap | ready |
| Menunggu penjemputan | waiting |
| Diserahkan ke kurir | info |
| Dibawa kurir | info |
| Dalam pengiriman | info |
| Barang diterima | success |
| Selesai manual | neutral |
| Menunggu hasil booking | progress |
| Booking belum pasti | progress |
| Stok tidak tersedia | progress |
| Barang rusak | error |
| Batas layanan terlampaui | error |
| Pengiriman tertahan | progress |
| Barang dikembalikan | cancelled |
| Pengiriman dibatalkan | cancelled |
| Kendala pengiriman | error |
| Order tidak aktif | neutral |

Mapping memakai **label** karena kontrak `projectDeliveryStage` hanya
mengekspor label + guidance + terminal. `Selesai manual` dan `Order tidak aktif`
tetap neutral: keduanya tidak membuktikan barang diterima. Order `completed`
boleh success karena lifecycle-nya ditutup, bukan klaim delivered.

### 3.2 Tracking provider

| Status normalized | Tone |
|---|---|
| WAITING | waiting |
| CONFIRMED_BY_COURIER, ON_THE_WAY_PICK_UP / ON_THE_WAY_PICKUP, PICKED_UP, ON_DELIVERY | info |
| DELIVERED | success |
| ON_HOLD | progress |
| RETURNED, CANCELED | cancelled |
| SHIPMENT_ISSUE | error |

`ON_THE_WAY_PICKUP` hanya alias presentasi; vocabulary provider tidak diubah.

## 4. Fallback

| Input | Hasil |
|---|---|
| `null`, `undefined`, string kosong/whitespace | `neutral` |
| Identifier tidak dikenal | `neutral` |
| Label order customer asing | "Status pesanan belum tersedia" (identifier mentah tidak ditampilkan) |
| Label tracking asing | "Pembaruan pengiriman" |
| Promo/redemption asing | "Status promo belum tersedia" |
| Label admin asing | raw label yang di-escape React, tone `neutral` |
| Label admin kosong | "Status belum tersedia" |

Tidak ada pencocokan substring (`includes("success")`). Nilai baru tidak pernah
otomatis menjadi success/error/paid/delivered.

## 5. Komponen

### 5.1 `StatusBadge`

`packages/ui/src/components/ui/status-badge.tsx` — pill pasif di atas shadcn
`Badge` (`variant="outline"` + treatment tone). Props: `tone`, `children`,
`className`, `aria-label`, `aria-describedby`, `data-testid`. Tidak menerima
`variant`, `onClick`, `role`, atau `tabIndex`; tidak ada `hover:` yang mengubah
hue; teks wrap (`whitespace-normal break-words`), tidak dipotong ellipsis.

Elemen menandai tone-nya sendiri lewat `data-status-tone="<tone>"`. Atribut ini
adalah seam test (bukan API publik) dan **hanya** boleh berada pada elemen yang
benar-benar memakai treatment tone tersebut.

### 5.2 `getStatusToneClassName(tone)`

`packages/ui/src/lib/status-styles.ts` mengembalikan kelas statis
`border/bg/text` untuk container non-pill (ikon hasil checkout, ikon verifikasi
email, container feedback import/bulk, ikon ringkasan customer). Karena
foreground ikut di-set, ikon di dalamnya mewarisi `currentColor`.

### 5.3 Aggregate import/bulk

```ts
getPriceBatchTone({ rowCount, pendingCount, appliedCount, unchangedCount, failedCount, haltReason })
```

Urutan prioritas:

1. `haltReason` ada → `error`
2. ada `pending` → `progress` (walaupun ada `failed`)
3. semua baris gagal (`failed === rowCount > 0`) → `error`
4. sebagian gagal → `progress`
5. `applied > 0` → `success` (termasuk campuran `unchanged`)
6. selain itu (`unchanged` saja / belum ada hasil / `rowCount = 0`) → `neutral`

Resolver ini **tidak** menggantikan `statusMessage()` (copy & angka tetap dari
helper existing); ia hanya memetakan tone aggregate.

## 6. Yang bukan status lifecycle

Tetap memakai `Badge` biasa (kategori/atribut), bukan `StatusBadge`:

- Member tier, badge diskon `NN%`, atribut produk (gender/koleksi).
- Role/tipe user, tipe notifikasi, counter notifikasi, jumlah tipe Sales
  Operation, jumlah item terpilih.
- Homepage section type, sumber import, koreksi tertaut, "Ada draft".
- Promo "Dipilih"/"Paling hemat" (selection & recommendation, bukan lifecycle).

`getStatusTone("promo-selection", "applied")` hanya untuk badge "Dipakai".

## 7. Cara menambah status baru

1. Tentukan **domain** dulu; jangan menambah nilai ke domain yang salah hanya
   karena string-nya mirip.
2. Tambahkan entri di `DOMAIN_TONES` (`packages/ui/src/lib/status-presentation.ts`).
3. Tambahkan label eksplisit + fallback di komponen pemanggil. Label existing
   dipertahankan; jangan melokalisasi ulang dalam pekerjaan warna.
4. Tambahkan baris di tabel test literal
   `apps/store/src/lib/status-presentation.test.ts` (expected ditulis manual
   dari dokumen ini, bukan diimpor dari implementasi).
5. Tambahkan bukti browser pada spec store/admin yang relevan bila surface-nya
   berubah; ukur computed color, jangan hanya class.
6. Perbarui tabel di dokumen ini.

Tone baru (mis. `warning` terpisah dari `progress`) memerlukan keputusan user:
delapan tone adalah kontrak palet yang disetujui.

## 8. Verifikasi

```bash
npm run verify:unit:slice -- apps/store/src/lib/status-presentation.test.ts
npm run verify:types:store
npm run verify:types:admin
npm run verify:batch:e2e -- e2e/store/status-colors-mock.spec.ts e2e/admin/status-colors-mock.spec.ts
```

Kedua spec browser mengukur `getComputedStyle` (background/teks/border), kontras
≥ 4.5:1, kestabilan hover, palet light **dan** dark, serta kesamaan lintas app
lewat palet literal yang sama. Spec berjalan di konfigurasi mock terisolasi
(`playwright.mock.config.ts`) dengan DB disposable; lihat
[`docs/testing/README.md`](../testing/README.md).

## 9. Batasan yang diketahui

- **Badge stok di katalog store.** `ProductCard` hanya menerima flag stok dari
  `InfiniteProductGrid`, sedangkan katalog store menyembunyikan produk tanpa
  stok tersedia; `CarouselProductSection` (homepage/preview) tidak meneruskan
  flag tersebut. Karena itu tone `stock-visibility` diverifikasi lewat unit test
  mapping dan invariant katalog (tidak ada badge stok bertone salah), bukan
  dengan fixture produk habis di halaman katalog.
- **Editor Offer & daftar kode** adalah halaman Server Component yang membaca
  DB; bukti browser untuk lifecycle offer diambil dari daftar Offer dengan
  fixture API. Editor memakai resolver `offer` yang sama.
- Warna hanya satu dimensi: label teks tetap wajib dan tidak boleh dihapus demi
  badge yang "lebih berwarna".
