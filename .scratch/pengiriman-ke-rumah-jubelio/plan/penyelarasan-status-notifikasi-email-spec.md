# Spec: Penyelarasan status, notifikasi, dan email order

## 1. Tujuan dan approval

Delivery harus mencatat pembayaran dengan aturan yang sama seperti pickup, memperbarui Status Channel Jubelio, memberi tahu admin ketika order siap ditangani, dan mengirim email sesuai perkembangan nyata. Cara penyerahan barang tetap berbeda: delivery tidak menghasilkan kode pickup.

- Kesepahaman dikonfirmasi pengguna: **“Sesuai, lanjut draft spec”** setelah ronde grilling.
- Dua klarifikasi blueprint berikutnya dikonfirmasi: aksi notifikasi delivery **Buka order**; bukti diterima yang valid setelah penutupan manual tetap menghasilkan email sudah sampai.
- Approval complete spec, rancangan teknis, dan acceptance criteria: **disetujui pengguna pada 2026-11-09**, dengan pernyataan **“oke sudah approve dari saya untuk specnya”**. Approval mencakup isi spec ini; belum ada implementasi atau verifikasi runtime.
- Status plan hanya di [index fitur](../index.md). Dokumen ini bukan izin implementasi, delegasi, commit, akses remote, provider write, atau deployment.
- Sumber keputusan: [catatan grilling](../wayfinder/penyelarasan-status-notifikasi-email.md). Istilah bisnis: [CONTEXT.md](../../../CONTEXT.md).

## 2. Konteks yang terverifikasi

Transaksi development `SO-000068453` telah menerima settlement Midtrans, invoice Jubelio `45979`, dan payment Jubelio `69`; lihat `logs/store.log:265–293`. Status Channel tetap Belum Bayar karena cabang delivery mengakhiri settlement sebelum pemanggilan mirror sukses.

| Fakta | Referensi |
|---|---|
| Verifikasi Midtrans serta pencatatan invoice/payment memakai pipeline bersama | `apps/store/src/app/api/webhooks/midtrans/route.ts`, `apps/store/src/lib/jubelio-sales-settlement.ts` |
| Delivery terverifikasi tetap processing dan melewati efek pickup | `apps/store/src/lib/jubelio-sales-settlement.ts:245` |
| Siap Proses saat ini mensyaratkan ready_for_pickup; sweep tidak mengambil delivery processing yang sehat | `apps/store/src/lib/jubelio-channel-mirror.ts:1014`, `:2731` |
| Notifikasi order lunas dan email siap diambil berada di fungsi pickup | `apps/store/src/lib/order-finalize.ts:255` |
| Tabel notifikasi belum membawa fulfillmentMethod; aksi per baris selalu Verifikasi pickup | `apps/admin/src/lib/notifications.ts`, `apps/admin/src/app/admin/notifications/page.tsx` |
| Email langsung dikirim tanpa antrean retry tersimpan | `apps/store/src/lib/email.ts:54` |
| Bukti DELIVERED menyelesaikan delivery; order selesai menolak perkembangan status berikutnya | `packages/db/src/shipment-tracking.ts` |
| Penutupan manual berarti penanganan berakhir, bukan bukti barang diterima | `apps/admin/src/lib/delivery-follow-up.ts:540`, `docs/features/delivery-follow-up.md` |

Nomor baris adalah hasil inspeksi saat draft, bukan pengganti pencarian identifier bila kode berubah. Tidak ada request provider atau pengujian runtime baru dalam penyusunan spec.

## 3. Scope dan batas perubahan

### Termasuk

1. Delivery baru mengikuti Status Channel **Belum Bayar → Siap Proses → Selesai** dengan ledger terverifikasi dan pengamanan mirror existing.
2. Satu notifikasi admin setelah delivery siap diproses, terhubung ke order dan cabang yang benar.
3. Kolom **Jenis Order** serta aksi **Buka order** untuk delivery pada tabel notifikasi.
4. Tiga email delivery: sedang disiapkan, sedang diantar, dan sudah sampai.
5. Antrean dan retry untuk **semua email order**: delivery baru, pickup siap diambil/selesai, serta pembayaran gagal pickup/delivery.
6. Bukti diterima yang datang setelah penutupan manual dapat menghasilkan email sudah sampai, tanpa membuka order kembali.
7. Recovery proses komunikasi order baru, deterministik dan tahan restart, termasuk jika aplikasi berhenti setelah transaksi bisnis committed.

### Tidak termasuk

- Backfill, koreksi status, notifikasi, atau email historis. Seluruh data sekarang masih development, project belum live production; `000068453` dibiarkan apa adanya.
- Mengubah formula harga, pajak, diskon, nominal Midtrans/Jubelio, aturan stok, syarat booking, atau izin operasional cabang.
- Mengubah delivery menjadi ready_for_pickup, membuat kode pickup, atau mengirim instruksi pengambilan ke customer delivery.
- Filter baru Pickup/Delivery, halaman riwayat email, tombol resend, tracking publik tanpa login, atau email khusus penutupan manual/kendala kurir.
- Perubahan email autentikasi/verifikasi akun/reset password.
- Redesign notifikasi, penerjemahan massal label existing, atau refactor backend di luar call chain yang disentuh.

## 4. Kontrak perilaku order

### 4.1 Arti status

- **Lunas**: pembayaran customer dikonfirmasi langsung ke Midtrans. Gangguan integrasi berikutnya tidak mengubah fakta ini.
- **Siap Diproses**: pembayaran customer, create Sales Order, invoice, dan payment Jubelio sudah terverifikasi; tidak ada blocker fulfillment/cancel aktif yang menghalangi pemrosesan normal.
- **Mulai Diantar**: bukti pertama dari catatan serah-terima petugas yang sah atau konfirmasi kurir PICKED_UP/ON_DELIVERY. Resi/booking saja tidak cukup.
- **Sudah Sampai**: konfirmasi DELIVERED yang valid dan cocok dengan shipment/order. Tidak mensyaratkan foto/bukti penerimaan berformat tautan tersedia.
- **Selesai**: penanganan order berakhir. Termasuk penutupan manual; tidak otomatis berarti barang diterima.

### 4.2 Matriks delivery baru

| Kejadian committed | Status website | Status Channel yang dituju | Notifikasi admin baru | Email |
|---|---|---|---|---|
| Create order sebelum pembayaran | pending_payment / pending | Belum Bayar, tetap dari create existing | Tidak | Tidak |
| Midtrans lunas, invoice/payment Jubelio masih berjalan | processing / paid | Belum ada target Siap Proses | Tidak | Belum ada email siap diproses |
| Invoice/payment ambigu atau ada pemeriksaan operator | processing / paid, blocked | Menunggu Verifikasi sesuai aturan existing | Tidak ada notifikasi siap diproses | Belum ada email siap diproses |
| Semua syarat siap diproses terpenuhi | processing / paid | Siap Proses | Satu | Pembayaran diterima — pesanan sedang disiapkan |
| Bukti pertama barang dibawa | processing / paid | Tetap Siap Proses | Tidak | Pesanan sedang diantar |
| DELIVERED valid | completed / paid | Selesai | Tidak | Pesanan sudah sampai |
| Penutupan manual yang sah | completed / paid | Selesai | Tidak | Tidak membuat email sudah sampai |
| DELIVERED valid setelah penutupan manual | Tetap completed / paid | Tetap Selesai | Tidak | Pesanan sudah sampai, satu tugas unik |

Penutupan manual tidak menghapus alasan/actor/waktu manual saat bukti diterima datang. Bukti terlambat tidak membuka order, mengubah stok, membatalkan pembayaran, atau menambah kasus follow-up.

### 4.3 Integrasi Jubelio

- Perluas derivasi Siap Proses untuk delivery baru yang processing/paid, unblocked, dengan create/invoice/payment confirmed dan ID valid. Pickup tetap memakai syarat existing.
- Eligibility, pencarian sweep, dan guard saat dispatch harus memakai aturan yang sama; jangan hanya menambah pemanggilan setelah settlement.
- Selesai harus dipicu oleh completed committed: dari pickup, delivery DELIVERED, atau penutupan manual delivery.
- Gunakan intent mirror existing, urutan versi target, single-claim dispatch, pre-read, pemeriksaan identity/financial envelope versi tersimpan, dan independent confirmation GET.
- Semua provider contract yang sudah didukung runtime tetap menggunakan decoder existing; jangan hardcode uang/versi dari contoh transaksi ini.
- Respons tidak pasti tidak mengizinkan pengulangan edit POST secara buta. Pertahankan GET-only recovery serta investigasi/rejection existing.
- Mirror adalah informasi perkembangan: gagal update channel tidak menghapus Lunas, menghalangi notifikasi/email siap diproses, membuat payment ulang, atau mengubah status bisnis yang sudah committed.
- Target lama tidak boleh menimpa Selesai. Jika order telah selesai sebelum Siap Proses terkirim, proyeksikan keadaan terkini, bukan memaksa semua label terlihat berurutan.

### 4.4 Notifikasi admin

- Gunakan jenis existing `order_paid`, hubungan order/cabang existing, dan jalur broadcast existing.
- Untuk delivery: judul **Order dibayar — siap diproses**; pesan **Order #{nomor-ringkas} sudah dibayar dan siap disiapkan untuk pengiriman.**
- Dibuat hanya setelah siap diproses; bukan saat customer baru klik bayar atau invoice/payment belum pasti.
- Tepat satu pembuatan logis per order. Webhook berulang, sweep, restart, dan pemrosesan paralel tidak membuat notifikasi ganda.
- Penghapusan notifikasi oleh admin tidak menyebabkan notifikasi yang sama dibuat ulang; catatan efek yang sudah dihasilkan tetap tersimpan terpisah dari baris notifikasi.
- Notifikasi tampil pada list, unread count, dan update real-time existing. Hak akses notifications dan Branch Scope tidak diperluas.

## 5. Kontrak email

### 5.1 Isi dan tujuan

Penerima menggunakan `orders.contactEmail` yang tersimpan, bukan email dari payload webhook atau data akun yang bisa berubah. Nilai uang, item, dan alamat menggunakan data order/snapshot tersimpan; jangan reprice.

| Jenis | Subject / heading delivery | Copy inti | Link |
|---|---|---|---|
| `delivery_ready` | Pembayaran diterima — pesanan sedang disiapkan | Pembayaran untuk order #{nomor-ringkas} telah diterima. Pesanan Anda sedang disiapkan untuk pengiriman. | Lihat pesanan |
| `delivery_in_transit` | Pesanan sedang diantar | Pesanan Anda sudah diserahkan kepada kurir untuk diantar ke alamat tujuan. Pantau perkembangannya melalui detail pesanan. | Lacak pesanan |
| `delivery_delivered` | Pesanan sudah sampai | Menurut informasi kurir, pesanan Anda sudah diterima. Terima kasih telah berbelanja. | Lihat pesanan |
| `pickup_ready` | Subject dan isi pickup existing | Tetap memuat kode dan informasi pengambilan existing | Pertahankan existing |
| `pickup_completed` | Subject dan isi selesai pickup existing | Pertahankan existing | Pertahankan existing |
| `payment_failed` | Subject dan isi gagal existing | Pemicu kedaluwarsa/failure terminal existing, bukan setiap percobaan metode gagal | Pertahankan existing |

Subject dapat mempertahankan suffix nomor order sesuai template existing. HTML dan plain text sama-sama tersedia. Template delivery tidak memuat pickup date/time/kode pickup. Ringkasan mencakup nomor order, item, rincian uang relevan, cabang asal, tujuan dan layanan delivery tersimpan; tidak menampilkan alasan internal penutupan manual.

Link delivery mengarah ke origin storefront yang sudah dikonfigurasi melalui `BRAND_APP_URL` dan path `/account/orders/{orderId}`. Tidak memakai origin admin, input Host yang tidak dipercaya, atau link kurir sebagai keharusan. Autentikasi dan ownership halaman order tetap berlaku.

### 5.2 Antrean dan retry

1. Fakta bisnis dan tugas komunikasi dicatat secara durable, bukan hanya callback di memori atau `after()` tanpa record database.
2. Tugas email unik per `(orderId, kind)`; ulang pemicu tidak membuat tugas baru atau mereset hitungan retry.
3. **1 percobaan awal + maksimal 3 retry**: paling banyak empat dispatch email. Jeda retry lima menit dari kegagalan/hasil tidak pasti terakhir; waktu aktual mengikuti worker berjalan.
4. Worker membedakan berhasil diterima server email, kegagalan sementara, kegagalan definitif, dan hasil tidak pasti. Kegagalan definitif tidak diulang otomatis; gangguan sementara/hasil tidak pasti memakai batas retry di atas.
5. Hasil tidak pasti tetap retry sesuai keputusan pengguna; ini dapat menyebabkan email ganda di luar kendali aplikasi. Tidak menjanjikan exactly-once delivery, masuk inbox, atau terbaca.
6. Tugas yang berhasil tidak dikirim ulang. Tugas yang habis retry masuk failed dan dicatat aman untuk pemeriksaan teknis, tanpa tombol admin.
7. Worker melakukan claim atomik dengan lease, bukan menahan transaksi database selama SMTP berjalan. Worker paralel tidak boleh memegang claim aktif yang sama.
8. Catat attempt sebelum SMTP. Crash setelah dispatch dianggap hasil tidak pasti; setelah lease kedaluwarsa boleh retry dalam sisa batas yang sama, bukan reset nol.
9. Rancangan awal lease lima menit; timeout transport harus lebih pendek dari lease. Worker berhenti memulai tugas baru sebelum budget request habis. Durasi final diselaraskan dengan API transport yang diverifikasi saat implementasi.
10. Kegagalan email tidak membatalkan pembayaran/pesanan. Keberhasilan channel/notifikasi/email dicatat independen; satu kegagalan tidak mengulang efek lain yang sudah selesai.

### 5.3 Kondisi terbaru mengalahkan email lama

- Sebelum claim dan sesaat sebelum dispatch, baca kembali keadaan authoritative order dan bukti pengiriman.
- Delivery: ready → in_transit → delivered. Email tahap sebelumnya yang belum dikirim atau menunggu retry menjadi superseded jika bukti tahap lebih baru sudah ada.
- Pickup: ready → completed. Email siap diambil yang tertunda tidak dikirim setelah pickup selesai.
- Email gagal yang tertunda tidak dikirim setelah pembayaran terlambat membuat order paid.
- Penutupan manual menghentikan email ready/in_transit yang masih menunggu; tidak menciptakan email delivered. Bukti DELIVERED valid setelah itu boleh menciptakan delivered.
- Webhook duplikat/tidak sah, AWB tidak cocok, identitas shipment salah, status tidak dikenal, dan perkembangan mundur tidak membuat email baru.
- Informasi sah yang sudah diteruskan ke server email tidak dapat ditarik kembali ketika order berubah di tengah proses kirim; dokumentasikan batas concurrency ini, jangan menjanjikan tidak ada email lama dalam seluruh kemungkinan race.

## 6. Rancangan teknis

### 6.1 Struktur dan sumber fakta

Tambahkan domain kecil `order-communications` untuk pencatatan fakta komunikasi lintas app. Admin dan store berbagi **schema dan repository berparameter db/tx**, bukan instance database, auth, atau SMTP app lain. Pengiriman email dan orkestrasi channel tetap milik store.

Dua tabel:

- `order_communication_event`: fakta unik `(order_id, kind)`, sumber bukti, waktu kejadian/penerimaan, serta checkpoint produksi efek. Bagian fakta tidak ditimpa oleh checkpoint. Jenis fakta: delivery_ready, delivery_in_transit, delivery_delivered, delivery_closed_manually, pickup_ready, pickup_completed, payment_failed.
- `order_email_job`: unique `(order_id, kind)`, event asal, status pending/sending/retry/sent/failed/superseded, attempt_count 0..4, next_attempt_at, claim token, lease_until, sent_at, dan safe error code. Jangan menyimpan raw SMTP error/credential/body provider dalam error field.

`orders.order_communication_version`: integer default `0`; penulisan order baru oleh checkout yang sudah diperbarui secara eksplisit mengisi `1`. Record lama tetap `0`, tidak di-backfill. Ini batas eksplisit sehingga sweep baru tidak mengirim pemberitahuan historis. Untuk order lama, perilaku legacy existing tetap dipertahankan, bukan dimigrasikan diam-diam. Pengujian harus membuktikan kedua jalur create/promotion memberi marker yang benar.

Catat event dengan transaksi yang sama dengan perubahan bisnis bila ada transaksi tersebut. Untuk hasil invoice/payment, final guarded fulfillment commit mencatat ready event; sweep memulihkan order versi 1 yang memenuhi eligibility jika proses berhenti sebelum pencatatan. Tidak merekonstruksi riwayat dari seluruh order lama.

Admin handoff/reconcile/manual finish dan shared shipment webhook mencatat event melalui repository bersama pada db/tx milik pemanggil. Store worker memproduksi email/channel dari event committed; tidak perlu endpoint admin memanggil SMTP store secara langsung.

### 6.2 Blueprint per file

Semua path berikut adalah rancangan draft yang diajukan untuk approval; bukan klaim file baru sudah ada.

| Path | Aksi | Tanggung jawab / layer | Seam test |
|---|---|---|---|
| `packages/db/src/schema/orders.ts` | Ubah | Marker versi komunikasi order; schema | Schema dan create/promotion integration |
| `packages/db/src/schema/order-communications.ts` | Baru | Dua tabel, unique/check/index/FK; seluruh waktu timestamptz | `packages/db/src/order-communications/order-communication-repository.db.test.ts` |
| `packages/db/src/schema/index.ts` | Ubah | Export schema baru | Typecheck konsumen |
| `packages/db/src/order-communications/order-communication-contract.ts` | Baru | Jenis fakta/job/outcome yang aman tanpa runtime app | Policy dan consumer tests |
| `packages/db/src/order-communications/order-communication-policy.ts` | Baru | Eligibility email, supersede, retry deterministik; domain murni | `packages/db/src/order-communications/order-communication-policy.test.ts` |
| `packages/db/src/order-communications/order-communication-repository.ts` | Baru | Event dedupe, checkpoint, read state, atomik claim/lease/finish, notifikasi exactly-once logis; repository db/tx | Repository integration termasuk concurrency dan delete notifikasi |
| `apps/store/src/features/order-communications/project-order-communications-service.ts` | Baru | Pulihkan fakta versi 1, hasilkan notifikasi/job dan panggil mirror existing; service satu operasi projection | `apps/store/src/features/order-communications/project-order-communications-service.test.ts` |
| `apps/store/src/features/order-communications/send-order-emails-service.ts` | Baru | Claim pekerjaan, recheck stage, render, kirim, klasifikasi hasil dan jadwal retry; service satu operasi dispatch | `apps/store/src/features/order-communications/send-order-emails-service.test.ts` |
| `apps/store/src/features/order-communications/order-email-client.ts` | Baru | Adapter sender existing + proyeksi aman error transport; tidak menyimpan query | `apps/store/src/features/order-communications/order-email-client.test.ts` |
| `apps/store/src/features/order-communications/order-communication-sweep-service.ts` | Baru | Budget/batch/fairness projection dan mail worker; service operasi sweep | `apps/store/src/features/order-communications/order-communication-sweep-service.test.ts` |
| `apps/store/src/features/order-communications/delivery-email-templates.ts` | Baru | Tiga pasangan HTML/text, reuse token brand | `apps/store/src/features/order-communications/delivery-email-templates.test.ts` |
| `apps/store/src/lib/email.ts` | Ubah terbatas | Timeout transport terverifikasi bila dibutuhkan; kontrak sendEmail existing dan auth tetap | Sender regression dan client tests |
| `apps/store/src/lib/jubelio-sales-settlement.ts` | Ubah | Commit delivery_ready; trigger projection setelah verified settlement; legacy/new branch jelas | Existing `jubelio-sales-settlement.test.ts` + versioned DB suite |
| `apps/store/src/lib/jubelio-channel-mirror.ts` | Ubah | Delivery versi 1 eligibility, dispatch recheck dan sweep SQL selaras; Selesai pada manual finish | Existing `jubelio-channel-mirror.test.ts`, `jubelio-channel-mirror.db.test.ts` |
| `apps/store/src/lib/order-finalize.ts` | Ubah | Pickup ready/failure mencatat event/job versi 1, bukan direct email ganda; legacy tetap | Existing `order-finalize.test.ts` + repository integration |
| `apps/store/src/lib/paid-order-side-effects.ts` | Ubah | Jalur versi 1 menuju producer yang sama jika dipakai; jangan menghidupkan entry legacy yang tidak memiliki caller | Existing caller tests + producer dedupe |
| `apps/store/src/features/orders/complete-pickup-service.ts` | Baru | Operasi penyelesaian pickup dan pembuatan event committed; pertahankan HTTP outcome | `apps/store/src/features/orders/complete-pickup-service.test.ts` |
| `apps/store/src/features/orders/pickup-completion-repository.ts` | Baru | Guard/commit completed + event pada transaksi yang sama; repository | `apps/store/src/features/orders/pickup-completion-repository.db.test.ts` |
| `apps/store/src/app/api/internal/order-complete/route.ts` | Ubah | Tetap HTTP/HMAC adapter; panggil complete service, tidak menambah query ke route | Existing `route.test.ts` |
| `packages/db/src/shipment-tracking.ts` | Ubah | Catat in_transit/delivered termasuk bukti delivered setelah manual completion, tanpa reopen | Existing `shipment-tracking.test.ts` + repository integration |
| `apps/admin/src/lib/delivery-follow-up.ts` | Ubah | Commit event closed_manually bersama penyelesaian manual; tanpa klaim diterima | Existing `delivery-follow-up.db.test.ts` |
| `apps/admin/src/app/api/admin/orders/[id]/delivery/finish-manually/route.ts` | Ubah terbatas | Selaraskan kontrak komentar: channel boleh Selesai, tidak ada email sampai tanpa bukti; route tetap adapter | Follow-up E2E |
| `apps/store/src/features/checkout/checkout-attempt-repository.ts` | Ubah | Order promotion baru memberi marker 1; request replay tidak mengubah marker order lama | Existing repository DB test |
| `apps/store/src/app/api/checkout/place-order/route.ts` | Ubah terbatas | Tambah marker 1 pada nilai insert existing; tidak menambah query atau aturan bisnis baru dalam route | Delivery/pickup checkout tests |
| `apps/admin/src/lib/notifications.ts` | Ubah | Tambah `order.fulfillmentMethod` di projection list dan item real-time | Existing `notifications.test.ts` |
| `apps/admin/src/app/admin/notifications/page.tsx` | Ubah | Kolom Jenis Order, badge, delivery Buka order; komponen UI existing | `e2e/admin/order-notifications-mock.spec.ts` dan existing `notifications.spec.ts` |
| `apps/admin/src/providers/notification-provider.tsx` | Ubah bila consumer perlu | Propagasi DTO baru tanpa merusak unread/sound/live merge | Notifications integration/E2E |
| `apps/store/src/app/api/cron/process-order-communications/route.ts` | Baru | Auth cron, parse, panggil sweep service, respons counters aman; tanpa query/provider call | `apps/store/src/app/api/cron/process-order-communications/route.test.ts` |
| `packages/db/src/seed.ts` | Ubah | DELETE FK order dan contoh delivery/pickup/job inert, tidak mengirim email sungguhan | Seed/schema check terisolasi |
| `packages/db/drizzle/` | Generate saja | Migration audit lewat drizzle-kit; nama ditentukan generator, tidak edit SQL manual | `db:check` + schema integration |
| `deployment/common/cron/process-order-communications.sh` | Baru | Pemanggil cron memakai secret env existing, timeout/log aman | `deployment/common/cron/process-order-communications.test.sh` |
| `deployment/staging/order-communications.cron`, `deployment/production/order-communications.cron` | Baru | Contoh jadwal setiap menit, URL environment yang benar; tidak memasang cron | Script tests dan review config |
| `playwright.mock.config.ts` | Ubah | Daftarkan mock spec baru di seluruh testMatch yang berlaku | Playwright discovery |
| `e2e/admin/order-notifications-mock.spec.ts` | Baru | Kolom, aksi, live update, scope cabang, responsive | Mock Playwright |
| `e2e/store/order-communications-mock.spec.ts` | Baru | Event → worker → email sink mock dan delivery tracking, termasuk late proof | Mock Playwright |
| `docs/features/order-communications.md` | Baru | Kontrak enduring status/notifikasi/email/retry dan batas jaminan | Review terhadap acceptance |
| `docs/features/jubelio-sales-orders.md`, `docs/features/delivery-orders.md`, `docs/features/delivery-tracking.md`, `docs/features/delivery-follow-up.md`, `docs/features/notifications.md` | Ubah | Hapus klaim superseded bahwa delivery melewati seluruh komunikasi; jelaskan manual selesai vs diterima | Doc review |
| `docs/deployment-docs/order-communications.md`, `docs/README.md`, `docs/api-reference.md`, `docs/deployment-docs/README.md` | Baru/ubah sesuai path | Endpoint, jadwal dev/manual trigger, konfigurasi, navigasi | Link dan endpoint contract review |

**Batas refactor:** penambahan marker pada nilai insert existing tidak membutuhkan module enrollment pass-through atau ekstraksi seluruh checkout. Jalur query existing di route bukan izin memperluas pelanggaran; bila perubahan membutuhkan persistence tambahan, ekstrak bagian transaksi terkait ke repository bernama dan perbarui blueprint sebelum slice diterapkan.

### 6.3 Kontrak export baru/berubah

Signature berikut adalah kontrak internal yang diusulkan, tanpa body. `DbExecutor`/`TxExecutor` berarti executor schema db milik pemanggil, bukan shared singleton.

- Contract: `OrderCommunicationKind`, `OrderEmailKind`, `OrderEmailJobStatus`, `OrderCommunicationState`, `OrderEmailContent`, `OrderCommunicationSummary`.
- Policy: `isOrderEmailApplicable(input: { kind: OrderEmailKind; state: OrderCommunicationState }): boolean`; `nextOrderEmailAttempt(input: { attemptCount: number; outcome: "temporary" | "uncertain" | "permanent"; now: Date }): { status: "retry" | "failed"; nextAttemptAt: Date | null }`.
- Repository: `recordOrderCommunicationEvent(tx: TxExecutor, input: { orderId: string; kind: OrderCommunicationKind; source: string; occurredAt: Date | null; receivedAt: Date }): Promise<{ eventId: string; created: boolean }>`.
- Repository: `listProjectableOrderCommunications(db: DbExecutor, input: { limit: number; now: Date; orderId?: string }): Promise<OrderCommunicationState[]>`; `materializeOrderCommunicationEffects(db: DbExecutor, input: { eventId: string; now: Date }): Promise<{ emailJobCreated: boolean; notificationCreated: boolean }>`.
- Repository: `claimDueOrderEmailJobs(db: DbExecutor, input: { limit: number; now: Date; leaseUntil: Date }): Promise<ClaimedOrderEmailJob[]>`; `readOrderCommunicationState(db: DbExecutor, orderId: string): Promise<OrderCommunicationState | null>`; `finishOrderEmailAttempt(db: DbExecutor, input: FinishOrderEmailAttemptInput): Promise<boolean>`. Finish wajib membawa claim token agar worker lama tidak menimpa claim baru.
- Projection service: `projectOrderCommunications(input: { limit: number; orderId?: string }): Promise<OrderCommunicationSummary>`.
- Mail service: `sendDueOrderEmails(input: { limit: number }): Promise<OrderEmailDispatchSummary>`.
- Client: `sendOrderEmail(input: OrderEmailContent): Promise<{ outcome: "accepted" | "temporary" | "uncertain" | "permanent"; code: string | null }>`; jangan mengekspos raw transport error.
- Sweep service: `sweepOrderCommunications(input: { limit: number; deadline: Date }): Promise<OrderCommunicationSweepSummary>`.
- Template: `renderDeliveryOrderEmail(input: { kind: "delivery_ready" | "delivery_in_transit" | "delivery_delivered"; order: DeliveryEmailOrder; orderUrl: string }): OrderEmailContent`.
- Pickup service: `completePickupOrder(input: { orderId: string }): Promise<PickupCompletionOutcome>`; HMAC tetap diverifikasi di HTTP adapter.
- Pickup repository: `completePickupWithCommunicationEvent(input: { orderId: string; now: Date }): Promise<PickupCompletionOutcome>`; menggunakan db lokal store.
- Notifications DTO: tambah `order.fulfillmentMethod: "pickup" | "delivery" | null`; projection list dan item harus sama. Nilai unknown/null ditampilkan `—`, jangan ditebak menjadi pickup.
- Existing fungsi shipment tracking, follow-up, channel mirror, settlement, dan email auth mempertahankan public signature; berubah pada efek internal sesuai scope ini.

### 6.4 Pilihan struktur

- **Event + job tersimpan, bukan setTimeout:** restart tidak menghilangkan pekerjaan; source event lintas app tidak perlu SMTP atau impor app lain.
- **Store worker terpisah, bukan memperbesar sweep reservasi:** komunikasi tidak menghabiskan budget recovery pembayaran/stok. Jadwal lokal/dev dapat dipanggil manual; produksi tidak diasumsikan sudah aktif.
- **Event pada boundary transaksi:** mencegah commit bisnis tanpa jejak komunikasi. Recovery eligibility versi 1 menjadi safety net, bukan jalur replay provider write.
- **Reuse mirror Jubelio:** jangan membangun mesin edit/channel kedua atau memakai aturan retry SMTP untuk request Jubelio.
- **Service per operasi:** projection, dispatch, sweep terpisah karena invariant dan dependency berbeda, bukan satu God Service.
- **Notifikasi dedupe memakai event checkpoint:** tidak perlu unique index baru atas data notifikasi lama yang mungkin sudah duplikat; penghapusan baris tidak menghilangkan jejak produksi efek.

### 6.5 Endpoint dan operasi

Endpoint baru: `POST /api/cron/process-order-communications`.

- Auth `X-Cron-Secret` menggunakan `CRON_SECRET` existing; tidak menerima cookie customer/admin sebagai pengganti.
- Secret server tidak dikonfigurasi → 503; secret tidak cocok → 401; method lain tidak didukung.
- Body tidak membawa recipient, HTML, order override, status pembayaran, atau instruksi provider write.
- Respons sukses 200 berisi counters projected/sent/retry/failed/superseded, tanpa PII. Kegagalan dependency global → 503; kegagalan satu email direkam per job tanpa membatalkan batch lain.
- Jadwal yang diajukan setiap menit. Polling mengambil batch terbatas, urutan due-time/id stabil, lease dan SQL eligibility mengecualikan sent/failed/superseded agar batch tidak tersumbat oleh pekerjaan selesai.
- Request bisnis boleh memicu best-effort projection setelah commit untuk notifikasi/channel yang cepat; email dikirim oleh worker, bukan menahan request customer untuk SMTP. Event durable tetap sumber retry bila trigger cepat gagal.
- Tidak ada env baru yang wajib. Gunakan SMTP, CRON_SECRET dan storefront origin existing. Tambah berkas jadwal/script/docs, bukan memasang scheduler atau menjalankan remote.

## 7. Rancangan UX

### 7.1 Referensi dan tugas

Referensi: halaman notifikasi existing `apps/admin/src/app/admin/notifications/page.tsx`, shared Table/Badge/Button admin, serta token/struktur email order existing `apps/store/src/lib/email-templates-order.ts` dan `email-config.ts`. Tidak ada prototype diminta.

Tugas admin: melihat order lunas, mengenali cara pemenuhannya, lalu membuka tindakan yang benar. Hierarki judul/notifikasi, nomor order, cabang, waktu, dan status dipertahankan.

Urutan kolom: **Judul | Cabang (hanya viewer all-branch) | Order | Jenis Order | Waktu | Status | Aksi**.

- Badge non-interaktif, variant outline existing: **Pickup** / **Delivery**. Jangan bedakan hanya lewat warna atau menjadikannya filter terselubung.
- Delivery: aksi **Buka order** menuju `/admin/orders/{id}` tanpa `?verify=1`; accessible name harus jelas. Pickup: aksi **Verifikasi pickup** existing.
- Link nomor order tetap tersedia; mark read/delete/mute/pagination/filter dibaca existing tetap berlaku. Tidak menambah tombol resend atau action kurir di daftar notifikasi.

### 7.2 Reuse komponen

| Elemen | Path | Pemakaian |
|---|---|---|
| Tabel/header/cell | `apps/admin/src/components/ui/table.tsx` | Tambah header/cell; pertahankan semantic table dan scroll container |
| Penanda jenis | `apps/admin/src/components/ui/badge.tsx` | Variant outline existing, label teks wajib |
| Aksi | `apps/admin/src/components/ui/button.tsx` | Treatment existing, label/accessible name Buka order atau Verifikasi pickup |
| Card/select/filter | `apps/admin/src/components/ui/card.tsx`, `apps/admin/src/components/ui/select.tsx` | Tidak mengubah struktur/varian existing |
| Brand email | `apps/store/src/lib/email-config.ts`, `apps/store/src/lib/email-templates-order.ts` | Warna/typography/header/footer existing; HTML/text aman dan copy ringkas |

### 7.3 State matrix

| Area | State | Tampilan/perilaku |
|---|---|---|
| Kolom jenis | Loaded pickup/delivery | Badge Pickup/Delivery sesuai DTO |
| Kolom jenis | Order/jenis tidak tersedia | `—`, tidak membuat asumsi pickup |
| Daftar | Loading | Loader existing; tidak menampilkan badge dari data buatan |
| Daftar | Empty/filter tanpa hasil | `Tidak ada notifikasi.` existing; tidak menambah copy/filter baru |
| Daftar | Gagal request | Pertahankan data yang sudah tersedia dan jalur logging/feedback existing; tidak mengklaim sukses. Redesign error page di luar scope |
| Daftar | Live update | Baris baru langsung membawa Jenis Order; tidak perlu reload untuk melengkapi kolom |
| Aksi delivery | Loaded | Buka order; tidak memicu dialog/form verifikasi pickup |
| Aksi baca/hapus | Pending/disabled | Spinner/disabled existing; tidak menambah submit ganda |
| Akses | Tidak memiliki notifications:view | Guard existing; tidak membocorkan data lewat poll/list |
| Akses | Own-branch | Hanya notifikasi branch sah; kolom Cabang mengikuti pola existing |
| Form | Unsaved | N/A, tidak ada form baru |
| Email | Ready/in_transit/delivered | Copy final §5.1, CTA dapat dikenali tanpa hanya hover |
| Email | Tidak ada link kurir | CTA detail order tetap berfungsi; tidak ada link kosong |
| Email | Pengiriman gagal/retry | Tidak ada UI admin baru; catatan teknis aman saja |

Viewport verifikasi: desktop 1440×900, tablet 768×1024, mobile 390×844. Tabel boleh scroll horizontal dalam region existing, bukan overflow seluruh halaman. Badge tidak menutupi nomor order/action. Keyboard focus, accessible name aksi, semantic header, dan kontras diperiksa; jangan mengklaim WCAG penuh hanya dari automated test. Email diuji HTML/text serta render sempit 390px dan desktop, termasuk escaping nama/item/alamat.

## 8. Acceptance criteria dan test seam

| ID | Bukti yang harus dapat diamati | Test utama |
|---|---|---|
| AC01 | Delivery baru valid memperoleh target Siap Proses setelah create/invoice/payment confirmed, bukan hanya Midtrans paid | Settlement + mirror unit/DB |
| AC02 | Delivery baru tetap processing/paid, tanpa pickup code/email pickup | Settlement unit + delivery mock E2E |
| AC03 | Midtrans paid tetapi invoice/payment ambigu tidak menghasilkan ready notification/email; tetap blocked dan mekanisme Menunggu Verifikasi existing berlaku | Settlement regression |
| AC04 | Sweep menemukan delivery baru yang kehilangan fast trigger dan menerapkan target yang sama; SQL/pre-dispatch/derivasi selaras | Mirror DB concurrency |
| AC05 | DELIVERED/manual finish memicu Selesai; target lama tidak menimpa tahap baru | Mirror DB + tracking/follow-up tests |
| AC06 | Mirror error/timeout tidak menurunkan paid, tidak membuat invoice/payment ulang, tidak mengulang edit POST secara buta | Gateway/mirror regression |
| AC07 | Delivery ready menghasilkan satu notifikasi order_paid dan broadcast; replay/sweep paralel/delete notifikasi tidak membuat duplikasi | Repository real-PG + notification tests |
| AC08 | List dan real-time DTO memuat fulfillmentMethod konsisten; own-branch tidak melihat cabang lain | Admin DAL tests + E2E |
| AC09 | Kolom Jenis Order tampil untuk pickup/delivery; missing data `—`; tidak ada filter jenis baru | `e2e/admin/order-notifications-mock.spec.ts` |
| AC10 | Aksi delivery membuka detail biasa; pickup tetap menuju verifikasi pickup; baca/hapus/mute/pagination existing tidak rusak | Mock E2E + `e2e/admin/notifications.spec.ts` |
| AC11 | Email delivery ready hanya setelah financial gate; isi tidak mengklaim barang sudah dibawa kurir | Service/template tests |
| AC12 | Catatan handoff sah ATAU PICKED_UP/ON_DELIVERY valid menghasilkan satu in_transit job, mana yang lebih dulu; booking saja tidak menghasilkan | Tracking/repository tests |
| AC13 | Email sedang diantar memakai URL storefront detail order; akses order lain tetap ditolak oleh halaman existing | Template + store mock E2E |
| AC14 | DELIVERED sah menghasilkan delivered job tanpa mewajibkan POD; data tidak sah/identitas salah/duplikat tidak menghasilkan | Tracking DB tests |
| AC15 | Manual finish menghasilkan Selesai tanpa delivered email; DELIVERED valid belakangan menghasilkan satu email tanpa reopen/menghapus alasan manual | Tracking + follow-up DB tests |
| AC16 | Semua email order baru memakai job, termasuk pickup dan pembayaran gagal; tidak ada direct-send kedua pada fast/late/sweep path | Finalize/completion/producer tests |
| AC17 | Maksimal empat attempt; retry tidak lebih awal dari lima menit; sukses/permanent failure/exhaustion berhenti sesuai policy | Fake clock + mail service tests |
| AC18 | Worker paralel/lease recovery/restart tidak mengklaim job aktif dua kali; crash/hasil tidak pasti memakai sisa retry, risiko duplikasi eksternal dinyatakan | Repository real-PG + sender fake |
| AC19 | Email lama superseded saat tahap terbaru sudah diketahui, termasuk gagal → late paid dan pickup ready → completed | Pure policy + dispatch integration |
| AC20 | SMTP failure tidak membatalkan bisnis, tidak mengulang notifikasi/channel sukses, tidak mengganggu email auth | Integration + auth sender regression |
| AC21 | Order versi 0 tidak dimigrasikan atau mendapat efek baru dari worker; create/promotion baru versi 1; replay order lama tidak mengubah marker | Checkout repository DB + worker tests |
| AC22 | Cron menolak secret salah/hilang, membatasi batch dan tidak membocorkan PII; konfigurasi dev/staging/production didokumentasikan tanpa remote action | Route + shell tests |
| AC23 | UI rendered, responsive/keyboard, dan HTML/plain-text email dibandingkan terhadap referensi existing; bukan JSX inspection saja | Manual browser review + Playwright |
| AC24 | Seeder/schema selaras, migration dihasilkan bukan hand-edited; tidak ada live customer/provider/email writes saat testing | Schema isolated + sink/gateway mock |

Expected value berasal dari fixture independen dan aturan keputusan, bukan helper produksi yang dipanggil ulang di assertion. Waktu dikontrol; SMTP, Midtrans, dan Jubelio dimock. Real-PG fixture terisolasi untuk constraint/transaction/concurrency, bukan transaksi pengguna.

## 9. Urutan implementasi yang diajukan

Ini urutan verifiable slice, **bukan publikasi breakdown ticket multi-session**.

| # | Fitur | Status fitur | Verifikasi |
|---|---|---|---|
| 1 | Delivery ready → Siap Proses + satu notifikasi, dengan gate order baru | Ready | AC01–AC08, AC21 |
| 2 | Jenis Order dan aksi delivery pada notifikasi | Ready | AC08–AC10, AC23 |
| 3 | Antrean email order + retry dan integrasi delivery ready/pickup/payment failure | Ready | AC11, AC16–AC20, AC22 |
| 4 | Mulai diantar, diterima, manual selesai, dan bukti terlambat | Ready | AC05, AC12–AC15, AC19 |
| 5 | Integrasi, deployment docs, seed, dan regression batch | Ready | AC01–AC24 |

Tulis satu test gagal pada public seam, jalankan RED, implementasikan irisan minimum, lalu GREEN. Jangan membangun schema/worker seluruhnya tanpa membuktikan satu alur vertikal. Jika diperlukan ticket lintas sesi, minta approval breakdown tersendiri sebelum menerbitkannya.

## 10. Verification dan checkpoint sebelum coding

- Saat draft: inspeksi kode/dokumen dan review statis saja. **Belum ada test, lint, typecheck, build, seed, schema push, atau browser run untuk perubahan ini.**
- Context7: belum diperlukan untuk dokumen/internal signature draft. Sebelum implementasi, main agent wajib resolve/query versi terpasang untuk Drizzle (atomic claim/locking/constraints), Next.js (route/background lifecycle), Nodemailer (timeout/error/accepted semantics), Vitest dan Playwright (clock/mocks/test API yang dipakai). Catat ID library dan hasil inquiry dalam slice notes; bila gagal pakai types/source terpasang atau vendor docs dengan sumber eksplisit.
- L0 per slice: `npm run verify:types:store` dan/atau `npm run verify:types:admin`.
- L1 per slice: `npm run verify:unit:slice -- <path-test-yang-diubah>` dengan file eksplisit dari blueprint, bukan full scan tanpa daftar.
- L2 per batch: `npm run verify:batch:unit` dan `npm run verify:batch:e2e -- e2e/admin/order-notifications-mock.spec.ts e2e/store/order-communications-mock.spec.ts` ditambah hanya spec regression mock yang batch tersebut sentuh.
- Semua spec mock baru dimasukkan pada kedua testMatch yang berlaku di `playwright.mock.config.ts`.
- Sebelum commit/PR/integration: full unit dan E2E sesuai repo; legacy `npm run test:e2e` tetap butuh izin terpisah. Tidak ada commit/push yang diizinkan oleh approval spec.
- Capture output ke log bounded; jangan menjalankan ulang suite yang sudah lulus tanpa perubahan relevan. Laporan disposable browser di `playwright/`; kegagalan Playwright dibaca dari Markdown, bukan screenshot attachment.
- Main agent memeriksa hasil render notifikasi/email dan cross-page/shared-pattern consistency. Browser terblokir berarti frontend belum dapat dinyatakan selesai.

## 11. Open items teknis dan batas approval

Tidak ada pertanyaan produk yang sengaja dibiarkan terbuka. Complete spec disetujui pengguna pada 2026-11-09; discovery teknis berikut tetap harus diperiksa sebelum slice terkait dan bukan izin mengubah perilaku yang disetujui.

- `discovery:` konfirmasi kode error SMTP dan timeout transport pada versi Nodemailer terpasang sebelum client ditulis. Jika classification belum dapat dipercaya, perlakukan sebagai uncertain sesuai batas retry, jangan menebak permanent success.
- `discovery:` konfirmasi semua order-create runtime seams pada HEAD implementasi; dua jalur yang ditemukan adalah insert place-order dan promotion checkout-attempt. Jangan memberi marker 1 pada replay record lama.
- `discovery:` konfirmasi strategi atomic materialization/checkpoint dan claim terhadap Drizzle/Postgres terpasang melalui integration test; tidak boleh mempertukarkan worker lease dengan jaminan exactly-once SMTP.
- Nomor migration dan penyesuaian nama file test mengikuti generator/struktur repo, bukan SQL buatan tangan.
- Perubahan produk yang ditemukan saat implementasi harus dihentikan dan diminta ke pengguna; jangan mengartikan discovery sebagai izin memperluas scope.

## 12. Dokumentasi dan penutupan

Setelah implementasi dan verifikasi: perbarui docs fitur/API/deployment pada blueprint, simpan evidence per slice/batch, pertahankan spec ini, dan ubah entri plan di `../index.md` menjadi Done dengan tanggal dan bukti. Tidak mereset plan delivery lama yang sudah Done.

### Deviation log

- 2026-11-10 — Implementasi selesai untuk seluruh AC; bukti dan pemetaan
  AC → evidence ada di [implementasi-dan-verifikasi](../ticket/implementasi-dan-verifikasi.md).
- Migrasi `0057` dihasilkan generator dan **juga** membawa drift lama
  `discount_offer_revision.draft_configuration` (kolom sudah ada di schema,
  belum pernah masuk migrasi). SQL tidak diedit tangan; tidak ada perubahan
  perilaku diskon.
- Renderer pickup/payment-failed ditempatkan di `delivery-email-templates.ts`
  bersama renderer delivery (tidak menambah file di luar blueprint).
- Recovery proyeksi berjalan juga saat `orderId` diberikan, sehingga fast path
  settlement dapat memulihkan fakta yang gagal dicatat.
- Notifikasi `delivery_ready` hanya diproduksi bila fakta siap-diproses masih
  berlaku pada keadaan authoritative.
- Halaman notifikasi: baris aksi menjadi `flex-wrap` dan header kartu menjadi
  satu kolom di bawah `lg` karena pada 390 px halaman overflow 126 px dan
  kontrol terpotong. Token/komponen existing tidak berubah.
- `orders.order_communication_version` dan dua tabel baru **belum** diterapkan
  ke database development pengguna; seluruh verifikasi memakai database
  disposable. Tanpa `db:push`, `npm run dev`, `npm run test:unit` default, dan
  Playwright dengan `.env` root akan gagal pada kolom/tabel baru.
- Tidak ada backfill data lama, provider write, remote action, commit, atau
  deployment.
