#!/usr/bin/env bash
# Full checks: docs, tests, Node checks, seeded-PRNG rule.
#   (no flag)  Stop hook. Reads the Stop hook JSON on stdin and runs only when this turn changed something:
#              .claude/.dirty exists (Write/Edit hooks set it) or the repo state differs from the one stored after the
#              last green check (.claude/.last-check; this catches edits made through Bash).
#              Exit 2 = Claude keeps going and sees stderr; exit 0 = allow stop.
#              While .claude/.batch-running exists (the orchestrator writes the batch name and start time there for the length of an executor batch) it prints one line
#              and exits 0 without running anything or touching .dirty and .last-check, so the first turn after the marker is removed runs the gate.
#   --manual   Ignore stdin, stop_hook_active, stored state and the batch marker: always run, print a summary, exit 0 (PASS) or 1 (FAIL).
#   --lab      Also run the end-to-end checks of the lab page (scripts/qa_lab.py: builds the lab, then headless Chromium, Firefox and WebKit; about a minute). Never part of the
#              Stop hook, which passes no flag; the S3 batches use `--manual --lab` (docs/design/lab_ui.md section 12).
#   --plant    Also run the end-to-end checks of the plant (scripts/qa_plant.py: builds the lab, then headless Chromium with software WebGL; about a minute). Never part of the Stop
#              hook; the plant batches use `--manual --lab --plant` (docs/design/plant_ui.md section 10).
set -u
MANUAL=0; LAB=0; PLANT=0
for arg in "$@"; do
  case "$arg" in
    --manual) MANUAL=1 ;;
    --lab) LAB=1 ;;
    --plant) PLANT=1 ;;
    *) echo "check_all.sh: unknown flag $arg (flags: --manual, --lab, --plant)" >&2; exit 2 ;;
  esac
done
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-.}")"
cd "$ROOT" || exit 0

# Fingerprint of everything git can see: status, staged and unstaged diffs, and the contents of untracked files.
# Empty when this is not a git work tree (then every Stop runs the checks).
state_hash() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
  local keep=(-- . ':(exclude).claude/.last-check')
  {
    git status --porcelain=v1 -uall "${keep[@]}"
    git diff "${keep[@]}"
    git diff --cached "${keep[@]}"
    git ls-files -z --others --exclude-standard "${keep[@]}" | while IFS= read -r -d '' f; do cat -- "$f"; done
  } 2>/dev/null | git hash-object --stdin
}

if [ $MANUAL -eq 0 ]; then
  INPUT="$(cat)"
  ACTIVE="$(printf '%s' "$INPUT" | python3 -I -c 'import json,sys
try: print(str(json.load(sys.stdin).get("stop_hook_active", False)).lower())
except Exception: print("false")')"
  [ "$ACTIVE" = "true" ] && exit 0        # already continuing because of this hook: never loop
  if [ $LAB -eq 0 ] && [ $PLANT -eq 0 ] && [ -e .claude/.batch-running ]; then  # an executor batch is running: leave state alone, the gate is the orchestrator's
    BATCH="$({ tr -s '[:space:]' ' ' < .claude/.batch-running; } 2>/dev/null)"; BATCH="${BATCH# }"; BATCH="${BATCH% }"
    echo "check_all: gate deferred while an executor batch runs (${BATCH:-.claude/.batch-running is empty or unreadable}); the orchestrator runs 'bash scripts/check_all.sh --manual' before it commits." >&2
    exit 0
  fi
  STATE="$(state_hash)"
  LAST="$(cat .claude/.last-check 2>/dev/null)"
  if [ ! -f .claude/.dirty ] && [ -n "$STATE" ] && [ "$STATE" = "$LAST" ]; then exit 0; fi  # nothing changed
fi

OUT=""; RC=0
step() {  # step <label> <command...>: collect the output, record a failure line when the command fails
  local label="$1" out rc; shift
  out="$("$@" 2>&1)"; rc=$?
  OUT="$OUT"$'\n'"$out"
  if [ $rc -ne 0 ]; then OUT="$OUT"$'\n'"FAIL  $label failed (exit $rc)"; RC=1; fi
}

step check_docs uv run --frozen --quiet python scripts/check_docs.py --all
step pytest uv run --frozen --quiet pytest -q
if [ -f package.json ]; then step "npm run check" npm run -s check; fi
# Seeded PRNG only: Math.random is banned in engine/src and src (test files and tests/ directories excepted)
RANDOM_HITS="$(grep -rIl --include='*.ts' --include='*.js' 'Math\.random' engine/src src 2>/dev/null \
  | grep -Ev '(^|/)(__)?tests(__)?/|/[^/]*test[^/]*$')"
if [ -n "$RANDOM_HITS" ]; then
  OUT="$OUT"$'\n'"FAIL  Math.random found in engine/src or src (use the seeded PRNG): $(printf '%s' "$RANDOM_HITS" | tr '\n' ' ')"; RC=1
fi

# The end-to-end checks of the lab page, last because they are the slowest; qa_lab.py prints one `FAIL  qa_lab <check>: ...` line per failed check, which the summary below keeps.
if [ $LAB -eq 1 ]; then step qa_lab uv run --frozen --quiet python scripts/qa_lab.py; fi
# The plant's end-to-end checks (qa_plant.py prints `FAIL  qa_plant <check>: ...` lines the same way).
if [ $PLANT -eq 1 ]; then step qa_plant uv run --frozen --quiet python scripts/qa_plant.py; fi

# The summary. Never cut: each step's "FAIL  <step> failed", the Math.random line and the count lines (Vitest's, eslint's when it counts errors), so a failed gate
# always says which one. Cut after 40 lines, with a note of how many: the lines that name a failure. Vitest indents its own (" FAIL  <file> > <test>"); eslint prints
# the file path on a line of its own before its "  l:c  error  ..." lines, so the path is kept once per file with an error; tsc prints "file(l,c): error TS####". Warnings stay out.
SHOWN="$(printf '%s\n' "$OUT" | awk -v cap=40 '
  function keep(line) { if (++n <= cap) print line }
  /^[^ ]/ { path = $0 }
  /^FAIL  (.* failed \(exit [0-9]+\)|Math\.random found)/ || /^ +(Test Files|Tests|Errors) .*(failed|error)/ || /^✖ .*\([1-9][0-9]* errors?,/ { print; next }
  /^(FAIL|WARN)/ || /check_docs/ || /ERR/ || /^ +FAIL / || /error TS[0-9]+:/ { keep($0); next }
  /^ +[0-9]+:[0-9]+ +error / { if (path != seen) { keep(path); seen = path } keep($0) }
  END { if (n > cap) print "(" (n - cap) " more lines not shown)" }
')"
if [ $MANUAL -eq 1 ]; then
  [ -n "$SHOWN" ] && printf '%s\n' "$SHOWN"
  if [ $RC -ne 0 ]; then echo "check_all --manual: FAIL"; exit 1; fi
  echo "check_all --manual: PASS"; exit 0
fi

if [ $RC -ne 0 ]; then
  printf '%s\n' "$SHOWN" >&2
  printf '%s\n' "Checks failed. Report the failure to the user with the lines above. Do not edit ADR decider notes or flip ADR status to Accepted." >&2
  exit 2
fi
rm -f .claude/.dirty
mkdir -p .claude && state_hash > .claude/.last-check
WARN="$(printf '%s\n' "$OUT" | grep '^WARN' | head -5)"
if [ -n "$WARN" ]; then
  python3 -I -c 'import json,sys; print(json.dumps({"systemMessage": sys.argv[1]}))' "$WARN"
fi
exit 0
