# 13 — Integrasi dan kesiapan rilis

Label: ready-for-agent
Type: task
Status: open
Assignee: none
Blocked by: 05, 10, 11, 12
Parent: [Map implementasi diskon](../map.md)
Spec: [Complete spec](../../../plan/discounts-spec.md)
Acceptance IDs: M01, M02, M03, X01, X02, X03, X04, X05, X06, C01, C02, C03, C04, C05, C06, C07, F01, F02, F03, T01, T02, T03, T04, T05, T06, P01, P02, P03, S01, S02, S03, S04, A01, A02, A03, A04, D01, D02, D03, R01

## Perilaku yang dibangun

Mengintegrasikan slice yang sudah teruji menjadi satu fitur yang siap direview untuk rilis: seluruh benefit/activation channels, Markdown/Excel, customer selection/reservation/provider, admin privacy/ops dan versioned cutover konsisten. Pemilik/tester memperoleh evidence register, rehearsal dan checklist/sign-off staging yang jujur, bukan klaim mock-only green berarti production aktif.

Ini gate integrasi/operasional setelah slices menghasilkan perilaku nyata, **bukan tempat pertama** membangun seluruh tests, logging, schema/seed atau safety. Deploy/remote/provider writes/launch dan UAT yang memerlukan lingkungan berizin tetap keputusan terpisah.

## Acceptance criteria

- [ ] Semua40 IDs spec §12.2 memiliki evidence traceable sesuai seam L/T/H/B/P/D dan coverage detail proposal. Distinguish pass/fail/blocked/skipped; infrastructure skips bukan pass dan report subagent bukan acceptance.
- [ ] Cross-slice public/manual × fixed/percentage/shipping, Markdown+masing-masing Offer, qty>1/multi-line, optional caps, pickup/delivery, invalidation/confirmation/replay dan permissions berjalan konsisten. Manual+percentage terverifikasi sesudah09+10, bukan dianggap selesai karena evaluator sama.
- [ ] Provider create→mirror→invoice→payment→post-invoice mirror dan reconciliation memakai expected snapshot/version/IDs/whole-line discounts/original/net shipping yang benar. External controlled tests membuktikan application integration; evidence08/T1–T3/M1M2 hanya pada envelope existing. Tidak menguji ulang real provider tanpa izin spesifik baru.
- [ ] End-to-end failure/race regression mencakup last quota/budget/account slot, price/source edits, publish/pause/limit changes, same-key crash/response loss, duplicate/out-of-order callbacks/sweep, ambiguous provider and late paid; safety sudah ada di slice asal dan tidak diturunkan di integration.
- [ ] Full serial unit, isolated mock Playwright, affected lint/typechecks/build/schema checks dan required regression evidence tercatat. Standard E2E yang dapat menulis provider tidak dijalankan tanpa otorisasi; jika belum aman/berizin, laporkan gate blocked dan jangan menyebut seluruh suites lulus.
- [ ] Generated SQL, FK ownership/retention/indexes dan migration/seed rehearsal diuji pada disposable DB; shared schema/timestamptz dan FK-ordered cleanup benar. Demo fixtures lengkap, mode Jubelio tanpa dummy transactional data, production seed tetap forbidden. Tidak menghapus/edit generated SQL manual.
- [ ] Preflight tidak menemukan usage legacy nyata yang diabaikan; jika ditemukan, hentikan cutover terkait dan minta keputusan. Tidak fabrikasi opening balances/backfill personal/dual-write atau reset data nyata.
- [ ] Writer gate default0, explicit config import, paired store/admin/sweep/mirror/sync compatible readers/writers dan unknown-version fail-closed teruji. Legacy voucher route/consumers diputus sesuai approved cutover, bukan fallback ke subtotal browser authority.
- [ ] Rollout/rollback rehearsal membuktikan snapshot/evidence terjaga. Sesudah new-version orders ada, aplikasi incompatible tidak dijalankan untuk memprosesnya; pause new writes dan compatible recovery/forward fix. Restore lokal bukan rollback writes provider.
- [ ] Deployment common/staging/production dan enduring feature/API/DB/RBAC/PPN/delivery/testing/config/rollback docs sesuai perubahan aktual. Trusted IP dan request/parser limits diverifikasi terhadap runtime/proxy, bukan sekadar unit fixture.
- [ ] UAT staging pemilik/tester mencatat functional/visual admin-existing, no service fee, nominal/payment/provider/quote breakdown, privacy, partial Excel dan safe pause outcomes. Sign-off/blocked environment/izin direkam; tidak mengarang hasil UAT.
- [ ] Rilis publik hanya setelah acceptance/gates/sign-off dan izin operasi terpisah; tanpa internal-production cohort tambahan. Pause satu Offer menahan pemakaian baru saja; snapshots/holds lama tetap. Tidak ada mass cancel/reprice/forced usage release.
- [ ] Tidak ada requirement pembayaran/provider Rp0, fee baru, cleanup sandbox lama sebagai launch blocker, refund tooling atau scope baru yang disisipkan.

## Verifikasi dan external gates

Main agent mengintegrasikan perubahan, mereview terhadap complete spec dan repo standards, lalu menjalankan command plan spec §12.3 pada environment yang sesuai. Seluruh tests fitur seharusnya sudah datang bersama slices; tambah tests hanya untuk gap/cross-slice regression konkret, satu TDD cycle per perilaku.

Register evidence mencatat commands/environment/ref/IDs/result/artifacts/scope serta sign-off owner. Saat Playwright gagal baca Markdown/trace context, bukan PNG. Rehearsal lokal disposable tidak memberi izin SSH/Docker remote, reset data nyata, credential/login provider atau staging mutation.

Jika UAT staging, required standard suite, deployment rehearsal target atau approval operasi belum tersedia, jangan resolve seolah R01/D02/full gates selesai. Catat blocker eksternal secara eksplisit dan minta langkah/izin spesifik. Ticket ini tidak memaksa deployment/launch hanya agar bisa ditutup.

## Completion

Baca [kontrak bersama](../map.md#kontrak-bersama-untuk-semua-ticket). Setelah seluruh acceptance wajib dan gates dipenuhi, main agent menyelaraskan status task/features/plan, mengekstrak enduring docs dan melakukan retirement plan sesuai approved checklist. Tidak menghapus Wayfinder/evidence scratch, commit/push atau menjalankan deploy otomatis. Answer harus memisahkan implemented/tested/UAT/launchable/actually activated.
