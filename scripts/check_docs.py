#!/usr/bin/env python3
"""Repository document checks: banned tokens, ADR format, source/assumption ledgers, ID references.

Modes
  --hook      PostToolUse hook: read hook JSON on stdin, check the one edited file, mark .claude/.dirty.
              Exit 2 on a violation (message goes back to Claude).
  --all       Check every tracked + untracked (not ignored) file. Exit 1 on failure.
  --staged    git pre-commit: check staged blobs and refuse private paths. Exit 1 on failure.
  --history   git pre-push: scan the full history (`git log -p --all`). Exit 1 on failure.
  --ci        With --all: warnings about ADR decider notes become failures.

Banned tokens come from .guardrails.local.txt (gitignored) or the GUARDRAIL_TERMS environment
variable (CI secret, one term per line). If neither exists the check FAILS rather than passing.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import yaml

ADR_STATUSES = {"Proposed", "Accepted", "Rejected", "Superseded"}
ADR_SECTIONS = ["## Context", "## Options", "## Decision", "## Consequences", "## Evidence", "## Decider's note"]
NOTE_PLACEHOLDER = "_(author only"
VERIFICATION = {"snippet", "agent-read", "main-reread"}
GRADES = {"S", "P", "D", "A"}
ID_RE = re.compile(r"\b([SA]\d{3})\b")
PUBLIC_NUMBER_FILES = ("README.md", "infographic/index.html")
PRIVATE_PREFIXES = ("docs/private/",)
PRIVATE_FILES = (".guardrails.local.txt",)
SKIP_SCAN = {"uv.lock", "package-lock.json"}
LEDGER_FILES = {"docs/research/sources.yaml", "docs/research/assumptions.yaml"}  # they define ids, so they are not checked as references


def git(*args: str, root: Path) -> str:
    return subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, check=False).stdout


def repo_root() -> Path:
    out = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    if out.returncode == 0:
        return Path(out.stdout.strip())
    return Path(os.environ.get("CLAUDE_PROJECT_DIR", Path(__file__).resolve().parents[1]))


def load_terms(root: Path) -> list[str] | None:
    env = os.environ.get("GUARDRAIL_TERMS")
    if env:
        lines = env.splitlines()
    else:
        f = root / ".guardrails.local.txt"
        if not f.exists():
            return None
        lines = f.read_text(encoding="utf-8").splitlines()
    return [ln.strip().lower() for ln in lines if ln.strip() and not ln.strip().startswith("#")]


def banned_hits(text: str, terms: list[str]) -> list[str]:
    low = text.lower()
    return [t for t in terms if t in low]


def is_ignored(rel: str, root: Path) -> bool:
    return subprocess.run(["git", "check-ignore", "-q", rel], cwd=root).returncode == 0


def read_text(path: Path) -> str | None:
    try:
        if path.stat().st_size > 2_000_000:
            return None
        return path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return None


# ---------- ADR ----------
def check_adr(rel: str, text: str) -> tuple[list[str], list[str]]:
    errors, warnings = [], []
    name = Path(rel).name
    if name == "0000-template.md" or name == "README.md":
        return errors, warnings
    m = re.fullmatch(r"(\d{4})-[a-z0-9-]+\.md", name)
    if not m:
        return [f"{rel}: ADR file name must be NNNN-kebab-slug.md"], warnings
    if not re.search(rf"^# ADR-{m.group(1)}: .+", text, re.M):
        errors.append(f"{rel}: first heading must be '# ADR-{m.group(1)}: <title>'")
    st = re.search(r"^- \*\*Status:\*\* (\w+)", text, re.M)
    if not st or st.group(1) not in ADR_STATUSES:
        errors.append(f"{rel}: needs '- **Status:** <{'|'.join(sorted(ADR_STATUSES))}>'")
    if not re.search(r"^- \*\*Date:\*\* \d{4}-\d{2}-\d{2}", text, re.M):
        errors.append(f"{rel}: needs '- **Date:** YYYY-MM-DD'")
    for sec in ADR_SECTIONS:
        if sec not in text:
            errors.append(f"{rel}: missing section '{sec}'")
    if "## Decider's note" in text:
        note = text.split("## Decider's note", 1)[1].strip()
        empty = (not note) or note.startswith(NOTE_PLACEHOLDER)
        if st and st.group(1) == "Accepted" and empty:
            warnings.append(f"{rel}: Accepted but the decider's note is empty (author must write it; Claude must not)")
    return errors, warnings


# ---------- ledgers ----------
def load_ledgers(root: Path) -> tuple[dict, dict, list[str]]:
    errors: list[str] = []
    sources: dict = {}
    assumptions: dict = {}
    sp = root / "docs/research/sources.yaml"
    ap = root / "docs/research/assumptions.yaml"
    if sp.exists():
        data = yaml.safe_load(sp.read_text(encoding="utf-8")) or {}
        for i, s in enumerate(data.get("sources", [])):
            sid = s.get("id", f"#{i}")
            for k in ("id", "title", "publisher", "url", "accessed", "type", "supports", "verification"):
                if not s.get(k):
                    errors.append(f"sources.yaml {sid}: missing '{k}'")
            if not re.fullmatch(r"S\d{3}", str(s.get("id", ""))):
                errors.append(f"sources.yaml {sid}: id must be S###")
            if s.get("verification") not in VERIFICATION:
                errors.append(f"sources.yaml {sid}: verification must be one of {sorted(VERIFICATION)}")
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(s.get("accessed", ""))):
                errors.append(f"sources.yaml {sid}: accessed must be YYYY-MM-DD")
            if sid in sources:
                errors.append(f"sources.yaml: duplicate id {sid}")
            sources[sid] = s
    if ap.exists():
        data = yaml.safe_load(ap.read_text(encoding="utf-8")) or {}
        for i, a in enumerate(data.get("assumptions", [])):
            aid = a.get("id", f"#{i}")
            for k in ("id", "name", "default", "grade"):
                if a.get(k) in (None, ""):
                    errors.append(f"assumptions.yaml {aid}: missing '{k}'")
            if not re.fullmatch(r"A\d{3}", str(a.get("id", ""))):
                errors.append(f"assumptions.yaml {aid}: id must be A###")
            if a.get("grade") not in GRADES:
                errors.append(f"assumptions.yaml {aid}: grade must be one of S/P/D/A")
            srcs = a.get("sources") or []
            if a.get("grade") in {"S", "P", "D"} and not srcs:
                errors.append(f"assumptions.yaml {aid}: grade {a.get('grade')} needs at least one source")
            for s in srcs:
                if s not in sources:
                    errors.append(f"assumptions.yaml {aid}: unknown source {s}")
            if aid in assumptions:
                errors.append(f"assumptions.yaml: duplicate id {aid}")
            assumptions[aid] = a
    return sources, assumptions, errors


def check_references(rel: str, text: str, sources: dict, assumptions: dict) -> list[str]:
    errors = []
    for ref in sorted(set(ID_RE.findall(text))):
        known = sources if ref.startswith("S") else assumptions
        if ref not in known:
            errors.append(f"{rel}: references unknown {ref}")
        elif rel in PUBLIC_NUMBER_FILES and ref.startswith("S") and sources[ref].get("verification") != "main-reread":
            errors.append(f"{rel}: public number cites {ref}, which is not main-reread yet")
    return errors


# ---------- modes ----------
def scan_file(rel: str, text: str, terms: list[str]) -> tuple[list[str], list[str]]:
    errors, warnings = [], []
    if Path(rel).name not in SKIP_SCAN:
        hits = banned_hits(text, terms)
        if hits:
            errors.append(f"{rel}: banned token(s) {hits} (see .guardrails.local.txt)")
    if rel.startswith("docs/adr/") and rel.endswith(".md"):
        e, w = check_adr(rel, text)
        errors += e
        warnings += w
    return errors, warnings


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
        print(f"FAIL  history contains banned token(s): {hits}", file=sys.stderr)
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
    if terms is None:
        msg = "FAIL  no banned-token list (.guardrails.local.txt or GUARDRAIL_TERMS) — refusing to pass silently\n"
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
