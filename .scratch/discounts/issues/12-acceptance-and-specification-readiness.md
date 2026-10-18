# Acceptance End-to-End dan Kesiapan Spec

Label: wayfinder:grilling
Type: grilling
Status: open
Assignee: none
Blocked by: 06, 11
Parent: [Wayfinder Desain Diskon](../map.md)

## Question

Acceptance criteria yang dapat diamati, test seams, dan release gates provider apa yang diperlukan untuk spec lengkap siap direview, serta apakah masih ada keputusan pemilik yang belum selesai?

Putuskan acceptance matrix untuk konsistensi markdown di katalog/detail/cart; hasil/conflict/retry Excel valid rows; penggantian kupon/kode manual yang dipilih langsung; satu slot; contoh capped/fixed/shipping independen; usage/budget/concurrency/replay pada DB nyata; nominal order/provider immutable; cancellation/refund/late payment; authorization/audit admin; migration legacy; bukti provider dan pengaman rollout.

## Referensi dan batasan

- Artefak [UX Admin Diskon dan Authorization](06-admin-ux-and-authorization.md) serta jawaban [Arsitektur Schema, Retention, dan Extensibility](11-schema-retention-and-extensibility.md) yang wajib disetujui pemilik.
- Semua child resolved melalui [map](../map.md); baca jawaban/artefak terkait sesuai kebutuhan.
- [Matriks verifikasi research existing](../../../plan/research/discounts-coupons-promo-codes.md#11-verification-matrix-for-a-later-implementation).
- [Persyaratan testing project](../../../AGENTS.md), [dokumentasi testing](../../../docs/testing/README.md), [gates spec/persetujuan](../../../.agents/skills/development-workflow/SKILL.md).

Menulis research atau map bukan berarti tests fitur sudah dijalankan. Bukti provider tidak dapat digantikan dengan stubbed-fetch checks. Persetujuan outline acceptance bukan persetujuan complete spec.

## Bukti penyelesaian

Link ke acceptance matrix yang disetujui pemilik dan outline spec yang tepat, dengan decisions/scope/evidence gates ditelusuri ke child masing-masing. Jika muncul pertanyaan baru yang sudah konkret, tambahkan melalui gates scope/publikasi map yang disetujui, bukan mengasumsikan jawabannya. Setelah keputusan selesai, draft spec lengkap untuk review/persetujuan pemilik secara terpisah; jangan mengubah Ready atau membuat build tickets hanya berdasarkan persetujuan map.

## Batas pekerjaan

Claim setelah blockers selesai. Muat `grilling`, `domain-modeling`, dan `development-workflow`; konsultasikan `tdd` untuk diskusi desain tests. Planning saja; tidak ada penulisan/eksekusi implementation tests, perubahan app/schema, request provider, subagent, commit, atau penyelesaian tiket HITL lain.

## Comments

Dipublikasikan setelah proposal map lengkap disetujui. Semua prerequisite awalnya open, dan spec lengkap belum dibuat/disetujui.
