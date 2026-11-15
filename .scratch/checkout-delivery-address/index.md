# checkout-delivery-address

Navigasi artefak fitur ini; aturan layout dan lifecycle: [panduan](../README.md).
Status plan hanya dicatat di sini. Status ticket tetap di masing-masing ticket.

## Status plan

| Plan | Status | Features | Notes / Outcome |
|---|---|---|---|
| [Isi dan simpan alamat delivery di checkout](../../docs/features/delivery-quotes.md) | Done | 3 | 2026-10-02: checkout menerima alamat baru tanpa harus disimpan, penyimpanan opsional/default terintegrasi dengan transaksi order dan dedupe save-intent; unit serial 955 lulus/2 skipped, mock E2E 30/30, store typecheck/lint lulus. Tidak ada aktivasi provider live. |
| [Alamat checkout tersimpan sebelum order](plan/alamat-tersimpan-sebelum-order-spec.md) | Done | 3 | 2026-11-15: implementasi selesai — alamat disimpan sebelum order lewat modal (create/PATCH), card tujuan lengkap, quote/review/place-order hanya `addressId`, retry key terbatas, guard save-intent legacy, docs diperbarui. Evidence: `verify:types:store` lulus, serial unit 204 file/2455 test, mock E2E 67 + 25 (`delivery-quote` dengan test AC09) + 11 (`checkout-cross-check`) lulus, rendered review 390/1280 dengan artefak di `playwright/mcp/address-review/`. AC01–AC20 Verified (AC18: dark theme N/A untuk store). Rollout drain/pause tetap gate operasional. |

Catatan status dan hasil test di atas dipindahkan dari index lama, bukan verifikasi baru.
Plan Done yang dahulu sudah dihapus tidak direkonstruksi; outcome dan docs tetap tersedia.

## Artefak

- [Research penyimpanan alamat sebelum place-order](research/penyimpanan-alamat-sebelum-place-order.md) — 2026-11-15: penelusuran source pada `164f1f6` memverifikasi draft frontend, opsi simpan, dua jalur persistence (attempt/legacy), endpoint create existing, dampak requirement, dan keputusan terbuka. Belum ada perubahan implementasi atau verifikasi runtime.

- [Sesi keputusan simpan alamat checkout](wayfinder/keputusan-simpan-alamat-checkout.md) — grilling with docs untuk menyelesaikan keputusan perilaku sebelum spec; bukan approval implementasi.

- [Spec alamat checkout tersimpan sebelum order](plan/alamat-tersimpan-sebelum-order-spec.md) — flow simpan/edit/card, pemisahan persistence dari place-order, kontrak API, blueprint file/UI, acceptance dan verification ladder.

## Tindak lanjut research

Setelah research, user mengonfirmasi D1–D4 melalui grilling with docs dan menambahkan D5 tentang card alamat lengkap. Seam browser/API/persistence dikonfirmasi melalui **Sesuai**. Complete spec kemudian disetujui pada 2026-11-15 melalui **“oke saya setuju dengan specnya”**; approval tercatat di spec, termasuk retry key terbatas, batas edit, dan cutover drain/guard legacy. Implementasi belum dimulai dan AC01–AC20 tetap Pending. Keberadaan attempt lama di environment target belum diperiksa dan merupakan gate rollout sampai kewajiban save dituntaskan. Approval tidak memberikan izin subagent, ticket breakdown, commit, perubahan database pengguna, remote, atau deployment.

## Hasil implementasi 2026-11-15

Kode dan test untuk spec [alamat checkout tersimpan sebelum order](plan/alamat-tersimpan-sebelum-order-spec.md) sudah terintegrasi. Tabel AC → evidence ada di spec §14. Ringkasan: 20 dari 20 AC Verified. AC09 ditutup dengan test Playwright jaringan (PATCH abort → hanya GET), AC18 ditutup dengan assertion + rendered review 390/1280 (dark theme N/A karena store memakai `darkMode: "class"` tanpa theme toggle). Gate AC18 juga menemukan satu defect nyata (`.trim()` pada label wilayah opsional) yang sudah diperbaiki. Seluruh gate dijalankan pada database disposable yang dibuat dan dihapus dalam sesi ini; DB kerja pengguna tidak disentuh. Preflight attempt nonterminal dan cutover drain tetap prasyarat operasional terpisah (lihat runbook di `docs/features/delivery-orders.md`).
