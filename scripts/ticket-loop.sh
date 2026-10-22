#!/usr/bin/env bash
# Conductor tiket diskon: satu proses `pi` baru per tiket.
#
# Conductor ini tidak menjalankan model dan tidak punya context window. Ia
# membaca frontier dari frontmatter tiket, menjalankan `pi -p` untuk satu tiket,
# lalu memeriksa hasilnya. Tiket berikutnya selalu mendapat sesi baru.
#
# Pemakaian:
#   bash scripts/ticket-loop.sh
#   DISCOUNTS_DRY_RUN=1 bash scripts/ticket-loop.sh
#   DISCOUNTS_MAX_TICKETS=1 bash scripts/ticket-loop.sh
#
# Variabel lingkungan:
#   DISCOUNTS_WORKDIR           cwd eksekusi (default: root repo)
#   DISCOUNTS_LOG_DIR           direktori log (default: %TEMP%/discounts-loop)
#   DISCOUNTS_MAX_TICKETS       batas spawn per invocations (default: 8)
#   DISCOUNTS_PROVIDER          provider model (default: ollama)
#   DISCOUNTS_MODEL             model (default: deepseek-v4.1-flash:1017-cloud)
#   DISCOUNTS_THINKING          thinking level (default: high)
#                               Set salah satunya kosong (mis. DISCOUNTS_MODEL=) untuk
#                               mewarisi settings pi. --provider butuh --model.
#   DISCOUNTS_RETRY             1 = retry sekali dengan sesi sama (default: 1)
#   DISCOUNTS_CONTINUE_ON_BLOCKED 1 = lewati tiket gagal, lanjut yang lain
#   DISCOUNTS_CHECKPOINT        1 = commit lokal tiap tiket resolved
#   DISCOUNTS_DRY_RUN           1 = cetak rencana, jangan spawn
#   DISCOUNTS_SLEEP             jeda antar tiket detik (default: 3)
#   DISCOUNTS_PI_BIN            binary pi (default: pi)
#
# Hentikan kapan saja dengan membuat file:
#   .scratch/discounts-implementation/STOP
#
# Exit code: 0 selesai/batas tercapai, 3 lock, 4 cwd, 5 resolver,
#            6 BLOCKED, 7 gagal tanpa BLOCKED.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRATCH="$ROOT/.scratch/discounts-implementation"
PROMPT="$SCRATCH/ticket-prompt.md"
NEXT="$ROOT/scripts/ticket-next.mjs"
PI_BIN="${DISCOUNTS_PI_BIN:-pi}"
WORKDIR="${DISCOUNTS_WORKDIR:-$ROOT}"
LOG_DIR="${DISCOUNTS_LOG_DIR:-${TMPDIR:-${TEMP:-/tmp}}/discounts-loop}"
MAX_TICKETS="${DISCOUNTS_MAX_TICKETS:-8}"
PROVIDER="${DISCOUNTS_PROVIDER-ollama}"
MODEL="${DISCOUNTS_MODEL-deepseek-v4.1-flash:1017-cloud}"
THINKING="${DISCOUNTS_THINKING-high}"
RETRY="${DISCOUNTS_RETRY:-1}"
CONTINUE_ON_BLOCKED="${DISCOUNTS_CONTINUE_ON_BLOCKED:-0}"
CHECKPOINT="${DISCOUNTS_CHECKPOINT:-0}"
DRY_RUN="${DISCOUNTS_DRY_RUN:-0}"
SLEEP_SECONDS="${DISCOUNTS_SLEEP:-3}"

say() { echo "[$(date -Is)] $*"; }

if ! command -v node >/dev/null 2>&1; then
  echo "node tidak ditemukan di PATH" >&2
  exit 4
fi
if [ ! -f "$NEXT" ] || [ ! -f "$PROMPT" ]; then
  echo "file conductor tidak lengkap: $NEXT / $PROMPT" >&2
  exit 4
fi
if [ "$DRY_RUN" != "1" ] && ! command -v "$PI_BIN" >/dev/null 2>&1; then
  echo "binary '$PI_BIN' tidak ditemukan di PATH" >&2
  exit 4
fi

mkdir -p "$LOG_DIR"

# Lock portabel: mkdir atomik (flock tidak selalu tersedia di Git Bash).
LOCK="$LOG_DIR/.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "conductor lain masih berjalan (lock: $LOCK)" >&2
  exit 3
fi
cleanup() { rmdir "$LOCK" 2>/dev/null || true; }
trap cleanup EXIT

cd "$WORKDIR" || { echo "tidak bisa masuk ke $WORKDIR" >&2; exit 4; }

say "model: ${PROVIDER:-inherit}/${MODEL:-inherit} (thinking ${THINKING:-inherit})"

run_pi() { # $1=session-id  $2=file-tiket  $3=instruksi  $4=suffix-log
  local sid="$1" ticket="$2" instruction="$3" suffix="$4"
  local base="${ticket##*[/\\]}"
  local -a args=(--approve -p --session-id "$sid" --name "discounts ${base%.md}")
  local out="$LOG_DIR/${suffix}.out" err="$LOG_DIR/${suffix}.err"

  if [ -n "$PROVIDER" ]; then args+=(--provider "$PROVIDER"); fi
  if [ -n "$MODEL" ]; then args+=(--model "$MODEL"); fi
  if [ -n "$THINKING" ]; then args+=(--thinking "$THINKING"); fi

  if [ "$DRY_RUN" = "1" ]; then
    printf '[dry-run] cd %q && %q' "$WORKDIR" "$PI_BIN"
    printf ' %q' "${args[@]}" "@$ticket" "@$PROMPT" "$instruction"
    printf ' > %q 2> %q\n' "$out" "$err"
    return 0
  fi

  "$PI_BIN" "${args[@]}" "@$ticket" "@$PROMPT" "$instruction" >"$out" 2>"$err"
}

is_blocked_output() { # $1=id  $2=suffix-log
  local out="$LOG_DIR/$2.out"
  [ -f "$out" ] && grep -q "TICKET:$1:BLOCKED" "$out"
}

spawned=0
skipped_csv=""
while [ "$spawned" -lt "$MAX_TICKETS" ]; do
  if [ -f "$SCRATCH/STOP" ]; then
    say "STOP marker ditemukan; berhenti."
    break
  fi

  resolver_args=(--quiet)
  if [ -n "$skipped_csv" ]; then resolver_args+=(--skip "$skipped_csv"); fi

  ticket="$(node "$NEXT" "${resolver_args[@]}")"
  resolver_rc=$?
  if [ "$resolver_rc" -ne 0 ]; then
    echo "resolver gagal (exit=$resolver_rc); periksa graf tiket." >&2
    exit 5
  fi
  if [ -z "$ticket" ]; then
    say "Tidak ada tiket ready; selesai."
    break
  fi

  base="${ticket##*[/\\]}"
  id="${base:0:2}"
  sid="discounts-${id}-a1"
  say "START tiket $id -> $base (sesi $sid)"

  run_pi "$sid" "$ticket" \
    "Eksekusi tiket $id sesuai protokol. Jangan bertanya." \
    "${id}-a1"
  rc=$?

  if [ "$DRY_RUN" = "1" ]; then
    say "dry-run: tidak ada proses yang dijalankan; berhenti setelah satu rencana."
    break
  fi

  status="$(node "$NEXT" --status "$id" 2>/dev/null || true)"

  if is_blocked_output "$id" "${id}-a1"; then
    say "BLOCKED tiket $id (lihat $LOG_DIR/${id}-a1.out); berhenti."
    exit 6
  fi

  if [ "$status" != "resolved" ] && [ "$RETRY" = "1" ]; then
    say "RETRY tiket $id (exit=$rc status=${status:-unknown}); melanjutkan sesi $sid."
    run_pi "$sid" "$ticket" \
      "Validasi tiket $id belum lengkap (exit=$rc). Lanjutkan dari state saat ini; perbaiki kegagalan lalu tutup protokol." \
      "${id}-a1-retry"
    rc=$?
    status="$(node "$NEXT" --status "$id" 2>/dev/null || true)"
    if is_blocked_output "$id" "${id}-a1-retry"; then
      say "BLOCKED tiket $id pada retry; berhenti."
      exit 6
    fi
  fi

  if [ "$status" = "resolved" ]; then
    spawned=$((spawned + 1))
    say "RESOLVED tiket $id."
    if [ "$CHECKPOINT" = "1" ]; then
      if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
        if git -C "$ROOT" add -A; then
          git -C "$ROOT" reset -q -- .pi/subagents 2>/dev/null || true
          if git -C "$ROOT" commit -q -m "wip(discounts-$id): resolve ticket $id"; then
            say "checkpoint commit dibuat (lokal, tanpa push)."
          fi
        fi
      fi
    fi
  else
    say "GAGAL tiket $id (exit=$rc status=${status:-unknown})."
    if [ "$CONTINUE_ON_BLOCKED" = "1" ]; then
      skipped_csv="${skipped_csv:+$skipped_csv,}$id"
      spawned=$((spawned + 1))
      say "melanjutkan ke tiket lain; $id dilewati pada run ini."
    else
      say "berhenti. Periksa $LOG_DIR/${id}-a1.out dan ticket Answer/Comments."
      exit 7
    fi
  fi

  sleep "$SLEEP_SECONDS"
done

say "Ringkasan frontier:"
node "$NEXT" --json || true
