# Persiapan eksperimen pengurangan field diskon dan ongkir

## Permintaan pemilik dan status

Pemilik meminta eksperimen field diskon barang/ongkir pada fixtures baru untuk mengetahui kombinasi yang gagal saat generate invoice, serta mengusulkan product/item55269 karena menurut informasi pemilik stock banyak. Tujuan research adalah membandingkan kasus terkontrol, bukan memperbaiki accounting atau mengubah aplikasi. Matriks business writes, endpoint, budget dan protokol final belum disetujui; belum ada create SO untuk rangkaian ini. Baseline kumulatif tetap23 create attempts.

## Fakta preflight read-only

Login dan GET `/inventory/items/55269`, lalu POST read-only `/inventory/items/all-stocks/` dijalankan pada akun sandbox dari credentials `.env`. Tidak ada token, credentials atau raw customer response disimpan. [Journal awal](research-08-field-matrix-preflight.json).

- Master aktif, price439000, unit Buah. Field account IDs pada response master bernilai null; ini bukan bukti akun efektif provider kosong atau akar error journal.
- Lookup langsung item55269: available0 pada seluruh lokasi yang dikembalikan (-1,1,2,7), on_hand0/on_order0. Tidak menyimpulkan kondisi semua akun/environment dari hasil akun ini.

Karena hasil berbeda dari informasi stock pemilik, agent memeriksa identitas SKU secara read-only sebelum meminta keputusan. [Journal identity dan stock siblings](research-08-field-matrix-identity.json).

- GET mengidentifikasi item_group_id14360, dengan product_skus55268/55267/55270/**55269**. Jadi55269 memang salah satu SKU pada produk ini, bukan otomatis diganti dengan group ID.
- SKU55269 memiliki end_qty0; batch lookup seluruh sibling juga menunjukkan available0 untuk55269 di lokasi yang dikembalikan.
- Sibling55268 memiliki available1 pada location3 dan available1 pada location5, bukan stock banyak untuk matriks pada satu lokasi yang sama. Tidak dipilih otomatis.
- Tidak ada business writes, create, mirror, invoice/payment, cancel, perubahan stock, atau order existing pada discovery ini.

## Klarifikasi item dan endpoint dari pemilik

Pemilik mengoreksi target menjadi **157190 — Celana Okcir Bagus** dan memilih **Invoice-only (Recommended)**. [Preflight terbaru](research-08-field-matrix-item157190.json) memverifikasi product group55269 dengan SKU157190, aktif, price1000000, unit Buah, stock location2 on_hand21/on_order1/available20.

Ini menjelaskan perbedaan sebelumnya: angka55269 sebagai item_id menunjuk SKU di group14360, sedangkan group_id55269 adalah produk Celana Okcir Bagus. Untuk SO produk yang dimaksud, gunakan item_id157190; jangan menyamakan namespace group dengan SKU.

Pada akhir discovery belum ada business write baru dan baseline23 create attempts. Pemilik kemudian menyetujui [protokol matriks lengkap](research-08-field-matrix-protocol.md) dengan batas10 create/invoice-only attempts, tanpa mirror/payment/cancel dan global stop. [Hasil eksekusi](research-08-field-matrix-evidence.md): A–G invoice verified, H conversion23113. Setelah instruksi kelanjutan dan izin khusus pascaI, [I/J juga dijalankan](research-08-field-matrix-ij-evidence.md) dan masing-masing conversion23113. Terpakai10/10, kumulatif33 create attempts; budget habis dan stop business writes aktif.

## Referensi

- [Vendor response product/SKUs](../../docs/jubelio-api/dist.yaml#L18007).
- [Vendor stock lookup](../../docs/jubelio-api/dist.yaml#L5124).
- [Test integer sebelumnya](research-08-integer-discount.md).
