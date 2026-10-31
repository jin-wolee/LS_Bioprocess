"""Source/assumption ledger rules: ledger schema, grade bundles, S###/A### references, and the public-number gate."""
from __future__ import annotations

import re
from pathlib import Path

import yaml

VERIFICATION = {"snippet", "agent-read", "main-reread"}
GRADES = {"S", "P", "D", "A"}
GRADE_RANK = {g: i for i, g in enumerate("SPDA")}  # strongest first: a bundle is only as good as its weakest component
ID_RE = re.compile(r"\b([SA]\d{3})\b")
PROVISIONAL_RE = re.compile(r"\bprovisional\b", re.I)
PUBLIC_NUMBER_FILES = ("README.md", "docs/research/README.md", "site/infographic/index.html")  # numbers here need main-reread sources
LEDGER_FILES = {"docs/research/sources.yaml", "docs/research/assumptions.yaml"}  # they define ids, so they are not checked as references


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
            for k in ("range", "unit"):
                if k not in a:
                    errors.append(f"assumptions.yaml {aid}: missing '{k}' (write n/a and explain it in notes if it does not apply)")
                elif (a[k] is None or str(a[k]).strip().lower() == "n/a") and not str(a.get("notes") or "").strip():
                    errors.append(f"assumptions.yaml {aid}: '{k}' is {a[k]!r} but notes do not explain why")
            if a.get("range_grade") is not None and a["range_grade"] not in GRADES:
                errors.append(f"assumptions.yaml {aid}: range_grade must be one of S/P/D/A")
            srcs = a.get("sources") or []
            if a.get("grade") in {"S", "P", "D"} and not srcs:
                errors.append(f"assumptions.yaml {aid}: grade {a.get('grade')} needs at least one source")
            for s in srcs:
                if s not in sources:
                    errors.append(f"assumptions.yaml {aid}: unknown source {s}")
            if aid in assumptions:
                errors.append(f"assumptions.yaml: duplicate id {aid}")
            assumptions[aid] = a
        errors += check_components(assumptions)
    return sources, assumptions, errors


def check_components(assumptions: dict) -> list[str]:
    """A bundle lists the assumption ids it is built from; its grade is the weakest of theirs."""
    errors = []
    for aid, a in assumptions.items():
        comps = a.get("components")
        if not isinstance(comps, list):
            continue
        for c in comps:
            if not (isinstance(c, str) and c in assumptions):
                errors.append(f"assumptions.yaml {aid}: unknown component {c}")
        grades = [assumptions[c].get("grade") for c in comps if isinstance(c, str) and c in assumptions]
        grades = [g for g in grades if g in GRADE_RANK]
        if grades and a.get("grade") in GRADE_RANK:  # an invalid grade is reported elsewhere
            weakest = max(grades, key=GRADE_RANK.get)
            if a["grade"] != weakest:
                errors.append(f"assumptions.yaml {aid}: grade {a['grade']} but its weakest component grade is {weakest}")
    return errors


def check_references(rel: str, text: str, sources: dict, assumptions: dict) -> list[str]:
    errors = []
    for ref in sorted(set(ID_RE.findall(text))):
        known = sources if ref.startswith("S") else assumptions
        if ref not in known:
            errors.append(f"{rel}: references unknown {ref}")
    if rel in PUBLIC_NUMBER_FILES:
        errors += check_public_numbers(rel, text, sources, assumptions)
    return errors


def unverified_sources(ref: str, sources: dict, assumptions: dict) -> list[str]:
    """Sources behind a cited S### or A### that are not main-reread (unknown ids are reported elsewhere)."""
    behind = [ref] if ref.startswith("S") else (assumptions.get(ref) or {}).get("sources") or []
    return [s for s in behind if s in sources and sources[s].get("verification") != "main-reread"]


def check_public_numbers(rel: str, text: str, sources: dict, assumptions: dict) -> list[str]:
    """Public files may cite only main-reread sources; a line containing 'provisional' is the labelled exception."""
    errors = []
    for n, line in enumerate(text.splitlines(), 1):
        if PROVISIONAL_RE.search(line):
            continue
        for ref in dict.fromkeys(ID_RE.findall(line)):
            for s in unverified_sources(ref, sources, assumptions):
                how = sources[s].get("verification")
                via = f"{ref}, whose source {s}" if s != ref else s
                errors.append(f"{rel}:{n}: public number cites {via} (verification: {how}), not main-reread; "
                              "re-read the source or label the line 'provisional'")
    return errors
