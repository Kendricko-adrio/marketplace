#!/usr/bin/env bash
#
# sweep-reservations.sh — wrapper cron untuk POST /api/cron/sweep-reservations.
#
# Dipanggil oleh cron (user `ops`), bisa juga dijalankan manual untuk test.
# Tugas script:
#   1. POST ke endpoint sweep dengan header `X-Cron-Secret`. Secret dibaca dari
#      env `CRON_SECRET` atau dari file `.env` (`--env-file`) — sehingga secret
#      tidak perlu ditulis di crontab.
#   2. Menambahkan satu baris hasil ke file log harian:
#      <log-dir>/marketplace-sweep-YYYY-MM-DD.log
#   3. Housekeeping: menghapus file log harian yang lebih tua dari
#      `--retention-days` (default 7 hari) supaya log tidak menumpuk.
#
# Pemakaian:
#   sweep-reservations.sh --url https://dev-store.adfsport.cloud \
#     --env-file /home/ops/marketplace/deployment/staging/.env \
#     --log-dir /home/ops/logs/marketplace-sweep/staging
#
# Konfigurasi via argumen CLI atau env var (argumen menang atas env):
#   --url URL                  | SWEEP_URL            | URL store (wajib)
#   --env-file PATH            | SWEEP_ENV_FILE       | file .env sumber CRON_SECRET
#   --log-dir PATH             | SWEEP_LOG_DIR        | default $HOME/logs/marketplace-sweep
#   --retention-days N         | SWEEP_RETENTION_DAYS | default 7
#   --timeout DETIK            | SWEEP_CURL_TIMEOUT   | default 55 (curl --max-time)
#   (env CRON_SECRET menimpa nilai dari --env-file)

set -euo pipefail

PROG="sweep-reservations"

usage() {
  sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
}

die() {
  printf '%s: %s\n' "$PROG" "$1" >&2
  exit 1
}

# ---------------------------------------------------------------- parsing arg
while [ $# -gt 0 ]; do
  case "$1" in
    --url)
      [ $# -ge 2 ] || die "--url butuh nilai"
      SWEEP_URL="$2"; shift 2 ;;
    --env-file)
      [ $# -ge 2 ] || die "--env-file butuh nilai"
      SWEEP_ENV_FILE="$2"; shift 2 ;;
    --log-dir)
      [ $# -ge 2 ] || die "--log-dir butuh nilai"
      SWEEP_LOG_DIR="$2"; shift 2 ;;
    --retention-days)
      [ $# -ge 2 ] || die "--retention-days butuh nilai"
      SWEEP_RETENTION_DAYS="$2"; shift 2 ;;
    --timeout)
      [ $# -ge 2 ] || die "--timeout butuh nilai"
      SWEEP_CURL_TIMEOUT="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      die "argumen tidak dikenal: $1 (lihat --help)" ;;
  esac
done

# ------------------------------------------------------------------- default
SWEEP_URL="${SWEEP_URL:-}"
SWEEP_ENV_FILE="${SWEEP_ENV_FILE:-}"
SWEEP_LOG_DIR="${SWEEP_LOG_DIR:-${HOME}/logs/marketplace-sweep}"
SWEEP_RETENTION_DAYS="${SWEEP_RETENTION_DAYS:-7}"
SWEEP_CURL_TIMEOUT="${SWEEP_CURL_TIMEOUT:-55}"
SWEEP_LOG_PREFIX="${SWEEP_LOG_PREFIX:-marketplace-sweep}"

# ------------------------------------------------------------------ env .env
# Baca nilai satu variabel dari file .env (dukung kutip ganda/tunggal, CRLF).
read_env_value() {
  local key="$1" file="$2" line value
  [ -f "$file" ] || return 1
  line="$(grep -E "^[[:space:]]*${key}=" "$file" | tail -n 1)" || return 1
  value="${line#*=}"
  value="${value%$'\r'}"
  if [ "${#value}" -ge 2 ]; then
    case "$value" in
      '"'*'"') value="${value:1:${#value}-2}" ;;
      "'"*"'") value="${value:1:${#value}-2}" ;;
    esac
  fi
  printf '%s' "$value"
}

# --------------------------------------------------------------- validasi
case "$SWEEP_URL" in
  https://*|http://*) ;;
  *) die "URL store wajib diisi (--url / SWEEP_URL), contoh: https://dev-store.adfsport.cloud" ;;
esac

case "$SWEEP_RETENTION_DAYS" in
  ''|*[!0-9]*) die "--retention-days harus angka bulat positif (dapat: '$SWEEP_RETENTION_DAYS')" ;;
esac
[ "$SWEEP_RETENTION_DAYS" -ge 1 ] || die "--retention-days minimal 1"

case "$SWEEP_CURL_TIMEOUT" in
  ''|*[!0-9]*) die "--timeout harus angka detik (dapat: '$SWEEP_CURL_TIMEOUT')" ;;
esac

secret="${CRON_SECRET:-}"
if [ -z "$secret" ] && [ -n "$SWEEP_ENV_FILE" ]; then
  secret="$(read_env_value CRON_SECRET "$SWEEP_ENV_FILE")" \
    || die "CRON_SECRET tidak ditemukan di $SWEEP_ENV_FILE"
fi
[ -n "$secret" ] || die "CRON_SECRET kosong: set env CRON_SECRET atau --env-file yang berisi CRON_SECRET"

# ------------------------------------------------- folder log + file harian
mkdir -p "$SWEEP_LOG_DIR" || die "tidak bisa membuat folder log: $SWEEP_LOG_DIR"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >> "$LOG_FILE"
}

LOG_FILE="${SWEEP_LOG_DIR}/${SWEEP_LOG_PREFIX}-$(date +%F).log"

# ------------------------------------------------------------- panggil endpoint
# --max-time menjaga agar satu run tidak menggantung >1 menit dan bertumpuk
# dengan run cron berikutnya. Endpoint sweep idempoten, tetapi tetap dijaga.
err_file="$(mktemp)"
rc=0
body="$(curl -fsS --max-time "$SWEEP_CURL_TIMEOUT" \
  -X POST -H "X-Cron-Secret: ${secret}" "$SWEEP_URL" 2>"$err_file")" || rc=$?

if [ "$rc" -eq 0 ]; then
  log "OK ${body}"
else
  # Contoh isi err_file: "curl: (22) The requested URL returned error: 503"
  log "FAIL rc=${rc} $(tr '\n' ' ' < "$err_file")"
fi
rm -f "$err_file"

# --------------------------------------------------------------- housekeeping
# File log harian terakhir ditulis mendekati akhir hari, jadi -mtime +6
# (untuk retensi 7) menyimpan tepat 7 hari kalender terakhir lalu menghapus
# sisanya. Dijalankan tiap eksekusi; find di folder berisi <=8 file itu murah.
deleted="$(find "$SWEEP_LOG_DIR" -maxdepth 1 -type f \
  -name "${SWEEP_LOG_PREFIX}-*.log" \
  -mtime +"$((SWEEP_RETENTION_DAYS - 1))" -print -delete | wc -l)"
deleted="${deleted//[[:space:]]/}"
if [ "$deleted" -gt 0 ]; then
  log "housekeeping: hapus ${deleted} file log lama (retensi ${SWEEP_RETENTION_DAYS} hari)"
fi

exit "$rc"