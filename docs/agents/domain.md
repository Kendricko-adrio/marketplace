# Domain Docs

Cara agent mengonsumsi dokumentasi domain repo ini. Dokumen ini adalah **papan
petunjuk**, bukan glossary, bukan spec, dan bukan pengganti [`AGENTS.md`](../../AGENTS.md).

Repo ini **single-context**: satu produk, satu glossary di root. `apps/store`,
`apps/admin`, dan `packages/db` adalah satu konteks produk, bukan konteks
terpisah.

## Sebelum mengeksplorasi kode

Baca sesuai area kerja:

1. [`CONTEXT.md`](../../CONTEXT.md) di root — glossary istilah administrasi,
   otorisasi, cabang, dan harga/promo.
2. [`docs/adr/`](../adr/) — ADR yang menyentuh area itu; `status: accepted`
   bersifat mengikat.
3. [`docs/`](../README.md) — dokumentasi produk/arsitektur/API yang tahan lama
   untuk fitur terkait.

Kalau file yang relevan tidak ada, lanjut diam-diam: jangan berhenti untuk
melaporkan ketiadaannya.

## Pakai kosakata glossary

- Nama fungsi, tipe, endpoint, test, issue, dan judul dokumen memakai istilah dari
  `CONTEXT.md`.
- Baris `_Avoid_:` bersifat mengikat. Jangan memakai sinonim yang dilarang
  (misalnya `Customer` atau `Client` untuk Admin User).
- Istilah glossary dipertahankan **verbatim** walaupun dokumen lain berbahasa
  Indonesia. Jangan menerjemahkan identifier domain.
- Cakupan glossary saat ini adalah administrasi. Istilah storefront yang belum
  tercatat jangan dikarang; usulkan ke pemilik sebagai pertanyaan.
- `.scratch/**` adalah artefak workflow per fitur. Jangan menjadikannya sumber
  kosakata atau arsitektur tahan lama.

## ADR mengikat

- ADR `status: accepted` menang atas preferensi agent maupun isi plan/spec.
- Jika pekerjaan bertentangan, tahan path itu dan sebut eksplisit:
  > Contradicts ADR-0001 (application-owned hybrid RBAC), but worth reopening because…
- Jangan menimpa, menghapus, atau menulis ulang ADR tanpa keputusan pemilik.

## Membuat dokumen domain

- `CONTEXT.md`: tambahkan istilah hanya setelah istilah itu disepakati pemilik,
  dan tanpa detail implementasi.
- ADR baru: hanya untuk keputusan yang sulit dibalik, mengejutkan tanpa konteks,
  dan hasil trade-off nyata — dan setelah pemilik menyetujuinya.
- Jangan membuat `CONTEXT-MAP.md` atau `apps/*/CONTEXT.md` tanpa keputusan pemilik.

## Batas dokumen ini

- Bukan glossary (`CONTEXT.md`), bukan spec/plan/ticket (`.scratch/<fitur>/`),
  bukan aturan arsitektur kode.
- Aturan struktur backend: [`.agents/skills/maintainable-code/`](../../.agents/skills/maintainable-code/SKILL.md).
  Aturan UX: [`.agents/skills/ux-design/`](../../.agents/skills/ux-design/SKILL.md).
