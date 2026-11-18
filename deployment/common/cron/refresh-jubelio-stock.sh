#!/usr/bin/env bash
# Wrapper host: satu lock untuk rangkaian serial stock refresh sandbox/production.
# --runs default 1 menjaga kompatibilitas cron existing; maksimal 12 invocation.
set -euo pipefail
URL=""; ENV_FILE=""; LOG_DIR=""; RUNS=1
while [ $# -gt 0 ]; do
  [ $# -ge 2 ] || { echo "option value required" >&2; exit 2; }
  case "$1" in
    --runs) RUNS="$2"; shift 2 ;;
    --url) URL="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --log-dir) LOG_DIR="$2"; shift 2 ;;
    *) echo "unknown option" >&2; exit 2 ;;
  esac
done
case "$RUNS" in ''|*[!0-9]*) echo "runs must be an integer 1..12" >&2; exit 2 ;; esac
[[ "$RUNS" =~ ^([1-9]|1[0-2])$ ]] || { echo "runs must be an integer 1..12" >&2; exit 2; }
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
for ((run=1; run<=RUNS; run++)); do
  if body="$(curl -fsS --max-time 540 -X POST -H "X-Cron-Secret: $secret" "${URL%/}/api/cron/refresh-jubelio-stock" 2>&1)"; then
    # Route mengembalikan 503 untuk missing/failed. Tolak juga success:false
    # atau body incomplete walaupun proxy salah mengembalikannya sebagai 200.
    if ! printf '%s' "$body" | grep -Eq '"success"[[:space:]]*:[[:space:]]*true[[:space:]]*[,}]' ||
       printf '%s' "$body" | grep -Eq '"(missing|failed)"[[:space:]]*:[[:space:]]*[1-9]'; then
      printf '[%s] FAIL run=%s/%s incomplete response\n' "$(date -Is)" "$run" "$RUNS" >> "$log"
      exit 1
    fi
    printf '[%s] OK run=%s/%s %s\n' "$(date -Is)" "$run" "$RUNS" "$body" >> "$log"
  else
    rc=$?
    printf '[%s] FAIL run=%s/%s rc=%s\n' "$(date -Is)" "$run" "$RUNS" "$rc" >> "$log"
    exit "$rc"
  fi
done
find "$LOG_DIR" -maxdepth 1 -name 'stock-refresh-*.log' -mtime +6 -delete
