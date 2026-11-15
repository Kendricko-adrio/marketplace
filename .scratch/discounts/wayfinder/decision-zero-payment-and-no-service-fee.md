# Koreksi scope: tanpa pembayaran Rp0 dan tanpa service fee

Status: **Keputusan eksplisit pemilik — berlaku untuk sesi berikutnya.**

## Sumber keputusan

Pada percakapan tindak lanjut outstanding 2 setelah research status mirror09, pemilik menegaskan:

> “tidak mungkin user membayar 0. kamu tidak perlu memikirkan soal ini karena itu hal yang tidak perlu dipikirkan. ini nanti dijaga by prosedur oleh admin dan pemilik bisnis.”

> “di website ini tidak ada service fee.”

> “tidak ada kewajiban untuk membuktikan orang membayar 0. karena itu tidak mungkin terjadi pada real world”

Pemilik kemudian meminta jejak keputusan dalam dokumen agar tersedia pada next session. Catatan ini merekam arahan tersebut, bukan hasil grilling atau provider testing baru.

## Keputusan yang berlaku

- Pembayaran customer Rp0 tidak termasuk scope operasional website; pencegahannya dijaga melalui prosedur admin dan pemilik bisnis.
- Website **tidak mengenakan service fee**. Contoh hipotetis barang habis dipotong tetapi customer membayar fee Rp2.000 tidak berlaku dan ditarik.
- **Outstanding 2 dicoret, bukan ditunda:** tidak ada kewajiban merancang atau membuktikan alur pembayaran Rp0, termasuk solusi settlement payable provider Rp0 yang sebelumnya dijadikan blocker dari contoh tersebut.
- Jangan memasukkan pembuktian tersebut kembali sebagai research requirement, acceptance test, launch gate, atau ticket follow-up dalam scope ini.
- Pencoretan ini berdasarkan keputusan scope pemilik, **bukan** klaim Jubelio mendukung invoice/payment Rp0, otomatis settled, atau sudah lulus pengujian kasus tersebut.
- Tidak menambah service fee atau menaikkan nominal sebagai workaround. Keberadaan field teknis `serviceFee`/`service_fee` tidak berarti website mengenakan biaya tersebut. Checkout existing memasok `serviceFee: 0` di `apps/store/src/app/api/checkout/place-order/route.ts`.

## Dampak pada dokumen dan kelanjutan

Keputusan ini menggantikan ketentuan lama tentang provider Rp0 sebagai launch blocker, kewajiban pembuktiannya, serta contoh fee berbayar pada kontrak09, logical schema11, acceptance12, map, dan catatan tiket/research terkait. Catatan approval/protokol/evidence lama tetap histori; jangan membacanya sebagai kewajiban aktif yang mengalahkan koreksi pemilik ini.

Evidence mirror post-invoice/payment M1/M2 tetap berlaku dalam envelope yang diuji. Complete spec dan approval-nya, implementasi, integration tests, staging UAT serta izin launch tetap terpisah dan belum dipenuhi hanya dengan pencoretan outstanding 2.

Perubahan sesi ini hanya dokumentasi planning. Tidak mengubah aplikasi/schema/config/guards, tidak menjalankan tests aplikasi atau request provider, dan tidak mengizinkan commit/deployment.

Referensi: [map](map.md), [kontrak provider09](contract-09-provider-representation-and-settlement.md#7-bukti-tersedia-dan-syarat-sebelum-launch), [acceptance12](acceptance-12-and-specification-outline.md#6-evidence-dan-release-gates), [logical schema11](contract-11-schema-retention-and-extensibility.md).
