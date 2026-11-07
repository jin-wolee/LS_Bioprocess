"""Source/assumption ledger rules: ledger schema, grade bundles, S###/A### references, and the public-number gate."""
from __future__ import annotations

import re
from pathlib import Path

import yaml

VERIFICATION = {"snippet", "agent-read", "main-reread"}
GRADES = {"S", "P", "D", "A"}
GRADE_RANK = {g: i for i, g in enumerate("SPDA")}  # strongest first: a bundle is only as good as its weakest component
ID_RE = re.compile(
    r"(?<![A-Za-z0-9_])(?<![Uu]\+)(?<![Uu]\+[0-9A-Fa-f]{4}-)"
    r"(?<![Uu]\+[0-9A-Fa-f]{5}-)(?<![Uu]\+[0-9A-Fa-f]{6}-)([SA][0-9]{3})(?![A-Za-z0-9_])"
)  # Korean particles are boundaries; Unicode code points and ranges are not ledger IDs.
PROVISIONAL_AFTER = re.compile(
    r"`?(?:에서|으로|은|는|이|가|을|를|의|과|와|로|에|도|만)?\)?(?:\s*,\s*|\s+)(?:\(provisional\)|provisional\b)",
    re.I,
)
PUBLIC_NUMBER_FILES = ("README.md", "README.ko.md", "docs/research/README.md", "site/infographic/index.html")  # numbers here need main-reread sources
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
    errors += check_ledger_references(sources, assumptions)
    return sources, assumptions, errors


def check_ledger_references(sources: dict, assumptions: dict) -> list[str]:
    """Resolve ledger prose and check source usage against assumption sources."""
    errors: list[str] = []
    for kind, entries in (("sources", sources), ("assumptions", assumptions)):
        for entry_id, entry in entries.items():
            for field in ("notes", "supports"):
                for ref in sorted(set(ID_RE.findall(str(entry.get(field) or "")))):
                    known = sources if ref.startswith("S") else assumptions
                    if ref not in known:
                        errors.append(f"{kind}.yaml {entry_id}: {field} references unknown {ref}")
    for sid, source in sources.items():
        used = source.get("used_in", [])
        if not isinstance(used, list):
            errors.append(f"sources.yaml {sid}: used_in must be a list of assumption ids")
            continue
        for aid in used:
            if not isinstance(aid, str) or not re.fullmatch(r"A\d{3}", aid):
                errors.append(f"sources.yaml {sid}: invalid used_in entry {aid}")
            elif aid not in assumptions:
                errors.append(f"sources.yaml {sid}: used_in references unknown {aid}")
            elif sid not in (assumptions[aid].get("sources") or []):
                errors.append(f"sources.yaml {sid}: used_in {aid} missing {sid} in assumptions sources")
        for aid, assumption in assumptions.items():
            if sid in (assumption.get("sources") or []) and aid not in used:
                errors.append(f"sources.yaml {sid}: used_in missing {aid} from assumption sources")
    return errors


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
    if rel in PUBLIC_NUMBER_FILES or rel.startswith(("docs/design/", "docs/adr/")):
        errors += check_public_numbers(rel, text, sources, assumptions)
    return errors


def unverified_sources(ref: str, sources: dict, assumptions: dict) -> list[str]:
    """Sources behind a cited S### or A### that are not main-reread (unknown ids are reported elsewhere)."""
    behind = [ref] if ref.startswith("S") else (assumptions.get(ref) or {}).get("sources") or []
    return [s for s in behind if s in sources and sources[s].get("verification") != "main-reread"]


def yaml_comment_start(line: str) -> int | None:
    """Find a YAML comment without mistaking a quoted hash for one."""
    quote = None
    i = 0
    while i < len(line):
        c = line[i]
        if quote == '"' and c == "\\":
            i += 2
            continue
        if quote == "'" and c == "'" and line[i:i + 2] == "''":
            i += 2
            continue
        if c == quote:
            quote = None
        elif quote is None and c in "\"'":
            quote = c
        elif quote is None and c == "#" and (i == 0 or line[i - 1].isspace()):
            return i
        i += 1
    return None


def structured_labels(rel: str, line: str) -> tuple[set[int], set[int]]:
    """Reference offsets covered by explicit per-ID labels and offsets of the labels themselves."""
    covered: set[int] = set()
    labels: set[int] = set()
    if rel.endswith((".yaml", ".yml")):
        comment = yaml_comment_start(line)
        marker = re.search(r"# provisional: ([SA][0-9]{3}(?:, [SA][0-9]{3})*)\s*$", line[comment:], re.I) if comment is not None else None
        if marker:
            start = comment + marker.start()
            ids = set(ID_RE.findall(marker.group(1)))
            covered.update(m.start() for m in ID_RE.finditer(line[:start]) if m.group(1) in ids)
            labels.update(m.start() for m in ID_RE.finditer(line, start))
    if rel == "site/infographic/index.html":
        for tag in re.finditer(r"<[^>]*>", line):
            src = re.search(r'\bdata-src="([^"]*)"', tag.group())
            marker = re.search(r'\bdata-provisional-refs="([^"]*)"', tag.group())
            if not marker:
                continue
            labels.update(tag.start() + marker.start(1) + m.start() for m in ID_RE.finditer(marker.group(1)))
            if src and re.search(r'\bdata-status="provisional"', tag.group()):
                ids = set(ID_RE.findall(marker.group(1)))
                covered.update(tag.start() + src.start(1) + m.start() for m in ID_RE.finditer(src.group(1)) if m.group(1) in ids)
    return covered, labels


def check_public_numbers(rel: str, text: str, sources: dict, assumptions: dict) -> list[str]:
    """Every citation of an unverified source needs its own adjacent label."""
    errors = []
    for n, line in enumerate(text.splitlines(), 1):
        covered, labels = structured_labels(rel, line)
        for match in ID_RE.finditer(line):
            if match.start() in covered or match.start() in labels or PROVISIONAL_AFTER.match(line, match.end()):
                continue
            ref = match.group(1)
            for s in unverified_sources(ref, sources, assumptions):
                how = sources[s].get("verification")
                via = f"{ref}, whose source {s}" if s != ref else s
                errors.append(f"{rel}:{n}: public number cites {via} (verification: {how}), not main-reread; "
                              "re-read the source or label this reference 'provisional'")
    return errors
