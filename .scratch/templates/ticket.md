# <NN> — <judul singkat>

> Salin ke `.scratch/<feature>/ticket/NN-<slug>.md`; sesuaikan link dari lokasi
> tujuan. Status ticket hanya di file ini; status plan hanya di `../index.md`.
> Jangan menduplikasi status plan, dan jangan menaruh status ticket di map/index.
> Aturan layout: `.scratch/README.md`.

Label: ready-for-agent
Type: task
Status: open
Assignee: none
Blocked by: <none | NN, NN>
Parent: [Implementation map](map.md)
Spec: [<judul spec>](../plan/<slug>.md)
Acceptance IDs: <ID dari spec, bila ada>
Owner authorization: none

## Perilaku yang dibangun

<Perilaku end-to-end dari sudut pandang pengguna: apa yang bisa didemokan saat
ticket ini selesai. Bukan daftar layer, bukan ringkasan perubahan per file.>

**Demo path:** <langkah yang bisa ditunjukkan begitu ticket selesai.>

<Kalau demo path ini tidak bisa ditulis, ticket-nya horizontal dan harus dipotong
ulang sebelum dipublikasikan.>

## Acceptance criteria

- [ ] <kriteria yang dapat diamati> — gagal di commit awal karena: <observasi yang membuktikannya salah>

<Aturan: setiap kriteria wajib punya observasi yang membuatnya salah di commit
awal implementer. Kriteria yang sudah benar sebelum bekerja, atau yang hanya bisa
lulus karena pekerjaan ticket lain, bukan kriteria ticket ini.>

## Irisan blueprint

> Wajib bila ticket mengubah kode; bila tidak, tulis `N/A — <alasan>`.
> Tabel ini **irisan** dari blueprint yang sudah disetujui di spec/plan
> (`## Rancangan teknis` atau `## Implementation Decisions`), bukan tempat
> mendesain ulang. File atau modul di luar tabel adalah temuan review; modul,
> perilaku, atau state baru tetap butuh keputusan pemilik.

| Path | Aksi | Tanggung jawab (1–3 baris) | Layer | Seam test |
|---|---|---|---|---|
| `apps/<app>/src/...` | create / modify | <...> | `route.ts` / `-service.ts` / `-repository.ts` / `-client.ts` / komponen UI / `packages/db/src/schema/` | `<path test>` |

Kontrak export untuk file baru atau file yang kontraknya berubah (nama
fungsi/tipe + parameter, **tanpa body**):

- `<module>`: `<namaFungsi>(input: Input): Promise<Result>` — <satu baris perilaku>

`discovery:` <pertanyaan konkret untuk path yang memang belum diketahui, dan siapa/apa yang menjawabnya>

## Seam dan test pertama

- **Seam publik yang diuji:** <satu seam; bila lebih dari satu, tulis alasannya>
- **Test RED pertama:** `<path test>` — <perilaku yang gagal sebelum implementasi>
- **Prior art:** <test existing dengan pola serupa>

## Batas keputusan

> Keputusan yang sudah ditutup di grilling, wayfinder, atau spec. Ticket ini tidak
> boleh membukanya kembali. Bila implementasi membutuhkan perubahan, hentikan path
> itu dan minta keputusan pemilik — jangan memilih default sendiri.

- Jangan <larangan konkret, satu baris>.
- Jangan <larangan konkret, satu baris>.
- Rujukan otoritas: <link decision ticket / bagian spec yang mengikat>.

## Verifikasi

<Seam dan level yang berlaku untuk slice ini (L0–L3 sesuai `AGENTS.md` §5, atau
padanan L/T/H/B/P/D pada spec), environment yang dipakai, dan hal yang **tidak**
diklaim lulus.>

## Batas dan handoff

<Yang sengaja tidak termasuk di ticket ini, perilaku yang diserahkan ke ticket
lain beserta nomornya, dan izin yang belum diberikan.>

## Answer — <tanggal>

**Resolved oleh:** <main agent> sesudah <review terhadap acceptance dan standar repo>.

### Perubahan dan cakupan acceptance

- <perubahan, dipetakan ke acceptance ID yang dibuktikan>

### Deviation log

| Rencana (path / kontrak / spec §) | Aktual | Alasan | Dampak |
|---|---|---|---|
| <...> | <...> | <...> | <...> |

<Deviasi hanya boleh menyentuh nama atau penempatan file selama konvensi layer dan
kontrak export tetap utuh. Perubahan perilaku, modul baru, atau state/label di luar
blueprint adalah temuan review dan butuh keputusan pemilik: tulis di sini, jangan
dibiarkan implisit.>

### Evidence

| Gate | Hasil | Artifact |
|---|---|---|
| <command> | PASS / FAIL / BLOCKED | <path log atau ringkasan> |

### Batas bukti

<Yang tidak diklaim: provider live, staging, UAT, skenario yang di-skip, atau
acceptance yang masih menjadi milik ticket berikutnya.>
