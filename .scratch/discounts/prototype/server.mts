import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { stripTypeScriptTypes } from "node:module";

/*
 * Launcher prototype diskon.
 *
 * Menyajikan satu halaman statis dari folder ini saja:
 *   /            -> index.html
 *   /index.html  -> index.html
 *   /styles.css  -> styles.css
 *   /app.js      -> app.ts yang di-strip tipe-nya lewat node:module
 *
 * Tidak ada akses folder lain, env, proxy, atau request keluar. Hanya GET/HEAD.
 */

const HOST = "127.0.0.1";
const DEFAULT_PORT = 3016;
const ROOT = import.meta.dirname;

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

const ASSETS: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
};

let compiledApp: string | null = null;

async function loadAppJs(): Promise<string> {
  if (compiledApp !== null) return compiledApp;
  const source = await readFile(join(ROOT, "app.ts"), "utf8");
  compiledApp = stripTypeScriptTypes(source, { mode: "strip" });
  return compiledApp;
}

function sendText(res: ServerResponse, status: number, message: string, extra: Record<string, string>): void {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "text/plain; charset=utf-8",
    ...extra,
  });
  res.end(message);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    sendText(res, 405, "Metode tidak didukung. Prototype hanya melayani GET dan HEAD.", {
      Allow: "GET, HEAD",
    });
    return;
  }

  const requestUrl = new URL(req.url ?? "/", "http://" + HOST);
  const pathname = requestUrl.pathname;

  if (pathname === "/app.js") {
    try {
      const code = await loadAppJs();
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        "Content-Type": "text/javascript; charset=utf-8",
      });
      if (method === "HEAD") {
        res.end();
        return;
      }
      res.end(code);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("Gagal menyiapkan /app.js dari app.ts:", detail);
      sendText(res, 500, "Gagal menyiapkan app.js dari app.ts. Periksa console server.", {});
    }
    return;
  }

  if (!Object.hasOwn(ASSETS, pathname)) {
    sendText(res, 404, "Tidak ditemukan. Prototype hanya menyajikan halaman utamanya.", {});
    return;
  }

  const asset = ASSETS[pathname];
  try {
    const body = await readFile(join(ROOT, asset.file));
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": asset.type,
      "Content-Length": String(body.byteLength),
    });
    if (method === "HEAD") {
      res.end();
      return;
    }
    res.end(body);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("Gagal membaca aset " + asset.file + ":", detail);
    sendText(res, 500, "Gagal membaca aset prototype.", {});
  }
}

function resolvePort(): number {
  const raw = process.argv[2];
  if (raw === undefined) return DEFAULT_PORT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
    console.error("Argumen port tidak valid: " + raw + ". Memakai " + DEFAULT_PORT + ".");
    return DEFAULT_PORT;
  }
  return parsed;
}

const port = resolvePort();

try {
  await loadAppJs();
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error("Preflight gagal: app.ts tidak dapat dijadikan app.js.", detail);
  process.exit(1);
}

const server = createServer((req, res) => {
  void handleRequest(req, res);
});

server.on("error", (error) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error("Server prototype gagal berjalan: " + detail);
  process.exitCode = 1;
});

server.listen(port, HOST, () => {
  console.log("Prototype Diskon — data simulasi, state hanya di memori (reload = reset).");
  console.log("Buka: http://" + HOST + ":" + port);
  console.log("Hentikan: Ctrl+C. Tidak ada API, DB, auth, provider, atau penulisan data.");
});
