"""Apply the author's recorded ADR decisions: status line, decider's note and index row.

Input: a JSON object {"0001": {"status": ..., "chosen_option": ..., "decider_note": ...}, ...}
(default docs/adr/review_2026-10-29.json). The author runs this and commits the result.
It never overwrites a decider's note that holds other words. All or nothing: on any mismatch nothing is written.

  python3 scripts/adr_accept.py [--dry-run] [--root DIR] [REVIEW_JSON]

Exit 0: applied (or nothing left to change). Exit 1: a file, placeholder or index row did not match.
"""
from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
from pathlib import Path

DEFAULT_REVIEW = "docs/adr/review_2026-10-29.json"
NOTE_HEADING = "## Decider's note"
PLACEHOLDER = "_(author only — Claude never writes here)_"
STATUS_LINE = re.compile(r"^- \*\*Status:\*\* \w+$", re.M)


def accept_adr(text: str, status: str, note: str) -> str:
    """The ADR text with the new status and note. Raises ValueError when the file does not match."""
    if len(STATUS_LINE.findall(text)) != 1:
        raise ValueError("needs exactly one '- **Status:** <word>' line")
    if text.count(NOTE_HEADING) != 1:
        raise ValueError("needs exactly one decider's note section")
    head, tail = text.split(NOTE_HEADING)
    if tail.strip() == PLACEHOLDER:
        tail = tail.replace(PLACEHOLDER, note)
    elif tail.strip() != note:
        raise ValueError("the decider's note holds other text; refusing to overwrite it")
    return STATUS_LINE.sub(lambda _: f"- **Status:** {status}", head + NOTE_HEADING + tail)


def accept_row(index: str, number: str, status: str) -> str:
    """The index table with the status column of one row replaced."""
    row = re.compile(rf"^(\| \[{number}\]\(.*\) \| .* \| )\w+( \|)$", re.M)
    if len(row.findall(index)) != 1:
        raise ValueError("the index needs exactly one row for this number")
    return row.sub(lambda m: m.group(1) + status + m.group(2), index)


def plan(root: Path, review: dict) -> tuple[dict[Path, str], list[str], int]:
    """New text per changed file, the error lines, and the number of changed index rows."""
    index_path = root / "docs/adr/README.md"
    old = {index_path: index_path.read_text(encoding="utf-8") if index_path.is_file() else ""}
    new, errors, rows = dict(old), [], 0
    if not index_path.is_file():
        errors.append("docs/adr/README.md: missing")
    for number, entry in sorted(review.items()):
        files = sorted((root / "docs/adr").glob(f"{number}-*.md"))
        if len(files) != 1:
            errors.append(f"{number}: expected exactly one docs/adr/{number}-*.md, found {len(files)}")
            continue
        try:
            status, note = entry["status"], entry["decider_note"]
            old[files[0]] = files[0].read_text(encoding="utf-8")
            new[files[0]] = accept_adr(old[files[0]], status, note)
            if index_path.is_file():
                before = new[index_path]
                new[index_path] = accept_row(before, number, status)
                rows += before != new[index_path]
        except (KeyError, ValueError) as e:
            errors.append(f"{number}: {e if isinstance(e, ValueError) else f'review entry lacks {e}'}")
    return {p: t for p, t in new.items() if t != old.get(p)}, errors, rows


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="print a unified diff and write nothing")
    ap.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    ap.add_argument("review", nargs="?", type=Path)
    args = ap.parse_args(argv)
    try:
        review = json.loads((args.review or args.root / DEFAULT_REVIEW).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        print(f"cannot read the review file: {e}", file=sys.stderr)
        return 1
    changes, errors, rows = plan(args.root, review)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        print("nothing written", file=sys.stderr)
        return 1
    for path, text in changes.items():
        rel = path.relative_to(args.root).as_posix()
        if args.dry_run:
            old = path.read_text(encoding="utf-8")
            sys.stdout.writelines(difflib.unified_diff(old.splitlines(True), text.splitlines(True), f"a/{rel}", f"b/{rel}"))
        else:
            path.write_text(text, encoding="utf-8")
    adrs = len(changes) - (1 if any(p.name == "README.md" for p in changes) else 0)
    print(f"{adrs} ADR file(s) and {rows} index row(s) {'would change' if args.dry_run else 'changed'}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
