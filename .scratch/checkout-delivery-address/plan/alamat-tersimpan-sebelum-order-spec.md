# Spesifikasi: alamat checkout tersimpan sebelum order

Tanggal penyusunan: 2026-11-15. Lifecycle dokumen hanya dicatat di [index fitur](../index.md).

## 1. Dasar, approval, dan batas kewenangan

- [Research alur existing](../research/penyimpanan-alamat-sebelum-place-order.md): baseline source `164f1f6`; penelusuran statis, bukan bukti runtime.
- [Keputusan D1–D5](../wayfinder/keputusan-simpan-alamat-checkout.md): D1–D4 dikonfirmasi melalui `ask_user_question`; D5 berasal dari permintaan langsung user setelah sesi.
- User meminta penyusunan spec dari hasil tersebut. Batas pengujian browser + API/persistence dikonfirmasi melalui `ask_user_question`, jawaban **Sesuai**.
- **Approval complete spec: disetujui user pada 2026-11-15**, melalui pesan **“oke saya setuju dengan specnya”**, setelah tautan complete draft diberikan. Cakupan persetujuan: D1–D5, blueprint teknis/UX, kontrak API/retry, batas edit, transisi request/attempt lama, serta AC01–AC20 dan verification ladder.
- Persetujuan menetapkan kontrak kerja; pesan ini belum meminta eksekusi implementasi. Tidak mengizinkan pembuatan breakdown ticket, subagent, commit, perubahan database pengguna, akses remote, atau deployment tanpa kewenangan terpisah.
- Bahasa domain mengikuti [glossary](../../../CONTEXT.md#alamat-pengiriman-customer). Alamat Tersimpan berbeda dari snapshot pengiriman order.

Bagian 2–4 menyintesis kebutuhan yang disepakati. Bagian 5–9 disetujui melalui approval complete spec di atas; rincian teknis tersebut bukan jawaban yang diklaim sudah dipilih user selama interview. Penyebutan usulan/draft di uraian menyimpan konteks penyusunannya, bukan menandakan approval masih Pending. Discovery implementasi dan gate rollout tetap ada di bagian 11.

## 2. Pernyataan masalah

Di checkout **Kirim ke alamat**, konfirmasi modal alamat baru saat ini hanya menerapkan draft. Penyimpanan ke buku alamat bersifat opsional dan baru dilakukan bersama pembentukan order. Customer yang meninggalkan checkout sebelum order terbentuk belum mendapatkan alamat tersimpan.

Selain itu, card detail saat ini hanya tampil untuk alamat baru. Alamat dari buku alamat dipilih melalui dropdown tanpa card detail yang sama. Nama penerima yang sama pada beberapa alamat membuat customer lebih sulit memeriksa rumah versus kantor.

Sumber utama: [handler draft](../../../apps/store/src/components/checkout/DeliveryQuotePanel.tsx#L260-L275), [pemilih dan card existing](../../../apps/store/src/components/checkout/DeliveryQuotePanel.tsx#L410-L488), [save legacy](../../../apps/store/src/features/checkout/place-order-repository.ts#L246-L289), dan [promotion attempt](../../../apps/store/src/features/checkout/checkout-attempt-repository.ts#L471-L515).

## 3. Solusi dan kontrak produk

| ID | Keputusan user | Kontrak yang dipertahankan |
|---|---|---|
| D1 | Simpan lewat konfirmasi tombol, bukan autosave. | **Simpan dan gunakan** memvalidasi lalu membuat alamat. Mengetik atau Batal sebelum submit tidak membuat alamat. |
| D2 | Selalu simpan. | Hapus checkbox **Simpan alamat** dan mode tujuan sekali pakai. Alamat tetap tersedia walaupun checkout ditinggalkan atau pembayaran tidak dilanjutkan. |
| D3 | Koreksi alamat baru di checkout. | **Ubah alamat** memperbarui alamat yang sama melalui PATCH, bukan membuat row kedua. Periksa ulang ongkir setelah perubahan berhasil. |
| D4 | Alamat utama opsional. | **Jadikan alamat utama** tetap ada dan tidak dicentang saat tambah. Alamat pertama maupun terbaru tidak otomatis menjadi utama. |
| D5 | Card alamat lengkap konsisten. | Alamat existing, alamat utama yang dipilih otomatis, dan hasil tambah alamat menggunakan pola card detail tujuan yang sama. Card mengikuti pilihan aktif. |

Flow target:

```text
Pilih Kirim ke alamat
→ pilih Alamat Tersimpan ATAU buka modal Tambah alamat
→ untuk alamat baru: Simpan dan gunakan → server validasi + insert address
→ terima ClientAddressView dan pilih addressId hasil server
→ tampilkan card tujuan lengkap
→ quote ongkir → pilih layanan → review → Bayar Sekarang
→ place-order memvalidasi addressId dan menyimpan snapshot order, tanpa mutasi buku alamat
```

**Invarian utama:** hanya operasi buku alamat yang membuat/mengubah row `address`. Quote, review, place-order, promotion, dan recovery checkout tidak membuat alamat atau mengganti default buku alamat.

Tidak menghapus snapshot alamat pada order. Edit/hapus buku alamat tidak boleh menulis ulang tujuan order historis; FK order tetap mengikuti perilaku `ON DELETE SET NULL` existing.

Contoh: customer menyimpan alamat kantor untuk Kendricko, lalu menutup checkout. Alamat kantor sudah tersedia di Buku Alamat. Ketika dipilih lagi, card memperlihatkan tujuan kantor lengkap, bukan hanya nama Kendricko.

## 4. User stories

1. Sebagai customer, saya ingin menyimpan alamat dari checkout tanpa meninggalkan halaman, agar tidak perlu menunggu order berhasil.
2. Sebagai customer, saya ingin menentukan kapan menyimpan dengan tombol yang jelas, agar mengetik atau membatalkan draft tidak menciptakan alamat.
3. Sebagai customer, saya ingin alamat yang sudah berhasil dibuat tetap tersedia setelah checkout ditinggalkan.
4. Sebagai customer, saya ingin hasil tambah langsung dipilih sebagai tujuan pengiriman.
5. Sebagai customer, saya ingin melihat nama penerima, telepon, alamat, wilayah, dan kode pos tujuan aktif sebelum melanjutkan.
6. Sebagai customer dengan dua alamat bernama penerima sama, saya ingin memeriksa detail rumah atau kantor setelah memilih.
7. Sebagai customer, saya ingin alamat utama yang terpilih otomatis juga mempunyai card detail.
8. Sebagai customer, saya ingin mengoreksi alamat baru pada row yang sama tanpa duplikat, lalu melihat ongkir terbaru.
9. Sebagai customer, saya ingin menjadikan alamat utama hanya ketika saya memilihnya.
10. Sebagai customer, saya ingin input dipertahankan jika validasi/penyimpanan gagal, dengan jalan retry yang jelas.
11. Sebagai customer, saya ingin retry setelah respons create terputus tidak membuat alamat kedua untuk permintaan yang sama.
12. Sebagai customer, saya ingin quote atau checkout yang gagal tidak menghapus alamat yang telah berhasil dibuat.
13. Sebagai customer, saya ingin memakai form/card dengan keyboard dan pada mobile tanpa informasi tujuan terpotong.
14. Sebagai pemilik akun, saya ingin alamat saya tidak dapat dipilih/diedit customer lain, dan sesi admin tidak dianggap sesi store.
15. Sebagai customer yang sudah memiliki order, saya ingin perubahan buku alamat tidak mengubah tujuan snapshot order tersebut.

Stories 11 dan rincian penanganan error adalah pengaman teknis yang diajukan dalam draft, bukan perluasan ke sistem deduplikasi alamat universal.

## 5. Rancangan teknis

### 5.1 Sumber data dan identitas tujuan

- Reuse `GET /api/addresses`, `POST /api/addresses`, `PATCH /api/addresses/{id}` dan seam `createClientAddressBook()` existing.
- UI mempertahankan data `ClientAddressView` lengkap dari server: ID, nama penerima, telepon, alamat, ID/nama wilayah, kode pos, dan flag utama. Mapping panel saat ini membuang nama wilayah; mapping tersebut harus diperbaiki, bukan mengarang label dari ID.
- Setelah create/update sukses, response server menjadi sumber card dan pemilihan alamat. Update daftar lokal berdasarkan response, kemudian rekonsiliasi pembacaan daftar tanpa mengembalikan pilihan/data ke respons lama.
- Pilihan checkout hanya berupa `deliveryAddressId` dan preview Alamat Tersimpan. Hapus state/props untuk tujuan ephemeral dan save-intent dari halaman serta panel: `deliveryNewAddress`, `deliverySaveAddress`, `saveRequestId`, `initialNewAddress`, `initialSaveAddress`, `onNewAddressChange`, dan `onSaveAddressChange`.
- Draft hanya berada di modal. Dilarang memakai draft belum sukses sebagai tujuan quote/review atau mengisi ID fiktif.
- Simpan state mutation alamat terpisah dari loading quote. Jangan memakai satu boolean yang dapat di-reset oleh `finally` request berbeda.
- Ketika alamat/payload relevan berubah, clear layanan, review token, persetujuan, dan angka quote lama sesuai mekanisme generation/abort existing. Late response tidak boleh menimpa tujuan/card terbaru. Edit alamat dapat mempertahankan ID yang sama; invalidation tidak boleh hanya bergantung pada perubahan ID.

### 5.2 Validasi dan operasi alamat

- Field mengikuti `ClientAddressInput` existing. Hierarki wilayah dan kode pos canonical tetap diverifikasi server; ID/kode pos tetap string.
- UI mengecek kelengkapan dan kelayakan kontak checkout sebelum mengirim: nama/telepon/alamat wajib, panjang sesuai batas schema alamat, seluruh wilayah lengkap, kode pos tersedia, dan nomor penerima memenuhi aturan checkout existing **8–15 digit**.
- Pengecekan kontak tersebut dipindahkan lebih awal ke modal untuk mencegah sukses create yang langsung ditolak oleh **Lanjut**. Ini **tidak** mengubah aturan global API/Buku Alamat dari 5–25 karakter menjadi aturan baru; validasi kontak server place-order existing tetap tidak dilemahkan. Penyelarasan global bukan scope.
- Pergantian wilayah induk mengosongkan turunan/kode pos; label wilayah dari browser bukan sumber canonical.
- Mutation memakai sesi store onboarded, ownership di persistence, transaksi lock owner existing, dan partial unique index maksimal satu alamat utama.
- Saat edit, checkbox utama diisi dari status alamat yang sedang diedit, bukan di-reset ke `false`. Uncheck tidak otomatis mempromosikan alamat lain.
- Koreksi yang dibatalkan sebelum submit tidak menjalankan PATCH. Sukses edit tidak menjalankan POST.

**Batas D3:** kemampuan edit dalam draft ini dijamin untuk alamat yang baru dibuat dari checkout pada sesi halaman tersebut. D5 menyamakan informasi card, tidak otomatis memperluas aksi edit/hapus semua alamat existing. UI menampilkan **Ubah alamat** pada hasil create yang masih diketahui panel; alamat existing tetap dapat dikelola melalui Buku Alamat. Perluasan edit ke semua alamat hanya lewat revisi scope yang disetujui.

### 5.3 Retry create tanpa alamat ganda — usulan teknis

Extend `POST /api/addresses` dengan header opsional **`Idempotency-Key`** berisi UUID; body `ClientAddressInput` tetap strict dan tidak berubah. Checkout selalu mengirim header ini; consumer Buku Alamat existing tanpa header tetap kompatibel.

Kontrak:

1. Satu konfirmasi tambah menghasilkan satu key. Retry dari operasi yang belum pasti mempertahankan key dan body, bukan UUID baru.
2. Persistence menggunakan identitas alamat deterministik yang di-scope oleh client dan key. Usulan namespace: `address-create:` ditambah SHA-256 dari pasangan client/key. Tidak ada key global lintas customer.
3. Di bawah lock owner: bila row belum ada, insert seperti create biasa. Bila row ada dan tujuan ter-normalisasi sama, kembalikan alamat yang ada **tanpa insert dan tanpa mengulang perubahan default**. Berbeda tujuan dengan key yang sama menghasilkan `409 REQUEST_KEY_CONFLICT`.
4. Kesamaan tujuan meliputi nama penerima, telepon, alamat, ID wilayah, dan kode pos setelah trim/validasi; bukan nama wilayah kiriman browser. `isDefault` merupakan pilihan pada create pertama, bukan instruksi yang diterapkan ulang saat replay.
5. Replay mengembalikan status default terkini, sehingga retry tidak membatalkan perubahan utama yang terjadi kemudian. Jika respons pertama terputus sesudah commit, retry tetap mengarah ke ID yang sama.
6. Jaminan ini berlaku untuk **key yang sama selama row masih ada**. Bukan dedupe berdasarkan kesamaan alamat dari penambahan yang sengaja dilakukan ulang, bukan receipt permanen setelah alamat dihapus, dan bukan kontrak idempotency PATCH universal.
7. Key/operasi tidak diubah diam-diam ketika status create belum pasti. UI memberi kesempatan retry key yang sama atau menutup lalu memeriksa Buku Alamat; tidak melakukan POST otomatis saat membuka/refresh halaman. Menutup modal unknown dalam sesi panel yang sama mempertahankan draft/key unresolved; membuka lagi melanjutkan operasi itu, bukan membuat command baru. Setelah reload, UI hanya memuat daftar server dan meminta pilihan eksplisit, bukan merekonstruksi POST dari input lama.
8. Header invalid menghasilkan 400 tanpa mutation. Normalisasi UUID konsisten sebelum membentuk identitas. Kegagalan DB/region bukan conflict atau sukses palsu.
9. Replay row yang sudah tersimpan tidak membutuhkan region HTTP baru hanya untuk membuktikan write sebelumnya. Untuk insert baru, validasi region tetap dilakukan di luar transaksi/lock; setelah itu persistence mengunci owner dan memeriksa ulang identitas untuk menangani race. Tidak menahan lock saat menunggu provider.

Penambahan perilaku terbatas dilakukan pada seam persistence alamat existing, bukan membuat transaction manager baru. Bentuk optional options menjaga caller existing tetap berlaku. Bila strategi ini tidak dapat memenuhi kontrak tanpa schema baru, hentikan slice dan ajukan revisi; jangan menambah tabel diam-diam.

Untuk PATCH dengan respons tidak pasti: jangan fallback ke POST atau menjalankan ulang write otomatis. Aksi **Periksa alamat** memuat daftar milik customer untuk membaca row yang sama. Jika tujuan tersimpan sesuai, gunakan hasil server; jika tidak, tampilkan input/keadaan terkini untuk konfirmasi ulang. Ini bukan jaminan compare-and-swap terhadap semua edit concurrent.

### 5.4 Kontrak HTTP checkout sesudah perubahan

| Boundary | Kontrak tujuan baru | Dampak |
|---|---|---|
| `POST /api/checkout/delivery-quote` | `{ itemIds, addressId }` | Hapus cabang payload `newAddress`; quote tidak melakukan mutation buku alamat. |
| `POST /api/checkout/preview` untuk delivery | Field review existing + `addressId` | `deliveryReviewSchema` hanya menerima Alamat Tersimpan; hapus `newAddress/saveAddress/saveRequestId`. |
| `POST /api/checkout/place-order` untuk delivery | Field approval existing + `addressId` | Hapus bentuk inline/ephemeral. Request key, review token, promo/approval tetap mengikuti gate existing. |
| `GET /api/checkout/requests/{requestKey}` | Tidak berubah | Read-only, owned, tanpa save/requote/dispatch baru. |

Kontrak kontak, courier/service, origin fingerprint, pricing approval, promo dan perilaku reprice tidak diubah. Tujuan foreign/tidak ditemukan tetap ditolak tanpa membocorkan ownership.

`placeDeliveryQuote()` selalu memuat alamat owned. Hilangkan hasil `verifiedNewAddress` dan semua caller-nya. **Jangan menghapus validasi region bersama hanya karena helper bernama `loadRevalidatedNewDestination()`**: loader alamat tersimpan existing menggunakannya. Cabang payload dihapus, validasi internal tetap berfungsi.

### 5.5 Place-order, promotion, dan snapshot

- Legacy: hapus pemanggilan dan implementasi saver checkout beserta helper write/default khususnya yang tidak lagi mempunyai caller. Order mengacu ke `deliveryBody.addressId`, bukan ID hasil save.
- Attempt: pembentukan snapshot tidak mengisi data untuk membuat alamat. Pertahankan `addressToSave: null` pada snapshot baru untuk menjaga bentuk versi JSON existing; hapus mutasi alamat/default dari promotion.
- Type snapshot boleh mempertahankan field deprecated bertipe legacy agar histori dapat dibaca. Jangan menyimpulkan snapshot lama sudah berubah hanya karena type berubah.
- Reservation, promotion, replay, dan worker tidak boleh menjalankan insert/update/delete tabel `address`. Pemeriksaan ownership, deteksi perubahan tujuan sebelum reservation, FK, dan snapshot tetap ada.
- Alamat yang diedit/dihapus sebelum final approval harus memicu validasi/review ulang existing. Setelah attempt sah sudah durable, gunakan snapshot yang dibekukan; jangan mengganti tujuan order dengan isi buku alamat terbaru ketika promotion.
- Jika row alamat dihapus sesudah reservation, promotion dapat membentuk order dengan FK null seperti perilaku existing, tetapi snapshot tujuan tetap utuh. Tidak membuat ulang row alamat.

### 5.6 Transisi request dan attempt lama — usulan cutover terbatas

**Tidak mempertahankan saver lama tanpa batas**, karena bertentangan dengan tujuan nol mutation buku alamat dari checkout.

Prasyarat aktivasi versi baru:

1. Dengan approval operasional terpisah, hentikan penerimaan checkout lama dan tunggu request lama yang sedang berjalan selesai. Gunakan mekanisme pause/runbook existing; penulisan spec ini tidak menjalankannya.
2. Periksa semua attempt nonterminal yang menyimpan `addressToSave` non-null, termasuk `manual_review`. Proses/pemulihan lama harus dituntaskan dengan versi lama dan bukti yang sah; jangan menghapus snapshot, membatalkan payment, atau menandai rejected berdasarkan timeout semata.
3. **Blokir cutover** selama masih ada kewajiban save lama yang belum selesai. Belum diketahui apakah environment memiliki kasus ini; itulah discovery, bukan asumsi nol data.
4. Pada kode baru, guard snapshot legacy yang masih membawa save-intent **sebelum** melanjutkan provider/recovery/promotion. Fail closed, pertahankan evidence, log konteks aman; jangan diam-diam mengabaikan `addressToSave` atau membuat alamat dari worker.
5. Snapshot/order terminal lama tidak dimigrasikan atau dihapus. Lookup hasil request lama tetap bisa dibaca melalui GET existing.

Untuk tab browser/body pending lama:

- Jangan mengganti `newAddress` menjadi `addressId` pada request key yang sudah dipakai. Fingerprint memang mencakup intent; konversi dapat mengubah makna request.
- Payload inline baru ditolak schema dengan 400, sebelum side effect. Jangan menyediakan compatibility path yang tetap membuat alamat lewat place-order.
- Saat memuat pending body lama, client melakukan lookup read-only request terlebih dahulu. Jika hasil sudah ada, tampilkan/recover hasil itu, bukan create alamat/order baru.
- Jika lookup gagal/503 atau hasil belum pasti, pertahankan pending dan beri retry lookup. Jangan menganggap kegagalan jaringan sebagai tidak ada order.
- Jika lookup 404 **sesudah cutover yang memenuhi prasyarat drain**, arahkan customer memilih alamat tersimpan dan review ulang. Aksi eksplisit **Pilih alamat dan review ulang** menghapus body lama dari pending lokal dan memulai review/request key baru; tidak mengirim ulang body lama. Jangan menerapkan aturan ini pada pending baru secara umum.

Rancangan ini memerlukan review operasional sebelum rollout. Pengecekan database, pause, recovery live, dan deployment masing-masing tetap membutuhkan kewenangan terpisah.

### 5.7 Logging, privacy, schema, dan deployment

- Reuse facade `apps/store/src/lib/logger.ts`; logger module-scope, wrapper `withRequestContext`, tanpa parameter logger/requestId ke service/persistence.
- Boundary `addressApi` menjadi pemilik success/failure log API alamat; checkout menjaga konteks error/rejection existing. Minimum info sukses dan error kegagalan backend dengan identifier/code aman.
- Jangan log nama penerima, telepon, alamat jalan, cookie, header autentikasi, body request, token review, atau raw provider response. Key idempotency bukan pengganti requestId logging.
- Tidak ada perubahan kolom/tabel/index, migration SQL, atau seeder yang direncanakan. Deterministic address ID memanfaatkan primary key text existing. Type JSON legacy dipertahankan; tidak perlu `db:push` untuk rancangan ini.
- Tidak ada env/port/domain/cron/build/volume baru. File runtime deployment tidak perlu diubah selama fakta ini tetap benar; prosedur cutover perlu masuk dokumentasi rollout. Jika implementasi menemukan kebutuhan schema/env, kembali untuk approval perubahan scope dan izin DB terpisah.
- Context7 checkpoint untuk **penyusunan dokumen**: N/A, tidak ada implementasi API library. Sebelum coding: main agent wajib resolve/query versi terpasang React/Next.js, Zod, Drizzle dan Playwright/Vitest sesuai slice, lalu mencatat ID library dan API yang dikonfirmasi pada evidence. Jangan menyebut lookup ini sudah dilakukan.

## 6. Blueprint teknis tingkat file

Path di bawah relatif terhadap root repo. Blueprint memuat path sesuai aturan proyek, sebagai pengecualian eksplisit terhadap template upstream `to-spec` yang melarang path. Tidak ada file aplikasi yang diubah saat menyusun spec.

### 6.1 File dan tanggung jawab

| Path lengkap | Aksi | Tanggung jawab / layer | Seam verifikasi |
|---|---|---|---|
| `apps/store/src/components/checkout/DeliveryQuotePanel.tsx` | Modify | UI orchestration: daftar/selection Alamat Tersimpan, modal, card, quote invalidation dan callbacks. | Browser checkout pada delivery-quote/order mock. |
| `apps/store/src/components/checkout/CheckoutAddressDialog.tsx` | Create | UI cohesive untuk draft create/edit, region picker, validasi, mutation state/retry, focus. Bukan backend service. | Browser checkout + API alamat. |
| `apps/store/src/components/checkout/CheckoutAddressCard.tsx` | Create | Satu presentasi pasif tujuan lengkap; action edit opsional sesuai scope D3. Dipakai untuk sumber alamat existing maupun baru. | Browser card/default/switch/long address. |
| `apps/store/src/app/checkout/page.tsx` | Modify | UI intent hanya addressId, pending mutation guard, reset review dan transisi pending body lama. | Browser checkout; checkout request regression. |
| `apps/store/src/app/api/addresses/route.ts` | Modify | HTTP parse header optional dan panggil seam create existing; tanpa query baru. | Route test alamat + browser/API. |
| `apps/store/src/lib/address-api.ts` | Modify | Auth/logging/error boundary existing; mapping conflict khusus ke 409, tanpa membocorkan PII. | API response dan route test. |
| `apps/store/src/lib/client-addresses.ts` | Modify | Persistence/DAL seam existing: create options, owner-scoped deterministic create/replay/conflict. CRUD lain tetap kompatibel; tidak dibuat generic repository baru. | `createClientAddressBook` pada real PostgreSQL. |
| `apps/store/src/app/api/checkout/delivery-quote/route.ts` | Modify | Hapus cabang inline schema; pertahankan auth/mapping quote existing, jangan menambah query route. | Browser/API delivery-quote. |
| `apps/store/src/lib/checkout-delivery-review.ts` | Modify | Review input hanya addressId dan loader owned; preview signature tetap. | Browser/API review. |
| `apps/store/src/features/checkout/place-order-input.ts` | Modify | Domain schema delivery hanya addressId, parser menolak payload inline. | Unit input existing. |
| `apps/store/src/features/checkout/place-order-delivery.ts` | Modify | Requote dari owned address, hilangkan hasil verifiedNewAddress; snapshot tetap. | Place-order route/service regression + browser. |
| `apps/store/src/features/checkout/place-checkout-service.ts` | Modify | Service memilih lifecycle seperti existing, menghasilkan snapshot tanpa save-intent. | Public `placeCheckoutOrder` dan route. |
| `apps/store/src/features/checkout/place-order-legacy-service.ts` | Modify | Service transaksi order tanpa saveCheckoutAddress. | Public `placeOrderLegacy` / place-order route. |
| `apps/store/src/features/checkout/place-order-repository.ts` | Modify | Repository menghapus saver/address writes khusus checkout; read/lock ownership dipertahankan. | Public order path pada real PG. |
| `apps/store/src/features/checkout/checkout-attempt-repository.ts` | Modify | Repository reservation/promotion tanpa mutasi address; guard save-intent legacy; snapshot/FK tetap aman. | Public reserve/promote pada real PG. |
| `apps/store/src/features/checkout/place-order-service.ts` | Modify | Guard attempt lama sebelum resume/provider; lifecycle uang/stock/payment tidak dirancang ulang. | Public place/replay regression. |
| `apps/store/src/features/checkout/recover-checkout-service.ts` | Modify | Worker guard save-intent lama sebelum dispatch/promotion; tidak kehilangan evidence. | Public recovery pada fixture attempt. |
| `packages/db/src/schema/checkout.ts` | Modify | Dokumentasikan field deprecated/read compatibility `addressToSave`; tidak mengubah definisi kolom/constraint atau SQL. | Fixture type + snapshot guard tests. |
| `apps/store/src/app/api/addresses/route.test.ts` | Modify | Header valid/invalid/default compatibility/conflict response. | HTTP route. |
| `apps/store/src/lib/client-addresses.db.test.ts` | Modify | Concurrency key sama, ownership, same-key replay/conflict, default tidak dipromosikan ulang. | Factory CRUD existing. |
| `apps/store/src/features/checkout/place-order-input.test.ts` | Modify | addressId diterima; field inline lama ditolak. | Parser publik. |
| `apps/store/src/app/api/checkout/place-order/route.lifecycle-parity.test.ts` | Modify | Ganti ekspektasi create alamat menjadi nol mutation buku alamat; pertahankan lifecycle. | Route POST publik. |
| `apps/store/src/features/checkout/place-order-repository.db.test.ts` | Modify | Ganti test helper saver yang dihapus dengan bukti order legacy memakai alamat existing tanpa mutation. | Public order path real PG. |
| `apps/store/src/features/checkout/checkout-attempt-repository.db.test.ts` | Modify | Promotion/replay/recovery tanpa alamat baru; delete/edit sesudah snapshot dan guard attempt lama. | Public lifecycle real PG. |
| `e2e/store/delivery-quote-mock.spec.ts` | Modify | Card existing/default/new, draft/modal, validation/loading/errors/keyboard/mobile. | Browser + protected API. |
| `e2e/store/delivery-order-mock.spec.ts` | Modify | Save sebelum order, edit same ID, default, kegagalan quote/order tidak rollback alamat, gate 0 tanpa mutation. | Browser + protected API/persistence. |
| `e2e/store/checkout-review-mock.spec.ts` | Modify | Fixture `newAddress` menjadi create address → addressId; gate 1/review/promo tetap berlaku. | Browser/API versioned checkout. |
| `e2e/store/versioned-checkout-mock.spec.ts` | Modify | Address-only intent/replay, pending legacy body read-only, order tidak membuat alamat. | Browser/API versioned checkout. |
| `e2e/store/addresses-mock.spec.ts` | Modify bila terdampak | Membuktikan consumer Buku Alamat tanpa header baru tetap bekerja; tidak redesign halaman. | Browser/API alamat. |
| `docs/features/client-addresses.md` | Modify | Kontrak simpan-langsung dan retry terbatas. | Review docs versus API/AC. |
| `docs/features/delivery-quotes.md` | Modify | Flow modal/card konsisten dan input addressId. | Review docs versus browser/AC. |
| `docs/features/delivery-orders.md` | Modify | Hilangnya saver checkout; snapshot tetap. | Review docs versus order/AC. |
| `docs/api-reference.md` | Modify | Header optional, konflik, payload delivery address-only. | Review kontrak HTTP. |
| `docs/README.md` | Modify bila perlu | Pastikan discoverability dokumentasi fitur/rollout tanpa entri duplikat. | Link check. |

Test lain yang mengimpor tipe/helper yang dihapus diperbarui sebatas compile dan ekspektasi kontrak yang berubah; bukan rewrite unit suite. Jangan menambah spec mock baru tanpa mendaftarkan `testMatch`; rancangan ini mengutamakan file mock existing yang sudah terdaftar.

### 6.2 Kontrak export dan delta

Deklarasi berikut adalah kontrak usulan tanpa implementasi:

- `apps/store/src/lib/client-addresses.ts`:
  - `ClientAddressCreateOptions = { requestKey?: string }`.
  - `ClientAddressBook.create(clientId: string, input: ClientAddressInput, options?: ClientAddressCreateOptions): Promise<ClientAddressView>`.
  - `createClientAddressBook(db: ClientAddressesDb, regionGateway: ClientRegionGateway): ClientAddressBook` tetap.
  - `ClientAddressInput`, `ClientAddressView`, `update(clientId, addressId, input)`, list/remove/setDefault tetap. Tambah error code `REQUEST_KEY_CONFLICT`; jangan mengubah semua DB error menjadi conflict.
- `apps/store/src/components/checkout/CheckoutAddressDialog.tsx`:
  - default `CheckoutAddressDialog(props: CheckoutAddressDialogProps)`.
  - Props: `open: boolean`, `mode: "create" | "edit"`, `initialAddress: ClientAddressView | null`, `triggerElement: HTMLButtonElement | null`, `onOpenChange(open: boolean): void`, `onBusyChange(busy: boolean): void`, `onSaved(address: ClientAddressView, kind: "created" | "updated"): void`.
  - Browser fetch merupakan adapter ke API existing; tidak mengimpor DB/persistence ke komponen client.
- `apps/store/src/components/checkout/CheckoutAddressCard.tsx`:
  - default `CheckoutAddressCard(props: { address: ClientAddressView; onEdit?: () => void })`.
- `apps/store/src/components/checkout/DeliveryQuotePanel.tsx`:
  - `DeliveryAddressPreview` diperluas ke data canonical `ClientAddressView` yang dibutuhkan card/form; `id` harus ID tersimpan.
  - default `DeliveryQuotePanel(props: DeliveryQuotePanelProps)` tetap.
  - Pertahankan callbacks `onAddressChange(addressId: string | null)`, `onAddressSelected(address: DeliveryAddressPreview | null)`, service/pending/reprice existing.
  - Tambah `onAddressPendingChange?(pending: boolean): void`; hapus props `initialNewAddress`, `initialSaveAddress`, `onNewAddressChange`, dan `onSaveAddressChange`.
- `apps/store/src/features/checkout/place-order-input.ts`:
  - `DeliveryPlaceOrderData` menjadi base delivery existing + `addressId: string`, tanpa inline union.
  - `parsePlaceOrderBody(body: unknown, fulfillmentMethod: unknown)` dan `extractPlaceOrderFields(data: PlaceOrderData, isDelivery: boolean)` tetap bernama/signature existing; return mengikuti tipe baru.
- `apps/store/src/lib/checkout-delivery-review.ts`: `previewDeliveryReview(clientId: string, input: DeliveryReviewInput, providerTax?: ValidatedProviderTax)` tetap secara semantik; `DeliveryReviewInput` adalah inferred schema existing yang dipersempit ke `addressId`, bukan API baru.
- `apps/store/src/features/checkout/place-order-delivery.ts`: `placeDeliveryQuote(input: PlaceDeliveryInput)` tetap; hasil sukses tidak lagi membawa `verifiedNewAddress`.
- `apps/store/src/features/checkout/place-checkout-service.ts`: `placeCheckoutOrder(input: PlaceCheckoutOrderInput)` tetap; snapshot baru `addressToSave=null`.
- `apps/store/src/features/checkout/place-order-legacy-service.ts`: `placeOrderLegacy(input: PlaceOrderLegacyInput)` tetap; hapus properti `verifiedNewAddress` dari input dan pemanggil.
- `apps/store/src/features/checkout/place-order-repository.ts`: hapus `saveCheckoutAddress`, `SaveCheckoutAddressInput`, dan helper write alamat yang tidak lagi dipakai; public query/order operations lain tetap.
- `apps/store/src/features/checkout/checkout-attempt-repository.ts`: `reserveCheckoutAttempt(input, database?)` / `promoteCheckoutAttempt({ attemptId }, database?)` tetap; reject/guard legacy save-intent tanpa address write.
- `apps/store/src/features/checkout/place-order-service.ts`: `placeCheckout(input, dependencies?)` / `replayCheckoutAttempt(input, dependencies?)` tetap; guard sebelum melanjutkan pekerjaan legacy.
- `apps/store/src/features/checkout/recover-checkout-service.ts`: `recoverCheckoutAttempts({ limit, cutoff, now? }, database?)` tetap; blocked legacy attempt tidak ditandai sukses/dituntaskan palsu.
- `packages/db/src/schema/checkout.ts`: `CheckoutAttemptSnapshot` mempertahankan field deprecated agar histori terbaca; tidak mengubah versi payload existing hanya untuk mengganti type.
- Export HTTP `GET`/`POST`/`PATCH` existing tetap. Contract-changing body/header/error ada di §5.3–5.4; response sukses alamat tetap `{ success: true, data: ClientAddressView }`.

### 6.3 Keputusan struktur dan alternatif

- **Dialog terpisah dari panel:** state draft/mutation/retry/focus cohesive dan berbeda dari state quote. Ditolak: menambah seluruh persistence lifecycle ke panel besar atau membuat universal form framework.
- **Satu card checkout:** menghindari dua renderer yang berbeda untuk existing versus baru. Ditolak: menyalin cabang card untuk setiap sumber alamat atau mengubah shared card seluruh app.
- **Reuse seam alamat existing:** aturan owner/region/default tetap satu jalur yang sudah memiliki DB tests. Ditolak: query alamat baru di route checkout atau memanggil saver lama lebih awal dari frontend.
- **Hapus jalur save pada kedua lifecycle:** bukan hanya menyembunyikan checkbox. Ditolak: tetap membentuk `addressToSave` pada backend untuk request baru.
- **Header key opsional dan deterministic ID:** pengaman retry terbatas tanpa tabel baru. Ditolak: dedupe dengan membandingkan street/name seluruh buku alamat, karena penambahan serupa belum tentu duplikasi yang harus digabung.
- Tidak ada pemindahan massal seluruh CRUD dari `lib/` atau redesign API akun. Query baru tetap di seam DAL, bukan service/route yang harus bebas query.

## 7. Blueprint UX

### 7.1 Referensi dan hierarki

- Referensi utama: card alamat baru dan modal existing pada `apps/store/src/components/checkout/DeliveryQuotePanel.tsx`, disamakan untuk alamat existing. Perbaikan: hilangkan perbedaan asal alamat dan copy simpan-tertunda.
- Referensi form/data: `apps/store/src/app/account/addresses/page.tsx` dan API-nya; bukan izin menyalin kekurangan error/spacing halaman tersebut.
- Alias `@/components/ui/*` sebenarnya menunjuk `packages/ui/src/components/ui/*`, terverifikasi di `apps/store/tsconfig.json`.
- Referensi baru belum diperiksa rendered di sesi penyusunan spec. Gate sebelum penerimaan frontend mencakup browser review dan perbandingan dengan halaman/pattern ini; spec tidak mengklaim UX sudah lulus.
- Prioritas: pilih tujuan → periksa detail → pilih layanan → **Lanjut**. **Tambah alamat** dan **Ubah alamat** adalah aksi sekunder; **Simpan dan gunakan** menjadi primary di modal create.

Susunan target, bukan prototype yang sudah diuji:

```text
Alamat Pengiriman
[ Pemilih alamat tersimpan                         v ]
┌ Alamat terpilih ───────────────────────────────────┐
│ Kendricko                              [Ubah alamat]*│
│ 081234567890                                        │
│ Jl. Melati No. 12, unit dan patokan                  │
│ Kelurahan/Area, Kecamatan                           │
│ Kota/Kabupaten, Provinsi · Kode pos 12345            │
└────────────────────────────────────────────────────┘
[+ Tambah alamat]
Pilih pengiriman / hasil quote
```

`*` Aksi edit mengikuti batas D3 §5.2. Untuk dua alamat bernama sama, dropdown tetap memperlihatkan nama dan street existing; card lengkap adalah sumber pemeriksaan, bukan tooltip. Data card tidak menggunakan truncation/line-clamp. Badge utama opsional memakai pola existing, bukan syarat memilih alamat.

### 7.2 Component reuse map

| Elemen | Existing / baru | Path lengkap | Penggunaan |
|---|---|---|---|
| Tombol | Existing | `packages/ui/src/components/ui/button.tsx` | Primary modal; outline untuk tambah/ubah; ukuran mengikuti existing. |
| Modal | Existing | `packages/ui/src/components/ui/dialog.tsx` | Focus trap, close comfortable, body scroll/footer terjangkau. |
| Pemilih alamat/wilayah | Existing | `packages/ui/src/components/ui/select.tsx` | Controlled selection, opsi wrap, keyboard existing. |
| Input/label | Existing | `packages/ui/src/components/ui/input.tsx`, `packages/ui/src/components/ui/label.tsx` | Required marker + legenda, autoComplete/phone existing. |
| Kode pos | Existing | `packages/ui/src/components/ui/read-only-input.tsx` | Hasil area, bukan input bebas. |
| Presentasi tujuan | Baru, app-local | `apps/store/src/components/checkout/CheckoutAddressCard.tsx` | Reuse token/layout card alamat existing; tidak mengubah design system. |
| Form mutation | Baru, app-local | `apps/store/src/components/checkout/CheckoutAddressDialog.tsx` | Form create/edit yang sama, data canonical, state matrix di bawah. |

### 7.3 State matrix dan copy target

Copy berikut adalah isi draft yang diajukan untuk approval, bukan placeholder implementasi.

| Permukaan / state | Tampilan dan copy | Aksi / perilaku |
|---|---|---|
| Daftar loading | **Memuat alamat tersimpan…** | Tidak menampilkan card tujuan fiktif; belum boleh melanjutkan delivery. |
| Buku alamat kosong | **Belum ada alamat tersimpan. Tambahkan alamat pengiriman untuk melanjutkan.** | **Tambah alamat**; dropdown kosong disembunyikan. |
| Daftar ada, belum dipilih | Dropdown **Pilih alamat pengiriman** | Tidak ada card; jangan otomatis memilih alamat pertama non-default. |
| Tujuan terpilih | Card **Alamat terpilih**, nama, telepon, street, wilayah, kode pos | Berlaku existing/default/baru; edit hanya sesuai §5.2. |
| Daftar gagal | **Alamat belum dapat dimuat.** | **Coba lagi** memuat daftar, bukan create ulang; tidak disamakan dengan empty. |
| Alamat legacy belum lengkap | Opsi disabled: **Wilayah belum lengkap — perbarui di Buku Alamat** | Tidak dianggap tujuan valid/diquote. |
| Create idle/unsaved | Judul **Alamat baru**; deskripsi **Alamat akan disimpan ke Buku Alamat dan digunakan untuk pengiriman.** | Field, **Jadikan alamat utama** unchecked, **Batal**, **Simpan dan gunakan**. Tidak ada checkbox Simpan alamat. |
| Edit idle/unsaved | Judul **Ubah alamat**; deskripsi **Perubahan disimpan ke Buku Alamat. Ongkir akan diperiksa ulang.** | Isi current server view; **Batal**, **Simpan perubahan**. |
| Form belum lengkap | **Lengkapi nama, telepon, wilayah, dan alamat.** | Primary disabled; input tetap editable. |
| Telepon tidak layak checkout | **Nomor telepon penerima harus berisi 8–15 angka.** | Error dekat field, fokus ke error saat submit; jangan mengubah tujuan aktif. |
| Validasi server/region gagal | **Periksa alamat dan wilayah yang dipilih.** | Modal/input tetap ada; field/error association bila detail tersedia; tidak mulai quote tujuan baru. |
| Region gagal dimuat | **Wilayah belum dapat dimuat.** | **Coba lagi wilayah**; reset hierarchy tidak mengarang kode pos. |
| Saving | **Menyimpan alamat…** dengan indikator visual | Primary/loading, submit ulang tidak tersedia; Batal/X/Escape ditahan selama request berlangsung, bukan dianggap rollback. **Lanjut**/submit order tidak tersedia. |
| Create gagal definitif | **Alamat belum dapat disimpan. Coba lagi.** | Input tetap, retry sesuai key; tidak ada ID/card sukses palsu. |
| Create respons tidak pasti | **Status penyimpanan belum dapat dipastikan. Coba lagi untuk memeriksa permintaan yang sama.** | **Coba simpan lagi** memakai key/body sama; jangan edit body dengan key yang statusnya belum pasti. **Tutup** boleh menutup tanpa klaim batal; baca ulang daftar, tidak auto-POST. |
| Edit respons tidak pasti | **Status perubahan belum dapat dipastikan. Periksa alamat tersimpan.** | **Periksa alamat** melakukan GET; bukan POST/PATCH otomatis. **Tutup** tidak menyatakan perubahan dibatalkan dan tidak menerapkan draft belum terkonfirmasi. |
| Konflik key create | **Permintaan alamat berbeda. Periksa Buku Alamat sebelum menambahkan lagi.** | Tidak otomatis mengganti key dan mengulang POST. |
| Edit target tidak ditemukan | **Alamat tidak ditemukan. Pilih alamat lain atau tambahkan alamat baru.** | Refresh daftar; clear tujuan yang hilang, input tidak dianggap tersimpan. |
| Sukses create/update | Modal ditutup; card hasil server; status singkat **Alamat disimpan.** / **Alamat diperbarui.** | Pilih hasil, clear old quote/review, periksa ongkir. Tidak ada pesan **Akan disimpan** atau **Tidak disimpan**. |
| Tujuan berganti / edit berhasil | **Tujuan berubah. Pilih layanan pengiriman kembali.** | Pertahankan pola invalidation existing; nomor kontak mengikuti penerima baru. |
| Quote loading/error/empty | Copy dan retry existing | Quote gagal tidak menghapus alamat yang telah dibuat; tidak menampilkan ongkir nol/fallback lama. |
| Sesi tidak valid | Penanganan guard/login existing | Tidak mengirim mutation tanpa akses, tidak menerima sesi admin sebagai store. |
| Pending body lama tanpa hasil sesudah cutover | **Alamat checkout perlu dipilih ulang. Pilih alamat tersimpan dan periksa kembali pesanan.** | **Pilih alamat dan review ulang** hanya setelah lookup definitif/prasyarat §5.6; tidak auto-submit. |

Jika close create berstatus tidak pasti, UI tidak menyatakan **Batal berhasil**. Penutupan modal tidak berarti write server dibatalkan. Di luar state saving/unknown, Escape/Batal/tutup membuang draft yang belum dikirim dan mempertahankan tujuan lama.

### 7.4 Kontrak pemilih, viewport, dan accessibility

- Daftar alamat bersumber penuh dari `GET /api/addresses` milik client, mengikuti urutan existing `createdAt`/`id` descending. Ini picker existing, bukan tabel katalog besar; tidak menambah search, filter, server pagination, atau URL state. Tidak mengganti query server dengan search browser tersembunyi.
- Hasil quote tetap menggunakan kategori/pagination layanan existing; tidak diubah karena card alamat.
- Viewport target: mobile 390 px dan desktop 1280 px, light/dark sesuai dukungan existing. Card/nama/wilayah panjang wrap, bukan overflow horizontal. Tombol edit tidak mempersempit teks kritis; dapat turun baris pada mobile.
- Modal mengikuti batas tinggi viewport existing; body scroll dan footer tetap dapat dijangkau. Data yang diperlukan untuk memeriksa tujuan tidak disembunyikan di accordion/hover.
- Enter/Space pada tombol, select keyboard, Tab/focus trap, Escape sesuai state di atas. Fokus awal ke nama penerima; error summary/field terasosiasi; setelah close/sukses fokus kembali ke trigger yang relevan.
- Field wajib ditandai label/required/legenda; error `aria-invalid`/`aria-describedby`; proses dan status sukses diumumkan tanpa mengganti label kontrol menjadi hanya ikon.
- Gunakan token contrast/shared focus existing. Target penting ≥24×24 CSS px atau pengecualian sah; tidak mengklaim WCAG penuh dari atribut saja.
- Tidak ada prototype yang diminta/disepakati. Diagram teks di atas adalah proposal struktur; implementasi harus mengikuti spec yang disetujui dan token existing, bukan CSS baru.

## 8. Acceptance criteria dan peta evidence

Semua evidence implementasi di bawah **Pending** pada saat spec disusun. Hasil implementasi aktual dan evidence per AC ada di §14 (seluruh baris sudah terverifikasi); kolom Status di tabel ini menunjuk ke §14.

| AC | Perilaku yang harus dapat diamati | Evidence target | Status |
|---|---|---|---|
| AC01 | Mengetik alamat atau Batal sebelum submit tidak membuat row dan tidak mengganti tujuan/quote aktif. | Delivery-quote browser + GET alamat sebelum/sesudah. | Verified (§14) |
| AC02 | **Simpan dan gunakan** yang valid membuat alamat dan memilih ID server sebelum ada panggilan place-order/order baru. | Delivery-order browser, GET alamat, baseline count order. | Verified (§14) |
| AC03 | Alamat create sukses tetap ada setelah meninggalkan/refresh checkout tanpa order; tidak auto-POST pada reload. | Delivery-order browser + GET. | Verified (§14) |
| AC04 | Tidak ada mode sekali pakai/checkbox **Simpan alamat** atau status simpan-tertunda; request quote/review/place hanya addressId. | Browser serta body request publik. | Verified (§14) |
| AC05 | Checkbox utama default false; menambah alamat tanpa centang tidak mengganti default; centang mempromosikan maksimal satu default. | Browser + factory real PG concurrent. | Verified (§14) |
| AC06 | Koreksi alamat baru melalui checkout memperbarui ID yang sama, tidak menambah row; Batal edit tidak mengubah data server. | Browser/API PATCH + GET. | Verified (§14) |
| AC07 | Nama/telepon/region tidak valid ditolak sesuai batas §5.2, input dipertahankan, tidak ada card sukses/quote atas tujuan yang gagal dibuat. | Browser invalid/region failure + API/factory. | Verified (§14) |
| AC08 | Saving terlihat, submit ganda dicegah; create key sama secara concurrent/lost-response menghasilkan satu alamat; replay tidak mengubah default lagi; konflik tujuan ditolak. | Browser retry + factory real PG + HTTP response. | Verified (§14) |
| AC09 | Error/unknown edit memberi GET reconciliation dan tidak membuat alamat baru atau mengklaim write dibatalkan. | Browser network fixture + API reads. | Verified (§14) |
| AC10 | Card lengkap hadir untuk alamat existing, default otomatis, dan hasil create; dua alamat bernama sama dapat dibedakan dari detail tujuannya. | Delivery-quote browser, desktop/mobile. | Verified (§14) |
| AC11 | Pergantian pilihan/hasil edit same-ID memperbarui card dan invalidates layanan/review lama; late response tidak mengembalikan detail/ongkir sebelumnya. | Browser controlled delayed responses. | Verified (§14) |
| AC12 | Quote/reprice/order gagal tidak rollback alamat yang telah sukses dibuat; ongkir gagal tidak berubah menjadi nol. | Delivery-order/review browser + GET alamat. | Verified (§14) |
| AC13 | Gate 0 dan gate 1 place-order/promotion/replay/recovery tidak insert/update/delete alamat atau mengganti default, termasuk sesudah perubahan default oleh operasi lain. | Public route/lifecycle real PG; bandingkan buku alamat/default sebelum/sesudah. | Verified (§14) |
| AC14 | Ownership tetap: foreign/unknown address tidak dapat dipakai/diubah; sesi admin tidak mengakses endpoint store. | API isolation/guard tests + addresses browser regression. | Verified (§14) |
| AC15 | Snapshot order tetap memuat tujuan canonical; edit/hapus buku alamat tidak mengubah snapshot; hapus setelah reservation tidak membuat row pengganti. | Public lifecycle real PG + delivery-order snapshot regression. | Verified (§14) |
| AC16 | Payload inline lama ditolak tanpa side effect; pending lama lookup-only terlebih dahulu, hasil existing tidak digandakan; kegagalan lookup tidak memulai checkout baru. | Input unit + versioned-checkout browser/API. | Verified (§14) |
| AC17 | Guard menolak melanjutkan save-intent legacy sebelum side effect tanpa menghapus evidence; runbook mewajibkan drain sebelum aktivasi versi baru. | Public recovery guard pada fixture legacy + review runbook §5.6. Hasil preflight environment aktual dicatat terpisah bila rollout diizinkan. | Verified (§14) |
| AC18 | Keyboard/focus/loading/error, alamat panjang, viewport 390/1280 dan theme relevan lolos browser review terhadap referensi; tidak ada overflow/info penting terpotong. | Playwright + rendered/task-flow review main agent. | Verified (§14) |
| AC19 | CRUD Buku Alamat tanpa header baru, pickup, pricing/promo, pembayaran, dan lookup existing tidak mengalami perubahan kontrak di luar spec. | Focused regression + final gate sesuai §9. | Verified (§14) |
| AC20 | Dokumen endpoint/fitur diperbarui, privacy logging terjaga, dan tidak ada schema/env/deployment runtime baru tanpa approval. | Review diff/docs/log API + verification notes. | Verified (§14) |

## 9. Keputusan pengujian dan urutan kerja

### 9.1 Seam yang dikonfirmasi

User mengonfirmasi pengujian di batas publik:

1. **Utama:** perjalanan customer di `/checkout`, dengan fixture provider terkontrol; amati card, aksi, request, dan data melalui API.
2. **Persistence:** `createClientAddressBook()` dan public placement/lifecycle pada real PostgreSQL untuk ownership, replay/concurrency, default, serta invariannya. Pembacaan tabel diperbolehkan sebagai evidence requirement **nol mutation/row baru**, bukan memanggil helper private.
3. **Kontrak publik:** parser/route untuk penolakan inline/header invalid; bukan menguji nama state React, private method, urutan setter atau jumlah internal call yang bukan kontrak.

Prior art: `e2e/store/addresses-mock.spec.ts`, `e2e/store/delivery-quote-mock.spec.ts`, `e2e/store/delivery-order-mock.spec.ts`, `e2e/store/checkout-review-mock.spec.ts`, `apps/store/src/lib/client-addresses.db.test.ts`, dan `apps/store/src/features/checkout/checkout-attempt-repository.db.test.ts`.

Fixture expected harus literal independen: dua alamat dengan nama **Kendricko** tetapi street/telepon/wilayah berbeda; bukan snapshot yang dihitung ulang oleh helper implementation. Test eksternal Shipment/Jubelio/Midtrans dimock. DB test yang skipped karena infrastruktur belum ada bukan Verified.

### 9.2 Irisan implementasi yang diusulkan, bukan breakdown ticket yang dipublikasikan

1. **Tambah → card → alamat persisted:** RED pada public create/route seam untuk key/replay, lalu flow modal simpan dan pemilihan/card. Jalur user berakhir pada alamat yang benar-benar tersimpan, bukan foundation DB saja.
2. **Pilih/edit → card konsisten → quote terbaru:** pastikan existing/default/new dan edit same-ID, error/retry serta keyboard/mobile mengikuti kontrak yang sama.
3. **Review → place-order tanpa saver:** ganti seluruh intent/validator, hapus saver kedua lifecycle, pertahankan snapshot/recovery, guard legacy dan regresi gate 0/1.

Semua irisan merupakan satu deliverable terintegrasi. Slice awal tidak boleh dilaporkan memenuhi AC13/seluruh flow bila backend lama masih dapat menyimpan alamat. Tidak membuat ticket multi-session tanpa approval breakdown terpisah.

### 9.3 Verification ladder

- L0 tiap slice: `npm run verify:types:store`.
- L1 RED→GREEN: `npm run verify:unit:slice -- <path eksplisit dari tabel berikut>`; satu perilaku/seam per loop. Jangan menjalankan semua file setiap perubahan.

| Irisan | Path L1 eksplisit yang relevan |
|---|---|
| Create/retry alamat | `apps/store/src/app/api/addresses/route.test.ts`, `apps/store/src/lib/client-addresses.db.test.ts` |
| Input dan pemutusan saver | `apps/store/src/features/checkout/place-order-input.test.ts`, `apps/store/src/app/api/checkout/place-order/route.lifecycle-parity.test.ts` |
| Order/promotion/recovery | `apps/store/src/features/checkout/place-order-repository.db.test.ts`, `apps/store/src/features/checkout/checkout-attempt-repository.db.test.ts` |

L2 **hanya pada akhir deliverable terintegrasi**, bukan tiap slice:

```bash
npm run test:unit
npm run verify:types:store
npm run verify:batch:e2e -- e2e/store/addresses-mock.spec.ts e2e/store/delivery-quote-mock.spec.ts e2e/store/delivery-order-mock.spec.ts e2e/store/checkout-review-mock.spec.ts e2e/store/versioned-checkout-mock.spec.ts
```

- Set `DATABASE_URL` ke database disposable yang sesuai guard suite; jangan memakai DB development pengguna untuk test destructive. Suite attempt existing mensyaratkan nama `marketplace_discounts_test_*`. Konfigurasi fixture lain harus diperiksa sebelum run, bukan diasumsikan semuanya infrastrukturless.
- Playwright spec authored bersama fitur, dieksekusi di gate final. Legacy `npm run test:e2e` memerlukan izin terpisah; bila menjadi syarat yang belum dapat dijalankan, catat Pending, jangan ganti dengan unit count.
- Typecheck admin hanya jika konsumen shared/type memang terdampak. Build/lint bukan pengganti AC.
- Main agent menjalankan validasi dan rendered UX review. Tidak ada subagent yang diizinkan saat ini.
- Output disposable tetap di `playwright/`; kegagalan Playwright didiagnosis dari Markdown, bukan membuka screenshot failure.
- Catat hasil per AC di evidence fitur. Re-run focused test jika code/conditions relevan berubah; jangan broad-run untuk reassurance.

## 10. Di luar scope

- Redesign seluruh Buku Alamat, editor semua alamat existing di checkout, delete alamat dari checkout, pencarian/pagination baru pada picker.
- Perubahan aturan telepon global akun, normalisasi nomor internasional baru, geocoding, map pin, label Rumah/Kantor, atau verifikasi alamat fisik oleh kurir.
- Dedupe otomatis alamat serupa lintas penambahan, idempotency receipt permanen, optimistic concurrency universal pada CRUD alamat.
- Mengubah pricing/pajak/ongkir/promo, stok, SO, booking, pembayaran, TTL, atau snapshot order historis.
- Backfill/reset data, menghapus attempt lama, menyatakan hasil provider unknown sebagai gagal, atau menjalankan recovery live tanpa izin.
- Perubahan schema/env/ports/deployment runtime yang belum ditemukan perlu; ticket breakdown, commit, remote, push/deployment.

## 11. Open items, discovery, dan batas approval

### Fakta yang harus dicari agent

- `discovery: apps/store/src/features/checkout/checkout-attempt-repository.ts` — apakah environment target memiliki attempt nonterminal dengan save-intent lama, termasuk manual review, dan bagaimana owner menyelesaikannya sebelum cutover? Membaca DB target/menjalankan operasional hanya setelah akses/scope diizinkan. Ini blocker rollout, bukan pertanyaan agar user menebak isi tabel.
- `discovery: apps/store/src/app/checkout/page.tsx` — fixture transisi pending lama mana yang harus dipertahankan agar lookup hasil existing tidak berubah menjadi submit baru? File/seam sudah diketahui; kunci perilaku pada spec sebelum mengubah flow.
- `discovery: apps/store/src/components/checkout/DeliveryQuotePanel.tsx` dan `apps/store/src/app/account/addresses/page.tsx` — verifikasi referensi rendered dan state dark/mobile; belum ada browser review pada penyusunan spec. Tidak perlu menentukan palet baru.
- `discovery: e2e/store/delivery-order-mock.spec.ts` dan `e2e/store/checkout-review-mock.spec.ts` — inventaris fixture inline yang harus beralih ke create → addressId dan kebutuhan DB disposable/env fixture per suite sebelum L2.
- Context7 untuk library slice belum dilakukan karena belum ada implementasi; wajib sebelum code API baru.

### Cakupan complete spec yang disetujui

- Pengaman create-key opsional dan batas jaminannya (§5.3), bukan tabel idempotency baru.
- Card berisi seluruh detail wilayah, copy/action/state dan batas edit D3 (§5.2, §7).
- Validasi kontak checkout lebih awal tanpa mengubah aturan global Buku Alamat (§5.2).
- Cutover drain/guard legacy, penolakan payload inline, dan pemulihan pending body lama (§5.6).
- File-level blueprint, test seams yang sudah dikonfirmasi, acceptance/verification AC01–AC20.

Tidak ada keputusan D1–D5 yang dibuka ulang. Approval berasal dari pesan user yang dicatat di §1, bukan self-review agent. Perubahan perilaku/scope setelah persetujuan tetap memerlukan approval baru. Discovery dan pemeriksaan operasional tidak dianggap selesai hanya karena spec disetujui.

## 12. Checklist penutupan implementasi

- [x] AC01–AC20 memiliki evidence aktual; seluruh 20 baris Verified (AC18 dengan catatan dark theme N/A untuk store) melalui §14.
- [x] L0/L1 dan final L2 yang diwajibkan lulus pada perubahan terintegrasi; serial unit suite 204 file / 2455 test lulus dan 67 test E2E lulus (lihat §14).
- [x] Rendered UI/task-flow review desktop/mobile serta perbandingan referensi dan keyboard/theme dicatat oleh main agent. — Dilakukan pada 2026-11-15: Chromium + server mock + DB disposable, artefak di `playwright/mcp/address-review/`; perbandingan dengan form `/account/addresses` dan card alamat existing; dark theme N/A karena store tidak punya theme toggle (`darkMode: "class"` tanpa provider).
- [x] Tidak ada mutasi buku alamat dari quote/review/place-order/promotion/recovery; guard legacy diverifikasi pada fixture dan prasyarat rollout didokumentasikan. Preflight/pause/deployment aktual tetap gate operasional terpisah.
- [x] Dokumentasi fitur/API diperbarui; catatan transisi/rollout ditautkan di `docs/features/delivery-orders.md`.
- [x] Spec tetap disimpan di `plan/`; index fitur mencatat approval, blocker, evidence dan tanggal.

Seluruh checklist penutupan terpenuhi. Temuan tambahan dari gate AC18: satu defect
nyata pada `CheckoutAddressCard` (`.trim()` pada label wilayah yang bisa
`undefined`, membuat halaman crash di spec cross-check) sudah diperbaiki sebelum
review rendered.

### Catatan fixture run AC09/AC18

DB disposable `marketplace_discounts_test_ci2` (push + seed + fixture E2E) dibuat
untuk run ini dan dihapus setelahnya; server mock + `next dev` port 3110/3112
dihentikan. Artefak review disimpan di `playwright/mcp/address-review/` (disposable).

## 13. Verifikasi penyusunan dokumen

| Cakupan permintaan spec | Status | Evidence |
|---|---|---|
| Sintesis keputusan D1–D5 tanpa mengubah keputusan user | Verified | Tabel §3 menautkan keputusan existing; pengaman/blueprint usulan dipisahkan pada §5–9 dan §11. |
| Batas test dikonfirmasi sebelum penyusunan | Verified | User memilih **Sesuai** pada pertanyaan browser + API/persistence. |
| Approval complete spec dicatat tanpa memulai implementasi | Verified | Pesan user **“oke saya setuju dengan specnya”**, 2026-11-15; cakupan tercatat di §1 dan lifecycle diperbarui di index fitur. |
| Blueprint teknis/UX, AC, non-scope, dan open items tercatat | Verified | §5–12; AC01–AC20 seluruhnya Pending untuk implementasi. |
| Path/link dan format dokumen diperiksa | Verified | Validator dokumentasi lokal: 14 tautan/anchor dan 74 referensi path valid, termasuk dua file UI yang direncanakan dibuat; tidak ada trailing whitespace. `git diff --check -- .scratch/checkout-delivery-address/index.md` lulus. |

Status Verified di tabel ini hanya untuk pekerjaan dokumentasi; tidak menjadi evidence runtime bagi AC implementasi.

## 14. Evidence implementasi (2026-11-15)

Implementasi mengikuti §5–§7. Seluruh bukti di bawah berasal dari run nyata pada
database disposable `marketplace_discounts_test_ci1` (dibuat, di-push, di-seed,
dihapus setelah run) dan server mock terisolasi port 3110/3111/3112.

| AC | Status | Evidence |
|---|---|---|
| AC01 | Verified | `delivery-quote-mock`: `address actions remain clear…` (Batal → tidak ada card, `Alamat terpilih` count 0) dan modal test (`unchanged.fullAddress` tetap). |
| AC02 | Verified | `delivery-order-mock`: `saves the checkout address before the order…` — row buku alamat ada sebelum order, `orders.address_id` = row tersebut, snapshot memuat jalan. |
| AC03 | Verified | `delivery-quote-mock`: `a customer with no saved addresses saves the modal address before the order` — reload hanya memuat daftar (`createPosts` 0) dan alamat tetap ada. |
| AC04 | Verified | Quote payload probe `{itemIds, addressId}` (spec ticket 03), `place-order-input.test.ts` (payload inline ditolak), route quote menolak `newAddress` 400. |
| AC05 | Verified | Modal test (tanpa centang → `isDefault:false`; dicentang → tepat satu default) + `client-addresses.db.test.ts` (default tunggal, concurrent). |
| AC06 | Verified | Modal test: `Simpan perubahan` → satu row (`edited[0].id === saved[0].id`), Batal edit tidak mengubah server. |
| AC07 | Verified | Modal test: telepon `12345` → `Nomor telepon penerima harus berisi 8–15 angka.`, dialog tetap terbuka + `client-addresses.db.test.ts` (input/region invalid tanpa mutation). |
| AC08 | Verified | Modal test: `Menyimpan alamat…` terlihat dan Batal ditahan; `client-addresses.db.test.ts`: 3 create concurrent satu key → 1 row, replay tanpa region call & tanpa re-apply default, key sama tujuan berbeda → `REQUEST_KEY_CONFLICT`; `address-api.test.ts` 409/400. |
| AC09 | Verified | `delivery-quote-mock`: `an edit whose response is lost reconciles by reading the address book, never by writing again` — PATCH di-`abort`, copy *Status perubahan belum dapat dipastikan* tampil, tombol menjadi **Tutup**/**Periksa alamat** (bukan Batal), nol PATCH/POST tambahan, hanya GET daftar, tidak ada row `Jl. Modal Baru No. 22`, dan tujuan aktif tetap alamat tersimpan. |
| AC10 | Verified | `address actions…` (1280/390): card existing menampilkan penerima, telepon, jalan, `Fixture Area, Fixture District`, `Fixture City, Fixture Province · Kode pos 01234`; modal test: card hasil create; dua alamat fixture dengan nama penerima sama dibedakan lewat detail. |
| AC11 | Verified | `delivery method quotes rates…` (perubahan tujuan membuang layanan) + modal test (edit same-ID → radio layanan tidak terpilih, quote ulang). |
| AC12 | Verified | `a cart quantity change requotes…`: setelah `rate-failure`/`rate-empty` alamat tersimpan masih ada di `/api/addresses` dan tidak ada ongkir nol. |
| AC13 | Verified | `place-order-repository.db.test.ts` (legacy delivery: `is_default`/`updated_at` identik), `route.lifecycle-parity.test.ts` (nol write tabel address), `checkout-attempt-repository.db.test.ts` (promotion/recovery tanpa write alamat). |
| AC14 | Verified | `addresses-mock.spec.ts` (6 lulus, isolasi lintas client) + `client-addresses.db.test.ts` ownership + `address-api.test.ts` sesi ditolak. |
| AC15 | Verified | `checkout-attempt-repository.db.test.ts`: hapus alamat setelah reservation → `orders.address_id` null, `delivery_snapshot.address.fullAddress` tetap; `place-order` legacy menyimpan snapshot tujuan. |
| AC16 | Verified | `place-order-input.test.ts` menolak `newAddress/saveAddress/saveRequestId`; `versioned-checkout-mock.spec.ts` test baru: pending body lama hanya lookup, 404 → notice + `Pilih alamat dan review ulang`, nol POST place-order, record pending dibuang. |
| AC17 | Verified (kode+runbook) | `checkout-attempt-repository.db.test.ts`: reservation menolak save-intent sebelum side effect, promotion gagal closed, recovery menahan attempt `manual_review` tanpa menghapus evidence dan tanpa membuat alamat. Runbook §5.6 didokumentasikan di `docs/features/delivery-orders.md`. Preflight/pause environment tetap gate operasional terpisah. |
| AC18 | Verified (light; dark N/A) | Assertion: fokus awal `#checkout-recipient`, aktivasi Enter, `aria-expanded` reset, state saving (`Menyimpan alamat…`, Batal nonaktif), error validasi, alamat panjang utuh, 390/1280 tanpa overflow. Rendered review main agent (Chromium, server mock + DB disposable, artefak `playwright/mcp/address-review/{card,dialog,picker}-{390,1280}.png`): card 390 px membungkus nama/telepon/jalan(3 baris)/wilayah/kode pos/**Alamat utama**, 0 dari 7 node terpotong (`scrollWidth <= clientWidth`), lebar card 308 px; footer modal 390 px terlihat penuh (`y+h=707 <= 844`) dan 1280 px `y=733`; dua alamat bernama **Kendricko** dibedakan lewat jalan di opsi picker, dan alamat legacy tampil disabled dengan alasan **Wilayah belum lengkap — perbarui di Buku Alamat**. **Dark theme N/A untuk store**: `apps/store/tailwind.config.ts` memakai `darkMode: "class"` tetapi tidak ada theme provider/toggle di app store (tidak ada `.dark` yang pernah dipasang; diverifikasi runtime `htmlHasDarkClass=false`). Temuan non-blocking: trigger `Select` memakai `line-clamp-1` dari shared component sehingga nama di trigger terpotong satu baris — detail lengkap tetap di card dan di baris opsi, sesuai §7.1; mengubah trigger berarti mengubah shared component dan butuh keputusan terpisah. |
| AC19 | Verified | `addresses-mock` (tanpa header baru) + `npm run verify:batch:unit` 204 file lulus / 3 skipped, 2455 test lulus / 25 skipped. |
| AC20 | Verified | `docs/features/{client-addresses,delivery-quotes,delivery-orders}.md` + `docs/api-reference.md` diperbarui; log boundary alamat tetap PII-safe (key tidak di-log); tidak ada perubahan schema/migration/env/deployment runtime. |

### Perintah gate yang dijalankan

```bash
DATABASE_URL=<disposable> npm run verify:types:store          # lulus
DATABASE_URL=<disposable> npm run verify:batch:unit           # 204 passed | 3 skipped; 2455 passed | 25 skipped
DATABASE_URL=<disposable> npm run verify:batch:e2e -- \
  e2e/store/addresses-mock.spec.ts e2e/store/delivery-quote-mock.spec.ts \
  e2e/store/delivery-order-mock.spec.ts e2e/store/checkout-review-mock.spec.ts \
  e2e/store/versioned-checkout-mock.spec.ts                   # 67 lulus (batch terakhir: 1 timeout cold-start pada
                                                              # delivery-order-mock; dijalankan ulang sendiri → 7/7 lulus)
```

Catatan fixture run E2E pada DB disposable (mode seed `demo`, bukan dev DB
pengguna): branch Home Branch admin perlu `jubelio_location_id` + `operating_hours`
aktif agar spec checkout-review berjalan; gate `discounts.contractVersion`
diset `0` untuk spec checkout dan `1` untuk unit suite discount/price.

### Deviation log

- `apps/store/src/lib/address-api.test.ts` (file baru) menggantikan sebagian
  cakupan header/status yang sebelumnya direncanakan di `route.test.ts`:
  `route.test.ts` mem-mock boundary `addressApi`, sehingga 400/409 nyata hanya
  bisa dibuktikan di seam boundary. `route.test.ts` tetap ditambah assertion
  pass-through header.
- `e2e/store/checkout-cross-check-mock.spec.ts` dan
  `e2e/store/discounts-coupon-mock.spec.ts` hanya menerima penyesuaian label
  tombol (`Gunakan alamat baru` → `Tambah alamat`) karena keduanya merujuk
  tombol tersebut; tidak ada perubahan perilaku yang diuji di sana.
