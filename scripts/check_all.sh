#!/usr/bin/env bash
# Stop hook: run the full checks only when this turn edited files (.claude/.dirty), block once on failure.
# Reads the Stop hook JSON on stdin. Exit 2 = Claude keeps going and sees stderr; exit 0 = allow stop.
set -u
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-.}")"
cd "$ROOT" || exit 0
INPUT="$(cat)"
ACTIVE="$(printf '%s' "$INPUT" | python3 -I -c 'import json,sys
try: print(str(json.load(sys.stdin).get("stop_hook_active", False)).lower())
except Exception: print("false")')"
[ "$ACTIVE" = "true" ] && exit 0          # already continuing because of this hook: never loop
[ -f .claude/.dirty ] || exit 0           # nothing edited this turn

OUT="$(uv run --frozen --quiet python scripts/check_docs.py --all 2>&1)"; RC=$?
if [ -f package.json ] && [ $RC -eq 0 ]; then
  OUT="$OUT"$'\n'"$(npm run -s check 2>&1)"; RC=$?
fi
if grep -rIl --include='*.ts' --include='*.js' 'Math\.random' src engine 2>/dev/null | grep -q .; then
  OUT="$OUT"$'\n'"FAIL  Math.random found in engine/src (use the seeded PRNG)"; RC=1
fi

if [ $RC -ne 0 ]; then
  printf '%s\n' "$OUT" | grep -E '^(FAIL|WARN)|check_docs|ERR' | head -40 >&2
  printf '%s\n' "Checks failed. Report the failure to the user with the lines above. Do not edit ADR decider notes or flip ADR status to Accepted." >&2
  exit 2
fi
rm -f .claude/.dirty
WARN="$(printf '%s\n' "$OUT" | grep '^WARN' | head -5)"
if [ -n "$WARN" ]; then
  python3 -I -c 'import json,sys; print(json.dumps({"systemMessage": sys.argv[1]}))' "$WARN"
fi
exit 0
