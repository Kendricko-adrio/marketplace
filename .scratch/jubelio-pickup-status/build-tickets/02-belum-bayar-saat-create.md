# 02: Belum Bayar pada create SO pickup

**Parent:** [Spesifikasi Ready — cermin Status Channel](../spec-draft.md) · [bukti create marker](../combined-test-results-2026-09-26.md)

**What to build:** Ketika pelanggan checkout pickup, SO `INTERNAL` yang dibuat menampilkan **Belum Bayar** pada Status Channel. Marker berada dalam **satu POST create SO yang sudah wajib**, diikuti **satu GET independen** untuk memastikan ID, cabang, item, jumlah, harga, dan total sebelum Midtrans. Ketidaksesuaian *marker saja* tidak menjadikan cermin sebagai gate pembayaran: catat mismatch tahan crash dan lanjutkan checkout bila atribut inti benar.

**Blocked by:** #01 (Done; tidak ada tiket build yang masih menghalangi).

**Status:** Done secara lokal untuk lingkup #02 (belum commit/deploy). Tes gateway dan seam PostgreSQL per-order lulus; `npm run test:unit` masih gagal pada dua tes RBAC seeded-Admin yang tidak terkait dan sengaja di luar lingkup perbaikan ini. Tidak ada POST Jubelio nyata.

## Acceptance criteria

- [x] Intent create persisten membawa marker **Belum Bayar**; gateway mengirim tepat satu POST create dan membaca balik lewat GET independen. Tidak ada POST edit ketiga untuk marker awal dan tidak ada pengulangan create secara buta ketika hasilnya ambigu.
- [x] Kegagalan/rejection create atau mismatch identitas, lokasi, item, jumlah/harga/total tetap menahan checkout seperti sebelumnya. Bila hanya marker tidak cocok pada GET, checkout dapat melanjutkan Midtrans; simpan mismatch yang bisa dicari menurut order/SO, dan log terstruktur tanpa PII/token/raw body.
- [x] SO yang belum ada atau belum terkonfirmasi tidak dikirimi edit marker. Perilaku stock hold, payment, dan pickup tidak berubah hanya demi Status Channel.
- [x] Tes gateway pada boundary HTTP membuktikan satu POST + GET dan kasus ambigu; tes perilaku checkout/mismatch persisten memakai seam per-order yang disepakati, red → green. Dokumentasi alur create dan penemuan mismatch diperbarui.

**Verification (lokal):** `npx vitest run --project @marketplace/store --silent`: 248 lulus, 1 dilewati; tes gateway, klaim PostgreSQL dan per-order marker/replay lulus. `npm run test:unit -- --silent`: 711 lulus, 2 gagal (RBAC seeded-Admin: home branch tidak ada), 1 dilewati. Typecheck store lulus; tidak ada perubahan UI/routing untuk E2E. Review read-only #02: tidak ada temuan pemblokir; risiko rendah lintas-project DB paralel dicatat, bukan izin mengubah tes RBAC. Tidak ada request ke Jubelio nyata.
