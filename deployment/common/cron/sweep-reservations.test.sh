#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/bin" "$TMP_DIR/logs"
printf 'CRON_SECRET=test-secret\n' > "$TMP_DIR/staging.env"

cat > "$TMP_DIR/bin/curl" <<'CURL'
#!/usr/bin/env bash
printf '%s\n' "${@: -1}" > "$CAPTURE_FILE"
printf '%s\n' '{"success":true}'
CURL
chmod +x "$TMP_DIR/bin/curl"

CAPTURE_FILE="$TMP_DIR/request-url" PATH="$TMP_DIR/bin:$PATH" \
  bash "$SCRIPT_DIR/sweep-reservations.sh" \
    --url "https://dev-store.adfsport.cloud/" \
    --env-file "$TMP_DIR/staging.env" \
    --log-dir "$TMP_DIR/logs"

expected="https://dev-store.adfsport.cloud/api/cron/sweep-reservations"
actual="$(cat "$TMP_DIR/request-url")"
if [ "$actual" != "$expected" ]; then
  printf 'FAIL: expected curl URL %s, got %s\n' "$expected" "$actual" >&2
  exit 1
fi

printf 'PASS: sweep uses the reservation endpoint URL\n'
