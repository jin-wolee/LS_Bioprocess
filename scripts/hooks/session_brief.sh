#!/usr/bin/env bash
# SessionStart hook: plain stdout becomes context for Claude.
# Shows the last progress entry and every ADR still waiting for the author's decision.
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-.}")"
cd "$ROOT" || exit 0
echo "== Sample Lineage Lab — session brief =="
if [ -f docs/progress.md ]; then
  echo "-- last progress entry (docs/progress.md) --"
  awk '/^## /{buf=""} {buf=buf $0 "\n"} END{printf "%s", buf}' docs/progress.md | head -25
fi
PROPOSED="$(grep -l -E '^- \*\*Status:\*\* Proposed' docs/adr/[0-9]*.md 2>/dev/null)"
if [ -n "$PROPOSED" ]; then
  echo "-- ADRs waiting for the author (Proposed; only the author flips them to Accepted) --"
  for f in $PROPOSED; do head -1 "$f" | sed 's/^# /  /'; done
fi
[ -f .guardrails.local.txt ] || echo "!! .guardrails.local.txt is missing — check_docs will FAIL until it is restored."
if [ -e .claude/.batch-running ]; then
  AGE="$(python3 -I -c 'import os,time; print(max(0, int(time.time()-os.stat(".claude/.batch-running").st_mtime)))' 2>/dev/null || echo 999999)"
  if [ "$AGE" -gt 21600 ]; then
    echo "!! stale batch marker: $((AGE / 3600)) hours old; the Stop gate will ignore it."
  else
    echo "!! batch marker: $((AGE / 3600)) hours old; the Stop gate is deferred."
  fi
fi
exit 0
