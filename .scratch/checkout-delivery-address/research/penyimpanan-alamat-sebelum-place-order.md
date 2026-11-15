# Research: penyimpanan alamat baru sebelum place-order

- Tanggal: 2026-11-15.
- Baseline kode: commit `164f1f6`; working tree bersih sebelum research.
- Scope: membaca alur checkout **Kirim ke alamat**, pembuatan alamat, quote, review, place-order, promotion/recovery, schema, dan test terkait.
- Metode: penelusuran statis source code sebagai sumber utama; dokumentasi dan test existing sebagai pendukung. Tidak menjalankan aplikasi/test, membaca database, atau mengirim request provider.
- Status: research, **bukan** spec/plan yang disetujui atau izin implementasi. Perilaku aplikasi belum diubah.
- Context7: tidak diperlukan untuk research ini; tidak ada implementasi atau klaim API library baru.

## 1. Kesimpulan utama

**Pemahaman user benar secara garis besar, dengan beberapa penajaman:**

1. Saat customer mengisi modal **Alamat baru**, data masih menjadi draft di React state. Menekan **Gunakan alamat ini** hanya menerapkan draft sebagai tujuan checkout, menutup modal, dan memicu quote. Handler tersebut tidak memanggil API create alamat. [S1]
2. **Penyimpanan ke buku alamat sekarang opsional**, bukan selalu terjadi saat checkout: checkbox **Simpan alamat** default-nya `false`. Jika tidak dicentang, order tetap memakai snapshot alamat tetapi tidak membuat row buku alamat. **Jadikan alamat utama** hanya muncul ketika opsi simpan dicentang. [S1][S2][S3]
3. Jika opsi simpan dicentang, pembuatan row `address` terikat dengan pembuatan order. Ada **dua jalur** yang masih didukung kode: lifecycle checkout attempt dan legacy. Mengubah modal saja belum memenuhi requirement untuk menghilangkan penyimpanan alamat dari place-order. [S8][S9][S10]
4. Frasa “stay pada frontend” akurat **sebelum submit**, tetapi bukan berarti data tidak pernah dikirim ke backend: quote dan review menerima `newAddress` untuk validasi/perhitungan. Setelah submit pada jalur attempt, data juga dapat tersimpan di snapshot `checkout_attempt` sebelum row buku alamat/order terbentuk. [S4][S5][S8][S9]
5. Endpoint **`POST /api/addresses` sudah tersedia** dan langsung menyimpan alamat valid tanpa perlu checkout. Halaman `/account/addresses` sudah memakainya. Ini kandidat reuse utama, bukan kebutuhan membuat mekanisme penyimpanan baru dari nol. [S11][S12][S13]

**Arah requirement yang dipahami:** pembuatan alamat menjadi operasi mandiri di checkout. Setelah penambahan alamat berhasil divalidasi dan disimpan oleh server, checkout menggunakan `addressId` hasil create. Place-order tidak lagi membuat/mengubah buku alamat, tetapi tetap memvalidasi tujuan dan menyimpan snapshot pengiriman pada order.

Contoh: customer menambahkan alamat rumah, lalu meninggalkan checkout sebelum menekan **Bayar Sekarang**. Dalam flow yang diminta, alamat sudah ada di `/account/addresses`; tidak perlu menunggu order berhasil.

## 2. Istilah yang perlu dibedakan

| Istilah | Makna dalam kode saat ini |
|---|---|
| Draft alamat | Input modal yang belum diterapkan; `draftAddress`. |
| Alamat baru terpakai | `appliedNewAddress`/`deliveryNewAddress`, dipakai untuk quote/review tanpa harus punya ID buku alamat. |
| Alamat tersimpan | Row tabel `address`, dimiliki store client; dipilih melalui `addressId`. |
| Snapshot pengiriman | Salinan data tujuan, origin, parcel, service, dan pricing yang dibekukan untuk order. Bukan row baru di buku alamat. |
| Checkout attempt | Bukti proses checkout yang durable sebelum order terbentuk; dapat dilanjutkan oleh replay/recovery. |

Pembedaan ini penting: **menghapus penyimpanan buku alamat dari place-order tidak berarti menghapus alamat dari order**. Snapshot tetap diperlukan agar edit/hapus buku alamat tidak mengubah tujuan order lama. [S7][S9][S14]

## 3. Alur frontend saat ini

### 3.1 Memilih Kirim ke alamat

`apps/store/src/app/checkout/page.tsx` menyimpan state `deliveryAddressId`, `deliveryNewAddress`, `deliverySaveAddress`, dan `saveRequestId`, kemudian memasangnya ke `DeliveryQuotePanel`. UUID save-intent diperbarui ketika isi alamat baru berubah. [S3]

Panel memuat `GET /api/addresses`. Alamat utama yang memiliki wilayah lengkap dipilih otomatis jika customer belum memilih alamat sendiri. Alamat tersimpan dan alamat baru merupakan dua bentuk tujuan yang berbeda. [S1]

### 3.2 Membuka dan mengisi modal

- **Gunakan alamat baru** membuka modal.
- Input masuk ke `draftAddress`, terpisah dari tujuan yang sedang dipakai.
- Mengganti wilayah induk mengosongkan pilihan turunannya dan kode pos; kode pos mengikuti Kelurahan/Area.
- `isCompleteAddress()` hanya memeriksa field wajib terisi; **bukan** pembuktian bahwa seluruh input lolos validasi server.
- **Simpan alamat** adalah pilihan opsional; mematikannya juga menghapus flag `isDefault` pada draft.
- **Batal**/tutup tidak menerapkan draft; membuka ulang modal menginisialisasi draft dari alamat baru terpakai atau input kosong. [S1][S2]

### 3.3 Menekan Gunakan alamat ini

`applyDraftAddress()` melakukan:

```text
cek draftReady
→ setAppliedNewAddress(draftAddress)
→ setSaveAddress(draftSaveAddress)
→ kosongkan addressId
→ tutup modal
```

**Tidak ada `POST /api/addresses` di handler ini.** Tujuan baru kemudian digunakan untuk quote otomatis sebagai `{ itemIds, newAddress }`, bukan `{ itemIds, addressId }`. Mengubah tujuan membatalkan layanan/approval lama sehingga customer harus memilih layanan kembali. [S1]

### 3.4 Review dan submit

Halaman membentuk intent delivery dengan salah satu cabang:

```text
alamat tersimpan: addressId
alamat baru:      newAddress + saveAddress + saveRequestId
```

Bentuk tersebut dipakai untuk review dan place-order. Pada checkout berversi, request final juga disimpan ke `sessionStorage` sebagai `checkoutRequest:<clientId>` sebelum submit, untuk pemulihan request yang sama. Jadi ini bukan jaminan bahwa data alamat hanya hidup di memori React sepanjang proses. Draft modal sendiri tidak memiliki persistence terpisah yang ditemukan pada alur ini. [S3][S15]

## 4. Alur backend saat ini

### 4.1 Quote dan review tidak membuat buku alamat

`POST /api/checkout/delivery-quote` menerima union strict:

- `{ itemIds, addressId }`; atau
- `{ itemIds, newAddress }`.

Alamat tersimpan diperiksa ownership-nya. Alamat baru melewati schema input dan validasi hierarki wilayah/kode pos melalui Shipment region gateway. Route menghitung quote; tidak memasukkan alamat ke tabel `address`. [S4][S6]

Review delivery juga menerima dua bentuk tujuan. Cabang alamat baru membawa `saveAddress` dan `saveRequestId`, tetapi operasi review bukan tempat create buku alamat. [S5]

### 4.2 Entry point place-order

`POST /api/checkout/place-order` memeriksa sesi store yang onboarded, mem-parse body, dan memanggil `placeCheckoutOrder()`. Schema delivery masih menerima `addressId` **atau** `newAddress + saveAddress + saveRequestId`. [S7]

Service memilih jalur berdasarkan kontrak pricing yang dibaca dari config, bukan hanya karena metode fulfillment delivery. Gate `1` memerlukan request key/review token; lifecycle snapshot dan identity yang lengkap menuju checkout attempt. Jalur lain menuju `placeOrderLegacy()`. Nilai gate pada database pengguna **tidak diperiksa** dalam research ini. [S8]

Keduanya melakukan quote/validasi ulang sebelum menerima approval. `placeDeliveryQuote()` menghasilkan `verifiedNewAddress` ketika input berupa alamat baru. [S16]

### 4.3 Jalur lifecycle checkout attempt

Urutan relevan:

```text
quote/approval valid
→ buat snapshot attempt, termasuk addressToSave jika saveAddress=true
→ reserveCheckoutAttempt() menyimpan snapshot ke checkout_attempt
→ proses Sales Order dan penyiapan sesi pembayaran
→ promoteCheckoutAttempt()
→ insert address bila ada addressToSave + insert order dalam transaksi lokal
```

Detail penting:

- `place-checkout-service.ts` membangun `snapshot.addressToSave` dari alamat canonical yang sudah divalidasi, hanya ketika `saveAddress=true`. [S8]
- `reserveCheckoutAttempt()` menyimpan snapshot tersebut, tetapi belum membuat row buku alamat. [S9]
- `promoteCheckoutAttempt()` mensyaratkan state/payment/hold dan bukti SO yang siap. Jika `addressToSave` ada, ia membuat atau memeriksa alamat lalu membuat order dalam transaksi yang sama. ID alamat baru umumnya `checkout:<attempt.id>`. Jika alamat diminta menjadi utama, default lama dibersihkan di jalur tersebut. [S9]
- **Sesi pembayaran siap bukan berarti customer sudah membayar.** Jadi persistence alamat bukan menunggu settlement pembayaran. [S9][S17]
- Recovery dapat memanggil promotion juga. Dengan demikian pembuatan alamat bisa terjadi saat pemulihan proses, bukan hanya selama HTTP request place-order pertama. [S18]
- Jika `saveAddress=false`, snapshot order tetap membawa tujuan, tetapi `addressToSave=null` dan `addressId` untuk alamat baru tetap `null`. [S8][S9]

### 4.4 Jalur legacy

`placeOrderLegacy()` memanggil `saveCheckoutAddress()` sebelum insert order, masih dalam transaksi lokal yang sama. Helper tersebut:

1. Hanya berjalan untuk delivery dengan `newAddress`, `saveAddress=true`, dan alamat tervalidasi.
2. Mengunci owner, membangun ID stabil dari hash `clientId:saveRequestId`, dan memeriksa row existing.
3. Memakai ulang row identik untuk save-intent yang sama atau menolak konflik isi alamat.
4. Membersihkan default lama bila perlu, lalu insert alamat canonical.
5. Mengembalikan ID yang dipasang ke order. [S10]

**Perbedaan dedupe:** helper legacy memakai `saveRequestId`, sedangkan jalur attempt yang dibaca memakai identitas attempt untuk alamat barunya. Jangan menganggap keduanya mempunyai jaminan dedupe lintas checkout yang persis sama hanya berdasarkan dokumentasi lama. Replay checkout memiliki identitas request tersendiri. [S9][S10][S19]

## 5. Mekanisme simpan langsung yang sudah tersedia

Alur `/account/addresses` saat customer menekan **Simpan alamat**:

```text
POST /api/addresses
→ addressApi("create", ...)
→ requireOnboardedApiSession()
→ createClientAddressBook(db, regionGateway).create(clientId, input)
→ schema validation
→ validasi region canonical
→ transaksi: lock client, bersihkan default bila diminta, insert address
→ { success: true, data: ClientAddressView }
```

`ClientAddressView` sudah membawa `id`, nama penerima, telepon, alamat, wilayah canonical, kode pos, dan `isDefault`. Hasil ini cukup untuk memilih alamat tersimpan di checkout tanpa menunggu order. Boundary existing juga memiliki logging tanpa isi alamat/telepon dan mapping error aman. [S11][S12][S13]

Batas yang perlu diperhatikan:

- `create()` menggunakan UUID baru setiap panggilan; tidak ditemukan kontrak idempotency create pada API ini. Timeout setelah server berhasil menyimpan lalu retry dapat menimbulkan duplikasi jika tidak ditangani. Menonaktifkan tombol saat loading hanya menangani sebagian risiko tersebut. [S12]
- `isDefault=false` tidak otomatis menjadikan alamat pertama sebagai utama. Mempertahankan perilaku ini tidak membutuhkan aturan bisnis baru. [S12]
- Schema input sekarang membatasi telepon dengan pola karakter sepanjang 5–25, sementara validasi kontak delivery pada **Lanjut** meminta 8–15 digit. “Semua field valid” perlu mencakup kelayakan dipakai checkout, bukan sekadar `draftReady`. Contoh: `12345` dapat melewati schema alamat tetapi ditolak ketika melanjutkan checkout. Ini temuan perbedaan validasi, bukan perubahan yang sudah disetujui. [S12][S15]

## 6. Interpretasi requirement dan dampak perubahan

### 6.1 Yang dinyatakan user

- Alamat baru dari checkout tidak lagi menunggu place-order untuk terbentuk.
- Setelah penambahan alamat dan validasi berhasil, alamat langsung tersimpan.
- Place-order tidak lagi bertanggung jawab menyimpan alamat user.

### 6.2 Arah teknis yang direkomendasikan, belum disetujui sebagai spec

Pisahkan command **buat alamat** dari command **buat order**:

```text
customer konfirmasi tambah alamat
→ POST /api/addresses
→ server validasi + simpan
→ pilih addressId dari response
→ quote/review menggunakan addressId
→ place-order menggunakan addressId dan membuat snapshot, tanpa mutasi buku alamat
```

Rekomendasi ini memakai jalur alamat tersimpan yang sudah ada. Pada flow baru, customer tidak melanjutkan sebagai alamat “sudah disimpan” hanya berdasarkan validasi frontend; response sukses server menjadi penentu.

Konsekuensi yang perlu disadari:

| Kondisi | Perilaku saat ini | Konsekuensi arah baru |
|---|---|---|
| Alamat diterapkan, customer meninggalkan checkout | Belum ada row buku alamat. | Row tetap ada jika create alamat sudah sukses. |
| Alamat berhasil ditambahkan, quote ongkir gagal | Belum membuat row buku alamat. | Alamat tetap tersimpan; quote dapat dicoba lagi tanpa create ulang. |
| Place-order ditolak/reprice/penyiapan pembayaran gagal | Penyimpanan tergantung jalur dan apakah transaksi pembentukan order sudah terjadi. | Alamat yang sudah berhasil dibuat tidak dibatalkan oleh kegagalan checkout. |
| Customer menandai alamat utama | Perubahan default mengikuti penyimpanan pada transaksi order. | Jika opsi dipertahankan, perubahan default mengikuti transaksi create alamat, lebih awal. |
| API create alamat menolak input/gagal | Sekarang belum ada panggilan create dari modal. | Modal perlu mempertahankan input dan menampilkan error; jangan lanjut dengan ID fiktif. |
| Alamat diubah/dihapus setelah order terbentuk | Snapshot order tetap stabil; FK dapat menjadi null. | Tetap harus dipertahankan, bukan dihapus bersama logic save. |

Membuat seluruh alamat baru langsung tersimpan berarti checkbox opsional **Simpan alamat** dan status **Akan disimpan di buku alamat** tidak lagi cocok. Penyederhanaan copy/kontrol merupakan konsekuensi UX yang perlu dikonfirmasi, bukan implementasi dalam research ini. [S2][S20]

### 6.3 Peta dampak kode, bukan instruksi implementasi final

| Area/file dari root repo | Dampak yang perlu dievaluasi |
|---|---|
| `apps/store/src/components/checkout/DeliveryQuotePanel.tsx` | Submit create alamat, state saving/error, pemilihan hasil create, pembaruan daftar/preview, pembatalan quote lama; dialog dan kontrol simpan/default. |
| `apps/store/src/app/checkout/page.tsx` | State/props alamat baru dan save-intent, intent review/submit, request tersimpan, reset/reprice setelah tujuan berubah. |
| `apps/store/src/app/api/addresses/route.ts`, `apps/store/src/lib/address-api.ts`, `apps/store/src/lib/client-addresses.ts` | Reuse endpoint/seam existing; evaluasi kecukupan validasi dan keamanan retry, tanpa menduplikasi persistence di checkout. |
| `apps/store/src/app/api/checkout/delivery-quote/route.ts`, `apps/store/src/lib/checkout-delivery-review.ts`, `apps/store/src/features/checkout/place-order-input.ts` | Konsistensi kontrak tujuan `addressId`; keputusan compatibility diperlukan sebelum menghapus cabang payload lama. |
| `apps/store/src/features/checkout/place-order-delivery.ts`, `apps/store/src/features/checkout/place-checkout-service.ts` | Tidak lagi membentuk save-intent/addressToSave untuk checkout baru; validasi/requote dan snapshot tetap ada. |
| `apps/store/src/features/checkout/place-order-legacy-service.ts`, `apps/store/src/features/checkout/place-order-repository.ts` | Jalur `saveCheckoutAddress()` masih merupakan mutasi buku alamat yang perlu ditangani jika requirement berlaku pada semua kontrak. |
| `apps/store/src/features/checkout/checkout-attempt-repository.ts`, `apps/store/src/features/checkout/recover-checkout-service.ts` | Promotion/recovery tidak boleh diam-diam kehilangan kewajiban save pada attempt lama yang sudah durable; tentukan strategi transisi dahulu. |
| `packages/db/src/schema/checkout.ts` | `CheckoutAttemptSnapshot.addressToSave` adalah kontrak JSON durable, bukan kolom alamat baru. Mengubah type saja tidak mengubah snapshot lama. |
| `packages/db/src/schema/orders.ts` | Tabel/kolom alamat dan relasi order sudah tersedia; belum ditemukan kebutuhan menambah kolom untuk tujuan inti ini. |
| `docs/features/client-addresses.md`, `docs/features/delivery-quotes.md`, `docs/features/delivery-orders.md` | Dokumentasi existing menjelaskan simpan opsional/tertunda; perlu diperbarui bersama implementasi setelah perilaku final disepakati. |

**Catatan batas refactor:** `loadRevalidatedDestination()` untuk alamat tersimpan saat ini memanggil `loadRevalidatedNewDestination()` sebagai helper validasi bersama. Menghapus dukungan payload `newAddress` bukan alasan menghapus helper tersebut tanpa menjaga validasi alamat tersimpan. [S6]

**Catatan compatibility:** body `newAddress` versus `addressId` ikut memengaruhi fingerprint request. Jangan mengonversi body pending yang sudah tersimpan lalu mengulang request dengan key yang sama tanpa strategi; perubahan intent dapat menjadi `REQUEST_KEY_CONFLICT`. Jangan menghapus `addressToSave` dari attempt existing tanpa menyelesaikan kewajiban penyimpanan yang sudah diterima. [S9][S19]

## 7. Coverage existing dan bukti yang perlu ditambah nanti

### Coverage yang ditemukan melalui pembacaan, tidak dijalankan

- `e2e/store/delivery-order-mock.spec.ts:565–605`: alamat tanpa simpan menghasilkan order dengan `address_id=null`, snapshot tujuan, dan buku alamat tidak berubah.
- `e2e/store/delivery-order-mock.spec.ts:607–692`: simpan-sebagai-default setelah order diterima dan dedupe save-intent. Suite tersebut menyetel gate `discounts.contractVersion=0`; coverage ini **bukan** bukti jaminan identik di jalur attempt. [S21]
- `e2e/store/delivery-quote-mock.spec.ts`: dialog, draft belum diterapkan, batal/edit, validasi wilayah, dan perilaku quote; dirujuk juga oleh dokumentasi UX existing. [S20]
- `apps/store/src/features/checkout/place-order-repository.db.test.ts:80–86`: helper save legacy memakai ulang row dan menolak reuse dengan tujuan berbeda. [S22]
- `apps/store/src/lib/client-addresses.db.test.ts`: seam persistence, ownership, validasi canonical, dan default concurrent; memerlukan PostgreSQL. [S23]
- `apps/store/src/features/checkout/checkout-attempt-repository.db.test.ts:358–379`: promotion idempotent setelah SO/payment siap. Fixture snapshot dasar memakai `addressToSave=null`; test tersebut bukan bukti khusus create alamat pada promotion. [S24]

Observasi yang dibutuhkan untuk membuktikan requirement baru, setelah scope disepakati:

1. Create dari modal sudah terlihat melalui `GET /api/addresses` **sebelum** place-order dipanggil.
2. Customer keluar/refresh setelah create berhasil dan alamat tetap tersedia meskipun belum ada order.
3. Input/region invalid tidak membuat row; kegagalan create mempertahankan input dan memberi feedback yang dapat dicoba kembali.
4. Sukses create memilih ID hasil server dan quote/review/place-order menggunakan ID tersebut.
5. Quote/reprice/checkout gagal tidak menghapus alamat yang sudah berhasil dibuat.
6. Replay/retry place-order tidak menambah alamat atau mengubah default; snapshot order tetap stabil.
7. Pemilihan alamat lain/reset layanan, keyboard/focus modal, dan viewport desktop/mobile tetap bekerja.
8. Jika opsi alamat utama dipertahankan, perubahan default terjadi saat create sukses dan tetap maksimal satu default.
9. Kebijakan retry create dan penanganan request/attempt lama mempunyai bukti tersendiri sesuai strategi transisi yang disetujui.

Daftar ini adalah kebutuhan evidence hasil research, **bukan acceptance criteria final yang sudah disetujui**. Research tidak menjalankan unit/E2E maupun mengklaim test existing lulus.

## 8. Open items dan batas scope

### 8.1 Fakta belum diketahui

- Gate yang aktif dan keberadaan attempt/request lama pada environment pengguna belum dibaca. Bukan blocker untuk kesimpulan source code; relevan sebelum menentukan rollout/compatibility.
- Kondisi UI rendered saat runtime belum diverifikasi. Kesimpulan UX di atas berdasarkan JSX/handler dan test source, bukan browser review.
- Tidak ada fakta source-code inti yang masih menghalangi pemahaman alur saat ini.

### 8.2 Keputusan user diperlukan sebelum spec

1. **Pemicu simpan:** “semua field valid” bisa berarti langsung autosave ketika field terakhir valid, atau simpan setelah customer menekan aksi konfirmasi modal. Rekomendasi: aksi eksplisit, misalnya **Simpan dan gunakan**, lalu validasi server; jangan menulis setiap kali form berubah. Contoh: customer mengisi alamat lengkap lalu menekan **Batal**—opsi ini tidak membuat row, sedangkan autosave bisa sudah membuatnya.
2. **Konsekuensi simpan selalu:** interpretasi requirement adalah semua penambahan alamat di checkout masuk buku alamat. Konfirmasi bahwa mode sekali pakai/checkbox **Simpan alamat** dihilangkan, dengan **Jadikan alamat utama** tetap opsional jika perilaku existing ingin dipertahankan. Contoh: alamat hadiah tetap tersimpan meskipun customer tidak jadi membayar.
3. **Semantik Ubah alamat setelah create:** sekarang tombol tersebut mengubah draft, bukan row tersimpan. Setelah create dipercepat, perlu memilih apakah edit memperbarui row yang baru dibuat atau customer hanya boleh memilih/tambah alamat melalui flow yang disepakati. Jangan diam-diam membuat row kedua setiap kali customer mengoreksi nomor rumah. [S20]

Compatibility snapshot/request lama merupakan keputusan teknis transisi yang perlu diajukan saat alignment berdasarkan kondisi environment, bukan meminta user menebak isi database. Jika target user adalah **nol mutasi buku alamat dari semua place-order/recovery**, mempertahankan saver lama tanpa batas tidak memenuhi target tersebut; strategi penyelesaian attempt lama harus dinyatakan jelas.

### 8.3 Di luar scope

- Implementasi kode, perubahan schema/database, backfill, pembersihan alamat lama, dan perubahan default massal.
- Perubahan perhitungan ongkir, promo, pajak, stok, pembayaran, Sales Order, atau booking pengiriman.
- Redesign buku alamat secara menyeluruh atau mengubah snapshot order historis.
- Menulis plan/spec/tickets, menjalankan provider writes, commit, atau deployment.

### 8.4 Rekomendasi langkah berikut

**Klarifikasi langsung** untuk pemicu simpan, mode simpan-selalu, dan perilaku koreksi alamat. Setelah diputuskan, rangkum kesepahaman lalu susun plan/spec dengan blueprint teknis/UX dan strategi transisi untuk approval. Research ini tidak otomatis memulai tahap tersebut.

## 9. Cakupan permintaan → evidence

| Cakupan research | Status | Evidence |
|---|---|---|
| Verifikasi pemahaman penyimpanan frontend versus order | Verified | Penelusuran handler modal, quote/review, kedua saver; bagian 1–4. |
| Pahami requirement dan dampaknya | Verified | Pemisahan tujuan eksplisit, rekomendasi, konsekuensi, dan keputusan terbuka; bagian 6–8. |
| Buat file research beserta rujukan | Verified | Dokumen ini dan tautan pada index fitur. |

`Verified` di tabel ini berarti pemeriksaan source/dokumentasi untuk **research**, bukan verifikasi runtime atau implementasi flow baru.

## 10. Sumber yang dapat diperiksa

Nomor baris mengikuti baseline di atas; source code mengungguli uraian docs lama bila ada perbedaan.

[S1]: ../../../apps/store/src/components/checkout/DeliveryQuotePanel.tsx#L99-L326
[S2]: ../../../apps/store/src/components/checkout/DeliveryQuotePanel.tsx#L672-L730
[S3]: ../../../apps/store/src/app/checkout/page.tsx#L353-L376
[S4]: ../../../apps/store/src/app/api/checkout/delivery-quote/route.ts#L55-L127
[S5]: ../../../apps/store/src/lib/checkout-delivery-review.ts#L88-L104
[S6]: ../../../apps/store/src/lib/delivery-quote-data.ts#L235-L320
[S7]: ../../../apps/store/src/features/checkout/place-order-input.ts#L59-L100
[S8]: ../../../apps/store/src/features/checkout/place-checkout-service.ts#L90-L513
[S9]: ../../../apps/store/src/features/checkout/checkout-attempt-repository.ts#L471-L536
[S10]: ../../../apps/store/src/features/checkout/place-order-repository.ts#L236-L289
[S11]: ../../../apps/store/src/app/api/addresses/route.ts#L12-L23
[S12]: ../../../apps/store/src/lib/client-addresses.ts#L140-L396
[S13]: ../../../apps/store/src/app/account/addresses/page.tsx#L43-L86
[S14]: ../../../packages/db/src/schema/orders.ts#L191-L236
[S15]: ../../../apps/store/src/app/checkout/page.tsx#L785-L817
[S16]: ../../../apps/store/src/features/checkout/place-order-delivery.ts#L47-L64
[S17]: ../../../apps/store/src/features/checkout/place-order-service.ts#L118-L174
[S18]: ../../../apps/store/src/features/checkout/recover-checkout-service.ts#L47-L53
[S19]: ../../../apps/store/src/lib/checkout-request.ts#L42-L62
[S20]: ../../../docs/features/delivery-quotes.md#L7-L13
[S21]: ../../../e2e/store/delivery-order-mock.spec.ts#L565-L692
[S22]: ../../../apps/store/src/features/checkout/place-order-repository.db.test.ts#L80-L86
[S23]: ../../../apps/store/src/lib/client-addresses.db.test.ts
[S24]: ../../../apps/store/src/features/checkout/checkout-attempt-repository.db.test.ts#L358-L379

Rujukan tambahan untuk detail yang dipisahkan di file lain:

- [Payload quote/review/intent frontend](../../../apps/store/src/app/checkout/page.tsx#L806-L817).
- [Request final dan sessionStorage](../../../apps/store/src/app/checkout/page.tsx#L1337-L1398).
- [Props panel checkout](../../../apps/store/src/app/checkout/page.tsx#L1697-L1724).
- [Review memuat tujuan dan membuat snapshot](../../../apps/store/src/lib/checkout-delivery-review.ts#L198-L223).
- [Route place-order](../../../apps/store/src/app/api/checkout/place-order/route.ts#L100-L129).
- [Snapshot addressToSave dan pemilihan legacy](../../../apps/store/src/features/checkout/place-checkout-service.ts#L416-L513).
- [Persist snapshot attempt](../../../apps/store/src/features/checkout/checkout-attempt-repository.ts#L252-L254).
- [Pemanggilan save legacy dan insert order](../../../apps/store/src/features/checkout/place-order-legacy-service.ts#L212-L232).
- [Kontrak durable snapshot](../../../packages/db/src/schema/checkout.ts#L17-L25).
- [Boundary alamat: auth, logging, respons/error](../../../apps/store/src/lib/address-api.ts#L20-L36).
- [Gate pricing dari config](../../../apps/store/src/lib/config.ts#L106-L115).
- [Gate 0 pada suite delivery-order](../../../e2e/store/delivery-order-mock.spec.ts#L352-L353).
- [Fixture attempt tanpa save-intent](../../../apps/store/src/features/checkout/checkout-attempt-repository.db.test.ts#L24).
- [Dokumentasi buku alamat existing](../../../docs/features/client-addresses.md).
- [Dokumentasi order delivery existing](../../../docs/features/delivery-orders.md).
