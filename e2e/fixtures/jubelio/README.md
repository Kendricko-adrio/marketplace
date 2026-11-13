# Fixture API Jubelio khusus testing

Server HTTP tiruan ini dipindahkan dari app workspace agar regression test tetap
offline. Bukan service development/deployment dan bukan bukti perilaku API sandbox.
Kedua konfigurasi Playwright menjalankannya sebagai proses lokal: suite mock pada
port 3112 dan suite standar pada port 3002 (termasuk boundary Midtrans).

- Entry point dari root: `node --import tsx e2e/fixtures/jubelio/server.ts`.
- Unit test: `npm run verify:unit:slice -- e2e/fixtures/jubelio/server.test.ts`.
- Typecheck: `npx tsc --noEmit -p e2e/fixtures/jubelio/tsconfig.json`.
- Host default `127.0.0.1`; parameter khusus fixture: `JUBELIO_MOCK_HOST` dan
  `JUBELIO_MOCK_PORT`. Jangan expose control API ke jaringan publik.
- Reset melalui `POST /__control/reset`; skenario melalui `PUT /__control/scenario`.
  Kontrak fixture dan pengaman E2E tetap sama setelah pemindahan.

`npm run dev:store`/`dev:all` tidak menjalankan fixture. Staging tidak memiliki
container mock. Konfigurasi akun provider dan pengaman write tidak diubah oleh
pemindahan ini. Webhook simulator sudah dihapus; endpoint webhook aplikasi tetap
tersedia untuk callback Jubelio asli.

Lihat [panduan testing](../../../docs/testing/README.md#fixture-provider-khusus-automated-test).
