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
| [Perombakan detail pesanan customer](plan/customer-order-detail-redesign.md) | In Progress | Diimplementasikan 2026-11-13 atas permintaan pengguna; commit lokal diminta, push tidak. | AC-01 sampai AC-10 Verified; AC-11 Pending untuk suite penuh karena `DATABASE_URL` menunjuk DB dev `storefront` (9 unit suite DB + 3 mock E2E menolak DB non-disposable, `pickup-mock` butuh admin Home Branch ↔ Jubelio). Bukti: `e2e/store/order-detail-presentation-mock.spec.ts` (12 test), unit `order-tracking-presentation.test.ts` (21 test), review render `playwright/mcp/order-detail-review/`. |

Catatan status legacy di atas tetap berlaku untuk artefak lama, bukan status plan baru.

## Artefak

### plan

- [plan/customer-order-detail-redesign.md](plan/customer-order-detail-redesign.md)

### ticket

- [ticket/verification.md](ticket/verification.md)
