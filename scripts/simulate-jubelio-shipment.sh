#!/usr/bin/env bash
# Simulasi callback Shipment untuk satu order uji; tidak memanggil API Jubelio.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
STATUS="${1:-}"
if [[ "$STATUS" == "--help" || "$STATUS" == "-h" || -z "$STATUS" ]]; then
  printf '%s\n' \
    'Pemakaian: bash scripts/simulate-jubelio-shipment.sh STATUS [opsi]' \
    'Status: WAITING CONFIRMED_BY_COURIER ON_THE_WAY_PICK_UP PICKED_UP ON_DELIVERY' \
    '        ON_HOLD DELIVERED RETURNED CANCELED SHIPMENT_ISSUE' \
    'Opsi: --send                 Kirim POST (default: preview saja).' \
    '      --url BASE_URL         Default http://localhost:3000; hanya loopback.' \
    '      --env-file FILE        Default .env di root repo.' \
    '      --date ISO_TIMESTAMP   Waktu event; default waktu sekarang.' \
    '      --detail TEXT          Keterangan tracking simulasi.' \
    'DELIVERED dapat menyelesaikan order. Status lama/duplikat bisa diabaikan.' \
    'Jangan gunakan bash -x: tracing shell dapat membocorkan signature.'
  exit 0
fi
shift
case "$STATUS" in
  WAITING|CONFIRMED_BY_COURIER|ON_THE_WAY_PICK_UP|PICKED_UP|ON_DELIVERY|ON_HOLD|DELIVERED|RETURNED|CANCELED|SHIPMENT_ISSUE) ;;
  *) printf 'Status tidak dikenal: %s\n' "$STATUS" >&2; exit 1 ;;
esac
SEND=false
URL='http://localhost:3000'
ENV_FILE="$ROOT/.env"
EVENT_DATE=''
DETAIL="Simulasi webhook Jubelio: $STATUS"
while (($#)); do
  case "$1" in
    --send) SEND=true; shift ;;
    --url|--env-file|--date|--detail)
      if (($# < 2)) || [[ "$2" == --* ]]; then
        printf 'Opsi %s membutuhkan nilai.\n' "$1" >&2; exit 1
      fi
      case "$1" in
        --url) URL="$2" ;;
        --env-file) ENV_FILE="$2" ;;
        --date) EVENT_DATE="$2" ;;
        --detail) DETAIL="$2" ;;
      esac
      shift 2 ;;
    *) printf 'Opsi tidak dikenal: %s\n' "$1" >&2; exit 1 ;;
  esac
done
command -v node >/dev/null || { printf 'Node.js 24 diperlukan.\n' >&2; exit 1; }
if "$SEND"; then
  command -v curl >/dev/null || { printf 'curl diperlukan (tersedia di Git Bash).\n' >&2; exit 1; }
fi
# Konversi path Git Bash menjadi path native agar dapat dibaca node.exe.
if command -v cygpath >/dev/null; then ENV_FILE="$(cygpath -w "$ENV_FILE")"; fi
GENERATED="$(node - "$STATUS" "$ENV_FILE" "$EVENT_DATE" "$DETAIL" "$URL" "$SEND" <<'NODE'
const { createHmac } = require('node:crypto');
const { existsSync } = require('node:fs');
const [status, envFile, eventDate, detail, baseUrl, send] = process.argv.slice(2);
try {
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('URL harus base URL loopback, misalnya http://localhost:3000.');
  }
  const date = eventDate ? new Date(eventDate) : new Date();
  if (!Number.isFinite(date.getTime())) throw new Error('Tanggal event tidak valid.');
  // Hanya baca .env sebagai data, jangan source/eval file menjadi perintah shell.
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const secret = (process.env.JUBELIO_SHIPMENT_WEBHOOK_SECRET || '').trim();
  if (send === 'true' && !secret) throw new Error('JUBELIO_SHIPMENT_WEBHOOK_SECRET kosong; periksa --env-file.');
  const raw = JSON.stringify({
    event: 'awb',
    ref_no: '170a6986-eaa9-49de-ab01-839775958c75',
    awb: 'MOCK-JS2420810000000005',
    shipment_id: 7,
    latest_status: status,
    tracking: { date: date.toISOString(), status, status_detail: detail },
  });
  console.log(raw);
  // Signature tidak dicetak ke terminal oleh Bash, hanya dikirim sebagai header.
  console.log(send === 'true' ? createHmac('sha256', secret).update(raw + secret).digest('hex') : 'preview');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
NODE
)"
PAYLOAD="${GENERATED%$'\n'*}"
SIGNATURE="${GENERATED##*$'\n'}"
ENDPOINT="${URL%/}/api/webhooks/jubelio-shipment"
printf 'Target: %s\n' "$ENDPOINT"
if ! "$SEND"; then
  printf 'PREVIEW: belum ada request dikirim. Tambahkan --send untuk mengirim.\n%s\n' "$PAYLOAD"
  exit 0
fi
printf 'Mengirim simulasi %s untuk order 170a6986-eaa9-49de-ab01-839775958c75.\n' "$STATUS"
# Tidak mengikuti redirect, tidak retry; byte body harus sama dengan yang ditandatangani.
curl --silent --show-error --fail-with-body --connect-timeout 5 --max-time 30 \
  --request POST "$ENDPOINT" \
  --header 'Content-Type: application/json' \
  --header "x-jubelio-signature: $SIGNATURE" \
  --data-binary "$PAYLOAD"
printf '\n'
