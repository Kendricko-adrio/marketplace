# Hasil uji satu kali — jurnal sebelum/sesudah edit `channel_status` SO ber-invoice (2026-09-26)

Sumber: [draf uji dan gate](accounting-safety-test-draft.md), [audit Tahap A](accounting-safety-phase-a-results.md), [jurnal run teredaksi](accounting-one-shot-run-02.jsonl), dan [uji pertama pada SO 68398](edit-channel-status-results-2026-09-26.md). Pemilik mengonfirmasi akun yang dikonfigurasi **terisolasi dari transaksi pelanggan nyata**, serta mengizinkan maksimal satu login, satu baca stok via POST, satu create SO baru, satu invoice, satu payment, dan satu edit SO, tanpa retry/cleanup. Fixture disetujui: item 43842, lokasi 7, qty 1, harga 1000, kontak generik dan akun payment uji terkonfigurasi. Tidak ada Midtrans atau perubahan aplikasi.

## Eksekusi & pengaman

- Run awal `accounting-one-shot-run.jsonl` **berhenti sebelum jaringan** (`login=0`, GET=0, semua write=0): variabel lokal pada harness menutupi fungsi POST. Penyebab direproduksi lokal, nama variabel diperbaiki dan jurnal run baru digunakan. **Tidak ada pengulangan write provider.**
- Run yang benar mengirim **1 × `POST /login`, 1 × `POST /inventory/items/all-stocks/` (read-only in effect), 1 × `POST /sales/orders/` create, 1 × `POST /sales/packlists/create-invoice`, 1 × `POST /sales/payments/`, dan 1 × `POST /sales/orders/` edit**. Masing-masing HTTP 200, satu kali. Token hanya di memori proses; tidak direkam. Semua GET mengambil data dari akun yang sama. Tidak ada retry atau operasi cleanup.
- Preflight stok `(on_hand,on_order,available)=(3,2,1)` untuk fixture. `reserved` **absent**, bukan angka nol. Preflight jurnal `GET /journal/?page=1&pageSize=100&sortBy=journal_id&sortDirection=DESC` berhasil menunjukkan urutan ID menurun yang stabil, count **95.540** dan newest ID **96600**. Ini jendela halaman terbaru yang terbatas, bukan audit seluruh 95.540 baris.
- SO **68399** dibuat baru dengan `Belum Bayar`, dikonfirmasi GET dengan ID/lokasi/item/detail/total; invoice **45945** dan payment **28** masing-masing dikonfirmasi GET. Payment GET memuat satu asosiasi berjumlah 1000 pada invoice yang benar. Tidak ada operasi pada SO uji terdahulu.
- Sesudah invoice/payment dan **sebelum edit**, jurnal total **95.542**, newest ID **96602**. Dua jurnal baru **96601** dan **96602** terlihat pada halaman terbaru, `source_doc_no` cocok dengan nomor dokumen SO/invoice/payment baru yang diketahui; GET detail keduanya memberi **4** dan **2** baris akun. Ini *positive control* bahwa metode daftar+detail yang dipakai benar-benar menemukan jurnal baru yang muncul dari fixture.
- Payload full-save edit menjaga SO ID, nomor SO, ID detail **74682**, contact/source/lokasi/item/qty/harga/uang yang diverifikasi; hanya `channel_status` yang dimaksud berubah dari **Belum Bayar → Siap Proses**. Response edit mengembalikan SO ID yang sama.

## Perbandingan sesudah edit

| Pengamatan | Sebelum edit | Segera sesudah dan pembacaan ulang tertunda (~2,2 detik) |
|---|---|---|
| Status Channel SO GET | Belum Bayar | Siap Proses |
| Atribut inti SO yang dibandingkan | ID/source/lokasi/contact/total/invoice/ID detail/item/qty/price/amount sesuai fixture | **Tidak berubah** |
| Invoice 45945 GET (ID, total, subtotal, diskon, pajak, item) | Terverifikasi | **Tidak berubah** |
| Payment 28 GET (ID, total, invoice association, amount, SO link bila ada) | Terverifikasi | **Tidak berubah** |
| Jurnal daftar: totalCount / newest ID | **95.542 / 96602** | **95.542 / 96602** di kedua pembacaan |
| Detail jurnal 96601 dan 96602 (ID line, akun, debit/kredit, source dokumen) | Snapshot dari GET detail | **Tidak berubah** pada GET detail ulang |
| Jurnal baru terlihat di atas high-water pra-edit | — | **0** pada halaman terbaru |

**Jawaban teramati untuk pertanyaan pemilik:** dalam satu edit SO ber-invoice/payment ini, **tidak terlihat perubahan jurnal**: tidak ada ID jurnal baru pada halaman terbaru, count/newest ID tetap, dan line dari dua jurnal fixture yang diketahui tetap sama. Bukti ini lebih kuat daripada uji SO 68398 karena ada positive control jurnal dari invoice/payment yang baru dibuat. Namun ini **bukan** jaminan tidak ada side effect finansial tersembunyi: pembacaan hanya satu halaman terbaru, ada jeda terbatas, kemungkinan jurnal tertunda atau berubah secara tidak tampak pada daftar tidak disangkal, dan tidak ada jaminan vendor terhadap edit konkuren/TOCTOU. Tidak ada snapshot stok sesudah edit karena izin hanya mencakup **satu** POST stock-read; jangan mengklaim stok pasca-edit tidak berubah dari run ini.

## Status gate dan residu uji

- Bukti langsung ini adalah **bukti akun/fixture terbatas**, bukan persetujuan Ready otomatis. **Keputusan pemilik sesudah membaca hasil:** menerima risiko akuntansi residual (termasuk potensi posting tertunda dan edit vendor bersamaan) dan menetapkan akuntansi **bukan lagi blocker peninjauan Ready**. Ini keputusan penerimaan risiko, bukan klaim aman secara finansial universal atau perubahan otoritas pembayaran/pickup. Spesifikasi lengkap yang diperbarui masih memerlukan persetujuan Ready terpisah.
- SO **68399**, invoice **45945**, payment **28** dan pengaruh stok/akun uji tetap ada. **Jangan** membatalkan, refund, menulis ulang, atau membersihkan tanpa izin terpisah dan pemeriksaan akuntansi/stok. Tidak ada POST selanjutnya yang diizinkan oleh persetujuan sekali pakai ini.
- Jurnal run ini disimpan teredaksi: hanya tahap, ID, HTTP status, nilai stok numerik, hitungan/ID jurnal, dan hasil diff boolean. Kredensial, token, respons mentah, nama pelanggan dan nomor akun tidak disimpan. Harness satu kali telah dihapus setelah uji agar tidak dipakai ulang.
