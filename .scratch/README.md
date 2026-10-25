# Artefak development per fitur

Semua dokumen kerja dari `development-workflow` dan skill terkait disimpan di
`.scratch/<feature>/`. Dokumentasi permanen tetap di `docs/`; definisi skill
tetap di `.agents/skills/`. Aturan utama: [`AGENTS.md`](../AGENTS.md).

## Struktur dan tujuan

```text
.scratch/
  README.md                  # panduan, bukan register status global
  templates/plan.md          # template bersama
  discounts/
    index.md                 # navigasi dan status plan fitur ini saja
    research/                # research, protokol, evidence pendukung
    plan/                    # proposal, spec, plan; termasuk yang Done
    wayfinder/               # map, decision tickets, wireframe, keputusan
    ticket/                  # implementation map, tickets, handoff, verification
    prototype/               # opsional, referensi prototype
```

Buat subfolder hanya saat diperlukan. Tidak ada `.scratch/index.md` atau
register status lintas fitur: fitur di branch berbeda tidak perlu mengubah
file status yang sama. Daftar fitur dapat dilihat dengan `ls .scratch/`.

## Aturan generate dokumen

1. Periksa folder existing dan gunakan satu slug fitur kebab-case yang stabil.
   Misalnya diskon memakai `discounts`, bukan folder baru `discounts-implementation`.
2. Simpan Markdown sesuai tujuan di atas; gunakan nama deskriptif dan ticket
   `NN-<slug>.md`. Research JSON/evidence non-Markdown boleh berdampingan dengan
   catatan yang menjelaskannya. Jangan menyimpan token, secret, atau PII.
3. `research` menulis ke `research/`; `to-spec` ke `plan/`; `wayfinder` ke
   `wayfinder/`; `to-tickets` ke `ticket/`. Map masing-masing tahap bernama
   `map.md` di subfoldernya. Nomor decision ticket dan implementation ticket
   adalah namespace berbeda.
4. Buat/perbarui `index.md` fitur: tujuan, link artefak, satu baris per plan,
   approval, status, blocker, dan link bukti. Status ticket tetap hanya pada
   ticket; map/index cukup menautkan, bukan memelihara daftar status kedua.
5. Gunakan relative Markdown links yang benar dari lokasi file. Untuk instruksi
   command/handoff, tulis path lengkap dari root repo. Evidence lintas fitur
   ditautkan ke pemiliknya, tidak disalin.
6. Tulis dokumen baru dalam bahasa Indonesia; pertahankan identifier, istilah
   teknis, dan metadata tracker. `AGENTS.md` tetap berbahasa Inggris.
7. Ikuti gates [`development-workflow`](../.agents/skills/development-workflow/SKILL.md):
   kesepahaman sebelum draft nontrivial, approval complete spec sebelum Ready,
   dan approval breakdown sebelum publikasi tickets. Folder atau template
   bukan izin implementasi, subagent, commit, remote, maupun provider writes.

Contoh: riset diskon disimpan sebagai `discounts/research/provider-mapping.md`,
spec sebagai `discounts/plan/discounts-spec.md`, keputusan sebagai
`discounts/wayfinder/01-money-basis.md`, dan implementation ticket sebagai
`discounts/ticket/01-versioned-checkout-money.md`.

## Lifecycle plan

Status keseluruhan **setiap plan** hanya ada di `.scratch/<feature>/index.md`;
file plan boleh mencatat status per slice. Satu fitur dapat mempunyai beberapa
plan dengan approval dan blocker yang berbeda. Jangan meratakan statusnya.

| Status | Syarat |
|---|---|
| Draft | Draft atau menunggu approval; belum boleh dipilih loop. |
| Ready | Complete scope dan acceptance/verification disetujui user secara eksplisit; approval dicatat di plan. |
| In Progress | Implementasi scope yang disetujui sudah dimulai. |
| Done | Semua acceptance diverifikasi, bukti dicatat, enduring content dirangkum ke `docs/`, index mencatat tanggal dan outcome. |

**Done bukan penghapusan:** simpan file plan, research, keputusan, tickets,
dan evidence agar riwayat tetap bisa dibaca langsung. Tidak perlu memindahkan
plan Done ke folder archive lain. Draft/superseded tidak boleh dianggap approved.
Perubahan scope/perilaku memerlukan keputusan user baru. Main agent memiliki
bookkeeping dan verifikasi; hasil subagent bukan approval.

Untuk pekerjaan kecil satu sesi, scope percakapan yang jelas sudah cukup;
jangan membuat plan/ticket seremonial. Jika perlu catatan kerja, tetap gunakan
folder fitur. `tasks.md` existing bukan pengganti status plan atau tempat baru
untuk research/spec/ticket.

## Migrasi dokumen lama

Artefak dari `plan/`, `plan/research/`, `.agents/plan.md`, plan/handoff RBAC lama,
dan folder `.scratch/*-implementation/` telah digabung per fitur. Research
workflow yang dahulu berada di `docs/` juga ditempatkan di `research/` fitur
terkait; ADR, referensi arsitektur, dan dokumentasi fitur permanen tetap di `docs/`.

Status dan catatan verifikasi existing dipertahankan, **bukan hasil test baru**.
Plan Done yang sudah dihapus sebelum kebijakan ini tidak direkonstruksi; index
fiturnya menyimpan outcome lama dan link docs. Plan legacy tanpa status final
terverifikasi diberi catatan perlu rekonsiliasi, bukan ditebak Done/Ready.
Referensi artefak yang sudah tidak ada sebelum migrasi tidak dibuat-buat ulang.
