# Setup credential Google OAuth staging — 18 November 2026

## Scope dan hasil

Pemilik memberikan pasangan Client ID/Secret staging secara eksplisit dan meminta pemasangan. Pasangan ini menggantikan Google lokal pada konfigurasi aktif; tidak memakai kandidat legacy. **Nilai credential tidak dicantumkan di dokumen ini.**

Hanya dua key `GOOGLE_CLIENT_ID` dan `GOOGLE_CLIENT_SECRET` pada:

- `/home/ops/marketplace/deployment/staging/.env`
- `/home/ops/marketplace/deployment/staging/.env.staging`

Input disimpan di direktori privat ber-ACL untuk user saat ini, di luar repo: `C:\Users\USER\.pi\secrets\marketplace-staging-phase2\google-oauth\confirmed.json`. Transfer melalui stdin SSH, bukan argv atau output command. Kedua env server tetap mode600. Tidak mengubah env lokal development, auth secret, credential provider, source code, image atau schema.

## Penerapan dan verifikasi operasional

- Mulai `2026-11-18T15:11:00.200216+00:00`, healthy `15:11:10.170533+00:00`.
- Store direcreate dari image ID yang sama pada release3256bdb3 melalui runtime override terpin. Tidak rebuild atau menjalankan unit/E2E suites.
- Env ter-resolve dan actual runtime dibandingkan secara privat: kedua key Google cocok tepat dengan input pemilik. Semua env selain dua key tersebut identik sebelum/sesudah; file non-Google lines juga identik.
- Admin tidak menggunakan social provider Google dan tidak direcreate. Admin/Caddy/container mounts tetap.
- `checkout.paused=false` tetap; hanya dibaca sebelum/sesudah, tidak diubah.
- Google auth base URL adalah `https://dev-store.adfsport.cloud`. GET `/api/auth/ok` →HTTP200 dan `ok:true` dengan verifikasi TLS normal. Ini health check operasional, bukan Google sign-in atau validasi secret oleh token endpoint.
- Tidak melakukan Google sign-in/token exchange, perubahan dashboard Google, transaksi provider, reset/seed/import atau perubahan data akun.

Bukti aman server: `/home/ops/log/marketplace-bootstrap/staging/google-oauth-setup.json`; rollout log tidak memuat credential. Source release/runtime tetap sama seperti task normalisasi, bukan build baru.

## Context7 dan kontrak existing

`/better-auth/better-auth` mengonfirmasi `socialProviders.google.clientId/clientSecret` dari env dan default callback `/api/auth/callback/google`. Source existing `apps/store/src/lib/auth.ts:129–133` membaca dua key tersebut; `apps/admin/src/lib/auth.ts` memiliki `socialProviders:{}`. Tidak menulis API library baru.

Callback yang perlu terdaftar pada OAuth client Google:

```text
https://dev-store.adfsport.cloud/api/auth/callback/google
```

Status dashboard/operator dan Google sign-in end-to-end **belum terverifikasi**. Keberhasilan auth health/runtime env bukan bukti token exchange telah berhasil. Pemilik dapat memeriksa Authorized redirect URIs di Google Cloud Console dan memakai tombol Google di login store; tidak ada agent Google canary dalam scope ini.

## AC → evidence

| AC | Evidence | Status |
|---|---|---|
| G1 | Dua key pada env aktif/legacy cocok dengan input eksplisit; non-Google file content identik; file mode600 | Verified |
| G2 | Store baru healthy pada image yang sama, runtime pair match; admin/Caddy/mounts dan env lain identik; checkout tetapfalse | Verified |
| G3 | Source auth base sesuai staging, GET auth health200/oktrue, tanpa build/test suite/Google sign-in | Verified |

Input U01 dan penerapan A01 pada [checklist outstanding](checklist-outstanding-staging.md) dapat ditutup pada scope konfigurasi. U06/A03 dashboard/callback dan readiness lainnya tetap Pending; tidak mengklaim seluruh deployment atau login Google end-to-end selesai.
