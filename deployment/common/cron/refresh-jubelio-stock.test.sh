#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/log"
printf 'CRON_SECRET=test-secret\n' > "$tmp/env"
cat > "$tmp/bin/curl" <<'CURL'
#!/usr/bin/env bash
printf '%s\n' "$*" > "$CAPTURE_FILE"
printf '%s\n' '{"success":true,"observed":1}'
CURL
chmod +x "$tmp/bin/curl"
# Git Bash on Windows lacks flock; this test checks HTTP wiring, not OS locking.
printf '#!/usr/bin/env bash\nexit 0\n' > "$tmp/bin/flock"
chmod +x "$tmp/bin/flock"
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
echo 'PASS: authenticated stock refresh URL, HTTPS restriction and daily schedule'
