# 08 — Penggantian dan gugurnya promo

Label: ready-for-agent
Type: task
Status: open
Assignee: none
Blocked by: 07
Parent: [Map implementasi diskon](../map.md)
Spec: [Complete spec](../../../plan/discounts-spec.md)
Acceptance IDs: C02, C04, T04, T06

## Perilaku yang dibangun

Customer mengganti Coupon publik yang dipilih dengan persetujuan harga yang benar. Jika total naik, ia harus mengonfirmasi; jika sama/turun, pilihan langsung berganti. Jika promo lama gugur, ia memilih ulang atau secara eksplisit melanjutkan tanpa promo. Tidak ada silent stacking/auto-apply atau kenaikan tagihan diam-diam.

Bangun pada fixed-public07; interface pilihan/acknowledgement harus dapat dipakai manual09, percentage10 dan shipping11 tanpa state machine kedua.

## Acceptance criteria

- [ ] Dua Coupon valid: mengganti benefit20000→10000 pada context sama membuat total final naik dan membuka dialog old/new/delta; batal mempertahankan pilihan/total lama. Yang dibandingkan final termasuk PPN/ongkir, bukan nominal benefit saja.
- [ ] Penggantian total sama/turun langsung mengganti melalui Pilih/Terapkan dan memperbarui breakdown tanpa dialog kenaikan tambahan. Tidak menciptakan reservation dari preview atau slot kedua.
- [ ] Context/review tokens dan candidate fingerprints mengikat previous/candidate/current state. Required increase acknowledgement/continue-without acknowledgment terikat candidate, bukan boolean confirmed bebas atau token akun lain.
- [ ] Minimum gugur sesudah cart berubah atau current Offer pause/expired/capacity tidak tersedia → alasan jelas; customer memilih Offer lain atau Lanjut tanpa promo eksplisit dengan total baru. Invalid benefit tidak dipertahankan.
- [ ] Percobaan candidate publik unavailable tidak mengganti old selection yang masih valid. Jika old juga invalid, tampilkan invalidation state, bukan mempertahankan diskon palsu. Kasus invalid manual code ditambahkan09.
- [ ] Place order menolak stale/invalid/unacknowledged review sebelum order/usage/stock commit. Jika quota habis saat commit, tetap409 tanpa partial order atau otomatis no-promo order; preview ulang tidak menghapus result accepted request yang sudah ada.
- [ ] Perubahan fulfillment/context membatalkan relevant approval; shipping→pickup spesifik ditambahkan11. Reprice delivery existing tetap meminta reapproval komponen walau total turun; aturan swap dialog hanya ketika final naik.
- [ ] UI keyboard/focus/loading/error sesuai existing theme; network failure tidak menampilkan applied state palsu. Code/PII/tokens tidak masuk logs, docs/HTTP contracts diperbarui.

## Verifikasi

L independent old/new total examples dengan PPN; H/B real preview→candidate→confirm/cancel→place dan changed cart/clock/Offer fixtures. T regression accepted request/replay+reservation07 memastikan no new hold di preview/cancel dan no ghost order pada failed review. UI response bukan stubbed checkout authority.

## Batas dan penyelesaian

Baca [kontrak bersama](../map.md#kontrak-bersama-untuk-semua-ticket). Tidak menambah prior claim, best-promo auto-choice, extra slot atau persistent customer coupon wallet. Tidak ada izin implementasi/provider writes/subagents/commit/deploy dari ticket. Main agent melakukan validasi dan mencatat Answer sebelum resolved.
