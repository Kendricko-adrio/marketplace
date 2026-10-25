# Akses dan Izin Verifikasi Jubelio di Akun Test Terisolasi

Label: wayfinder:task
Type: task
Status: resolved
Assignee: none
Blocked by: none
Parent: [Wayfinder Desain Diskon](map.md)

## Question

Akun test terisolasi, akses, dan scope request yang disetujui terpisah apa yang dapat menyediakan bukti nominal provider yang masih kurang secara aman?

Ini merupakan prerequisite human-in-the-loop, bukan izin umum menulis ke provider. Pemilik menetapkan authorization bisnis/akun; agent memeriksa credentials yang tersedia secara privat, bukan meminta rahasia dikirim melalui chat.

Tetapkan apakah pengujian terbatas boleh mencakup pembuatan SO disposable dengan diskon zero/nonzero, konversi invoice/payment, cancellation pre-invoice yang eligible, dan pemeliharaan marker dengan full payload. Catat tindakan/limit yang diizinkan, fixtures terproteksi/disposable, akun terisolasi, batas evidence/cleanup, dan eskalasi ketika hasil ambigu. Pemilik boleh menolak business writes: catat jalur bukti alternatif dan launch blocker yang timbul.

## Referensi dan batasan

- [Matriks izin/bukti research](../research/discounts-coupons-promo-codes.md#f-proposed-sandbox-research-matrix-and-permissions).
- [Keamanan provider](../../../docs/features/jubelio-sales-orders.md).
- [Batas project](../../../AGENTS.md).

Persetujuan map/tiket tidak mengizinkan `POST /login`, penulisan SO/invoice/payment, cancellation, atau mirror edit. Izin login saja bukan izin business write. Kasus uji yang bergantung pada finance/eligibility diperjelas setelah tiket keputusan terkait selesai; setujui **protokol request aktual yang terbatas** sebelum dikirim, bukan mengandalkan izin umum di awal.

## Bukti penyelesaian

Lokasi akses/fakta akun yang aman tanpa credentials atau PII; scope/pengaman yang disetujui atau tindakan yang ditolak/ditunda; serta instruksi tepat untuk tiket bukti provider. Jika akses akun yang diperlukan belum tersedia, pertahankan blocker, jangan mengklaim siap diverifikasi.

## Batas pekerjaan

Claim sebelum mengerjakan prerequisite HITL ini. Muat `development-workflow`, `grilling`, `domain-modeling`, dan `research`. Pemeriksaan read-only mengikuti kebijakan project; POST aktual memerlukan izin spesifik tersendiri. Jangan mengirim request provider hanya untuk menyelesaikan task ini, mengubah order existing, membuat script aplikasi executable, mendelegasikan, atau commit.

## Comments

Dipublikasikan setelah persetujuan decision map saja. Pada saat publikasi belum ada request provider atau penetapan akun yang disetujui.

### Otorisasi pemilik pada sesi lanjutan

- Pemilik menyatakan credentials pada `.env` merupakan akun sandbox terisolasi dan tidak memengaruhi production. Pernyataan ini adalah konfirmasi pemilik, belum verifikasi teknis oleh agent.
- Pemilik mengizinkan login ke akun tersebut dan pembuatan SO sandbox.
- Pemilik mengizinkan GET data Jubelio dan menyerahkan pemilihan SKU kepada agent, dengan syarat SKU memiliki stok tersedia.
- Credentials tidak diminta melalui chat dan tidak boleh disalin ke tiket/evidence.
- Pada konfirmasi lanjutan, pemilik juga secara eksplisit mengizinkan konversi invoice, payment, cancellation, dan marker edit untuk pengujian sandbox. Ini memperluas jenis tindakan yang diizinkan, bukan persetujuan protokol request aktual tanpa batas.
- Seluruh business writes dibatasi pada SO disposable yang dibuat untuk pengujian ini; tidak ada izin mengubah order existing di luar fixtures pengujian. Cancellation yang akan diusulkan hanya pre-invoice dan eligible; cancellation setelah invoice tidak diasumsikan aman atau masuk protokol.
- Cleanup di luar cancellation tersebut, delegasi, perubahan aplikasi, dan commit tidak diizinkan.
- Konfirmasi awal bounded memberi keleluasaan menentukan pengujian sandbox, termasuk quantity, nominal, fixtures, dan urutan tindakan, dengan batas keras maksimal **5 SO baru**. Batas dihitung konservatif sebagai maksimal 5 request create, termasuk hasil ambigu; tidak ada retry create untuk mengakali batas. Pemilihan SKU tetap oleh agent melalui GET dengan stok tersedia.
- Otorisasi terbaru mencakup eksekusi pengujian, bukan sekadar pencatatan izin pada tiket ini. Agent boleh menentukan protokol terbatas tanpa meminta persetujuan teknis berulang; tidak berarti menyetujui kebijakan finansial production pada tiket 04/09.
- Pemeriksaan privat menemukan `.env` tidak tersedia pada worktree ini, tetapi tersedia di root main checkout yang ditunjuk `git rev-parse --git-common-dir`. Pasangan credentials, base URL `https://api2.jubelio.com`, konfigurasi tax ID, dan payment account tersedia. Tidak ada isi credentials yang dicetak/disalin. Isolasi sandbox merupakan konfirmasi pemilik, bukan sesuatu yang terbukti hanya dari hostname API bersama.
- Jika write menghasilkan outcome ambigu, hentikan write dan lakukan rekonsiliasi GET/manual review; jangan blind retry.
- Pada tahap pencatatan izin awal belum ada request provider. Setelah otorisasi bounded terbaru, login berhasil; catalog, stock, tax, payment account dan dummy customer diperiksa. Customer dummy baru ID 116918 dibuat dan diverifikasi melalui GET tanpa PII. Konfigurasi payment account ID 2 cocok dengan lookup provider. `No Tax` ID 1, rate 0 diverifikasi.

### Tambahan budget setelah kasus H

Pemilik mengizinkan **maksimal 5 request create SO tambahan jika diperlukan**, setelah budget awal 5/5 terpakai. Dengan demikian batas kumulatif untuk rangkaian pengujian ini menjadi **10 request create**, bukan reset counter; tambahan yang baru diizinkan belum dijalankan pada saat pencatatan ini. Request ambigu tetap mengonsumsi budget. Izin invoice/payment/cancellation/marker sandbox sebelumnya tetap berlaku pada fixtures research; tidak ada perluasan ke production, aplikasi, delegasi, atau commit.

Gunakan tambahan hanya untuk gap bukti yang konkret (misalnya quantity >1, alokasi beberapa baris, atau preservasi diskon pada marker/invoice/payment), catat protokol sebelum write dan request/response tersanitasi. Izin tambahan bukan kewajiban menghabiskan semua 5 slot atau izin blind retry B/G yang masih unknown. Counter awal dan evidence tidak boleh dihapus/reset; hitung semua create lanjutan pada batas kumulatif yang sama.

### Penggunaan tambahan budget

Setelah pemilik meminta “iya tolong jalankan”, kelima create tambahan J–N dieksekusi sesuai [protokol aktual](../research/sandbox-followup.md). Counter kumulatif sekarang **10/10**, tidak direset; tidak ada izin create ke-11. Semua create tambahan terkonfirmasi; J diteruskan ke marker/invoice/payment, K–N canceled dan stock restore terverifikasi. B/G lama tetap unknown, tanpa retry. Bukti lengkap dan batas klaim dicatat pada artefak/tiket 08.

### Otorisasi tranche terbaru — 10 create lagi

Pemilik kemudian menyatakan **“oke kamu bisa create 10 so lagi. lanjutkan sampai semuanya selesai”**. Ini mengizinkan maksimal10 request create tambahan setelah rangkaian existing10, sehingga batas kumulatif terbaru **20 create attempts**. Tidak menumpuk lagi izin5 yang sudah terpakai. Protocol/stop rules tetap berlaku; tidak mengizinkan retry ambigu, perubahan aplikasi/account mapping, source marketplace, atau order non-fixture. Manual UI review B/G sudah diberikan pemilik, tetapi bukan bukti rollback backend.

Tranche terbaru memakai10/10 attempts: tujuh SO mendapatID, tiga request mendapat structured HTTP400 rejection; detail pada [protokol](../research/research-08-write-protocol.md), [hasil research](../research/research-08-evidence.md), dan [journal](../research/research-08-write-results.json). Stop aktif setelah conversion SO68422 mendapat HTTP500/code23113 tanpa invoiceID. Tidak ada retry conversion/payment/cancel untuk SO tersebut; memerlukan operator/support reconciliation.

## Answer

Akses sandbox telah tersedia dan login berhasil. Pemilik mengizinkan tindakan sandbox yang diperlukan serta menyerahkan rincian protokol kepada agent, dengan budget awal5, tambahan5 yang sudah terpakai, lalu tambahan10 pada otorisasi terbaru (batas kumulatif **20 request create**, kini20/20 attempts terpakai). Protokol, batas nominal/quantity, fixtures, marker, evidence, stop rule, dan cleanup tersedia di [protokol dan hasil sandbox](../research/sandbox-verification.md); hasil request tersanitasi dicatat di [evidence JSON](../research/sandbox-results.json). Tidak ada izin tersirat untuk production atau perubahan aplikasi.

Prerequisite akses/izin ini resolved. Ini **tidak** menyelesaikan tiket finance 04, bukti lengkap 08, atau kontrak mapping 09. Pengujian pendahuluan terotorisasi menggunakan pajak/ongkir nol untuk mengisolasi diskon barang; bukan persetujuan accounting production.
