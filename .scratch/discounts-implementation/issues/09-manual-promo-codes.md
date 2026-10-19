# 09 — Manual Promo Code dalam slot bersama

Label: ready-for-agent
Type: task
Status: open
Assignee: none
Blocked by: 08
Parent: [Map implementasi diskon](../map.md)
Spec: [Complete spec](../../../plan/discounts-spec.md)
Acceptance IDs: C01, C02, C03, C05, C07, T02, A01, A03, A04, D01, D02

## Perilaku yang dibangun

Admin membuat Offer manual-only dan mengelola kode-kodenya. Customer memasukkan kode untuk memakai benefit fixed-goods melalui slot yang sama dengan Coupon publik. Kode baru invalid tidak merusak pilihan lama; pergantian kode tidak mereset usage atau memperbesar kapasitas. Viewer tidak menerima literal kode lewat saluran alternatif.

Re-use fixed benefit/reservation07 dan selection/review08; jangan membuat engine atau counters khusus per code.

## Acceptance criteria

- [ ] Public/manual-only adalah activation kind identity tetap; public tidak punya code. Manual code tidak muncul di available public picker. Perubahan activation membutuhkan identitas Offer baru, bukan revision bypass.
- [ ] Normalize trim+uppercase, ASCII3–64 alphanumeric awal dan alphanumeric/underscore/hyphen berikutnya, exact canonical uniqueness. Input ` hemat17agustus ` → HEMAT17AGUSTUS; internal spaces/Unicode alias invalid. Unknown/nonaktif/expired memberi alasan aman tanpa code discovery.
- [ ] Published code literal/owner immutable dan reserved selamanya; replacement membuat record baru di Offer sama. Kode inactive/archived tidak dapat dialihkan ke Offer lain. Draft code proposals baru direservasi ketika publish/add berhasil, bukan saat mengetik draft.
- [ ] Semua kode Offer berbagi quota/budget/per-account history. Rename/revision/kode baru/email change tidak mereset usage; no code binding/subquota/expiry terpisah.
- [ ] Customer verified store email memakai manual code sampai order/paid/release melalui transaksi/lifecycle07. Tepat satu Redemption dan source code yang benar disimpan; tidak ada slot tambahan setelah public Coupon.
- [ ] Code invalid/kehabisan capacity mempertahankan old valid selection dan total. Candidate valid total naik memakai confirmation08; same/lower direct replace. Jika old sendiri gugur, jalur invalidation/explicit continue-without tetap berlaku.
- [ ] Account/IP manual-code limits20/120 per60detik diterapkan pada seluruh HTTP paths yang membawa code, termasuk invalid shape setelah admission; shared IP bukan entitlement. Lintas proses, forged header, Retry-After/503 unavailable teruji. No per-keystroke calls atau literal dalam URL/log.
- [ ] Viewer masked di list/detail/API/export/history/audit; hanya promo editor mendapat literal lengkap di protected interface. Audit grant sendiri tidak membuka kode. Store order hanya mengungkap kode milik order customer itu, bukan semua codes Offer.
- [ ] Create/add/state receipts/version guards/current policy menjamin lost response tidak menggandakan code/audit atau menimpa edit stale. Code ownership/cardinality constraints dan retention berlaku.
- [ ] Schema/canonical indexes/seed/role/UI/logs/API/privacy docs dan Playwright coverage diperbarui; writer gate operasional tetap0.

## Verifikasi

L/H canonical boundary/length/charset; T real PG duplicate publish/add-code, owner immutability, replay, shared last quota dan code-change no reset. B admin code creation/state/masked viewer dan store apply→swap invalid/valid→order/detail. Inspect actual response bodies untuk absence literal di viewer channels, bukan hanya teks layar tersembunyi. H rate windows/trusted IP dengan controlled time, no real provider requests.

## Batas dan penyelesaian

Percentage adalah benefit terpisah10; tidak menjadikan09 prerequisite10 hanya karena keduanya berbagi module. Cross manual+percentage diverifikasi13 setelah integrasi. Baca [kontrak bersama](../map.md#kontrak-bersama-untuk-semua-ticket); no service fee/Rp0 proof, execution/provider writes/delegasi/commit/deploy tetap perlu izin. Main agent mencatat review/evidence di Answer sebelum resolved.
