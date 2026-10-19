# Kelanjutan matriks I/J setelah instruksi pemilik

## Otorisasi dan batas

Pemilik meminta **jalankan I dan J dulu** setelah menerima hasil A–H. Ini mengizinkan dua kasus baru yang belum dibuat, memakai dua slot tersisa dari limit10; bukan retry H. Agent menyampaikan bahwa global stop tetap berlaku bila I ambigu. Invoice-only, tanpa mirror/payment/cancel/retry, perubahan stock/accounting/aplikasi atau write pada fixtures historis.

[Protokol dan otorisasi](research-08-field-matrix-protocol.md#otorisasi-kelanjutan-ij), [journal continuation](research-08-field-matrix-ij-results.json), [hasil A–H](research-08-field-matrix-evidence.md).

## Hasil I

Dijalankan2026-10-18 sekitar10:25UTC, SKU157190/location2, qty1/price1000000, NoTax1, tanpa diskon barang.

Potongan input finansial actual create:

```json
{
  "sub_total": 1000000,
  "total_disc": 0,
  "original_shipment_cost": 30000,
  "shipping_cost_discount": 20000,
  "shipping_cost": 10000,
  "grand_total": 1010000,
  "items": [{"item_id":157190,"qty_in_base":1,"price":1000000,"disc":0,"disc_amount":0,"amount":1000000}]
}
```

Create HTTP200/**SO68434**, detail74719. GET uang/identity dan pre-conversion cocok. Satu POST `/sales/packlists/create-invoice` dengan `{"salesorder_id":68434}` menghasilkan **HTTP500/code23113**, tanpa invoice ID. Global stop aktif; **J belum dibuat/dikonversi**.

Reconciliation read-only: SO68434 invoice_idnull, is_canceled/is_paidnull, marker Belum Bayar, grand1010000; shipping original30000/discount20000/net10000 tetap. Stock157190/location2 **on_hand14/on_order3/available11**, dibanding sebelum I14/2/12. Filtered invoice list tetap10/totalCount10 (tiga invoice lama+tujuh A–G), payment list tetap3/totalCount3 (40/42/44). Tidak terlihat artefak invoice/payment baru pada filter tersebut; bukan proof rollback internal.

**Kesimpulan tambahan:** diskon barang bukan kondisi yang diperlukan agar conversion error muncul pada skenario subsidi ini, karena I mengirim disc0/disc_amount0 dan tetap23113. I menggabungkan original shipment dan shipping discount; ini belum mengisolasi mekanisme accounting internal. Digabung kontrol D/E/H sebelumnya, nonzero shipping_cost_discount tetap kandidat yang lebih kuat pada envelope tersebut, bukan seluruh kontrak provider.

Budget saat checkpointI:9/10 create dan9/10 invoice attempts dalam matriks; kumulatif**32 create attempts**. J tersisa satu slot, tetapi memerlukan keputusan lanjut terpisah setelah stopI. Tidak retry/cancel/payment atau mengubah H/fixtures lama. SO68434 memerlukan manual UI/audit disposition sebelum cleanup.

## Otorisasi khusus dan hasil J

Setelah agent melaporkan outcome ambigu I dan berhenti, pemilik memilih **Ya, jalankan J (Recommended)**. Izin ini khusus satu fixture baruJ, satu create/satu conversion invoice-only, menggunakan slot terakhir; bukan retry I/H, tanpa mirror/payment/cancel/perubahan accounting. [Journal khususJ](research-08-field-matrix-j-results.json).

J dijalankan2026-10-18 sekitar10:28UTC. Item157190/location2/price1000000/qty1/NoTax1 tetap. Potongan input finansial:

```json
{
  "sub_total": 1000000,
  "total_disc": 100000,
  "original_shipment_cost": 30000,
  "shipping_cost_discount": 20000,
  "shipping_cost": 10000,
  "grand_total": 910000,
  "items": [{"item_id":157190,"qty_in_base":1,"price":1000000,"disc":10,"disc_amount":100000,"amount":900000}]
}
```

Create HTTP200/**SO68435**, detail74720. GET serta pre-conversion seluruh nominal/identity cocok. Satu POST `/sales/packlists/create-invoice` dengan `{"salesorder_id":68435}` kembali **HTTP500/code23113**, tanpa invoiceID. Semua business writes dihentikan.

Reconciliation J: invoice_idnull, is_canceled/is_paidnull, marker Belum Bayar, grand910000, original30000/subsidy20000/net shipping10000 tetap. Stock157190/location2 **on_hand14/on_order4/available10**, dibanding sebelumJ14/3/11. Filtered invoice list tetap10/totalCount10, payment list3/totalCount3; tidak terlihat invoice/payment baru pada filter yang diperiksa. Ini bukan proof rollback internal. Tidak retry/cancel atau mengubah SO68434/I, SO68433/H, dan fixtures historis lain.

## Kesimpulan akhir matriks

- **A–G:**7 invoice verified, masih unpaid.
- **H/I/J:** create berhasil, conversion invoice-only gagal23113; ketiganya memiliki shipping_cost_discount20000.
- **I** membuktikan diskon barang tidak diperlukan agar error muncul pada skenario subsidi ini.
- **G versus J**: keduanya diskon barang100000/net900000, shipping_cost10000, original30000, grand910000. G menghilangkan shipping_cost_discount dan berhasil invoice45964; J menambah20000 dan gagal. Jadi original_shipment_cost30000 tidak menghindari error nonzero shipping discount pada pembanding ini.
- Ini mempersempit conditional failing request, bukan membuktikan akar journal/account mapping, gross/net shipping contract, atau semua nilai nonzero/provider sources.

Seluruh10 kasus sudah dijalankan melalui tiga fase izin terpisah:8 awal+I1+J1. Total matriks**10/10 create dan10/10 invoice attempts**, kumulatif**33 create attempts**. Budget habis dan stop business writes aktif. J/I/H tetap fixtures investigasi tanpa rollback proof; manual UI/audit disposition diperlukan sebelum cleanup atau write lanjutan. Tidak ada perubahan aplikasi/schema/master/account mapping/env, unit/E2E/build/lint/typecheck aplikasi, subagent, atau commit.
