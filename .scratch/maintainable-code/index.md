# maintainable-code

Navigasi artefak fitur ini; aturan layout dan lifecycle: [panduan](../README.md).
Status plan hanya dicatat di sini. Status ticket tetap di masing-masing ticket.

## Status plan

| Plan | Status | Features | Notes / Outcome |
|---|---|---|---|
| [Standar maintainable code dan contextual logging](../../docs/features/logging.md) | Done | 5 | 2026-10-23: engine legacy (`createLogger`/`requestLogger`/`withRequestId`/`serializeError`/`Logger`/`LogLevel`) dihapus dari kedua facade `apps/{store,admin}/src/lib/logger.ts` sehingga tersisa `createModuleLogger`/`withRequestContext`/`getRequestId`/`withExecutionContext`/`withDetachedExecutionContext`, setiap route handler HTTP first-party dibungkus `withRequestContext` dengan `x-request-id` kanonik buatan server plus satu baris completion, module/service/provider/job membaca korelasi dari AsyncLocalStorage tanpa parameter logger, dan `packages/logging/src/policy.test.ts` menjaga invarian tersebut secara statis. Gate akhir hijau pada DB disposable `marketplace_discounts_test_logging_01a1646c` dengan kredensial provider palsu tanpa Docker/remote/provider live: types store+admin PASS, `policy.test.ts` 3/3, scoped ESLint 186 file 0 error, `lint:admin` 0 error/36 warning, batch unit 163 file/1776 pass/12 skip, sweep mock E2E penuh 152 pass/0 fail, dan `build:store`+`build:admin` compiled successfully. Batas bukti: `lint:store` masih 1 error **pre-existing** di `apps/store/src/components/Header.tsx:39` (file tanpa diff pada pekerjaan ini, di luar scope) sehingga lint store tidak boleh disebut hijau, eksekusi non-HTTP memakai `executionId`/`null` sesuai desain, dan bukti RED per file hanya ada untuk subset seam (core 18, facade 2, pilot 5, sales client 133, lifecycle 38, settlement 35) karena gelombang dieksekusi sebagai batch besar. |

Catatan status dan hasil test di atas dipindahkan dari index lama, bukan verifikasi baru.
Plan Done yang dahulu sudah dihapus tidak direkonstruksi; outcome dan docs tetap tersedia.

## Artefak

### research

- [research/nextjs-api-organization-research.md](research/nextjs-api-organization-research.md)
