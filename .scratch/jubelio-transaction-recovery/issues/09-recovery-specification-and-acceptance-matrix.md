# Spesifikasi Recovery dan Acceptance Matrix

Label: wayfinder:grilling
Type: grilling
Status: open
Blocked by: 08
Parent: [Recovery Transaksi Jubelio dan Tindak Lanjut Terpadu](../map.md)

## Pertanyaan

Apakah keputusan yang sudah diselesaikan menghasilkan kontrak recovery yang lengkap dan konsisten, serta acceptance/verification criteria teramati apa yang wajib dicantumkan dalam spec lengkap sebelum approval terpisah pengguna?

Lakukan sintesis; jangan membuat sendiri keputusan produk yang belum ada:

- Petakan setiap failure point dan kelas bukti yang didukung ke membership antrean, authority visibility/action, tindakan berikutnya, hasil berhasil, dan perilaku unresolved/eskalasi.
- Petakan kasus denied/legacy/missing-ID/mismatch/terminal/concurrent ke non-effects yang eksplisit.
- Konfirmasi kesetaraan scope sebelum mengganti Review Jubelio, akses operasional cabang yang dipertahankan, dan semantik grant HQ/custom Role.
- Konfirmasi pemisahan ketat GET recovery, repair lokal, kelanjutan operasi pertama kali, write attempt baru, dan fulfillment komersial/fisik.
- Cocokkan bukti provider dengan behavior retry yang dijanjikan; jaminan yang belum didukung harus tetap unresolved/dikecualikan, bukan diam-diam dianggap tersedia.
- Jadikan gap implementasi yang diketahui sebagai kewajiban verifikasi: pencatatan ID sebelum GET, intent dengan konfigurasi tidak valid, crash tanpa ID, transisi manual-review, pagination sesuai scope, dan beberapa kendala per order.
- Tentukan coverage unit/service/real-PG pada public seams serta Playwright, provider controls yang deterministic, audit/logging/privacy, dan implikasi deployment/dokumentasi yang relevan tanpa menjalankannya.
- Identifikasi keputusan baru yang memerlukan ticket tambahan yang disetujui atau perubahan scope dari pengguna sebelum drafting spec final.

## Bukti dan batasan

- [Wireframe dan Pesan pada Detail Recovery](08-recovery-detail-wireframes-and-messages.md) beserta seluruh prasyaratnya yang sudah resolved.
- [Research awal dan usulan target verifikasi](../../../plan/research/jubelio-transaction-recovery-admin.md#12-suggested-verification-targets-not-executed).
- [Development workflow](../../../.agents/skills/development-workflow/SKILL.md), [lifecycle plan](../../../plan/README.md), dan [persyaratan testing](../../../AGENTS.md).
- [Tujuan penyimpanan dokumentasi](../../../docs/README.md) dan [dokumentasi testing](../../../docs/testing/README.md).

Penyelesaian ticket mengonfirmasi konsistensi desain dan acceptance criteria. Ini bukan approval spec implementasi, izin publikasi breakdown build tickets, atau authorization untuk menjalankan tests/provider requests.

## Bukti penyelesaian

Catat kontrak gabungan dan acceptance matrix yang dikonfirmasi pengguna serta dapat ditelusuri, dengan menautkan jawaban/assets child tickets sebagai sumber utama, bukan menduplikasi keputusannya.

Ketika tujuan map tercapai:

- Setelah shared understanding dikonfirmasi, buat spec lengkap yang dapat direview di `plan/`, dengan scope/non-goals eksplisit, skenario user-visible, invariants authorization/safety, kebutuhan verifikasi, dan keterbatasan yang tersisa.
- Conceptual plan tetap Draft sampai approval lengkap-spec diberikan terpisah; daftarkan melalui lifecycle plan repo tanpa menjadikan tracker ini sebagai indeks status plan.
- Tampilkan spec lengkap atau link untuk review beserta ringkasan edge cases yang akurat. Jangan set Ready atau mulai implementasi sampai pengguna secara eksplisit menyetujui seluruh kontrak tersebut.
- Breakdown implementation tickets lintas sesi memerlukan approval tersendiri sebelum publikasi.

Contoh yang harus dibedakan oleh matrix: delivery verified normal dibandingkan kasus settlement; timeout legacy dibandingkan bukti non-send; pencatatan payment Jubelio dibandingkan charge pelanggan; repair lokal dibandingkan remote create baru; cleanup order terminal dibandingkan fulfillment yang dibuka kembali.

## Batas pekerjaan

Hanya dokumen planning dan interview pengguna. Load skills yang diwajibkan map; claim terlebih dahulu. Selesaikan maksimal satu child non-research ini dalam satu sesi. Tidak ada perubahan aplikasi/schema/config, test suites, provider requests, build tickets, autonomous queueing, delegation, commit, atau deployment. Jika muncul keputusan baru, hentikan sintesis terkait dan minta arahan pengguna, bukan memilih sendiri.

## Komentar

Dipublikasikan pada 2026-10-13 setelah approval eksplisit struktur decision map. Approval spec lengkap dan implementasi belum diberikan.
