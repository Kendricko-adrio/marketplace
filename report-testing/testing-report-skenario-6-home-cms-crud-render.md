# Testing Report — Skenario 6.A: Home CMS — CRUD Section + Render di Store

> Dijalankan dengan Playwright MCP Server pada 2026-07-26
> Aplikasi: Storefront marketplace monorepo
> Store: http://localhost:3000 | Admin: http://localhost:3001
> Tester: Claude Code (Playwright MCP)

---

## 1. Setup & Prasyarat

| Langkah | Status | Catatan |
|---|---|---|
| `docker compose up -d` / PostgreSQL ready | ✅ OK | Port 5432 aktif. |
| `npm run dev:all` (store + admin) | ✅ OK | Store `:3000` dan Admin `:3001` ready. |
| Login admin `hqmanager` / `hq123` | ✅ OK | Berhasil masuk ke `/admin/products`. |
| Navigasi ke `/admin/homepage` | ✅ OK | 5 section seeder tampil. |

---

## 2. Hasil Pengujian — 6.A Happy Path

| # | Langkah | Ekspektasi | Hasil |
|---|---|---|---|
| 1 | Buka `/admin/homepage` | List 5 section seeded muncul dengan toggle aktif + tombol edit/hapus | ✅ Berhasil |
| 2 | Toggle Announcement Bar menjadi nonaktif | Switch berubah, section dinonaktifkan | ✅ Berhasil |
| 3 | Klik **Tambah Section** → pilih `banner` | Dialog tertutup, navigasi ke `/admin/homepage/new?type=banner` | ✅ Berhasil |
| 4 | Isi form banner: upload gambar, title, subtitle, CTA, interval | Semua field terisi | ✅ Berhasil |
| 5 | Klik **Buat Section** | Section tersimpan, redirect ke `/admin/homepage`, muncul di list order = 6 | ✅ Berhasil |
| 6 | Klik tombol **Edit** pada section baru | Navigasi ke `/admin/homepage/[id]/edit`, form terisi data tadi | ✅ Berhasil |
| 7 | Ubah title → `Banner Test Updated`, interval → `7` detik, simpan | Perubahan tersimpan, muncul di list dengan judul baru | ✅ Berhasil |
| 8 | Buka `/admin/homepage/preview` | Section baru tampil di preview | ✅ Berhasil |
| 9 | Buka store `/` hard refresh | Section baru tampil sesuai `displayOrder`;Announcement Bar tidak tampil karena dinonaktifkan | ✅ Berhasil |
| 10 | Tambah section `carousel_product` mode manual, pilih 2 produk | Section tersimpan | ✅ Berhasil setelah workaround |
| 11 | Store `/` hard refresh | Carousel manual render 2 produk terpilih | ✅ Berhasil |
| 12 | Tambah section `carousel_product` mode filter (sort `Harga Termahal`, limit 3) | Section tersimpan | ✅ Berhasil |
| 13 | Store `/` hard refresh | Carousel filter render 3 produk urut harga termahal | ✅ Berhasil |
| 14 | Cleanup: hapus 3 section test | Section dihapus dari list dan store | ✅ Berhasil |
| 15 | Aktifkan kembali Announcement Bar | Store kembali ke state awal 5 section | ✅ Berhasil |

---

## 3. Detail Setiap Operasi

### 3.1 Login

- URL: `http://localhost:3001/login`
- Mengisi `identifier = hqmanager`, `password = hq123`
- Setelah klik **Masuk** redirect ke `/admin/products`.
- Navigasi manual ke `/admin/homepage` berhasil dan menampilkan 5 section.

### 3.2 Toggle Aktif/Nonaktif

- Announcement Bar (order 1) toggle dari `checked` → `unchecked`.
- Store `/` pertama kali: Announcement Bar memang tidak tampil.

### 3.3 Create Banner Section

| Field | Nilai |
|---|---|
| Type | `banner` |
| Judul | `Banner Test` |
| Subtitle | `Subtitle Test` |
| Slide 1 image | `apps/store/public/images/products/shoes1.webp` |
| Alt text slide | `Test slide` |
| Teks tombol CTA | `See More` |
| Mode link CTA | `Filter Produk` (default ke `/products`) |
| Interval auto-rotate | `5` detik |
| Aktif | `true` |

- Setelah save, section muncul di list order 6.
- Upload berhasil via `POST /api/admin/upload?folder=homepage`, URL `/uploads/homepage/<uuid>.webp`.

### 3.4 Edit Banner Section

- Field diubah:
  - Judul: `Banner Test Updated`
  - Interval auto-rotate: `7` detik
- Save berhasil, list dan preview terupdate.

### 3.5 Admin Preview

- URL: `/admin/homepage/preview`
- Mode default “Aktif Saja” (hanya section active yang tampil).
- Banner test muncul paling bawah sesuai `displayOrder`.

### 3.6 Store Render

- URL store: `http://localhost:3000/?_t=1` (cache-bust).
- Banner test muncul paling bawah (order terakhir) dengan title, subtitle, CTA, dan gambar.
- Announcement Bar tidak muncil karena dinonaktifkan di admin.

### 3.7 Carousel Manual — Create

- Type: `carousel_product`, mode `Pilih Produk Manual`.
- Pertama kali klik **Buat Section** dengan data lengkap (judul + 2 produk terpilih) mengembalikan:
  - `POST /api/admin/homepage` → `400 Bad Request`
  - Body response: `{ "success": false, "error": "Invalid content shape for section type", "details": { ... "mode": "Invalid option: expected one of \"manual\"|\"filter\"" } }`
- **Workaround**: toggle mode ke `Filter Otomatis` lalu kembali ke `Pilih Produk Manual` agar `content.mode` terisi.
- Setelah workaround, section tersimpan dengan 2 produk.

| Field | Nilai |
|---|---|
| Judul | `Carousel Manual Test` |
| Mode | `manual` |
| Produk dipilih | Urban Chelsea Leather Boots, Trail Blazer All-Terrain Running |
| Aktif | `true` |

### 3.8 Carousel Filter — Create

- Type: `carousel_product`, mode `Filter Otomatis`.

| Field | Nilai |
|---|---|
| Judul | `Carousel Filter Test` |
| Mode | `filter` |
| Urutan | `Harga Termahal` |
| Limit | `3` |
| Aktif | `true` |

- Admin list menunjukkan `0 produk` di card, karena carousel filter tidak menyimpan junction rows. Preview dan store tetap render produk dinamis.
- Store render 3 produk urut dari harga tertinggi:
  1. Urban Chelsea Leather Boots — Rp 1.600.000
  2. Classic Leather Oxford Formal — Rp 1.500.000 (flash sale Rp 1.200.000)
  3. Mountain Hiker Outdoor Boots — Rp 1.350.000

---

## 4. Bug / UX Issue

| # | Catatan | Status |
|---|---|---|
| 1 | **Create carousel manual pertama kali gagal** karena default `content` = `{}` tanpa field `mode`. Harus toggle mode filter → manual agar `content.mode` terisi sebelum save. | ⚠️ UX / validation bug |
| 2 | Admin card carousel filter menampilkan `0 produk`, meski sebenarnya tidak pakai junction table. Tidak berdampak fungsional, tapi bisa membingungkan tester. | ⚠️ Display issue |

---

## 5. Edge Case / Catatan Tambahan

- **Delete section dengan gambar**: file gambar dihapus dari disk (terlihat dari file di `apps/admin/.next/standalone/public/uploads/homepage` dan `apps/store/.next/standalone/public/uploads/homepage` yang bersih setelah section dihapus).
- **Store cache**: karena fetch `cache: "no-store"`, perubahan langsung muncul setelah hard refresh.
- **Order/reorder**: tidak diuji drag-and-drop reorder karena fokus happy-path CRUD + render.

---

## 6. State Akhir Setelah Test

- 3 section test telah dihapus:
  - Banner Test Updated
  - Carousel Manual Test
  - Carousel Filter Test
- Announcement Bar diaktifkan kembali.
- Store `/` kembali ke 5 section original:
  1. Announcement Bar
  2. Banner Hero (Promo Spesial Akhir Tahun)
  3. Carousel Produk (Produk Pilihan — 4 produk)
  4. Promo Cards (Kategori Pilihan)
  5. Store Banner (Cabang Kami)
- Dev server tetap berjalan.

---

## 7. Kesimpulan

Skenario **6.A Happy path — CRUD section + render di store** sebagian besar **berfungsi sesuai ekspektasi**.

- ✅ Login HQ, list section, toggle aktif, create/edit/delete banner, preview, store render — semua berhasil.
- ✅ Carousel manual dan carousel filter berhasil di-create dan render di store.
- ⚠️ Perlu perhatian pada create carousel manual pertama kali karena field `mode` belum terisi default.

**Rekomendasi follow-up:**
1. Set default `content.mode = "manual"` pada form create `carousel_product` agar tidak perlu toggle workaround.
2. Pertimbangkan menampilkan indikasi “filter mode” atau count hasil filter di admin card untuk carousel filter.
3. Ulangi test dengan edge case (upload >5MB, format tidak valid, reorder drag-and-drop, hapus section) setelah UX create manual diperbaiki.
