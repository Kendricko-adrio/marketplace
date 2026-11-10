# Review langsung refactor place-order

Tanggal: **2026-11-10**. Scope: [spec yang disetujui](../plan/place-order-refactor.md).
Evidence command dan AC: [implementation-evidence.md](implementation-evidence.md).

## Metode dan fixed point

- Base tetap: `d64c14f04a1e4a4a199a5223c4955a961e92320d`.
- Review dilakukan **langsung oleh agent utama**, sesuai keputusan user menolak delegasi. Ini bukan independent/subagent review.
- Diff dibatasi file refactor: HTTP route, sembilan modul checkout baru, sembilan test baru, dokumentasi organisasi kode dan artefak fitur ini. Perubahan dirty worktree unrelated tidak diikutkan.
- Sumber Standards: `AGENTS.md`, `apps/store/AGENTS.md`, `docs/architecture/code-organization.md`, serta skills `maintainable-code`, `ux-design`, `tdd`, `development-workflow` dan smell baseline Fowler dari `code-review`.
- Untracked source/tests dibaca sebagai bagian perubahan, bukan diabaikan karena belum masuk `HEAD`. Final staged scope diperiksa sebelum commit dengan `git diff --cached --stat`, `git diff --cached --name-only`, dan `git diff --cached --check`.

## Standards

**Tidak ada temuan blocking terhadap aturan repo.**

- Route hanya menangani HTTP/auth/parse/serialization/adapters/recovery; tidak ada query Drizzle. Domain/service/repository tidak membawa `NextRequest`, `NextResponse`, logger atau request ID sebagai parameter.
- Service menjelaskan sequence; repository memuat query, lock, conditional hold, stable address save/dedup dan metadata/cart persistence. SO/payment tetap di luar transaksi. Modul domain tidak memanggil HTTP provider.
- Logger module-scope tetap `checkout-place-order`; classifier tidak melakukan log atau recovery. Perbandingan baseline menghasilkan 131 event dengan urutan dan field observability yang sama. Perpindahan file mengubah lokasi stack, bukan message/code/event.
- Outcome bertipe discriminated union dan input eksplisit; tidak ada `any`/free context bag untuk melewati type safety.
- Tidak ada query baru, schema change, API/UX change, provider write nyata atau scope creep ke discounts/admin. Existing tests tidak dilemahkan.
- Types, focused ESLint, full unit, required PostgreSQL suite dan E2E mock PASS; bukti ada di artefak evidence.

### Sinyal smell, bukan pelanggaran hard

1. **Possible Long Method:** orchestrator dan legacy service melewati sinyal ukuran ~300 baris. Review cohesion: masing-masing memiliki satu workflow yang memang disetujui; detail query, pricing, promo, delivery dan payload sudah dipindahkan. Pemecahan tambahan semata-mata untuk batas baris akan melanggar granularity sembilan modul dan mengaburkan sequence yang perlu tetap terlihat. Tidak diperlukan perubahan untuk acceptance ini.
2. **Possible Data Clumps:** input legacy membawa banyak field hasil preparation. Field sudah bertipe eksplisit dalam `PlaceOrderLegacyInput`, bukan object bebas. Menggabungkan context lebih jauh tidak diperlukan untuk refactor parity ini; tidak dijadikan alasan mengubah kontrak atau membuat modul kesepuluh.

## Spec

**Tidak ada temuan blocking terhadap AC01–AC10.**

- Sembilan modul sesuai blueprint; lifecycle v2 existing tidak diubah. Refinement signature admission callback, branch row ID, address persistence helper dan kalkulasi legacy tetap dalam tanggung jawab modul yang disetujui dan dicatat di evidence.
- HTTP mapping berada di route. Catch workflow, tax, delivery, attempt, legacy dan recovery tidak diratakan. `PricingContractError` tetap berbeda pada fase legacy (409 review) vs workflow (400 input); redemption drift tetap ditranslasikan hanya di boundary yang sesuai.
- Delivery mengembalikan pricing, delivery snapshot, pricing snapshot, verified address, offer candidate dan promo final. Promo rejection tetap return langsung; seluruh exception non-data tetap repricing dengan services kosong.
- Accepted/attempt replay masih mendahului pause, contract/config dan expiry token. Bounded wait recovery dan flag committed tetap pada boundary existing; tidak mengulang provider write.
- Lock order dan sorting dipertahankan. Jumlah `step(...)` tetap 19: 15 pada legacy service + 4 pada address repository. Timeout/budget/retry tetap menggunakan `runCheckoutTransaction` existing.
- UUID/reference, TTL/payment clock, source price, whole-line discount, frozen provider tax dan env reads berada di titik workflow existing. POST baseline asli dan hasil refactor lulus 25 kasus dengan clock/UUID terkontrol; 47 E2E existing serta integration lifecycle/rollback/concurrency PASS.
- Sebanyak 12 skipped pada full suite tetap dilaporkan; required integration/E2E untuk scope ini tidak skipped. Tidak mengklaim test legacy live-provider, deployment, atau audit visual baru.

## Ringkasan

**Standards: 0 blocker, 2 sinyal advisory. Spec: 0 blocker.** Tidak ada bug existing yang diperbaiki diam-diam. Scope dan logic tetap mengikuti spec; keterbatasan review langsung dan evidence eksplisit tidak disamarkan.
