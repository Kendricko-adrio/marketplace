# 06 — Admin Coupon publik nominal

Label: ready-for-agent
Type: task
Status: open
Assignee: none
Blocked by: 01
Parent: [Map implementasi diskon](../map.md)
Spec: [Complete spec](../../../plan/discounts-spec.md)
Acceptance IDs: C05, F03, T03, A01, A02, A04, D01, D02, D03

## Perilaku yang dibangun

Admin berwenang membuat Offer publik fixed-goods, menyimpan draft, melakukan simulasi nominal, melihat diff lalu publish/pause dengan batas pemakaian. Ini admin path lengkap yang bisa didemokan tanpa mengklaim customer redemption sudah aktif; penggunaannya ditambahkan07.

Bawa schema/revision/benefit/capacity/current grants/audit yang diperlukan fixed-public saja. Tidak membuat tabel targeting/reward atau engine kondisi generik. Reuse pricing/version baseline01 dan writer gate tetap default0 di environment operasional.

## Acceptance criteria

- [ ] Offer identity public tetap, tanpa code; satu benefit fixed-goods per published revision, nominal positif/minimum nonnegative/currency IDR. Unknown kind/version/shape invalid ditolak, bukan default menjadi fixed.
- [ ] Draft incomplete boleh disimpan tetapi belum launchable. Minimal kuota atau budget wajib pada live state, per-account default1/configurable positif. Tidak mengambil default quota100 dari voucher legacy.
- [ ] Draft tidak mengubah live terms. Review diff server-bound versions/fingerprint, publish eksplisit atomik dengan benefit/pointer/policy/code-free invariants/audit. Dua editor stale409 pada save/publish; reload/review, tanpa force-overwrite.
- [ ] Admin simulation melalui pricing interface, subtotal/nominal clipping dan PPN jelas, label simulasi/no hold/no quote promise. Subtotal150000/fixed17000 → net133000, PPN11%14630, pickup total147630.
- [ ] Start/end opsional, WIB input/server time authoritative, start inklusif/end eksklusif dan start<end. Min barang setelah Markdown (input pricing authoritative ketika dipakai07), tanpa first-order/targeting tambahan.
- [ ] Initial/increase/removal capacity yang memperbesar memerlukan promo+capacity grants; editor promo tanpa capacity grant boleh draft tetapi tidak men-setting capacity lewat publish bypass. Penurunan di bawah reserved+consumed ditolak.
- [ ] Catalog/SQL scope CHECK/guard/role matrix/default fresh HQ dan Admin mendukung discounts/discount_capacity sebagai global modules; custom existing grants tidak auto-upgrade. Ceiling/coverage/self-role/current-policy tetap berlaku, direct URL/API tidak bypass.
- [ ] Command request receipts memastikan create/publish/state/policy replay tidak menggandakan Offer/audit atau mengubah hasil sesudah response putus; actor attribution/key tetap walau FK actor null.
- [ ] Pause/archive tidak reset usage/identity, published terms immutable/retained, canonical state/ownership/benefit constraints teruji. Empty usage projections dibuat bersama Offer; customer reserve race nyata disambungkan07, bukan dimock sebagai proof final.
- [ ] Viewer/authorized draft access, logs tanpa secrets, feature/API/testing docs dan seed fixtures sesuai spec. Percentage/shipping/manual features belum didukung tidak diberi UI aktif/publish path palsu.

## Verifikasi

B admin draft→simulate→review→publish/pause dan grant personas. H strict input/versions/replay/permission. T real PG untuk publish/current pointer/one-benefit/capacity edit/receipt dan SQL constraint seam, termasuk draft belum capacity tidak publish. L literal simulation/invalid config, D seed/shared timestamp/unknown versions. Tidak membuat fake customer usage untuk menyebut T03 reserve race sudah terverifikasi; real reserve coverage07/12.

## Batas dan penyelesaian

Baca [kontrak bersama](../map.md#kontrak-bersama-untuk-semua-ticket). Belum ada redemption UI/provider writes; gate0 operasional tetap. Main agent menjalankan TDD/review/validation setelah izin eksekusi dan mencatat Answer sebelum resolved. Approval ticket tidak memberi izin implementasi, delegasi, commit atau deploy.
