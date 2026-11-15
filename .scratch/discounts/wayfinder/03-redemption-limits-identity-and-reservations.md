# Limit Redemption, Identitas, dan Kebijakan Reservation

Label: wayfinder:grilling
Type: grilling
Status: resolved
Assignee: main-agent
Blocked by: 02
Parent: [Wayfinder Desain Diskon](map.md)

## Question

Limit dan pemeriksaan identitas apa yang mengatur penggunaan kupon/kode promo, serta kapan kapasitas ditahan, dianggap terpakai, atau dilepas?

Putuskan jumlah penggunaan global/per customer dan budget subsidi; nilai wajib/default dibandingkan konfigurasi opsional; verifikasi email/telepon dan dampaknya pada customer; audience awal, aturan customer baru, dan code binding; periode penggunaan ulang/subkuota kode jika memang diperlukan sekarang; kegagalan order dibandingkan payment attempt; benefit nol; riwayat setelah revision, rename, atau penambahan kode; rate limiting/challenge dan eskalasi hold yang ambigu.

Bedakan satu penggunaan per akun yang terautentikasi dari satu penggunaan per orang. Janji kepada customer harus sesuai dengan identitas terverifikasi yang benar-benar tersedia.

Contoh: kuota 100, consumed 90, reserved 10 berarti tidak ada kapasitas baru. Payment attempt gagal pada order yang masih aktif tidak otomatis membolehkan release. Perubahan kode atau revision aturan tidak boleh diam-diam mereset pemakaian customer.

## Referensi dan batasan

- [Research pemakaian dan anti-abuse](../research/discounts-coupons-promo-codes.md#7-limits-and-anti-abuse-design).
- [Proposal reservation dan data](../research/discount-database-design.md#7-reservationusage-and-financial-result-tables).
- [Field identitas store](../../../packages/db/src/schema/auth.ts).
- [Status order/pembayaran yang ada](../../../packages/db/src/schema/orders.ts).

Kerjakan setelah Eligibility Offer dan Dasar Perhitungan Diskon selesai. Satu slot bersama kupon/kode sudah disepakati. Pengembalian jatah setelah refund dan hasil late payment menjadi milik tiket Kebijakan Pembatalan, Refund, dan Pembayaran Terlambat; jangan diasumsikan di sini.

## Bukti penyelesaian

Lifecycle kapasitas, limit configurable/default, serta kontrol identitas dan anti-abuse scope awal yang dikonfirmasi pemilik, disertai kasus realistis. Catat prerequisite yang belum tersedia dan mekanisme yang sengaja ditunda.

## Batas pekerjaan

Claim setelah blockers selesai. Muat `grilling`, `domain-modeling`, dan `development-workflow`. Hanya planning dan pemeriksaan lokal read-only. Tidak ada perubahan konfigurasi auth, implementasi OTP, request provider, subagent, atau penyelesaian tiket HITL lain.

## Keputusan sementara — Ronde 1

Dikonfirmasi pemilik melalui `ask_user_question`; belum merupakan approval ringkasan final tiket:

- Kontrol kuota penggunaan dan budget subsidi Rupiah tersedia per promo. Mandatory/default dan nilai limit belum diputuskan.
- Identitas penggunaan adalah akun store dengan email terverifikasi. Limit per akun bukan jaminan sekali per orang; verified phone/OTP tidak dipilih sebagai prerequisite awal.
- Kuota, budget, dan jatah customer mulai ditahan saat order dibuat, sebelum proses provider/payment. Preview atau memilih promo di checkout tidak menahan kapasitas.
- Contoh: tersisa satu jatah; Ani dan Budi boleh melihat preview. Order Ani berhasil dibuat lebih dahulu dan mendapat hold; pembuatan order Budi tidak boleh menjanjikan diskon yang kapasitasnya sudah habis atau diam-diam menaikkan tagihan.

### Ronde 2 — batas dan pemakaian final

- Setiap promo wajib memiliki minimal satu batas global: kuota penggunaan atau budget subsidi. Keduanya boleh diisi bersamaan; tidak ada nilai angka global default yang disepakati.
- Limit per akun default 1, dapat diubah admin menjadi angka positif lain. Hold ikut memakai jatah akun.
- Hold berubah menjadi pemakaian final setelah pembayaran terverifikasi dari sumber authoritative, bukan setelah fulfillment selesai. Order sudah dibayar dengan fulfillment tertahan tetap memakai kuota/budget.

### Ronde 3 — jawaban terkonfirmasi dan klarifikasi release

- Pembayaran ditolak tidak melepas promo. Order aktif mempertahankan hold; retry pembayaran pada order yang sama memakai hold yang sama, bukan mengambil jatah tambahan. Selaras dengan klasifikasi non-terminal di `apps/store/src/lib/order-finalize.ts:48–66`.
- Provider timeout/status ambigu: tetap hold dan eskalasi untuk rekonsiliasi/review ops; tidak otomatis release karena timeout.
- Rename, revision aturan, atau penambahan kode pada promo yang sama tidak mereset pemakaian. Seluruh kode berbagi kuota/budget/jatah akun identitas promo yang sama; promo baru memiliki riwayat terpisah.
- Tidak ada limit harian/bulanan atau cooldown pada fase awal. Limit akun adalah total selama promo yang sama, bukan jatah periodik.
- Setelah klarifikasi Q11, order belum dibayar yang batal/expired secara final dan dipastikan aman mengembalikan kuota, budget yang ditahan, serta jatah akun. Klaim tidak adanya webhook kegagalan Midtrans belum diverifikasi dan bukan dasar kebijakan.

### Ronde 4 — release dan scope anti-abuse

- Kode tidak terikat akun tertentu pada fase awal; customer dengan akun eligible dan verified email dapat memakai kode sesuai kapasitas/jatah.
- Anti-abuse awal memakai rate limiting akun/IP; IP bersama bukan identitas customer. CAPTCHA/challenge ditunda. Ambang rate limiting belum diputuskan.

### Ronde 5 — deadline, perubahan limit, dan identitas

- Deadline hold promo mengikuti deadline pembayaran order. Retry tidak memperpanjang deadline; deadline lewat memicu pemeriksaan, bukan release otomatis tanpa kepastian.
- Penurunan limit di bawah pemakaian final + hold aktif ditolak dengan alasan jelas. Contoh kuota 100, consumed 90, reserved 10: perubahan kuota menjadi 95 ditolak. Berlaku untuk kuota, budget, dan jatah akun sesuai kapasitas terkait.
- Pergantian email tidak mereset riwayat akun; email baru wajib terverifikasi untuk pemakaian berikutnya.
- Pemilik meminta rekomendasi angka rate limiting dari agent nanti. Angka/window belum disepakati; perlu rekomendasi berbasis seam endpoint dan review sebelum approval complete spec, bukan mengasumsikan angka universal best practice.

### Ronde 6 — budget dan perlindungan order lama

- Budget ditetapkan admin per promo sebagai batas total subsidi. Kapasitas memperhitungkan benefit aktual pemakaian final dan hold aktif, bukan nominal maksimum yang tidak diberikan.
- Budget harus cukup untuk seluruh benefit order. Diskon Rp20.000 dengan budget tersedia Rp15.000: promo tidak dapat dipakai; tidak ada hold parsial atau pengurangan diskon mengikuti sisa budget.
- Pause, berakhirnya promo, atau revision aturan tidak mengubah diskon order yang sudah mendapat hold. Order aktif memakai snapshot saat dibuat; perubahan berlaku untuk order baru.

## Answer — keputusan final disetujui

Pemilik memilih **Setujui ringkasan (Recommended)** melalui `ask_user_question`. Seluruh keputusan Ronde 1–6 di atas menjadi kontrak planning tiket ini; approval bukan izin implementasi.

Lifecycle: preview tanpa hold → order dibuat dengan hold kuota/budget/jatah akun → pembayaran authoritative terverifikasi menjadi pemakaian final, atau order belum dibayar berakhir secara pasti dan aman menjadi release. Payment attempt ditolak tidak mengubah hold. Retry memakai hold yang sama dan tidak memperpanjang deadline. Status ambigu tetap hold + eskalasi.

Admin menyediakan kuota dan budget, wajib minimal salah satunya; angka global harus dikonfigurasi, bukan default angka yang ditebak. Jatah akun default 1 dan configurable positif, total per identitas promo. Kapasitas mencakup pemakaian final + hold, dan budget memakai benefit aktual penuh. Semua kode pada promo berbagi kapasitas; subkuota kode/periode/cooldown tidak masuk fase awal.

Customer menggunakan akun store dengan verified email; perubahan email tidak mereset jatah dan email baru harus terverifikasi. Tidak menjamin satu orang hanya satu akun. Tidak ada code binding/OTP/CAPTCHA atau promo khusus customer baru pada fase awal. Rate limiting akun/IP wajib, IP bukan identitas customer. Rekomendasi angka/window ditunda ke complete spec setelah seam endpoint diperiksa dan sebelum approval implementasi.

Riwayat tetap setelah rename/revision/penambahan kode. Limit tidak boleh diturunkan di bawah komitmen pemakaian final + hold; order yang telah mendapat hold mempertahankan snapshot meskipun promo berubah/di-pause/berakhir.

### Kasus realistis terkonfirmasi

- Kuota 100, consumed 90, reserved 10 → kapasitas baru nol; penurunan kuota menjadi 95 ditolak.
- Budget Rp100.000, empat order paid dengan diskon Rp20.000 → consumed Rp80.000; satu pending mendapat hold Rp20.000 → kapasitas Rp0. Jika order itu berakhir dan aman release, kapasitas kembali Rp20.000.
- Budget Rp95.000, consumed Rp80.000 → sisa Rp15.000 tidak cukup untuk diskon Rp20.000; promo tidak dapat dipakai, bukan memberikan diskon parsial.
- Limit akun 1: payment attempt ditolak pada order A → hold tetap. Retry A tidak mengambil jatah lagi. Setelah A berakhir pasti dan aman release, akun boleh memakai promo pada order B.
- Kode HEMAT berganti HEMATBARU pada promo yang sama atau email akun berubah → riwayat tetap, tidak mendapat jatah baru.

### Batas dan prerequisite tersisa

- Refund setelah paid dan hasil late payment milik tiket 10; keputusan release di sini tidak menentukan pemulihan setelah refund atau penyelesaian late settlement.
- Deletion/retention/anonymization identitas dan riwayat milik tiket 11; bukan persetujuan agar penghapusan profil mereset limit.
- Escalation hold ambigu wajib; detail UX/permission ops mengikuti tiket admin UX/otorisasi dan complete spec.
- Tidak ada implementasi/schema/auth changes, provider request, subagent, tests/build/lint atau verifikasi runtime. Bukti berasal dari jawaban pemilik dan pemeriksaan lokal schema/klasifikasi payment; klaim tidak adanya webhook kegagalan Midtrans belum diverifikasi.

## Comments

Dipublikasikan setelah proposal map lengkap disetujui. Dependencies dipasang pada tahap kedua setelah seluruh child tersedia.
