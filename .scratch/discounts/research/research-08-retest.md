# Retest terkontrol skenario subsidi F6

## Otorisasi sesi ini

Pemilik memilih **Setuju, jalankan retest (Recommended)** pada pertanyaan yang mencakup login sandbox, maksimal satu create SO baru, full-payload mirror, dan satu conversion invoice. Tidak ada payment, cancel, retry, perubahan stock/master/account mapping, aplikasi, subagent, atau commit. Izin sebelumnya menyatakan credentials `.env` merupakan sandbox; credentials tetap rahasia.

Budget tambahan: maksimal **1 create attempt** di luar 20 create attempts historis. Attempt hanya dihitung saat dispatch create; bukan jaminan create berhasil. SO68422 dan seluruh order existing tidak disentuh oleh write.

## Protokol yang disetujui sebelum request

1. Login sekali menggunakan credentials `.env`; cek master item43842 dan stock location2. Lookup stock menggunakan `POST /inventory/items/all-stocks/` yang bersifat read-only menurut vendor spec. Jika stock tidak cukup, berhenti tanpa berpindah lokasi/item atau menambah stock.
2. Bila tersedia, gunakan contact dummy116918, item43842 qty1, unit Buah, source1 INTERNAL, location2, NoTax1. Harga259000, diskon barang20000, disc7.72, net barang239000. `original_shipment_cost=30000`, `shipping_cost_discount=20000`, `shipping_cost=10000`, grand249000. Fee/tax/insurance/add_disc nol. Reference fixture baru unik; identitas/tanggal fixture boleh berbeda dari F6 lama, tetapi nilai finansial sama.
3. POST `/sales/orders/` maksimal sekali, lalu GET detail dan cocokkan uang/identity terhadap expected independen.
4. Jika cocok, POST full-payload mirror ke endpoint yang sama dengan ID/detail IDs asli; ubah hanya `channel_status` dari `Belum Bayar` ke `Menunggu Verifikasi`. GET dan cocokkan ulang.
5. Jika cocok, GET pre-invoice lalu satu POST `/sales/packlists/create-invoice` dengan ID fixture baru. Jika berhasil, GET invoice dan SO untuk memeriksa uang/linkage; tidak payment.
6. Bila network/5xx/missing ID atau hasil ambigu, hentikan seluruh business writes; hanya reconciliation read-only. Tidak retry/cancel otomatis. Artefak sandbox dipertahankan, termasuk reservation yang mungkin timbul.
7. Simpan hanya proyeksi allowlist: HTTP/code, fixture IDs/ref, quantity dan nominal relevan. Jangan simpan token, credentials, raw customer response, atau PII.

## Sumber

- [F6 awal dan reconciliation](research-08-evidence.md#5-f6-journal_unbalance-pada-conversion).
- [Journal historis](research-08-write-results.json), event F6.
- [Vendor stock lookup](../../../docs/jubelio-api/dist.yaml#L5124).
- [Builder payload existing](../../../apps/store/src/lib/jubelio-sales-client.ts#L443), dipakai sebagai referensi struktur, bukan menonaktifkan guard aplikasi.

## Hasil

Preflight dijalankan pada **2026-10-18 sekitar09:18UTC**. [Journal tersanitasi](research-08-retest-results.json).

| Request | Hasil |
| --- | --- |
| POST `/login` | HTTP200; token hanya in-memory, tidak dicatat |
| GET `/inventory/items/43842` | HTTP200; harga259000, aktif, unit Buah, cocok dengan F6 |
| POST `/inventory/items/all-stocks/`, input `{"ids":[43842]}` | HTTP200; location2: on_hand1, on_order1, available0 |

**Outcome: blocked-before-create.** Stock tersedia nol, sehingga sesuai protokol agent berhenti. Tidak ada create SO, mirror, conversion invoice, payment, cancel, retry, perubahan stock/master, atau write pada SO68422. Total create attempts historis tetap20; dari tambahan limit1, terpakai0.

Tidak ada pengujian ulang conversion yang benar-benar berjalan; karena itu **belum dapat disimpulkan apakah error23113 masih terjadi**. Hasil stock saat ini konsisten dengan snapshot historis, tetapi bukan bukti baru bahwa reservation tertentu pasti milik SO68422, karena detail SO tidak dibaca lagi pada preflight ini.

Langkah berikutnya memerlukan stock yang tersedia pada fixture/lokasi sama atau approval perubahan protokol. Jangan membebaskan reservation dengan cancel order ambigu, memindahkan lokasi/item, atau menambah stock tanpa keputusan dan izin terpisah. Tidak ada unit/E2E/build/lint/typecheck aplikasi dijalankan karena tidak ada perubahan aplikasi; verifikasi hanya request preflight provider di atas dan pemeriksaan journal.

## Usulan item pengganti setelah instruksi pemilik

Pemilik meminta menggunakan item lain. Discovery read-only menjalankan login, satu page katalog (`page=1&pageSize=50`), batch stock lookup, dan GET tiga master kandidat. Ini bukan pencarian exhaustif seluruh katalog. [Journal discovery tersanitasi](research-08-alternative-item-results.json). Tidak ada business write/create tambahan.

Kandidat60344,43825,43823 masing-masing aktif, harga650000/unit Buah, location2 available1 saat discovery. Usulan menggunakan **item60344 qty1**, lokasi tetap2, harga master650000; diskon barang20000 sehingga net630000. Input `disc` direncanakan **3.08** (derived3.076923076923077 dibulatkan dua desimal, mengikuti pola F6), sedangkan `disc_amount=20000` dan money expected tetap exact. Ongkir awal30000/subsidi20000/net10000, grand640000, NoTax1 dan seluruh fee/add_disc/insurance nol.

Semua batas protokol sebelumnya tetap berlaku: maksimal1 create attempt yang belum terpakai; recheck stock/master sebelum create; full-payload mirror dan satu conversion hanya setelah GET nominal/identity cocok; tidak ada payment/cancel/retry atau perubahan SO68422. Jika stock kandidat berubah menjadi tidak cukup, berhenti; tidak otomatis berpindah ke kandidat lain. Hasil dengan item pengganti merupakan varian skenario, bukan reproduksi identik atau isolasi penyebab error lama, karena item/harga dan kemungkinan account mapping berbeda. **Pemilik menyetujui protokol dengan nominal baru** melalui pilihan `Setuju, gunakan item60344 (Recommended)`. Agent diizinkan menjalankan satu fixture baru sesuai seluruh batas di atas. Journal eksekusi terpisah: `research-08-alternative-retest-results.json`. Jika terjadi kegagalan ambigu, reconciliation dibatasi GET detail SO baru, stock lookup read-only, dan filtered invoice/payment lists; tidak ada retry write atau cleanup otomatis.

### Checkpoint setelah create item pengganti

Create berhasil HTTP200 dengan SO68423; GET mempertahankan seluruh nominal expected640000. Script awal berhenti sebelum mirror karena hanya membaca item `location_id`; proyeksi awal tidak menyimpan alias `loc_id`. Client existing [mendukung alias tersebut](../../../apps/store/src/lib/jubelio-sales-client.ts#L1278), dan vendor response schema mencantumkannya. Ini masalah pemeriksaan script, bukan response error invoice. Journal awal tidak diubah/dihapus.

Kelanjutan tetap pada fixture baru68423 yang sama: GET ulang wajib mengonfirmasi alias lokasi2, detail74708, item60344, identity/reference dan seluruh nominal sebelum write. Tidak ada create tambahan. Hanya mirror dan conversion yang belum pernah didispatch boleh dilanjutkan, masing-masing sekali. Jika konfirmasi gagal atau ada konflik lokasi, berhenti. [Journal continuation](research-08-alternative-retest-continuation.json) menyimpan kedua nama field lokasi untuk audit. Penyesuaian ini tidak melonggarkan verifikasi nilai lokasi atau mengubah accounting/aplikasi.

## Hasil retest item60344 — error invoice sama

Eksekusi2026-10-18 sekitar09:27–09:29UTC. [Journal create](research-08-alternative-retest-results.json) dan [journal continuation/mirror/conversion/reconciliation](research-08-alternative-retest-continuation.json). JSON menyimpan proyeksi field allowlist, bukan raw full request/response; customer_name, contact response, token, dan detail identitas lain tidak dicatat.

| Tahap | Input relevan | Output teramati |
| --- | --- | --- |
| Preflight | item60344/location2; dummy116918; NoTax1 | Master650000/aktif/Buah; stock1/0/1; NoTax rate0 |
| POST `/sales/orders/` create | qty1; price650000; disc3.08; disc_amount20000; line amount630000; total_disc20000; original_shipment_cost30000; shipping_cost_discount20000; shipping_cost10000; grand640000 | HTTP200/id68423; GET seluruh uang cocok, detail74708 |
| GET continuation | SO68423 | HTTP200; alias `loc_id=2`, detail74708 dan semua money/identity cocok; tidak ada create ulang |
| POST `/sales/orders/` mirror | ID68423/detail74708; seluruh nilai dipertahankan, marker Menunggu Verifikasi | HTTP200/id68423; GET mengonfirmasi marker, detail, dan semua uang tetap |
| POST `/sales/packlists/create-invoice` | `{"salesorder_id":68423}` | **HTTP500/code23113**, tanpa invoice ID |
| Reconciliation GET SO | `/sales/orders/68423` | invoice_idnull; is_canceled/is_paidnull; grand640000 dan marker tetap |
| Reconciliation stock | item60344/location2 | on_hand1/on_order1/available0 |
| Filtered invoice/payment lists | q=label dummy existing, page1/pageSize100 | Masing-masing3 rows/totalCount3; hanya invoice45951/45952/45953 dan payment40/42/44 yang sudah dikenal; tidak terlihat artefak baru pada filter ini |

Kode23113 dipetakan vendor ke `journal_unbalance`. **Error yang sama muncul pada varian item pengganti**, sesudah create dan mirror berhasil. Ini bukan reproduksi identik F6 dan belum mengisolasi akar error: item/harga/persentase berbeda; account mapping dan efek internal conversion belum terbukti.

**Stop seluruh business writes aktif.** Tidak ada retry conversion, payment, cancellation, perubahan stock/master/account mapping, aplikasi, SO68422 atau order historis lain. SO68423 dipertahankan sebagai fixture investigasi dan masih menahan stock menurut transisi lookup. Tidak ditemukannya invoice baru pada API bukan proof rollback/absence side effects internal.

Total sesi: **1 create + 1 mirror + 1 conversion attempt**, masing-masing sekali. Budget tambahan **1/1 terpakai**, kumulatif **21 create attempts**. Dua journal eksekusi bukan dua create: journal continuation mempunyai createAttempts0 dan hanya melanjutkan fixture68423 yang sama.

Next action: manual UI/audit disposition SO68423 sebelum cleanup atau percobaan lain; SO68422 tetap memiliki unknown historis terpisah. Tidak ada kontak support atau izin write tambahan yang diasumsikan. Tiket08 tetap claimed, bukan resolved. Tidak ada unit/E2E/build/lint/typecheck aplikasi dijalankan; verifikasi provider dan review journal dilakukan langsung oleh main agent.
