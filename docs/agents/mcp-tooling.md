# Agent tooling: MCP servers (Context7, Playwright)

Dokumen ini menjelaskan MCP server yang dipakai agent di repo ini, cara
mengaktifkannya, dan cara memakai Context7 sebagai sumber dokumentasi
library/framework yang up-to-date. Aturan wajibnya ada di
[`AGENTS.md`](../../AGENTS.md) §4 ("Context7 inquiry is mandatory before
implementation") — dokumen ini hanya menjelaskan setup dan troubleshooting.

## Dua jalur konfigurasi MCP

Repo ini memakai **MCP bawaan Pi** (`builtin:mcp`), bukan `pi-mcp-adapter`.
Konsekuensinya ada dua file konfigurasi yang hidup berdampingan:

| File | Dibaca oleh | Isi di repo ini |
|---|---|---|
| `.pi/mcp.json` | Pi (`builtin:mcp`), butuh project trust | `context7` (OAuth, `direct`), `playwright` (stdio, `codemode`) |
| `.mcp.json` | Claude Code / client lain | `playwright` + `context7` (OAuth) |

**Keduanya di-commit.** Baris `.pi` sudah dihapus dari `.gitignore` supaya
config Pi ikut ter-share ke tim; yang di-ignore hanya file lokal/generated:
`.pi/mcp-traces/` dan `.pi/settings.json`. Config Pi tetap butuh project trust
saat pertama kali dipakai — commit tidak menggantikan trust.

Pastikan tidak ada adapter yang menumpang: `pi-mcp-adapter` mendaftarkan `/mcp`
sendiri sehingga Pi sengaja tidak memuat `builtin:mcp`. Cek dengan `pi list`;
kalau adapter terpasang dan ingin tetap memakai built-in, hapus dengan
`pi remove npm:pi-mcp-adapter`.

## Konfigurasi MCP Pi

```bash
# Context7: dokumentasi library, OAuth, tool langsung ke model
pi mcp add context7 -l \
  --url https://mcp.context7.com/mcp/oauth \
  --exposure direct \
  --description "Up-to-date version-specific docs for libraries and frameworks"

# Playwright: otomasi browser untuk verifikasi UI manual
pi mcp add playwright -l \
  --exposure codemode \
  --description "Playwright browser automation for manual UI verification" \
  -- npx @playwright/mcp@latest --output-dir playwright/mcp
```

- `-l` / `--local` menulis ke `.pi/mcp.json`; tanpa `-l` menulis ke
  `~/.pi/agent/mcp.json` (berlaku untuk semua project).
- `--exposure direct` (Context7) mendeklarasikan kedua tool langsung ke model —
  murah karena hanya 2 tool.
- `--exposure codemode` (Playwright) menyembunyikan 25 tool browser sampai
  dipakai: model menulis script codemode (`searchTools()` → panggil tool), jadi
  tidak ada 25 deklarasi tool di setiap request. Pilihan lain: `deferred`
  (lewat `tool_search`) dan `direct`.
- Project `.pi/mcp.json` hanya dibaca setelah project trust diberikan.

Server bawaan Pi **connect saat sesi mulai** (beda dengan adapter yang lazy),
jadi status `needs sign-in` akan dilaporkan sekali setelah startup. Playwright
dijalankan lewat `npx`, sehingga koneksi pertama bisa lebih lambat karena
mengunduh paket.

Setelah mengubah config di tengah sesi, jalankan `/reload`. Status dari shell:

```bash
pi mcp list          # status + tool tiap server
pi mcp list --json   # versi machine-readable
```

## Autentikasi OAuth Context7

Endpoint `https://mcp.context7.com/mcp` **tidak pernah** meminta autentikasi
(selalu `200` anonymous), sehingga popup login tidak akan muncul di sana.
Karena itu config memakai endpoint OAuth:

```
https://mcp.context7.com/mcp/oauth
```

Endpoint itu membalas `401` + `WWW-Authenticate: Bearer
resource_metadata="…/.well-known/oauth-protected-resource/mcp/oauth"`, lalu Pi
melakukan flow standar: discovery metadata (authorization server Clerk),
Dynamic Client Registration (`https://clerk.context7.com/oauth/register`),
browser sign-in + consent, callback ke `http://127.0.0.1:<port>/callback`
(PKCE `S256`), dan penyimpanan token.

Login:

```bash
pi mcp login context7      # dari shell: buka browser, tunggu callback
/mcp login context7        # dari dalam sesi Pi
```

Token disimpan Pi di `~/.pi/agent/mcp-auth.json` dan di-refresh otomatis.
**Tidak ada token/secret di repo.** Logout:

```bash
pi mcp logout context7     # hapus kredensial tersimpan
```

Catatan:

- **Tidak ada auto-login.** Kalau token expired dan refresh ditolak, tool
  melaporkan `needs sign-in`; jalankan `/mcp login context7` lagi.
- **Sesi headless/print** tidak bisa menyelesaikan flow browser. Login dulu
  dari sesi interaktif (token dipakai ulang), atau sementara pakai varian API
  key di bawah.
- **Claude Code** memakai `.mcp.json`: jalankan `/mcp`, pilih `context7`, lalu
  **Authenticate** sekali; tokennya disimpan sendiri oleh Claude Code.
- Varian API key (bukan konfigurasi repo ini, untuk headless/CI):
  `pi mcp add context7 -l --url https://mcp.context7.com/mcp --bearer-token-env-var CONTEXT7_API_KEY --exposure direct`.
  `CONTEXT7_API_KEY` adalah variabel tooling agent, **bukan** runtime aplikasi:
  jangan tambahkan ke `.env`, `.env.example`, `docker-compose.yml`, atau file
  di `deployment/`.

## Tool yang tersedia

Dengan exposure `direct`, dua tool Context7 terdaftar langsung ke model:

| Tool | Argumen | Kegunaan |
|---|---|---|
| `mcp__context7__resolve_library_id` | `libraryName`, `query` | Nama paket → ID kanonik (`/owner/repo`) |
| `mcp__context7__query_docs` | `libraryId`, `query`, `language?` | Dokumentasi + contoh kode untuk satu konsep |

Playwright memakai exposure `codemode`, jadi 25 tool `mcp__playwright__browser_*`
(navigate, snapshot, click, screenshot, console/network, tabs, dst.) dipanggil
dari script codemode, bukan dideklarasikan di awal:

```js
await tools.mcp__playwright__browser_navigate({ url: "http://localhost:3000/products" });
const shot = await tools.mcp__playwright__browser_take_screenshot({ filename: "playwright/mcp/products-review/products.png" });
return shot.content;
```

Nama tool di script memakai identifier yang sama dengan deklarasi model
(`tools.mcp__playwright__browser_navigate`). Kalau lupa nama tool, pakai
`searchTools("playwright screenshot")` atau `describeNamespace("mcp__playwright")`
di dalam script.

Dump manual disimpan di `playwright/mcp/` (di-ignore Git). Kedua konfigurasi
`.pi/mcp.json` dan `.mcp.json` menetapkan `--output-dir playwright/mcp` untuk
filename otomatis. Filename eksplisit tetap relatif terhadap root workspace,
jadi sertakan prefix `playwright/mcp/` seperti contoh di atas. Reconnect/restart
server diperlukan agar perubahan config berlaku pada proses MCP yang sudah aktif.

Untuk pekerjaan UI rutin repo ini, Playwright E2E (`npm run test:e2e:*`) tetap
jalur utama; MCP ini untuk inspeksi manual saat mendiagnosis. Lokasi report dan
results dijelaskan di [panduan testing](../testing/README.md#lokasi-output-playwright).

## Alur wajib sebelum implementasi

Ringkasnya (detail dan pengecualian ada di `AGENTS.md` §4):

1. `mcp__context7__resolve_library_id` dengan
   `{ libraryName: "Drizzle ORM", query: "check constraint" }` → mis.
   `/drizzle-team/drizzle-orm-docs`.
2. `mcp__context7__query_docs` dengan
   `{ libraryId: "/drizzle-team/drizzle-orm-docs", query: "check constraint in drizzle-kit 0.31" }`.
3. Catat ID library dan hal yang terkonfirmasi di plan/ticket/slice notes
   (`Context7 checkpoint: <id> — <yang diverifikasi>`).

Contoh nyata: slice yang menambah `check()` constraint memakai langkah di atas
untuk memastikan apakah `drizzle-kit@0.31` men-generate check constraint dari
schema Drizzle atau harus lewat SQL manual. Tanpa inquiry ini, agent bisa
menulis API yang hanya ada di versi lain (atau sudah deprecated) dan baru
ketahuan saat `db:generate`/typecheck gagal.

Subagent `implementer` tidak punya tool MCP maupun shell, jadi main agent wajib
menjalankan inquiry dan menuliskan signature/opsi yang sudah terkonfirmasi ke
handoff packet.

## Fallback bila Context7 tidak tersedia

Urutannya:

1. `pi mcp list` untuk memastikan status: `needs sign-in` (login), project
   tidak trusted (beri trust), atau entry invalid (perbaiki `.pi/mcp.json`).
2. Bila MCP/network tidak bisa dipakai: baca type dan source paket yang
   ter-install di `node_modules/<paket>` (paling akurat untuk versi yang
   benar-benar dipakai), atau dokumentasi resmi vendor.
3. Tulis di laporan slice sumber mana yang menggantikan Context7. Menebak API
   dari memori tanpa menyebutkannya adalah pelanggaran aturan `AGENTS.md`.

## Troubleshooting

| Gejala | Tindakan |
|---|---|
| `needs sign-in` | `pi mcp login context7` (shell) atau `/mcp login context7` (sesi). |
| Tool `mcp__context7__*` tidak muncul | `/reload` setelah mengubah `.pi/mcp.json`; pastikan tidak ada `pi-mcp-adapter` yang menumpang (`pi list`). |
| Tool `mcp__playwright__*` tidak muncul | Normal: exposure `codemode`, tool baru muncul di dalam script. Kalau server gagal, cek `pi mcp list` (npx bisa gagal unduh offline). |
| Project MCP tidak dibaca | Project belum trusted — setujui trust saat Pi start. |
| `pi mcp list` exit code 1 | Ada entry invalid atau server enabled yang tidak connected; baca pesan errornya. |
| Browser tidak terbuka / callback gagal | Jalankan `pi mcp login context7`; sesi terminal juga menerima URL redirect yang di-paste manual. |
| Token hilang setelah logout | Login ulang; tidak ada fallback anonymous di endpoint `/mcp/oauth`. |
| Hasil dokumentasi tidak cocok dengan versi terpasang | Sebutkan versi di `query`; Context7 mengindeks banyak versi (mis. `/vercel/next.js/v16.2.9`). |
| Library tidak terindeks | Pakai fallback `node_modules`/docs vendor dan catat di laporan. |

Verifikasi cepat dari shell bahwa endpoint OAuth aktif:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://mcp.context7.com/mcp/oauth \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}'
# 401 = benar, endpoint menuntut OAuth (bukan error)

curl -s https://mcp.context7.com/.well-known/oauth-protected-resource/mcp/oauth
# {"resource":"https://mcp.context7.com/mcp/oauth","authorization_servers":["https://clerk.context7.com","https://context7.com"],...}
```
