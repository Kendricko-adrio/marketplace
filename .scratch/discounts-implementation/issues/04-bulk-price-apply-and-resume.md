# 04 — Bulk harga dengan hasil dan resume akurat

Label: ready-for-agent
Type: task
Status: open
Assignee: none
Blocked by: 03
Parent: [Map implementasi diskon](../map.md)
Spec: [Complete spec](../../../plan/discounts-spec.md)
Acceptance IDs: M03, X01, X03, X04, X05, X06, A01, A04, D02

## Perilaku yang dibangun

Admin memilih SKU lintas halaman, mereview fixed target/restore dan menerapkan perubahan harga secara bertahap. Ia dapat membaca hasil yang akurat dan melanjutkan request terputus tanpa mengulang row final. Ini bulk UI end-to-end, bukan parser Excel yang baru diperkenalkan05.

## Acceptance criteria

- [ ] Hanya SKU dicentang diproses; selection retained lintas halaman, tidak otomatis seluruh hasil filter. Limit1000 SKU dari current config ditegakkan server.
- [ ] Shortcut persen dihitung dari source Base Price lalu dibekukan fixed target dengan nearest/half-up. Base300000/current150000/diskon20% → target240000, review menyebut kenaikan90000; target85% source100001 →85001.
- [ ] Stage/review tidak mengubah live prices. Preview menunjukkan selected count/SKU/variant/base/current/target/dampak/error dan restore consequence.
- [ ] Apply maksimum25 rows atau budget5detik/request, timeout transaksi/lock/statement tidak melewati remaining budget. Tiap row commit sendiri, tidak satu transaksi1000 SKU atau background worker. Row yang belum pasti dibaca durable result-nya, timeout HTTP bukan bukti rollback.
- [ ] Source/Markdown terbaru dipakai saat row apply; target tetap valid diterapkan tanpa mandatory re-review, invalid gagal row, restore melepas latest. Actual before-after/audit dan status row committed bersama.
- [ ] Concurrent apply/resume tidak menggandakan revision/audit/result; request key sama+payload berbeda409. Pending boleh dilanjutkan, final applied/unchanged/failed tidak diulang.
- [ ] Counts applied/unchanged/failed/pending jujur; no-op bukan perubahan fiktif. Batch belum final selama pending; final state mengikuti spec. Contoh60 committed/37 pending/3 failed tidak disebut sukses100; resume hanya37.
- [ ] Izin diperiksa per write row dengan serialized current policy. Revoke menghentikan write berikut dan mencatat halt reason; tidak rollback committed atau membocorkan hasil kepada viewer tanpa grant.
- [ ] Data report/read/history cukup untuk05 membentuk workbook/failed subset tanpa arsip file asli. Config limit invalid fail closed; perubahan limit tidak menghapus hasil committed, pending batch oversized ditahan sesuai spec.
- [ ] Price grants, ownership/retention, schema/seed, structured logs, admin visual existing dan feature/API docs tetap sesuai kontrak.

## Verifikasi

T real PG melalui apply/read/history untuk race resume, source edits, no-op, policy revoke dan row rollback. B real UI untuk selection lintas halaman, kenaikan target, partial/pending/resume dan truthful messages. L untuk half-up literals, H untuk bounds/denials/request replay. Parser Excel/fatal file acceptance belum diklaim selesai oleh04.

## Batas dan penyelesaian

Baca [kontrak bersama](../map.md#kontrak-bersama-untuk-semua-ticket). Tidak ada background job, batch atomik penuh, provider writes baru atau implementasi tanpa izin. Tests/docs slice ini wajib sebelum resolved; main agent mencatat Answer dan tidak menganggap limits sebagai SLA terukur.
