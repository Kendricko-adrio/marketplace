# Ukur status mentah SO Internal dan pembanding UI

Parent: [Cermin status website di Status Channel SO pickup Internal](../map.md)
Type: task
Status: answered (raw GET; UI mapping still unverified)
Blocked by: none

## Question

Pada akun yang menampilkan kolom **Status Jubelio** sebagai `UNKNOWN`, apa nilai mentah yang relevan (`is_paid`, `wms_status`, `internal_status`, dan field terkait) untuk SO contoh serta SO `INTERNAL` pembanding yang belum dibayar dan sudah dibayar? Apakah perbedaan terjadi pada data SO atau pada tampilan/list UI vendor?

GET read-only ke Jubelio boleh dilakukan saat riset tanpa keputusan tambahan dari pemilik. Jangan minta token di chat atau menyimpan respons mentah/PII. Jika perlu `POST /login` untuk token, atau POST lain/perubahan data Jubelio, minta izin eksplisit pemilik untuk tindakan tersebut terlebih dahulu; POST tidak dilarang secara mutlak. Ikuti allowlist, perbedaan absent/null, serta batas pembanding pada [riset awal](../../../plan/research/jubelio-wms-status-unknown.md). Jika akses tidak tersedia, catat keterbatasan bukti dan jangan mengarang kesimpulan.

## Result (2026-09-26)

See [redacted GET results and controlled probe](../observations-2026-09-26.md). SO 68371/68373 are **SHOPEE**, not INTERNAL: `PAID`/`PENDING`, `is_paid=true`/`false` respectively. Existing and newly created INTERNAL SOs had `wms_status=UNKNOWN` and `is_paid=null`, even after independently verified invoice/payment on new test SOs. Filtered list agrees with GET detail on `wms_status`; the vendor UI column mapping is still unproven. Do not treat this answer as approval to implement a status write.
