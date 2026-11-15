# Customer admin

## Tujuan

Penyeragaman tabel Customer dengan pola Branches dan pagination server-side, tanpa mengubah summary global atau halaman detail.

## Plan

| Plan | Status | Approval | Blocker / bukti |
|---|---|---|---|
| [Penyeragaman tabel Customer](plan/customer-table-branches-alignment.md) | In Progress | Complete spec disetujui user: “oke implementasikan spec tersebut” | 2026-11-03: implementasi dan 7 E2E Customer lulus; 9 unit Customer lulus, types/lint lulus; batch unit repo terblokir setup DB/seed di luar Customer. [Evidence](research/customer-table-verification.md) |

## Evidence awal

- Inspeksi kode memastikan Customer belum memakai pagination; Branches memakai server-side pagination 10 row dan search debounce 400 ms.
- Referensi kode, rancangan, acceptance, dan verification tercantum di plan.
- Implementasi runtime sudah tersedia; tidak ada commit atau deployment.
- [Verifikasi implementasi dan blocker batch](research/customer-table-verification.md).
