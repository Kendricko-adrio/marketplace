#!/usr/bin/env bash
# Host cron wrapper: read CRON_SECRET from an env file, serialize runs, log failures.
set -euo pipefail
URL=""; ENV_FILE=""; LOG_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --log-dir) LOG_DIR="$2"; shift 2 ;;
    *) echo "unknown option" >&2; exit 2 ;;
  esac
done
case "$URL" in https://*) ;; *) echo "HTTPS store URL required" >&2; exit 2;; esac
[ -f "$ENV_FILE" ] || { echo "env file missing" >&2; exit 2; }
[ -n "$LOG_DIR" ] || { echo "log directory required" >&2; exit 2; }
mkdir -p "$LOG_DIR"
command -v flock >/dev/null || { echo "flock utility missing" >&2; exit 2; }
exec 9>"$LOG_DIR/refresh.lock"
flock -n 9 || { echo "previous stock refresh still running" >&2; exit 1; }
secret="${CRON_SECRET:-$(grep -E '^CRON_SECRET=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r\"' || true)}"
[ -n "$secret" ] || { echo "CRON_SECRET missing" >&2; exit 2; }
log="$LOG_DIR/stock-refresh-$(date +%F).log"
if body="$(curl -fsS --max-time 540 -X POST -H "X-Cron-Secret: $secret" "${URL%/}/api/cron/refresh-jubelio-stock" 2>&1)"; then
  printf '[%s] OK %s\n' "$(date -Is)" "$body" >> "$log"
else
  rc=$?
  printf '[%s] FAIL rc=%s %s\n' "$(date -Is)" "$rc" "$body" >> "$log"
  exit "$rc"
fi
find "$LOG_DIR" -maxdepth 1 -name 'stock-refresh-*.log' -mtime +6 -delete
