# Plan: <judul>

> Salin ke `.scratch/<feature>/plan/<slug>.md`; sesuaikan link dari lokasi tujuan.
> Status plan secara keseluruhan hanya dicatat di `../index.md` milik fitur —
> tidak pernah di file ini. File ini hanya mencatat **status per fitur** di bawah.

## Tujuan / Motivasi

<Mengapa plan ini ada; masalah yang diselesaikan; tautan ke docs terkait.>

## Scope

<Apa yang termasuk dalam plan ini; tulis acceptance criteria yang dapat diamati.>

## Approval

- Kesepahaman bersama dikonfirmasi user: <tautan ke percakapan/decision record; pending sampai dikonfirmasi>
- Complete scope dan acceptance/verify criteria disetujui user: <tautan approval; pending sampai disetujui>

Jangan menandai plan atau fitur ini `Ready` selama approval masih pending atau
masih ada keputusan yang memengaruhi perilaku. Approval plan tidak menyetujui
subagent, commit, remote access, atau deployment.

## Non-scope

<Secara eksplisit di luar scope; kemungkinan follow-up.>

## Rancangan teknis

> Checklist advisory: isi bagian yang relevan, dan catat sisanya sebagai open
> item. Untuk perubahan kecil satu sesi, cukup 4–6 baris (file yang disentuh +
> state UI terkait). Jangan menebak path saat implementasi.

| Path | Aksi | Tanggung jawab (1–3 baris) | Layer | Seam test |
|---|---|---|---|---|
| `apps/<app>/src/app/api/<fitur>/route.ts` | modify | <kontrak HTTP, validasi, pemetaan outcome> | route | `e2e/<app>/<fitur>-mock.spec.ts` |
| `apps/<app>/src/features/<domain>/<operasi>-service.ts` | create | <use case, invariant, urutan operasi> | service | `<operasi>-service.test.ts` |

Layer mengikuti [`docs/architecture/code-organization.md`](../../docs/architecture/code-organization.md):
`route.ts` / `-service.ts` / `-repository.ts` / `-client.ts` / komponen UI /
schema `packages/db/src/schema/`.

Kontrak export untuk file baru atau file yang kontraknya berubah (nama
fungsi/tipe + parameter, **tanpa body kode**):

- `<module>`: `<namaFungsi>(input: Input): Promise<Result>` — <satu baris perilaku>

Keputusan struktur yang non-obvious (modul/folder baru, pemecahan file, shared vs
app-local), beserta alasan dan alternatif yang ditolak:

- **Keputusan:** <...> · **Alasan:** <...> · **Ditolak:** <...>

Discovery — hal yang memang belum diketahui; jangan ditebak saat implementasi:

- `discovery:` <pertanyaan konkret dan siapa/apa yang menjawab>

## Rancangan UX

> Wajib diisi bila perubahan memengaruhi UI. Jika tidak, tulis
> `N/A — <alasan>`.

- **Tugas dan pengguna:** <siapa penggunanya, kondisi awal, hasil sukses>
- **Halaman/pattern referensi:** <halaman existing yang disepakati sebagai patokan konsistensi>
- **Hierarki dan primary action:** <informasi utama, aksi dominan, aksi sekunder>

Component reuse map:

| Elemen | Existing / Baru | Path komponen | Catatan |
|---|---|---|---|
| <elemen> | Existing | `packages/ui/src/components/ui/<komponen>` | <varian/props yang dipakai> |

State matrix — isi label/copy final, bukan placeholder:

| Layar / komponen | Idle | Loading | Empty | Error | Sukses | Disabled / tanpa izin | Unsaved |
|---|---|---|---|---|---|---|---|
| <layar> | <...> | <...> | <...> | <...> | <...> | <...> | <...> |

- **Viewport dan responsive:** <viewport sasaran dan perilaku di tiap ukuran>
- **Accessibility:** <keyboard/focus, label field, kontras yang harus diperiksa>
- **Prototype:** <path prototype bila user memintanya — mengikat untuk struktur
  layar, alur, penamaan tombol/aksi, dan state; token serta komponen existing
  tetap sumber kebenaran visual>

## Fitur

| # | Fitur | Status | verify: | Catatan |
|---|---|---|---|---|
| 1 | <nama fitur> | Draft | <command atau perilaku yang dapat diamati> | <dependensi, urutan> |
| 2 | | Draft | | |

Status per fitur (lifecycle sama dengan plan):
- **Draft** — fitur terdefinisi tetapi belum dikerjakan.
- **Ready** — fitur sudah terspesifikasi lengkap dalam scope plan yang disetujui
  user; siap diimplementasikan.
- **In Progress** — implementasi dimulai.
- **Done** — fitur terimplementasi, `verify:`-nya lulus (test sesuai `AGENTS.md`
  §5), dan docs-nya diperbarui.

## Implementation notes

<Urutan, dependensi, dan vertical slice yang dapat diverifikasi sendiri.
Ticket mewarisi Rancangan teknis/Rancangan UX di atas; subagent lane opsional dan
butuh izin user terpisah; jangan memberi satu checkout ke dua writer.>

Setiap implementation ticket dibuat dari [`ticket.md`](ticket.md) dan wajib memuat
irisan blueprint (tabel file, kontrak export, seam test), seam + test RED pertama,
serta batas keputusan untuk slice-nya. Deviasi dicatat di `Deviation log` pada
`## Answer` ticket, bukan dibiarkan implisit.

## Deviation log

| Ticket / slice | Rencana (path/kontrak) | Aktual | Alasan | Dampak |
|---|---|---|---|---|
| <...> | <...> | <...> | <...> | <...> |

Deviasi hanya boleh menyentuh nama/penempatan file selama konvensi layer dan
kontrak export tetap utuh. Perubahan perilaku, scope, atau modul baru di luar
rancangan tetap memerlukan keputusan user.

## Open questions

- <pertanyaan — resolusi; pertanyaan yang memengaruhi perilaku memblokir Ready>

## Retirement checklist (saat plan mencapai Done)

- [ ] Semua fitur lulus `verify:` (test sesuai `AGENTS.md` §5).
- [ ] Konten enduring diekstrak ke `docs/` sesuai aturan tujuan di
      `docs/README.md` (docs fitur diperbarui; entri `docs/api-reference.md`
      ditambahkan bila endpoint berubah; docs deployment bila relevan).
- [ ] File plan tetap disimpan di `plan/` bersama research, keputusan, dan evidence.
- [ ] Entri `../index.md` fitur diperbarui ke **Done** dengan tanggal +
      ringkasan hasil satu baris (divalidasi main agent; delegasi hanya bila
      diizinkan).
