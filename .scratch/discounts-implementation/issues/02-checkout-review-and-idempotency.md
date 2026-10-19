# 02 — Review checkout dan retry tanpa order ganda

Label: ready-for-agent
Type: task
Status: open
Assignee: none
Blocked by: 01
Parent: [Map implementasi diskon](../map.md)
Spec: [Complete spec](../../../plan/discounts-spec.md)
Acceptance IDs: C07, T04, T06, D01, D02

## Perilaku yang dibangun

Customer mereview checkout tanpa promo dan dapat melanjutkan setelah koneksi putus tanpa membuat order kedua. HTTP/UI mengikat current review, request key dan accepted result. Order yang sudah committed tetap ditemukan walaupun cart telah dibersihkan atau response hilang.

Gunakan baseline uang/version gate01. Sediakan interface pilihan promo yang extensible, tetapi jangan membangun Offer/Markdown atau menampilkan fitur yang belum didukung. Penggantian promo ditambahkan08, manual guessing09.

## Acceptance criteria

- [ ] Preview authoritative menghasilkan review token bertanda tangan, context/price/version fingerprints, expiry10menit dan client binding sesuai spec. Token bukan auth, harga beku atau reservation.
- [ ] Reprice/expired token/missing acknowledgement/context berubah menolak order baru dan meminta review; delivery reapproval existing tetap berlaku walau perubahan total turun. Tidak memakai money browser sebagai authority.
- [ ] Place order mengikat key UUID+canonical user intent; same key+same fingerprint mengembalikan order sama, different fingerprint409. Duplicate cart IDs invalid; sort canonical tidak membuat konflik semu.
- [ ] Accepted request result, order/items/snapshot, optional saved address, stock hold dan SO intent satu commit. Kegagalan sebelum commit tidak menyisakan accepted order atau hold parsial.
- [ ] Parallel same-key hanya satu order dan satu SO dispatch claim. Replay mencari accepted result sebelum membaca cart/master terbaru; tidak requote/reprice/reserve ulang sesudah sukses.
- [ ] Response201 baru,200 replay,202 committed tetapi processing/manual-review jujur. Error sesudah commit tidak tampil seolah order tidak ada; UI memakai key sama dan result lookup/read order.
- [ ] Client hanya dapat membaca request result/order miliknya; key berbeda owner404. Result lookup/read tidak dispatch HTTP write. Retry/repayment tidak memperpanjang expiry atau menciptakan payment attempt/order pengganti otomatis.
- [ ] Crash sebelum external claim dibedakan dari possibly-sent claim: existing system path boleh claim intent belum dispatched sekali; dispatched ambiguity hanya reconcile, tidak re-POST. Tidak menambah worker/outbox kedua.
- [ ] Admission account/IP non-code dan place-order limits persis spec, lintas proses memakai operational PG counters; trusted proxy/spoofing,429 Retry-After dan503 fail-closed teruji. Raw IP/review tokens tidak disimpan di business logs. Same accepted replay tidak dihitung sebagai new placement.
- [ ] Ephemeral rate state terpisah dari retained checkout results; accepted results/ownership tidak hilang via cascade atau reset request key. Seeder, schema/version/read docs dan UI E2E ikut berubah.

## Verifikasi

T real PG: parallel same-key/changed-key, commit boundaries, no partial stock intent; observe via result/order interfaces. H/B: review expired/changed contexts, lost response dan replay sesudah cart removal, owner privacy, HTTP statuses/limiter shared-process simulation dan trusted IP. Inject failures deterministic pada external boundary/transaction seam yang disepakati, bukan mocking lock/counter internal. Expected order/amount literals independen.

Ticket ini belum menyelesaikan promo-specific reservation T04;07 harus mengikat Redemption ke transaksi/request yang sama. Jangan menambah schema Offer dahulu untuk menyebut fondasi selesai.

## Batas dan penyelesaian

Baca [kontrak bersama](../map.md#kontrak-bersama-untuk-semua-ticket). Semua identifiers/limits/errors mengikuti approved spec; perubahan perilaku baru kembali ke pemilik. Ticket bukan izin eksekusi, provider requests, subagent, commit atau deployment. Main agent memiliki TDD, review dan validasi; catat Answer sebelum resolved.
