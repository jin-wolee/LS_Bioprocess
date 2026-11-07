"""Per-file document rules: banned tokens (from the local list or GUARDRAIL_TERMS), ADR format, and the scan that applies them."""
from __future__ import annotations

import os
import re
from pathlib import Path

ADR_STATUSES = {"Proposed", "Accepted", "Rejected", "Superseded"}
ADR_SECTIONS = ["## Context", "## Options", "## Decision", "## Consequences", "## Evidence", "## Decider's note"]
NOTE_PLACEHOLDER = "_(author only"
SKIP_SCAN = {"uv.lock", "package-lock.json"}


def load_terms(root: Path, ci: bool = False) -> list[str] | None:
    if ci:
        lines = os.environ.get("GUARDRAIL_TERMS", "").splitlines()
    else:
        f = root / ".guardrails.local.txt"
        if not f.exists():
            return None
        lines = f.read_text(encoding="utf-8").splitlines()
    return [ln.strip().lower() for ln in lines if ln.strip() and not ln.strip().startswith("#")]


def banned_hits(text: str, terms: list[str]) -> list[int]:
    """1-based numbers of the list items found in the text. A hit reports these numbers, never the term."""
    low = text.lower()
    return [n for n, t in enumerate(terms, 1) if t in low]


def banned_lines(text: str, terms: list[str]) -> list[tuple[int, list[int]]]:
    """(line number, item numbers) for each line of the text that holds a listed term."""
    items = banned_hits(text, terms)
    if not items:
        return []
    out = []
    for n, line in enumerate(text.lower().split("\n"), 1):
        here = [i for i in items if terms[i - 1] in line]
        if here:
            out.append((n, here))
    return out


def banned_message(items: list[int]) -> str:
    """The one wording of a hit: item numbers of the loaded list, no term (the log may be public)."""
    return f"banned token(s): list item {', '.join(map(str, items))} (see .guardrails.local.txt or GUARDRAIL_TERMS; the terms are not printed)"


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


# ---------- scan ----------
def scan_file(rel: str, text: str, terms: list[str]) -> tuple[list[str], list[str]]:
    errors, warnings = [], []
    path_hits = banned_hits(rel, terms)
    if path_hits:
        errors.append(f"[redacted path]: {banned_message(path_hits)}")
        return errors, warnings
    if Path(rel).name not in SKIP_SCAN:
        for line, items in banned_lines(text, terms):
            errors.append(f"{rel}:{line}: {banned_message(items)}")
    if rel.startswith("docs/adr/") and rel.endswith(".md"):
        e, w = check_adr(rel, text)
        errors += e
        warnings += w
    return errors, warnings
