# 05 — Excel dan linked retry subset gagal

Label: ready-for-agent
Type: task
Status: open
Assignee: none
Blocked by: 04
Parent: [Map implementasi diskon](../map.md)
Spec: [Complete spec](../../../plan/discounts-spec.md)
Acceptance IDs: M03, X01, X02, X03, X04, X05, X06, A01, A04, D02

## Perilaku yang dibangun

Admin mengunduh template/export SKU, mengunggah workbook berversi, mereview accepted/error rows, menerapkan baris valid melalui bounded pipeline04, lalu mengunduh laporan/subset gagal dan mengunggah koreksinya sebagai linked batch baru. Kesalahan tidak disamarkan sebagai keberhasilan seluruh file.

## Acceptance criteria

- [ ] Template `.xlsx` satu sheet Harga, A1 marker OKCIR_MARKDOWN_V1, row2 headers resmi dan data row3. SKU text exact, action set_price/restore_base, numeric integer new_price; reference columns resmi tidak menjadi authority.
- [ ] set_price wajib target positif/di bawah base terbaru saat apply; restore wajib harga kosong. Blank price bukan restore. Baris blank seluruhnya diabaikan, partly-filled tanpa SKU error. Text nominal/formula/fraction/invalid action gagal row.
- [ ] Semua rows SKU duplikat gagal; SKU unknown/error lain tidak menghalangi baris valid. Formula tidak dievaluasi, termasuk reference cells/cached values.
- [ ] Rusak/container/signature/unsupported marker/header/sheet tambahan/macro/encrypted/external relationship/ZIP path traversal atau entries invalid menolak file sebelum price writes. Content validation tidak mengandalkan extension/MIME saja.
- [ ] Bounds current config1000 nonblank rows/5MiB compressed/25MiB expanded serta limits ZIP entries/cells/text dari spec ditegakkan selama parsing, bukan sesudah unbounded allocation. Tepat batas diterima bila valid; berlebih ditolak tanpa live changes. Library dipilih setelah verifikasi docs/security terkini, bukan asumsi API.
- [ ] Upload hanya staging. Baris valid memakai review/latest-data/apply/permissions04. Contoh100 input97 applied/3 failed memberi partial report dengan row number/SKU/action/target/status/reason yang tepat, bukan100 sukses.
- [ ] Report/failed subset `.xlsx` dibentuk dari bounded durable row records, text literal tidak menjadi formula. Workbook asli tidak diarsipkan; temporary resources dibersihkan pada success/error/disconnect.
- [ ] Failed subset dapat diperbaiki dan diupload menjadi batch baru yang linked origin row/batch valid, key baru, preview dan apply lagi.97 sukses tidak diulang. Replay upload/apply key yang sama tidak membuat hasil ganda; correction berbeda key lama ditolak.
- [ ] Putus setelah60 committed/37 pending/3 failed: resume batch sama hanya37 pending;3 final errors memerlukan linked correction, bukan reopen final rows.
- [ ] Download/export/template/history juga current grants price-view+product-view-all; mutation price-edit; tidak bocor via direct API. Schema/seed/audit/logs/feature/API/testing docs diperbarui.

## Verifikasi

B browser+actual HTTP/PG untuk upload→preview→apply→partial→report→retry. Independent workbook fixtures untuk valid/fatal/formula/unknown/duplicates/bounds/unsafe export. T untuk linked retry/replay/partial crash dan policy changes; H untuk resource bounds dan all failure no-price-write. Pakai controlled fixture clocks, bukan live provider. Sukses mock workbook bukan benchmark1000 rows atau klaim parser aman tanpa adversarial cases.

## Batas dan penyelesaian

Baca [kontrak bersama](../map.md#kontrak-bersama-untuk-semua-ticket). Tidak ada background worker, archive storage/volume baru atau implicit production config change. Main agent menguji dan mereview setelah execution berizin, lalu merekam evidence di Answer sebelum resolved.
