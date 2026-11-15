# Acceptance End-to-End dan Kesiapan Spec

Label: wayfinder:grilling
Type: grilling
Status: resolved
Assignee: main-agent
Blocked by: 06, 11
Parent: [Wayfinder Desain Diskon](map.md)

## Question

Acceptance criteria yang dapat diamati, test seams, dan release gates provider apa yang diperlukan untuk spec lengkap siap direview, serta apakah masih ada keputusan pemilik yang belum selesai?

Putuskan acceptance matrix untuk konsistensi markdown di katalog/detail/cart; hasil/conflict/retry Excel valid rows; penggantian kupon/kode manual yang dipilih langsung; satu slot; contoh capped/fixed/shipping independen; usage/budget/concurrency/replay pada DB nyata; nominal order/provider immutable; cancellation/refund/late payment; authorization/audit admin; migration legacy; bukti provider dan pengaman rollout.

## Referensi dan batasan

- Artefak [UX Admin Diskon dan Authorization](06-admin-ux-and-authorization.md) serta jawaban [Arsitektur Schema, Retention, dan Extensibility](11-schema-retention-and-extensibility.md) yang wajib disetujui pemilik.
- Semua child resolved melalui [map](map.md); baca jawaban/artefak terkait sesuai kebutuhan.
- [Matriks verifikasi research existing](../research/discounts-coupons-promo-codes.md#11-verification-matrix-for-a-later-implementation).
- [Persyaratan testing project](../../../AGENTS.md), [dokumentasi testing](../../../docs/testing/README.md), [gates spec/persetujuan](../../../.agents/skills/development-workflow/SKILL.md).

Menulis research atau map bukan berarti tests fitur sudah dijalankan. Bukti provider tidak dapat digantikan dengan stubbed-fetch checks. Persetujuan outline acceptance bukan persetujuan complete spec.

## Bukti penyelesaian

Link ke acceptance matrix yang disetujui pemilik dan outline spec yang tepat, dengan decisions/scope/evidence gates ditelusuri ke child masing-masing. Jika muncul pertanyaan baru yang sudah konkret, tambahkan melalui gates scope/publikasi map yang disetujui, bukan mengasumsikan jawabannya. Setelah keputusan selesai, draft spec lengkap untuk review/persetujuan pemilik secara terpisah; jangan mengubah Ready atau membuat build tickets hanya berdasarkan persetujuan map.

## Batas pekerjaan

Claim setelah blockers selesai. Muat `grilling`, `domain-modeling`, dan `development-workflow`; konsultasikan `tdd` untuk diskusi desain tests. Planning saja; tidak ada penulisan/eksekusi implementation tests, perubahan app/schema, request provider, subagent, commit, atau penyelesaian tiket HITL lain.

## Keputusan sesi — Ronde 1

Jawaban pemilik melalui `ask_user_question`; belum approval acceptance matrix atau complete spec:

- Percobaan kode baru yang invalid/kehabisan kuota tidak mengganti kupon lama yang masih valid. Tampilkan alasan kegagalan; pilihan dan total lama tetap.
- Picker kupon publik menampilkan kupon relevan yang belum eligible sebagai disabled dengan alasan, misalnya minimum belanja belum terpenuhi. Tidak membocorkan kode manual.
- Jawaban awal “Internal lalu publik” dikoreksi pemilik setelah istilah diperjelas: pemilik mengira internal berarti tests aplikasi dan publik berarti API external. Keputusan terbaru: setelah development, pemilik dan tester melakukan testing di staging, lalu rilis langsung publik tanpa cohort pengguna internal terpisah di production. Seluruh acceptance dan launch gates provider tetap berlaku; keputusan rencana bukan izin deploy atau request provider.
- Setelah contoh penggantian kupon Rp20.000 dengan kode valid Rp10.000 diperjelas, pemilik memilih konfirmasi tambahan hanya jika total pembayaran naik. Jika sama/turun, tindakan Pilih/Terapkan langsung mengganti promo dan menampilkan total baru. Jika konfirmasi dibatalkan, pilihan lama tetap. Angka net barang contoh belum termasuk pajak/ongkir/fee.

### Ronde 2 — promo gugur dan batas penghentian rollout

- Jika promo terpilih menjadi tidak valid karena perubahan cart/fulfillment, tampilkan alasan dan minta pilihan ulang. Customer memilih promo lain atau secara eksplisit melanjutkan tanpa promo dengan total baru sebelum order dibuat. Tidak mempertahankan benefit invalid atau menaikkan tagihan diam-diam.
- Setelah konteks dan istilah rollout diklarifikasi, pemilik memilih menghentikan kupon bermasalah untuk order baru saja ketika checkout lain terbukti aman. Jika dampak meluas/belum jelas, alur yang belum terbukti aman ditahan. Tidak mengubah nominal order yang sudah dibuat. Ini kontrak pengaman, bukan approval emergency-switch subsystem baru atau izin operasi production.

### Checkpoint kesepahaman dan draft lengkap

Pemilik memilih **Sesuai, buat draft (Recommended)** melalui `ask_user_question` setelah menerima rangkuman keputusan, non-goals, test seams, acceptance dan gap provider/detail teknis. Ini izin menyusun draft untuk review, bukan approval dokumen lengkap atau implementasi.

Draft reviewable: [acceptance matrix dan outline complete spec](acceptance-12-and-specification-outline.md). Memuat scenario/result/seam IDs, contoh uang independen, penelusuran prerequisite, gates spec/implementation/provider/staging/release, serta detail yang masih harus dijabarkan pada complete spec. Tidak menutup dua launch gates provider atau menganggap angka rate limiting/retry/timeout sudah disepakati. Pada checkpoint draft, status tetap claimed sampai pemilik menyetujui dokumen lengkap; approval akhir dicatat di bawah.

## Answer — acceptance matrix dan outline spec disetujui

Pemilik menyetujui [acceptance matrix, test seams, outline spec dan gates lengkap](acceptance-12-and-specification-outline.md) melalui `ask_user_question` dengan memilih **Setuju, tutup tiket 12 (Recommended)** setelah menerima link reviewable dan ringkasan cakupan/batas. Tidak ada frontier keputusan tambahan pada sesi ini. Tiket resolved sebagai keputusan planning, bukan hasil delivery implementasi atau approval complete spec/Ready.

- Matrix menelusuri harga katalog/detail/cart, Excel partial/conflict/resume/retry, pilihan satu slot dan konfirmasi, contoh capped/fixed/shipping, PG concurrency/replay, snapshot uang, provider lifecycle, authorization/audit, retention dan compatibility ke sumber prerequisite.
- Test seams pricing/transaksi PG/HTTP/browser/provider/deployment disetujui sebagai desain acceptance; belum ada implementation tests ditulis atau dijalankan. Concrete interfaces, angka rate limiting, code limits, bounded retry/timeout dan physical integration wajib dirinci/review pada complete spec, bukan dianggap sudah diputuskan.
- Rilis mengikuti automated acceptance, UAT staging oleh pemilik/tester, lalu publik tanpa internal-production cohort. Kupon bermasalah dihentikan untuk order baru bila alur lain terbukti aman; snapshot lama tetap, tanpa emergency-switch subsystem baru.
- Pada approval awal terdapat dua launch gates provider; status terkini telah berubah: evidence mirror M1/M2 tersedia, sedangkan kewajiban pembuktian pembayaran/provider Rp0 dicoret pemilik melalui koreksi scope di bawah. Outline bukan complete spec; dokumen lengkap serta approval-nya tetap tahap terpisah. Tidak membuat build tickets atau mengubah Ready dari approval ini.
- Refund aplikasi dan compatibility/backfill usage voucher legacy tetap di luar scope. Jika penggunaan nyata ditemukan, hentikan cutover terkait untuk keputusan; tidak mengarang histori atau menjalankan reset/delete.

Verifikasi dokumen: link lokal, whitespace/code fences dan 11 contoh aritmetika sesuai; `git diff --check` tiket bersih. Tidak ada edit app/schema/config/seed/SQL, migration execution, tests/build/lint/typecheck, provider request, subagent, commit atau deployment. Perubahan hanya artefak/tiket/map sesi ini; dirty changes dari sesi sebelumnya tidak diikutsertakan atau ditimpa.

## Pembaruan evidence sesudah approval tiket12

[Research mirror09 berizin terpisah](../research/research-09-post-invoice-mirror.md#hasil-kelanjutan-dan-review-main-agent) kini membuktikan stage post-invoice/payment pada M1/M2 qty1/qty2. Status evidence G4/P03 diperbarui di artefak acceptance; research ini sendiri tidak menyelesaikan kasus provider Rp0, yang kemudian dicoret dari scope oleh pemilik. Tidak mengubah scope/acceptance yang disetujui atau mengklaim tests implementasi, complete spec, Ready dan launch telah disetujui. Catatan dua gates terbuka di Answer merupakan keadaan saat approval tiket12.

## Koreksi scope berikutnya — tanpa pembayaran Rp0 dan service fee

[Keputusan eksplisit pemilik](decision-zero-payment-and-no-service-fee.md): pembayaran Rp0 tidak terjadi dalam scope operasional dan dijaga prosedur admin/pemilik bisnis; website tidak mengenakan service fee. Outstanding 2 dicoret, bukan ditunda. Pembuktian pembayaran/provider Rp0 bukan acceptance requirement, research follow-up atau launch gate; contoh fee Rp2.000 ditarik. Acceptance F02/F03, contoh nominal, G4/G5 dan daftar gap diperbarui mengikuti koreksi ini. Ini bukan klaim provider Rp0 telah diuji atau approval complete spec/implementasi/launch.

## Comments

Dipublikasikan setelah proposal map lengkap disetujui. Semua prerequisite awalnya open, dan spec lengkap belum dibuat/disetujui.
