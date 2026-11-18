#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/log"
printf 'CRON_SECRET=test-secret\n' > "$tmp/env"
cat > "$tmp/bin/curl" <<'CURL'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$CAPTURE_FILE"
count="$(wc -l < "$CAPTURE_FILE" | tr -d ' ')"
if [ "${FAIL_CALL:-0}" = "$count" ]; then exit 22; fi
body="${MOCK_BODY:-}"
[ -n "$body" ] || body='{"success":true,"observed":1,"missing":0,"failed":0}'
printf '%s\n' "$body"
CURL
chmod +x "$tmp/bin/curl"
# Git Bash tidak memiliki flock; ulangi di Linux untuk evidence locking aktual.
real_flock=1
if ! command -v flock >/dev/null; then
  real_flock=0
  printf '#!/usr/bin/env bash\nexit 0\n' > "$tmp/bin/flock"
  chmod +x "$tmp/bin/flock"
fi
CAPTURE_FILE="$tmp/capture" PATH="$tmp/bin:$PATH" bash "$root/refresh-jubelio-stock.sh" --url https://dev-store.adfsport.cloud/ --env-file "$tmp/env" --log-dir "$tmp/log"
grep -q 'X-Cron-Secret: test-secret' "$tmp/capture"
grep -q 'https://dev-store.adfsport.cloud/api/cron/refresh-jubelio-stock' "$tmp/capture"
grep -q 'OK' "$tmp/log/stock-refresh-$(date +%F).log"
if CAPTURE_FILE="$tmp/capture" PATH="$tmp/bin:$PATH" bash "$root/refresh-jubelio-stock.sh" --url http://unsafe.example --env-file "$tmp/env" --log-dir "$tmp/log" 2>/dev/null; then
  echo 'insecure URL accepted' >&2; exit 1
fi
# Full reconciliation is scheduled once a day; webhooks and live checkout
# verification cover stock changes between these scans.
for environment in staging production; do
  grep -Eq '^0 2 \* \* \* /home/ops/marketplace/deployment/common/cron/refresh-jubelio-stock.sh ' "$root/../../$environment/stock-refresh.cron"
done
# Dua invocation serial diperlukan untuk katalog dengan lebih dari 20.000 ID.
: > "$tmp/capture"
CAPTURE_FILE="$tmp/capture" PATH="$tmp/bin:$PATH" bash "$root/refresh-jubelio-stock.sh" --url https://dev-store.adfsport.cloud --env-file "$tmp/env" --log-dir "$tmp/log" --runs 2
[ "$(wc -l < "$tmp/capture" | tr -d ' ')" = 2 ] || { echo 'expected two requests' >&2; exit 1; }

for invalid in 0 13 -1 1.5 text 01 999999999999999999999 ''; do
  : > "$tmp/capture"
  if CAPTURE_FILE="$tmp/capture" PATH="$tmp/bin:$PATH" bash "$root/refresh-jubelio-stock.sh" --url https://dev-store.adfsport.cloud --env-file "$tmp/env" --log-dir "$tmp/log" --runs "$invalid" 2>/dev/null; then
    echo 'invalid runs accepted' >&2; exit 1
  fi
  [ ! -s "$tmp/capture" ] || { echo 'invalid runs sent a request' >&2; exit 1; }
done
: > "$tmp/capture"
if FAIL_CALL=2 CAPTURE_FILE="$tmp/capture" PATH="$tmp/bin:$PATH" bash "$root/refresh-jubelio-stock.sh" --url https://dev-store.adfsport.cloud --env-file "$tmp/env" --log-dir "$tmp/log" --runs 3; then
  echo 'failed run accepted' >&2; exit 1
fi
[ "$(wc -l < "$tmp/capture" | tr -d ' ')" = 2 ] || { echo 'did not stop at failed run' >&2; exit 1; }
for body in '{"success":false}' '{"success":true,"missing":1,"failed":0}' '{"success":true,"missing":0,"failed":1}' 'not-json'; do
  : > "$tmp/capture"
  if MOCK_BODY="$body" CAPTURE_FILE="$tmp/capture" PATH="$tmp/bin:$PATH" bash "$root/refresh-jubelio-stock.sh" --url https://dev-store.adfsport.cloud --env-file "$tmp/env" --log-dir "$tmp/log" --runs 2; then
    echo 'incomplete response accepted' >&2; exit 1
  fi
  [ "$(wc -l < "$tmp/capture" | tr -d ' ')" = 1 ] || { echo 'continued after incomplete response' >&2; exit 1; }
done
if [ "$real_flock" = 1 ]; then
  flock "$tmp/log/refresh.lock" bash -c 'touch "$1"; sleep 2' _ "$tmp/locked" &
  locker=$!
  for ((attempt=0; attempt<100; attempt++)); do [ -f "$tmp/locked" ] && break; sleep 0.02; done
  [ -f "$tmp/locked" ] || { echo 'test lock was not acquired' >&2; exit 1; }
  : > "$tmp/capture"
  if CAPTURE_FILE="$tmp/capture" PATH="$tmp/bin:$PATH" bash "$root/refresh-jubelio-stock.sh" --url https://dev-store.adfsport.cloud --env-file "$tmp/env" --log-dir "$tmp/log" --runs 2 2>/dev/null; then
    echo 'overlapping refresh accepted' >&2; exit 1
  fi
  [ ! -s "$tmp/capture" ] || { echo 'overlap sent HTTP' >&2; exit 1; }
  wait "$locker"
fi
echo "PASS: default/two runs, invalid bounds, fail-fast, incomplete, HTTP wiring, daily schedule; real_flock=$real_flock"
