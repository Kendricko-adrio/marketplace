# Token UI & Warna — Marketplace

Referensi internal untuk pertanyaan "warna ini diambil dari mana, dan boleh saya
pakai di halaman baru?". Dokumen ini melengkapi aturan visual operasional di
[skill `ux-design`](../../.agents/skills/ux-design/SKILL.md); skill tetap menjadi
pedoman perilaku, dokumen ini menjelaskan mekanismenya di kode.

## 1. Sumber kebenaran

```
apps/store/src/app/globals.css   ─┐  (dua file ini WAJIB identik)
apps/admin/src/app/globals.css   ─┘
        │  CSS variable HSL di :root / .dark
        ▼
apps/store/tailwind.config.ts    ─┐  colors.background = "hsl(var(--background))" dst.
apps/admin/tailwind.config.ts    ─┘  (dua file ini juga WAJIB identik)
        ▼
packages/ui/src/components/ui/*  → hanya memakai token semantik
```

- Tidak ada file `tokens.ts`/`constants` warna, tidak ada theme provider. Palet
  hidup sebagai CSS variable di `globals.css`.
- `packages/ui` **tidak** punya CSS sendiri. Komponen shared hanya menulis nama
  utility (`bg-field`, `border-input`, `ring-ring`), sehingga satu perubahan
  token berlaku untuk store dan admin sekaligus.
- Komponen di app diimpor lewat alias tsconfig
  `@/components/ui/* → packages/ui/src/components/ui/*` (lihat
  [`overview.md`](overview.md)). Jadi "komponen app" sering bukan file di
  `apps/*/src/components/ui/` — telusuri alias, bukan menebak folder.
- `globals.css` dan `tailwind.config.ts` di dua app masih **duplikat manual**.
  Setiap perubahan warna harus disalin ke kedua app dan diverifikasi dengan
  `diff apps/store/src/app/globals.css apps/admin/src/app/globals.css`.

## 2. Palet merek (nilai mentah)

| Token | Light | Hex | Peran |
|---|---|---|---|
| `--primary` | `199 42% 9%` | `#061E29` | teks utama, header, tombol utama |
| `--secondary` | `197 58% 27%` | `#1D546D` | navy medium, surface sekunder (`bg-secondary/30`) |
| `--accent` | `183 23% 48%` | `#5F9598` | teal, aksen |
| `--background` | `180 2% 95%` | `#F3F4F4` | kanvas halaman |
| `--card` | `0 0% 100%` | `#FFFFFF` | permukaan kartu/form |
| `--muted` | `180 2% 95%` | `#F3F4F4` | permukaan **non-editable** |
| `--border` | `180 2% 85%` | `#D8DADA` | pemisah/kartu |
| `--input` | `200 14% 62%` | `#909FAC` | **border kontrol form** |
| `--field` | `200 27% 98%` | `#F8FAFB` | **permukaan field yang bisa diketik** |
| `--placeholder` | `207 10% 52%` | `#788691` | **teks placeholder/prompt field kosong** |

## 3. Aturan permukaan field

1. **Field yang bisa diketik memakai `bg-field`**, bukan `bg-background`.
   `--background` adalah abu-abu kanvas; memakainya untuk input membuat field
   terbaca "disabled" di atas kartu putih — persis keluhan yang memicu token
   `--field`.
2. **`--muted` dipakai untuk state non-editable** (`readOnly`, `disabled`).
   Pemisahan ini disengaja: `--field` terang, `--muted` lebih gelap, jadi status
   terkunci terbaca dari tone.
3. **Jangan menulis ulang string kelas input secara ad-hoc.** Pakai
   `Input`/`Select`/`Textarea`/`ReadOnlyInput` dari `packages/ui`. Kalau butuh
   elemen native, salin string kelas dari komponen shared dan ganti hanya token
   yang benar-benar perlu (contoh lama: `ProductFilters.tsx`).
4. **`--input` lebih gelap dari `--border`.** Karena `--field` hampir putih,
   border adalah petunjuk utama bahwa sesuatu adalah kontrol. Nilai sekarang
   ≈ 2,6:1 terhadap putih; SC 1.4.11 (3:1) belum tercapai penuh — keterbatasan
   yang disadari, bukan nilai acak.

## 4. Aturan placeholder

Placeholder adalah **petunjuk**, bukan isi. Nilainya harus jauh lebih redup
supaya field kosong tidak terbaca sebagai field yang sudah diisi.

- Token: `--placeholder` (`207 10% 52%` / `#788691` di light, `190 10% 52%` di
dark), dipetakan sebagai `placeholder` di `theme.extend.colors`, sehingga
utility-nya `placeholder:text-placeholder`.
- Kontras ≈ **3,6:1** terhadap `--field`, sedangkan teks nilai asli
(`--foreground`) ≈ **16,9:1**. Rasio keduanya ≈ 4,7×, jadi status kosong/terisi
terbaca tanpa mengandalkan warna tipis, dan prompt masih punya margin di atas
ambang cue non-teks 3:1.
- **Jangan pakai `--muted-foreground` untuk placeholder.** Nilainya
`197 58% 27%` (`#1D566D`, ≈7,7:1 di atas `--field`) dan nyaris menyamai teks
nilai — persis regresi yang memicu token ini. `--muted-foreground` tetap
benar untuk hint, caption, dan teks state `readOnly`.
- Titik penerapan ada di komponen shared: `Input` dan `Textarea`
(`placeholder:text-placeholder`), `SelectTrigger`
(`data-[placeholder]:text-placeholder`, karena Radix menandai trigger kosong
dengan atribut `data-placeholder`), dan `CommandInput`. Jangan menyalinnya
ad-hoc per halaman.
- Pengecualian yang disadari: field pencarian di header gelap
(`Header.tsx`) memakai `placeholder:text-white/45` karena permukaannya
`bg-white/10` di atas header navy (≈3,3:1 terhadap permukaan field-nya).
- Batasan: ≈3,6:1 masih di bawah 4,5:1 (SC 1.4.3) bila placeholder dianggap
teks esensial. Di repo ini setiap field punya `Label` nyata, jadi placeholder
tidak pernah menjadi satu-satunya sumber informasi; angka ini adalah
kompromi yang disetujui pemilik produk, bukan nilai acak.
- Select native (`<select>` biasa) tidak ikut berubah lewat token ini:
Chromium mewarisi warna teks `select` ke seluruh item popup, sehingga
memberi `text-placeholder` pada elemennya ikut memucatkan daftar pilihan yang
sudah terisi. Gunakan `Select` dari `packages/ui` untuk prompt wilayah.
- Status migrasi prompt wilayah: dialog **“Alamat baru” di checkout**
(`DeliveryQuotePanel`) sudah memakai `Select` shared — tone placeholder, titik
`bg-field`, dan status wajib lewat `aria-required` + `aria-labelledby` pada
trigger. Yang **masih native**: `BranchForm` admin (`/admin/branches/[id]/edit`),
karena opsi kosong “Pilih wilayah” di sana berfungsi sebagai **reset wilayah**
yang belum punya padanan di `Select`; migrasinya menunggu keputusan produk
(item reset eksplisit vs menghapus kemampuan reset).

Kontrak ini dikunci E2E: `e2e/store/form-field-contrast-mock.spec.ts`
(store + admin) dan assertion tone di `e2e/store/addresses-mock.spec.ts`
(prompt `Input` dan `SelectTrigger` di dialog alamat), memakai helper
`e2e/support/contrast.ts`.

## 5. State terkunci (readOnly)

Field yang nilainya diturunkan dari tempat lain (mis. Kode Pos dari
Kelurahan/Area) memakai `ReadOnlyInput`:

```tsx
<Label htmlFor="postalCode">Kode Pos</Label>
<ReadOnlyInput id="postalCode" value={postalCode} hint="Terisi otomatis dari Kelurahan/Area." />
```

Yang diberikan komponen ini:

- `readonly` pada elemen (nilai tetap terkirim, teks bisa diseleksi),
- tone `bg-muted` + `text-muted-foreground` + `cursor-default`,
- ikon kunci `aria-hidden` (cue non-warna, bukan color-only),
- hint singkat via `aria-describedby`.

Catatan implementasi: tone `readOnly` dipicu oleh **prop** `readOnly`, bukan
variant `read-only:` dari Tailwind. Alasannya, `:read-only` juga cocok untuk
`input[type=file]`, `radio`, dan `checkbox` (semua elemen yang bukan
`:read-write`), sehingga akan salah mewarnai kontrol lain. Lihat
Context7 `/websites/v3_tailwindcss` — *Hover, focus, and other states →
read-only*.

## 6. Penanda field wajib

Field wajib memakai prop `required` pada `Label` shared
(`packages/ui/src/components/ui/label.tsx`), yang merender bintang `*`
sebagai teks `aria-hidden`:

```tsx
<Label htmlFor="checkout-recipient" required>Nama Penerima</Label>
<Input id="checkout-recipient" required … />
```

- **Kontrak wajib tetap milik kontrolnya**, bukan bintang: input memakai
  atribut `required`, kontrol Radix (mis. `SelectTrigger`) memakai
  `aria-required="true"`. Bintang hanya penanda visual, jadi pembaca layar
  melafalkan "Nama Penerima, wajib" tanpa ikut membaca "bintang".
- **Warna bintang mengikuti warna label**, bukan `--destructive`.
  `--destructive` light hanya ≈3,8:1 di atas `--card`/`--background`, di bawah
  4,5:1 untuk teks 14 px (SC 1.4.3), sementara warna label ≈16:1.
- **Bintang butuh legenda tertulis** `* Wajib diisi` di dekat judul form atau
  modal, supaya artinya tidak bergantung pada konvensi simbol.
- **Field yang tidak wajib tidak diberi bintang** dan tidak diberi label
  "(opsional)" — termasuk checkbox opsional dan field turunan seperti Kode Pos
  (`ReadOnlyInput`, lihat §5) yang sudah menyatakan sumber nilainya sendiri.
- Konsekuensi pengujian: label kini berakhir dengan `*`, jadi Playwright
  `getByLabel` memakai pencocokan substring, bukan `{ exact: true }`. Nama
  aksesibel tetap bersih (`getByRole(..., { name })`).

Diterapkan di dialog **Alamat baru** pada checkout
(`DeliveryQuotePanel`) dan form alamat di `/account/addresses`; dikunci
`e2e/store/delivery-quote-mock.spec.ts` dan
`e2e/store/addresses-mock.spec.ts`.

## 7. Dark mode

Blok `.dark` di `globals.css` sudah berisi nilai lengkap, tetapi **belum ada
mekanisme aktivasi** (tidak ada `ThemeProvider`, tidak ada toggle, `darkMode:
"class"` hanya belum terpakai). Nilai dark `--field`/`--input` tetap dijaga
konsisten agar tidak menjadi jebakan saat dark mode diaktifkan nanti.

## 8. Checklist sebelum menambah warna

1. Apakah token semantik yang ada sudah cukup? (`background`, `card`, `muted`,
   `field`, `placeholder`, `border`, `input`, `primary`, `secondary`, `accent`,
   `destructive`).
2. Kalau perlu token baru: tambahkan di **kedua** `globals.css`, petakan di
   **kedua** `tailwind.config.ts`, lalu `diff` kedua app.
3. Periksa token gabungan pada background sebenarnya (mis. `bg-muted` di atas
   `bg-card`), bukan hanya nilai HSL-nya.
4. Perubahan token menyentuh `packages/ui`, jadi periksa store **dan** admin.
5. Kalau perubahan menyentuh tone kontrol form, perbarui/kunci kontraknya di
   spec mock terkait dan jalankan lewat `playwright.mock.config.ts`.
