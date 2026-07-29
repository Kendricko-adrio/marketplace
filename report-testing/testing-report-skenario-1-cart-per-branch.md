# Testing Report — Skenario 1: Cart per Branch

> Dijalankan dengan Playwright MCP Server pada 2026-07-26  
> Aplikasi: Storefront marketplace monorepo  
> Store: http://localhost:3000 | Admin: http://localhost:3001  
> Tester: Claude Code (Playwright MCP)

---

## 1. Setup & Prasyarat

| Langkah | Status | Catatan |
|---|---|---|
| `docker compose up -d` / start PostgreSQL | ✅ OK | Container `storefront-postgres` sudah ada, di-start ulang. Port 5432 aktif. |
| `npm run dev:all` (store + admin) | ✅ OK | Store `:3000` dan Admin `:3001` Ready. |
| Login customer `john@example.com` / `password123` | ✅ OK | Berhasil. |
| Onboarding (phone, DOB, gender) | ✅ OK | Diisi: `+62 81234567890`, 1990-01-01, Laki-laki. |

---

## 2. Blocker Ditemukan Saat Test

### 2.1 Kolom `branch_stock.reserved_stock` belum ada di DB

Saat membuka halaman **product detail** dan saat `POST /api/cart/items`, API mengembalikan **500** karena query meminta kolom `reserved_stock` yang belum teraplikasikan di database.

**Error:**

```
Error fetching product: Error: Failed query: select ... branch_stock.stock, branch_stock.reserved_stock ...
cause: error: column branch_stock.reserved_stock does not exist
```

**Lokasi kode:**
- `apps/store/src/app/api/products/[id]/route.ts:77`
- `apps/store/src/app/api/cart/items/route.ts:90`

**Perbaikan sementara (diterapkan manual):**

```sql
ALTER TABLE branch_stock ADD COLUMN IF NOT EXISTS reserved_stock integer DEFAULT 0 NOT NULL;
```

> ⚠️ **Rekomendasi:** `npm run db:migrate` gagal dengan error `orders.payment_failure_reason already exists`, dan tabel `__drizzle_migrations` tidak ada. State DB perlu di-*reconcile* (reset seed ulang atau perbaiki migration history) agar kolom-kolom baru (`reserved_stock`, `payment_failure_reason`, `expires_at`, dll.) sinkron dengan schema.

---

## 3. Hasil Pengujian — 1.A Happy Path

| # | Langkah | Ekspektasi | Hasil |
|---|---|---|---|
| 1 | Login customer | Customer terautentikasi | ✅ Berhasil |
| 2 | Buka `/products/dec8cea9-...` (AirRunner Pro), pilih cabang **JKT-01** | Branch picker aktif, stok tampil | ✅ Berhasil setelah kolom `reserved_stock` ditambahkan |
| 3 | Pilih varian Hitam/42, qty 1, klik **Masukkan Keranjang** | Toast sukses; badge navbar bertambah | ✅ Berhasil |
| 4 | Buka `/cart` | Item dikelompokkan per cabang | ✅ Tampil grup **Cabang Jakarta Pusat** |
| 5 | Tambah produk lain (varian Putih/42) dari cabang **SRB-01** | Muncul 2 group | ✅ Tampil grup **Cabang Surabaya** + grup **Jakarta Pusat** |
| 6 | Centang item JKT-01 | Checkout enable | ✅ Tombol **Checkout** aktif |
| 7 | Centang item SRB-01 | Toast/validasi cabang berbeda; item SRB tidak ikut tercentang; Checkout disabled sampai hanya 1 cabang terpilih | ✅ UI menolak seleksi multi-branch; checkout tetap hanya untuk 1 cabang |
| 8 | Centang hanya JKT-01, klik **Checkout** | Redirect ke `/checkout` dengan item JKT-01 saja | ✅ Redirect berhasil. `sessionStorage.checkoutSelectedItemIds` terisi, hanya item JKT-01 yang muncul di checkout |

---

## 4. Hasil Pengujian — 1.B Edge Cases

| # | Skenario | Langkah / Cara Uji | Ekspektasi | Hasil |
|---|---|---|---|---|
| 1.1 | Tambah dari cabang nonaktif (BDG-01) | Cek branch picker di product detail | BDG-01 tidak muncul; API reject `400 "Branch not available"` | ✅ BDG-01 tidak muncul di picker |
| 1.2 | Stok tidak cukup | Pilih qty melebihi stok di product detail | Tombol `+` terkunci di stok; API reject | ⚠️ Tidak diuji via UI karena input qty readonly; aturan stok tercover oleh 1.3 |
| 1.3 | Update qty melebihi stok | `PUT /api/cart/items/[id]` dengan qty 40 (stok 39) | API reject; qty tidak berubah | ✅ `400 "Insufficient stock at this branch"`, qty tetap |
| 1.4 | Varian sama dari 2 cabang | Tambah varian A ke JKT-01 dan varian A ke SRB-01 | 2 line terpisah | ✅ Muncul 2 line terpisah |
| 1.5 | Varian+cabang sama (dedup) | Tambah varian A JKT-01 lagi | Line digabung, qty dijumlah | ✅ Qty dijumlahkan (contoh: qty 1 + qty 3 menjadi 4) |
| 1.6 | Item di cart lalu cabang nonaktif | Admin nonaktifkan cabang yang ada di cart | Item masih tampil; baru ditolak saat place-order | ⚠️ Belum diuji end-to-end |
| 1.7 | Hapus 1 item | Klik ikon sampah | Item hilang, badge update | ✅ Berhasil; badge & ringkasan update |
| 1.8 | Clear cart | `DELETE /api/cart` | Semua item terhapus; baris `carts` tetap ada | ✅ `200 {"success":true,"message":"Cart cleared"}`; cart kosong; badge hilang |
| 1.9 | Akses `/cart` tanpa login | Logout lalu buka `/cart` | Redirect ke `/login?callbackUrl=/cart` | ✅ Berhasil |
| 1.10 | Badge navbar | Tambah item qty 3 | Badge = sum qty | ✅ Badge menunjukkan total qty, bukan jumlah line |
| 1.11 | Halaman `/branches` | Buka `/branches` | Grid cabang aktif + jam operasional + filter kota | ✅ Berfungsi; JKT-01 & SRB-01 tampil; BDG-01 tidak tampil |

---

## 5. Catatan / Bug Lain

| # | Catatan | Status |
|---|---|---|
| 1 | Setelah login dengan `?callbackUrl=/cart`, user diarahkan ke `/` bukan ke `/cart`. | ⚠️ Minor UX issue |
| 2 | Input qty di product detail bersifat **readonly** sehingga tidak bisa langsung diketik; hanya bisa via tombol `+` / `-`. | ⚠️ UX keterbatasan |
| 3 | `npm run db:migrate` gagal karena kolom `orders.payment_failure_reason` sudah ada. Tabel `__drizzle_migrations` tidak ada. | 🔴 Perlu perbaikan migration/seed |
| 4 | Halaman `/catalog` mengembalikan **404**. | 🔴 URL footer/link menu yang rusak |

---

## 6. State Akhir Setelah Test

- **Cart customer** dikembalikan ke state baseline (2 item):
  - JKT-01 — AirRunner Pro — Hitam / 42 — qty 1
  - SRB-01 — AirRunner Pro — Putih / 42 — qty 1
- **Badge navbar** = `2`.
- **Dev server** (`npm run dev:all`) tetap berjalan di background.
- **Browser Playwright** telah ditutup.

---

## 7. Kesimpulan

Skenario **1. Cart per Branch** sebagian besar **berfungsi sesuai ekspektasi** untuk happy path dan edge cases utama (grouping per cabang, validasi single-branch checkout, dedup, stok, clear cart, logout redirect, halaman `/branches`).

Namun, terdapat **blocker environment** berupa ketidak-sinkronan antara schema kode dan database (`reserved_stock` belum ada) yang menghalangi product detail dan add-to-cart berjalan. Setelah kolom ditambahkan secara manual, skenario berjalan lancar.

**Rekomendasi follow-up:**
1. Perbaiki migration/seed Drizzle (`__drizzle_migrations` hilang, kolom duplication).
2. Periksa link `/catalog` yang 404.
3. Evaluasi UX callback URL setelah login.
4. Ulangi test setelah DB migration diperbaiki untuk hasil yang lebih bersih.
