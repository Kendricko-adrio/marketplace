# 12 — Pemakaian, privacy dan kapasitas

Label: ready-for-agent
Type: task
Status: open
Assignee: none
Blocked by: 09
Parent: [Map implementasi diskon](../map.md)
Spec: [Complete spec](../../../plan/discounts-spec.md)
Acceptance IDs: T02, T03, S01, S02, S03, S04, A01, A02, A03, A04, D01, D02, R01

## Perilaku yang dibangun

Admin menelusuri usage nyata dari order/Coupon/code, reserved versus consumed/released, global budget dan kapasitas, serta riwayat yang aman. Daftar/detail order mengikuti Orders grants/branch; summary global bukan alasan membuka customer/codes lintas akses. Capacity edits, pause dan review ambiguity mempertahankan safety transaksi07.

Baca usage generik/versioned; tidak bergantung percentage10/shipping11 untuk demonstrasi fixed-goods yang sudah berfungsi, tetapi mesti kompatibel dengan komponen benefit itu ketika13 mengintegrasikan semuanya.

## Acceptance criteria

- [ ] Offer detail menampilkan quota/budget consumed+held dan tersedia secara global. Contoh quota100/consumed90/held10 → available0; budget100000/consumed80000/held20000 → available0. Daftar scoped tidak diklaim sama dengan global totals.
- [ ] Promo viewer tanpa Orders:view hanya mendapat aggregate tanpa order/customer identities. Viewer Orders Jakarta hanya melihat entries/detail Jakarta; direct ID/API/export/cursor/count scope tidak membuka Bandung.
- [ ] Code literal masked pada list/usage/detail/history/export/general audit bagi non-editor; Audit:view saja bukan bypass. Editor berwenang tetap dapat menelusuri code ID/literal lewat protected interface, tanpa literal runtime logs.
- [ ] Capacity initial/increase/removal yang memperbesar memerlukan capacity grants+promo grants. Lowering di bawah consumed+reserved (quota/budget/per-account) ditolak; indexed commitments lookup di bawah Offer lock, tidak unbounded account locks.
- [ ] Publish/pause/policy edit bersamaan reserve/consume/release serial konsisten dan diaudit current versions. Perubahan role/session stale tidak mengizinkan mutasi. Rename/revision/code/email change tidak reset usage.
- [ ] History menyajikan actual revision/policy/batch/code/action/actor/time dengan attribution aman sesudah FK actor null; stale mutation/receipt replay tidak menimpa live atau menggandakan audit.
- [ ] Paid-but-provider-blocked/ambiguous hold dan late-paid-review dapat ditelusuri melalui existing Orders ops workflow. Tidak ada tombol reset usage/force release/retry provider write/refund baru; komunikasi/penyelesaian khusus tetap manual.
- [ ] Pause Offer bermasalah hanya menghentikan new reservations; order held tetap snapshot. Tidak mass cancel/reprice/release paksa. Outcome uncertain tetap held/review, refund manual tidak sync/restore usage.
- [ ] Ownership/client→orders/Redemption/allocations/accepted requests/provider/shipment evidence retention constraints melindungi histori; catalog references tidak cascade hilang. Attempts hard-delete transaksi ditolak; archival config tidak membuka reuse literal.
- [ ] Targeted projection drift ditahan untuk review, tidak reset/rebuild online. UI dan HTTP mengungkap state benar tanpa klaim eventual analytics sebagai authority capacity.
- [ ] Real read/list pagination, filters, permissions, visual existing, schema/seed/logs/enduring docs dan tests ikut diperbarui. Retention bukan klaim compliance/erasure workflow baru.

## Verifikasi

T real PG capacity versus reserve/lifecycle races dan retention constraint seam; H read APIs/direct mutations/scoped counts/export/audit payload privacy; B actual admin personas navigasi summary→scoped list→order/history dan safe pause. Assert melalui documented read interfaces, bukan private counters sebagai side channel; SQL hanya untuk schema constraints/setup. Carry actual lifecycle07 tests, bukan menggantinya dengan mocked usage counters.

## Batas dan penyelesaian

Baca [kontrak bersama](../map.md#kontrak-bersama-untuk-semua-ticket). Ini melengkapi ops read/capacity experience, bukan menunda safety dasar07. Staging sign-off/production activation ada di13 dengan izin tersendiri. Tidak ada fee/Rp0 proof/subagent/provider request/commit/deploy otomatis. Main agent merekam review/verification di Answer sebelum resolved.
