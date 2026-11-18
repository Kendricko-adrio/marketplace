# Daftar pekerjaan outstanding staging dan penanggung jawab

## Serah terima operasional

[Dokumen serah terima](handover-staging-fase-2.md) telah disusun. Atas arahan pemilik, A03 dan A04 dialihkan ke pemilik untuk pemeriksaan manual dan tidak menjadi syarat serah terima. Tidak ada pemeriksaan runtime/dashboard/admin baru.

U02/U05/U06 ditutup berdasarkan laporan pemilik: reset password System Owner, konfigurasi Shipment, dan callback provider sudah dilakukan. U03/U04 dan pekerjaan penerapan A02 ditutup untuk fase ini atas keputusan pemilik: sebagian cabang dan konten sudah diisi, tanpa klaim seluruhnya lengkap. Pengalihan A03/A04 bukan permintaan untuk mengulang setup atau reset. Tidak ada perubahan runtime, pemeriksaan server, atau test baru pada pembaruan ini.

## Checkpoint teknis — 18 November 2026

Credential Google staging terkonfirmasi telah diberikan pemilik dan diterapkan pada15:11 UTC. U01/A01 Verified: hanya dua key Google pada env staging berubah; store healthy dari image yang sama, auth healthHTTP200/oktrue, checkout tetap terbuka. Tidak build atau test suite; Google sign-in/dashboard masih belum terverifikasi. [Evidence setup Google](setup-google-oauth-staging.md). Pembacaan log/journal existing juga menutup A05: actual scheduled stock18November3/3 sukses dan freshness read-only lulus, tanpa memanggil job baru.

## Histori pembukaan checkout — 17 November 2026

**Checkout staging dibuka atas permintaan pemilik**, meskipun readiness lain belum lengkap. `checkout.paused=false` pada13:24 UTC (20:24 WIB); store direcreate dari image ID yang sama dan kembali healthy. Tidak rebuild, menjalankan test tambahan, mengubah Google/provider credentials, mengubah admin/Caddy/volume atau membuat transaksi percobaan. Bukti server: `/home/ops/log/marketplace-bootstrap/staging/checkout-unpause.json`.

Buka checkout berarti pause gate tidak lagi menghalangi order baru, **bukan jaminan transaksi pickup/delivery/payment bisa tuntas** ketika konfigurasi masih kurang. Gateway SO tetap test-account, direct stock adjustment off, Midtrans sandbox. Pada checkpoint ini, environment Shipment masih belum terverifikasi; nama staging tidak otomatis membuktikan seluruh akun provider sandbox. Pemilik/tester boleh memakai staging sesuai kebutuhannya; agent tidak mendapat izin canary transaksi provider dari perintah membuka checkout ini.

Dokumen ini inventaris operasional yang diminta pemilik, bukan publikasi implementation tickets atau izin menjalankan semua item otomatis. Pekerjaan test/perubahan kode di luar checklist operasional **ditunda sesuai arahan pemilik**.

## Pekerjaan Anda

| ID | Pekerjaan | Yang perlu disediakan/dilakukan | Status |
|---|---|---|---|
| U01 | Credential Google OAuth staging terkonfirmasi | Pemilik memberikan pasangan eksplisit18November; agent menyimpannya secara privat di luar repo. Nilai tidak dicantumkan dalam evidence dan pair legacy tidak dipakai | Verified — input diterima |
| U02 | Reset password System Owner | Login `https://dev-admin.adfsport.cloud/login`, selesaikan mandatory reset. Agent tidak mengganti password pribadi atau melewati gate ini | Selesai — dikonfirmasi pemilik |
| U03 | Data operasional cabang | Tentukan cabang yang benar-benar melayani pickup/delivery; berikan alamat pengirim lengkap, kode pos/kontak dan jam operasionalnya. Agent yang memadankan area ID dari master resmi, bukan Anda menebak ID. Tidak menganggap cabang bernama Transit/Website otomatis eligible/ineligible | Ditutup untuk fase ini — pengisian sebagian diterima pemilik |
| U04 | Konten storefront final | Berikan copy footer/kontak dan halaman legal/informasi yang ingin dipublikasikan, atau isi sendiri melalui admin setelah reset. Tidak memakai isi dummy/dev tanpa persetujuan | Ditutup untuk fase ini — pengisian sebagian diterima pemilik |
| U05 | Konfirmasi akun/environment Shipment | Pastikan credential yang boleh dipakai memang untuk environment yang diinginkan. Runtime host berbeda dengan referensi sandbox repo; agent tidak menebak target atau mencoba quote/booking untuk mencari tahu | Selesai — pemilik melaporkan setup sudah dilakukan; detail belum dicek agent |
| U06 | Callback di dashboard provider | Konfigurasi atau berikan bukti konfigurasi URL staging pada Google/Jubelio/Shipment/Midtrans. Perubahan dashboard tidak termasuk izin agent sekarang. Jangan sertakan token/secret pada bukti publik | Selesai — pemilik melaporkan callback sudah dikonfigurasi; belum dicek agent |

### URL callback untuk U06

- Google store: `https://dev-store.adfsport.cloud/api/auth/callback/google`
- Jubelio: `https://dev-store.adfsport.cloud/api/webhooks/jubelio`
- Jubelio Shipment: `https://dev-store.adfsport.cloud/api/webhooks/jubelio-shipment`
- Midtrans: `https://dev-store.adfsport.cloud/api/webhooks/midtrans`

Google callback hanya untuk store; admin tidak memakai social provider Google. Keberadaan route/secret bukan bukti dashboard sudah tersimpan atau callback sudah pernah berhasil.

## Pekerjaan agent

| ID | Pekerjaan | Ketergantungan / batas | Status |
|---|---|---|---|
| A01 | Terapkan credential Google terkonfirmasi | Dua key Google pada env staging/runtime cocok dengan input; store direcreate dari image terpin dan healthy. Non-Google env, admin/Caddy/mounts dan checkoutfalse tetap. Auth healthHTTP200; bukan Google sign-in end-to-end | Verified —18November15:11 UTC |
| A02 | Terapkan dan validasi data operasional/konten | Pemilik menerima pengisian sebagian dan menutup pekerjaan ini untuk fase staging. Tidak ada penerapan atau validasi kelengkapan tambahan oleh agent | Ditutup untuk fase ini — atas keputusan pemilik |
| A03 | Cocokkan Shipment dan callback | Pemilik akan mencocokkan environment dan dashboard secara manual. Tidak perlu mengulang setup, mengirim bukti ke agent, atau membuat transaksi percobaan untuk handover | Dialihkan ke pemilik — tidak diverifikasi agent |
| A04 | Review halaman admin | Pemilik menangani review manual; agent tidak membutuhkan akses sesi admin | Dialihkan ke pemilik — tidak diverifikasi agent |
| A05 | Catat hasil stock cron yang benar-benar terjadwal | Log/journal actual18November02:00 UTC menunjukkan3/3 sukses,59.730 IDs/165.021 observations, missing0/failed0; query read-only15:16 UTC timestamp kosong/stale24h/negative holds0. Tidak memanggil job baru | Verified — [bukti scheduler](verifikasi-stock-terjadwal-staging.md) |
| A06 | Selaraskan penutupan laporan/verifier import | Data telah ditarik dan direkonsiliasi. Verifier lama masih memakai asumsi SKU×seluruh cabang; perlu tindak lanjut kode/kontrak terarah. Bukan import ulang atau membuat row stok nol | Pending — tindak lanjut kode ditunda, tidak dijadikan syarat buka staging |
| A07 | Tutup full verification yang masih merah | Cancel-race assertion dan cleanup rehearsal DB di luar normalisasi. Tetap dicatat jujur; tidak menambah/mengulang test atau mengubah modul lain pada pekerjaan operasional ini | Pending — ditunda sesuai arahan Anda |
| A08 | Serah terima operasional dan bukti AC | Release, konfigurasi, scheduler dan keterbatasan dirangkum dalam [dokumen serah terima](handover-staging-fase-2.md) | Diserahkan — AC14 formal tetap Pending |

## Yang tidak perlu diulang

- Import sandbox: penarikan telah mencapai akhir,39.045 model/108.503 SKU; tidak reset/reseed/import ulang.
- Normalisasi refresher telah diterapkan; actual manual chain3 memperbarui165.021 mapped rows, missing0/failed0 dan local holds tidak berubah.
- Ketiga cron telah dipasang; sweep/email sudah terbukti terjadwal. Evidence **jadwal stock pertama** sudah tercatat terpisah dari manual chain, dengan actual cron/journal18November.
- Release store/admin/tools sudah satu snapshot terpin, apps healthy, image IDs/source pointer ada pada `active-release.json`.
- Kontrak diskon1 sudah aktif. Checkout tidak lagi perlu approval pembukaan—pemilik sudah memberikannya dan flag telah diubah.

## Di luar kewajiban scope saat ini

UAT transaksi sandbox, quote/booking kurir, payment/SO/invoice, SMTP delivery dan Google OAuth end-to-end bukan pekerjaan agent yang otomatis dijalankan. Jika pemilik ingin agent melakukannya, perlu scope/izin terpisah. Tidak menjadikan canary tersebut sebagai outstanding wajib baru hanya untuk memperpanjang deployment.

## AC permintaan ini → evidence

| AC | Evidence | Status |
|---|---|---|
| B1 | Persetujuan pemilik tercatat, flagfalse dibaca kembali, store direcreate dari image ID yang sama dan healthy | Verified |
| B2 | Runtime env termasuk Google/provider identik sebelum/sesudah; admin/Caddy/mounts dipertahankan; tidak build/test/provider canary | Verified |
| B3 | Semua outstanding dikelompokkan Anda/agent, dependency dan status tercatat; teknis yang ditunda tidak dijalankan otomatis | Verified |

Status global deployment tetap di [register AC](verifikasi-deployment-staging-fase-2.md). Checklist penutupan yang belum dipenuhi tetap mengikuti [limitations plan](verifikasi-pasca-import-staging.md#7-limitations-penutupan--item-spec-yang-belum-ditutup-verbatim); pembukaan staging tidak dianggap memenuhi origin/konten/callback/full verification.
