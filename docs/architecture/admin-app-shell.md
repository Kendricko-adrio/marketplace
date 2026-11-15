# Admin App Shell — Kontrak Scroll & Layout

Dokumen ini menjelaskan kerangka halaman admin (`apps/admin/src/app/admin/layout.tsx`
+ `apps/admin/src/components/AdminSidebar.tsx`) dan kontrak scroll yang harus
dipertahankan saat menambah halaman atau komponen baru.

## 1. Susunan shell

```
<div class="flex min-h-dvh flex-col md:h-dvh md:overflow-hidden md:flex-row">
  <AdminSidebar/>                                  ← statis, tinggi 100dvh (md+)
  <div class="flex min-w-0 flex-1 flex-col md:min-h-0">
    <header class="h-16 shrink-0 …">Admin Dashboard</header>
    <main class="flex-1 … md:min-h-0 md:overflow-y-auto">{children}</main>
  </div>
</div>
```

Kontrak yang berlaku pada breakpoint `md` ke atas:

1. **Dokumen tidak boleh scroll.** `document.scrollingElement` harus memenuhi
   `scrollHeight === clientHeight`. Kalau tidak, seluruh jendela ikut bergeser
   dan sidebar serta header hilang dari layar.
2. **Hanya `<main>` yang scroll.** Sidebar, brand header, dan kartu akun di
   bawah sidebar tetap pada posisinya.
3. **Nav sidebar punya scroll sendiri** (`overflow-y-auto`). Pada viewport
   pendek daftar modul yang panjang digulir di dalam sidebar; brand header dan
   kartu akun tidak boleh terpotong.

Di bawah `md` shell tetap memakai `min-h-dvh` tanpa tinggi tetap: sidebar
menumpuk di atas konten dan halaman scroll seperti biasa (perilaku mobile).

## 2. Aturan untuk halaman/komponen baru

- **Jangan** memakai `min-h-screen` / `h-screen` di dalam `main`. Shell sudah
  memberi tinggi penuh; `min-h-screen` di dalam konten membuat area scroll
  bertambah dan memunculkan ruang kosong.
- **Jangan** menambahkan elemen `<main>` kedua di dalam halaman admin: `main`
  milik shell adalah satu-satunya landmark konten. Untuk blok yang ingin
  memenuhi area konten (mis. layar safe state `/admin/no-access`), gunakan
  `<div className="flex min-h-full items-center justify-center p-6">` — bukan
  `<main min-h-screen>` (lihat §3).
- Untuk region yang perlu scroll sendiri (tabel panjang, panel), beri tinggi
  terbatas + `overflow-y-auto` pada region tersebut, bukan pada halaman.
- Elemen `position: sticky` di dalam konten menempel pada scroll container
  `<main>` — bukan pada viewport. Perhitungkan offset header 64px
  (`top-16`/`top-[calc(...)]`) bila elemen harus tampak di bawah header.
- Elemen `position: absolute` **tanpa** ancestor ber-`position` akan memakai
  *initial containing block* (viewport), sehingga lolos dari `overflow` milik
  `<main>` dan bisa menambah tinggi dokumen. Beri `relative` pada wrapper
  terdekat (contoh nyata di §3).

## 3. Dua regresi yang pernah terjadi

| Gejala | Penyebab | Perbaikan |
|---|---|---|
| Seluruh halaman ikut scroll; sidebar & header "naik" keluar layar | Shell dulu memakai `min-h-screen` + `md:flex-row`, sehingga container tumbuh bersama konten dan `overflow-y-auto` di `main` tidak pernah aktif | Shell diganti ke `md:h-dvh md:overflow-hidden` dan `main` diberi `md:min-h-0 md:overflow-y-auto` |
| `/admin/analytics` tetap bisa discroll walau kontrak di atas sudah dipenuhi | Tabel fallback screen-reader (`sr-only`) berisi 30 baris; `overflow` tidak memotong box `display: table`, dan karena tidak ada ancestor `position: relative`, tabel itu memakai initial containing block sehingga menambah tinggi dokumen | Tabel dibungkus `<div class="sr-only">` dan island chart `revenue-trend-chart.tsx` diberi `relative` |
| `/admin/footer` tetap bisa discroll | Input checkbox `sr-only` (position absolute) tidak punya ancestor ber-`position`, jadi lolos dari `main` dan menambah tinggi dokumen | `main` shell diberi `relative` sehingga menjadi containing block untuk semua elemen absolute di dalam konten |
| Halaman safe state (`/admin/no-access`) membuat area konten scroll dan punya dua landmark `main` | Halaman itu dirender **di dalam** shell tetapi memakai `<main class="min-h-screen">` | Diganti `<div class="flex min-h-full items-center justify-center p-6">` |

Kontrak ini dijaga oleh `e2e/admin/shell-layout.spec.ts` (nol overflow dokumen,
hanya `main` yang scroll, nav sidebar scroll pada viewport pendek, dan tabel
fallback analitik tidak menambah area scroll).

## 4. Verifikasi

```bash
npx playwright test e2e/admin/shell-layout.spec.ts --project=admin
```

Untuk memeriksa manual di browser: buka halaman admin mana pun, scroll dengan
wheel di area konten — brand header, `Admin Dashboard`, dan kartu akun harus
tetap terlihat, dan scrollbar muncul di area konten (bukan di jendela).
