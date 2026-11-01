#!/usr/bin/env python3
"""Repository document checks: banned tokens, ADR format, source/assumption ledgers, ID references.

Modes
  --hook      PostToolUse hook: read hook JSON on stdin, check the one edited file, mark .claude/.dirty.
              Exit 2 on a violation (message goes back to Claude).
  --all       Check every tracked + untracked (not ignored) file. Exit 1 on failure.
  --staged    git pre-commit: check staged blobs and refuse private paths. Exit 1 on failure.
  --history   git pre-push: scan the full history (`git log -p --all`). Exit 1 on failure.
  --ci        With --all: warnings about ADR decider notes become failures, ID references are enforced, and a banned-token list with no term in it fails
              (the Pages workflow runs `--all --ci` with the list in the secret GUARDRAIL_TERMS).

Banned tokens come from .guardrails.local.txt (gitignored) or the GUARDRAIL_TERMS environment
variable (CI secret, one term per line). If neither exists the check FAILS rather than passing.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

from docs_rules import banned_hits, banned_message, load_terms, scan_file
from ledger_rules import LEDGER_FILES, check_references, load_ledgers

PRIVATE_PREFIXES = ("docs/private/",)
PRIVATE_FILES = (".guardrails.local.txt",)


def git(*args: str, root: Path) -> str:
    return subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, check=False).stdout


def repo_root() -> Path:
    out = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    if out.returncode == 0:
        return Path(out.stdout.strip())
    return Path(os.environ.get("CLAUDE_PROJECT_DIR", Path(__file__).resolve().parents[1]))


def is_ignored(rel: str, root: Path) -> bool:
    return subprocess.run(["git", "check-ignore", "-q", rel], cwd=root).returncode == 0


def read_text(path: Path) -> str | None:
    try:
        if path.stat().st_size > 2_000_000:
            return None
        return path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return None


# ---------- modes ----------
def mode_hook(root: Path, terms: list[str]) -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0
    tin = data.get("tool_input", {}) or {}
    raw = tin.get("file_path") or tin.get("notebook_path")
    if not raw:
        return 0
    try:
        rel = Path(raw).resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return 0
    if is_ignored(rel, root) or rel.endswith("0000-template.md"):
        return 0
    (root / ".claude").mkdir(exist_ok=True)
    (root / ".claude/.dirty").touch()
    text = read_text(root / rel)
    if text is None:
        return 0
    errors, warnings = scan_file(rel, text, terms)
    if errors:
        sys.stderr.write("check_docs (edit hook) found problems:\n  " + "\n  ".join(errors) + "\nFix the file before continuing.\n")
        return 2
    return 0


def mode_all(root: Path, terms: list[str], ci: bool) -> int:
    files = git("ls-files", "--cached", "--others", "--exclude-standard", root=root).splitlines()
    errors, warnings = [], []
    sources, assumptions, lerr = load_ledgers(root)
    errors += lerr
    strict_refs = (root / ".claude/.bootstrap-done").exists() or ci
    for rel in sorted(set(files)):
        if rel.startswith(PRIVATE_PREFIXES) or rel in PRIVATE_FILES:
            errors.append(f"{rel}: private path is not ignored by git")
            continue
        p = root / rel
        if not p.is_file():
            continue
        text = read_text(p)
        if text is None:
            continue
        e, w = scan_file(rel, text, terms)
        errors += e
        warnings += w
        if strict_refs and rel.endswith((".md", ".html", ".yaml", ".yml", ".json", ".ts", ".py")) and rel not in LEDGER_FILES and not rel.startswith("tests/"):
            errors += check_references(rel, text, sources, assumptions)
    if ci:
        errors += warnings
        warnings = []
    for w in warnings:
        print(f"WARN  {w}")
    for e in errors:
        print(f"FAIL  {e}")
    print(f"check_docs --all: {len(files)} files, {len(errors)} failure(s), {len(warnings)} warning(s)"
          + ("" if strict_refs else " [bootstrap: ID references not enforced yet]"))
    return 1 if errors else 0


def mode_staged(root: Path, terms: list[str]) -> int:
    names = git("diff", "--cached", "--name-only", "--diff-filter=ACMR", root=root).splitlines()
    errors = []
    for rel in names:
        if rel.startswith(PRIVATE_PREFIXES) or rel in PRIVATE_FILES:
            errors.append(f"{rel}: private path staged")
            continue
        blob = subprocess.run(["git", "show", f":{rel}"], cwd=root, capture_output=True).stdout
        try:
            text = blob.decode("utf-8")
        except UnicodeDecodeError:
            continue
        e, _ = scan_file(rel, text, terms)
        errors += e
    for e in errors:
        print(f"FAIL  {e}", file=sys.stderr)
    return 1 if errors else 0


def mode_history(root: Path, terms: list[str]) -> int:
    log = subprocess.run(["git", "log", "-p", "--all", "--format=%H%n%an <%ae>%n%B"], cwd=root,
                         capture_output=True).stdout.decode("utf-8", errors="replace")
    hits = banned_hits(log, terms)
    paths = git("log", "--all", "--name-only", "--format=", root=root).splitlines()
    leaked = sorted({p for p in paths if p.startswith(PRIVATE_PREFIXES) or p in PRIVATE_FILES})
    if hits:
        print(f"FAIL  history contains {banned_message(hits)}", file=sys.stderr)
    if leaked:
        print(f"FAIL  history contains private paths: {leaked}", file=sys.stderr)
    return 1 if (hits or leaked) else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--hook", action="store_true")
    g.add_argument("--all", action="store_true")
    g.add_argument("--staged", action="store_true")
    g.add_argument("--history", action="store_true")
    ap.add_argument("--ci", action="store_true")
    args = ap.parse_args()
    root = repo_root()
    terms = load_terms(root)
    if terms is None or (args.ci and not terms):  # --ci is the Pages job: a secret that is blank or all comments would scan for nothing
        msg = "FAIL  no banned-token list (.guardrails.local.txt or GUARDRAIL_TERMS), or no term in it — refusing to pass silently\n"
        sys.stderr.write(msg)
        return 2 if args.hook else 1
    if args.hook:
        return mode_hook(root, terms)
    if args.all:
        return mode_all(root, terms, args.ci)
    if args.staged:
        return mode_staged(root, terms)
    return mode_history(root, terms)


if __name__ == "__main__":
    sys.exit(main())
