# Breakdown yang disetujui — Cermin Status Channel SO pickup INTERNAL

**Status: enam tiket lokal diterbitkan di [`build-tickets/`](build-tickets/); #01–#06 Done lokal; #04–#06 selesai dengan verifikasi gabungan, belum commit/deploy.** Sumber kontrak: [spesifikasi Ready yang disetujui](spec-draft.md), [peta dan empat tiket keputusan](map.md), [uji edit awal](edit-channel-status-results-2026-09-26.md), [uji jurnal lanjutan](accounting-one-shot-results.md), [alur SO yang diterapkan](../../docs/features/jubelio-sales-orders.md). Pemilik meninjau uji jurnal lanjutan dan menerima risiko akuntansi residual sebagai **non-blocker peninjauan Ready**. Pemilik kemudian menyetujui spesifikasi lengkap yang direvisi sebagai Ready, meminta tiket dibuat, dan memilih lokasi Markdown lokal `build-tickets/`. Ini tidak memberi izin implementasi/POST Jubelio, commit, atau deployment. Empat berkas di `issues/` tetap tiket **keputusan**, bukan tiket build; `plan/index.md` tidak dipakai sebagai tracker tiket.

**Gate bersama seluruh tiket build telah dilalui untuk penerbitan:** #01 ditutup sebagai keputusan risiko pemilik setelah uji teredaksi (bukan bukti keamanan finansial universal); spesifikasi lengkap yang diperbarui disetujui secara eksplisit sebagai Ready; lokasi tiket Markdown lokal dan pembuatan tiket dipilih pemilik. Penerbitan **bukan** perintah mengimplementasikan atau mengirim POST Jubelio. Tiap tiket build memakai seam utama yang telah dikonfirmasi: rekonsiliasi cermin per order dengan PostgreSQL dan respons Jubelio terkontrol, ditambah tes kontrak gateway pada boundary HTTP yang ada. Tes harus red → green per irisan, tidak menyentuh akun Jubelio nyata tanpa izin tersendiri. Tidak ada tiket yang mengubah otoritas pembayaran/pickup, `wms_status`, atau `is_paid`. Bila sebuah ticket memerlukan perubahan schema, seed dan dokumentasi/deployment terkait adalah bagian dari irisan itu.

## 01 — Nilai batas keamanan edit SO ber-invoice (gate riset: keputusan tercatat)

**Blocked by:** Tidak ada. **Status:** keputusan pemilik tercatat; bukan tiket build `ready-for-agent` dan bukan otorisasi provider write baru.

**Yang dihasilkan:** [Uji satu kali](accounting-one-shot-results.md) pada SO uji baru yang ber-invoice/payment menunjukkan Status Channel berubah, sedangkan total/ID jurnal terbaru dan baris dua jurnal terkait serta SO/invoice/payment yang diketahui tidak berubah. Jurnal invoice/payment yang baru muncul menjadi positive control. Pemilik meninjau batas bukti (satu fixture, halaman terbaru, pembacaan singkat, tanpa stok pasca-edit atau perlindungan CAS vendor) dan **menerima risiko residual; akuntansi bukan lagi blocker peninjauan Ready**. Ini keputusan risiko, bukan sertifikasi keamanan finansial universal.

**Kriteria hasil yang tercatat:**
- [x] Uji full-payload pada SO ber-invoice/payment uji baru dilakukan dengan izin POST terbatas dan jurnal teredaksi; tidak ada perubahan jurnal terkait yang teramati.
- [x] Batas audit, potensi posting tertunda, dan edit vendor konkuren dicatat eksplisit; pengaman fail-closed untuk payload/mismatch serta tes konkurensi lokal tetap diwajibkan dalam #03.
- [x] Pemilik menyatakan risiko akuntansi bukan blocker lagi; seluruh izin POST sekali pakai telah habis. Tidak ada edit SO lama, retry, atau cleanup yang diizinkan.

**Verifikasi:** [laporan hasil](accounting-one-shot-results.md) dan [jurnal teredaksi](accounting-one-shot-run-02.jsonl); tidak ada suite aplikasi yang dijalankan. Bila ada efek samping baru saat implementasi, hentikan dan minta keputusan baru.

## 02 — Marker Belum Bayar pada create SO pickup

**Blocked by:** #01 (Done). **Status #02:** Done lokal setelah review dan tes PostgreSQL terfokus; suite monorepo masih mempunyai dua kegagalan RBAC seeded-Admin yang tidak terkait #02. Belum commit/deploy.

**Yang dihasilkan:** Pelanggan checkout menghasilkan SO INTERNAL pickup dengan **Belum Bayar** di Status Channel lewat satu POST create yang sudah wajib, kemudian satu GET independen mengamankan identitas, lokasi, item, harga, dan total sebelum Midtrans. Mismatch marker saja dapat diinvestigasi tanpa menghentikan checkout atau menulis edit tambahan.

**Kriteria penerimaan:**
- [x] Satu create POST membawa marker dan intent durable; tidak ada POST edit terpisah untuk marker awal atau retry create buta bila respons hilang.
- [x] Rejection/ambiguity/mismatch atribut **inti** mempertahankan pengaman checkout saat ini; bila hanya marker yang berbeda sementara atribut inti cocok, Midtrans tetap boleh mulai dan mismatch tersimpan serta tercatat terstruktur tanpa PII.
- [x] Tidak ada SO terkonfirmasi → tidak mengirim status channel/marker follow-up; tes gateway dan checkout terkontrol membedakan dua kondisi itu.
- [x] Dokumen alur create dan cara menemukan mismatch awal diperbarui bersama perubahan; tidak ada jalur pickup baru.

**Verifikasi:** tes create gateway satu POST + GET, dan tes perilaku checkout/mismatch persisten pada seam yang disepakati; `npm run test:unit` (serta E2E bila UI/routing berubah sesuai aturan repo).

## 03 — Siap Proses setelah pickup lokal siap, dengan edit tahan crash

**Blocked by:** #02 (Done lokal). **Status #03:** Done lokal setelah tes PostgreSQL/gateway/cron dan review read-only; belum commit/deploy, tanpa request Jubelio nyata.

**Yang dihasilkan:** Operator melihat **Siap Proses** hanya sesudah invoice dan payment terverifikasi **serta** order lokal menjadi `ready_for_pickup`. Cermin pasca-create best effort; satu hasil buruk tidak menahan pickup, dan konkurensi webhook/sweep tidak menggandakan edit atau mengubah atribut finansial SO secara sengaja. Ini irisan pertama yang membawa mekanisme edit bersama dari intent sampai GET/recovery; jangan memisah ledger saja sebagai tiket horizontal.

**Kriteria penerimaan:**
- [x] Intent tahap/versi dan SO ID tersimpan sebelum klaim atomik; dua pemanggil konkuren hanya dapat mengirim paling banyak satu POST edit untuk intent yang sama. Pending/paid yang belum siap tidak mengirim Siap Proses.
- [x] GET sebelum edit dan payload full-save mempertahankan identitas SO, nomor/ID detail, source, lokasi, item, kuantitas, harga/total serta atribut wajib yang tervalidasi. GET sesudah edit memastikan marker dan invariant yang teramati. Data tidak lengkap/berubah, invoice link aneh, atau risiko menulis ulang item/uang → nol POST edit dan catatan investigasi.
- [x] Timeout/5xx/badan respons rusak/crash setelah klaim → possibly-sent persisten; sweep GET hanya dengan SO ID yang diketahui, tanpa re-POST otomatis. Intents berikutnya tidak melewati pendahulu yang ambigu; versi lama tidak menimpa versi baru.
- [x] Kegagalan cermin tidak mengubah `paymentStatus`, status lokal, `fulfillmentBlockedReason`, pickup code, atau izin pickup. Mismatch bisa dicari dari order/SO lewat mekanisme operasi terdokumentasi tanpa antrean/UI admin baru; log terstruktur aman dari PII/token/raw body.
- [x] Recovery memindai catatan pending/ambigu walau order sudah ready/completed, bukan bergantung hanya pada seleksi `processing + paid`. Schema/seed, penjelasan sweep dan dokumen feature/deployment (jika jadwal/env berubah) tetap konsisten.

**Verifikasi (lokal, 2026-09-26):** seam PostgreSQL mirror 42 lulus (1 environment-blocker skip), gateway edit, settlement, dan cron HTTP terkontrol lulus; parent mengulang `npm run test:unit` (**790 lulus, 2 skip, 0 gagal**), typecheck dan lint berkas #03 lulus. Review read-only independen menerima perbaikan blocker PII serta disposisi intent `pending` terminal. `lint:store` menyeluruh gagal pada `Header.tsx:39` yang tidak terkait. Tidak ada E2E karena UI/routing tidak berubah, request provider nyata, commit, push, atau deployment. Risiko residual: tidak ada CAS vendor, celah waktu perubahan status lokal sebelum POST, dan tidak ada deadline internal bagi sweep; lihat [tiket #03](build-tickets/03-siap-proses-edit-tahan-crash.md) dan runbook.

## 04 — Menunggu Verifikasi hanya untuk paid yang perlu operator

**Blocked by:** #03 (Done lokal). **Status #04:** Done lokal setelah tes PostgreSQL/HTTP dan review independen; belum commit/deploy.

**Yang dihasilkan:** Operator melihat **Menunggu Verifikasi** jika Midtrans sah paid tetapi settlement menghasilkan `manual_review` atau blokir eksplisit yang perlu investigasi manusia. Jalur sukses cepat melompat langsung dari Belum Bayar ke Siap Proses; `in_flight`/`pending` yang singkat tidak menyalakan alarm. Cermin tetap memakai pengaman edit/recovery dari #03 dan tidak menghalangi perbaikan settlement.

**Kriteria penerimaan:**
- [x] Intent baru hanya setelah keadaan paid-but-blocked yang benar-benar meminta investigasi terkomit; keanggotaan antrean review admin sendiri dan callback mentah bukan trigger.
- [x] Paid yang verifikasi invoice/payment-nya cepat selesai atau masih `in_flight`/`pending` tanpa blokir operator tidak mengirim Menunggu Verifikasi; ketika kemudian menjadi `ready_for_pickup`, target yang terkonfirmasi adalah Siap Proses, bukan marker lama.
- [x] Edit gagal/ambigu disimpan dan dapat direkonsiliasi lewat GET tanpa re-POST; status paid, blokir settlement yang nyata, serta hak pickup tetap ditentukan alur lama, bukan hasil channel edit.

**Verifikasi (lokal):** seam PostgreSQL, HTTP cron/settlement, dan suite gabungan **852 lulus, 2 skip, 0 gagal**; review independen menerima dengan catatan jendela transisi lokal sebelum POST (lihat tiket #04).

## 05 — Gagal Bayar dan pembayaran terlambat tanpa status basi

**Blocked by:** #04 (Done lokal). **Status #05:** Done lokal setelah tes balapan cancel, review independen, dan suite gabungan; belum commit/deploy.

**Yang dihasilkan:** Setelah order benar-benar menjadi `failed_payment`, SO yang masih aktif dan aman diedit dapat menampilkan **Gagal Bayar**. Jika jalur pembatalan SO telah dimulai atau selesai, cermin **melewatkan edit** dan mencatat mismatch persisten; status lokal gagal dan pelepasan stok tidak ditunda demi label. Bila kemudian ada pembayaran Midtrans terlambat, cermin mengikuti keadaan terbaru yang aman—review operator jika masih terblokir, atau Siap Proses setelah settlement dan pickup siap—tanpa menghidupkan kembali edit lama atau mengulang write provider yang ambigu.

**Kriteria penerimaan:**
- [x] Penolakan satu metode bayar yang masih nonterminal tidak memicu Gagal Bayar; kegagalan create sebelum SO terkonfirmasi tidak mengirim edit marker.
- [x] Setelah transisi terminal lokal, intent Gagal Bayar hanya dispatch bila SO aktif dan jalur cancel tidak dimulai; pemeriksaan terhadap cancel intent/hasil dan SO terkini fail-closed juga berlaku saat sweep/race. Jika cancel dimulai/terkonfirmasi, jangan kirim edit (termasuk intent cermin lama yang pending), simpan mismatch persisten dan log; jangan tunda cancel atau pelepasan hold. Edit yang boleh dikirim tetap memakai at-most-once/GET.
- [x] Late paid setelah jalur cancel aktif tetap paid-but-blocked/manual investigation menurut alur yang ada; jika settlement valid kemudian membuat `ready_for_pickup`, cermin akhirnya Siap Proses. Bila edit Gagal Bayar masih ambigu, target baru tidak menerobosnya atau mengirim POST kedua secara buta; catat untuk investigasi.

**Verifikasi (lokal):** tes race PostgreSQL dengan provider terkontrol, suite gabungan **852 lulus, 2 skip, 0 gagal**; review independen menerima. Tanpa CAS vendor masih ada jendela setelah pemeriksaan terakhir sebelum POST (lihat tiket #05).

## 06 — Selesai sesudah pickup; Dibatalkan tetap future-facing

**Blocked by:** #03 (Done lokal). **Status #06:** Done lokal setelah kerja di worktree isolasi dan integrasi aman sesudah #05; belum commit/deploy.

**Yang dihasilkan:** Setelah store benar-benar meng-commit completion pickup, Status Channel SO menjadi **Selesai** secara best effort, termasuk ketika respons store ke admin hilang tetapi order lokal sudah selesai. Pemilihan label **Dibatalkan** disiapkan/diuji hanya untuk status lokal `cancelled` yang sah bila kelak punya jalur runtime; tiket ini tidak membangun alur cancel baru.

**Kriteria penerimaan:**
- [x] Selesai tidak dikirim pada verifikasi kode yang gagal atau saat order masih ready; diproyeksikan dari status `completed` yang sudah commit, bukan suksesnya respons HTTP admin semata.
- [x] Timeout atau hasil edit ambigu tidak membatalkan completion/pickup audit; sweep dapat menemukan kembali order completed dan melakukan GET reconciliation tanpa POST ulang, menjaga urutan target.
- [x] Mapping Dibatalkan dibatasi pada transisi lokal `cancelled` dan ada tes kontraknya; karena saat ini tidak ada penulis runtime, tidak membuat UI/API/pembatalan SO baru ataupun menjanjikan kasus yang belum bisa dijalankan end-to-end.
- [x] Dokumentasi feature dan cara investigasi final-state mismatch diperbarui; tidak ada persyaratan channel-status untuk verify-pickup admin.

**Verifikasi (lokal):** seam PostgreSQL dan kontrak HTTP endpoint completion/cron, suite gabungan **852 lulus, 2 skip, 0 gagal**; review independen menerima. Dibatalkan hanya kontrak mapping tanpa runtime dispatch; tidak ada Playwright karena UI/routing tidak berubah.

## Frontier dan pertanyaan review

- **Sekarang:** #01 selesai sebagai keputusan risiko; #02–#06 Done lokal, belum commit/deploy. Verifikasi gabungan terakhir setelah koreksi reviewer: **852 unit lulus, 2 skip, 0 gagal**, seam mirror+HTTP terfokus **98 lulus, 1 skip**; typecheck store/admin/db dan lint berkas terkait lulus. Tidak ada E2E karena tidak ada perubahan UI/routing; tidak ada request provider nyata. Risiko tanpa CAS vendor dan jendela transisi lokal sebelum POST tetap tercatat; efek samping vendor baru wajib diekskalasi.
- **Urutan:** [#02](build-tickets/02-belum-bayar-saat-create.md) → [#03](build-tickets/03-siap-proses-edit-tahan-crash.md) → {[#04](build-tickets/04-menunggu-verifikasi-kasus-operator.md), [#06](build-tickets/06-selesai-dan-kontrak-dibatalkan.md)}; [#05](build-tickets/05-gagal-bayar-dan-late-settlement.md) menunggu #04. [#01](build-tickets/01-batas-keamanan-edit-so.md) sudah Done. Ketergantungan ini menunjukkan *syarat teknis*, bukan izin menjalankan beberapa penulis paralel pada checkout yang sama.
- **Konfirmasi pemilik:** ukuran enam tiket (satu gate bukti + lima irisan build) dinilai pas; edge #05 menunggu #04 dan #06 cukup menunggu #03 dinilai tepat. Klarifikasi untuk #05: saat cancel SO dimulai/terkonfirmasi, **lewati edit Gagal Bayar dan catat mismatch**. Tiket lokal dibuat atas permintaan pemilik setelah persetujuan Ready; izin implementasi, provider write, remote, commit, dan deployment tetap terpisah.
