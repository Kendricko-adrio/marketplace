# orders-presentation

Navigasi artefak fitur ini; aturan layout dan lifecycle: [panduan](../README.md).
Status plan hanya dicatat di sini. Status ticket tetap di masing-masing ticket.

## Status plan

Belum ada status keseluruhan yang dapat dipindahkan dari index lama. Artefak legacy
 dipertahankan tanpa mengasumsikan approval, Ready, atau Done. Rekonsiliasi dengan
 acceptance dan bukti implementasi diperlukan sebelum pekerjaan dilanjutkan.

## Plan baru

| Plan | Status | Approval | Blocker dan bukti |
|---|---|---|---|
| [Perombakan detail pesanan customer](plan/customer-order-detail-redesign.md) | Done (2026-11-13) | Diimplementasikan 2026-11-13 atas permintaan pengguna; commit lokal diminta, push tidak. | AC-01 sampai AC-11 Verified. Bukti: `e2e/store/order-detail-presentation-mock.spec.ts` (12 test), unit `order-tracking-presentation.test.ts` (21 test), unit suite penuh 199 file/2328 test pada DB disposable, mock E2E 41 lulus, review render `playwright/mcp/order-detail-review/`. Sisa 2 kegagalan pre-existing (`discounts-coupon-mock` line amount, `markdown-settlement-mock` SO body) bukan bagian perubahan ini. |

Catatan status legacy di atas tetap berlaku untuk artefak lama, bukan status plan baru.

## Artefak

### plan

- [plan/customer-order-detail-redesign.md](plan/customer-order-detail-redesign.md)

### ticket

- [ticket/verification.md](ticket/verification.md)
