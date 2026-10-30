#!/usr/bin/env python3
"""The ledger view of the lab page (docs/design/lab_ui.md section 6): grade, range and sources of the ids the lab names.

    uv run python scripts/lab_ledger.py --write    # write src/generated/ledger_view.json
    uv run python scripts/lab_ledger.py --check    # fail when the committed file differs from a fresh generation (npm run build:lab runs this)

The ids are exactly those that the shipped JSON (the files src/worker/data.ts imports: the `ref` of every parameter and the `bundle` of every profile file) and the dictionaries (src/i18n/*.ts) name; an id that is in no ledger is an error.
An A### is followed to its S### sources, and it is provisional when any of them is below `main-reread` (invariant 3). The ledgers are never edited here.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from ledger_rules import ID_RE, load_ledgers, unverified_sources  # noqa: E402

REPO = HERE.parent
VIEW = Path("src/generated/ledger_view.json")
DATA_TS = Path("src/worker/data.ts")
I18N_DIR = Path("src/i18n")
JSON_IMPORT = re.compile(r'from\s+"([^"]+\.json)"')


def shipped_json(root: Path) -> list[Path]:
    """The JSON files src/worker/data.ts imports, resolved against its folder."""
    data = root / DATA_TS
    if not data.exists():
        return []
    return [(data.parent / spec).resolve() for spec in JSON_IMPORT.findall(data.read_text(encoding="utf-8"))]


def refs_in(doc, found: set[str]) -> None:
    """Every `ref` value of a parsed JSON document ({value, unit, ref} parameters, ADR-0012) and the `bundle` of a profile file."""
    if isinstance(doc, dict):
        for key, value in doc.items():
            if key in ("ref", "bundle") and isinstance(value, str):
                found.add(value)
            else:
                refs_in(value, found)
    elif isinstance(doc, list):
        for item in doc:
            refs_in(item, found)


def named_ids(root: Path) -> dict[str, list[str]]:
    """Each id the lab names, with the files that name it."""
    where: dict[str, list[str]] = {}
    for path in shipped_json(root):
        found: set[str] = set()
        refs_in(json.loads(path.read_text(encoding="utf-8")), found)
        for ref in found:
            where.setdefault(ref, []).append(str(path.relative_to(root)))
    for path in sorted((root / I18N_DIR).glob("*.ts")) if (root / I18N_DIR).exists() else []:
        for ref in set(ID_RE.findall(path.read_text(encoding="utf-8"))):
            where.setdefault(ref, []).append(str(path.relative_to(root)))
    return where


def build(root: Path) -> dict:
    sources, assumptions, errors = load_ledgers(root)
    if errors:
        raise SystemExit("the ledgers do not validate (run check_docs.py): " + "; ".join(errors[:3]))
    where = named_ids(root)
    unknown = sorted(i for i in where if i not in (sources if i.startswith("S") else assumptions))
    if unknown:
        raise SystemExit("ids named by the lab that are in no ledger: " + ", ".join(f"{i} ({', '.join(where[i])})" for i in unknown))
    view_assumptions: dict[str, dict] = {}
    view_sources: dict[str, dict] = {}
    for ref in sorted(where):
        if ref.startswith("S"):
            view_sources[ref] = {"verification": sources[ref]["verification"]}
            continue
        a = assumptions[ref]
        behind = a.get("sources") or []
        view_assumptions[ref] = {
            "grade": a["grade"],
            "range": a["range"],
            "unit": a["unit"],
            "sources": list(behind),
            "provisional": bool(unverified_sources(ref, sources, assumptions)),
        }
        for s in behind:
            view_sources[s] = {"verification": sources[s]["verification"]}
    return {"schema_version": "1", "assumptions": view_assumptions, "sources": dict(sorted(view_sources.items()))}


def render(view: dict) -> str:
    return json.dumps(view, indent=2, ensure_ascii=False) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true", help=f"write {VIEW}")
    mode.add_argument("--check", action="store_true", help=f"fail when {VIEW} differs from a fresh generation")
    ap.add_argument("--root", type=Path, default=REPO, help="repository root (tests use a throwaway one)")
    args = ap.parse_args(argv)
    fresh = render(build(args.root))
    target = args.root / VIEW
    if args.write:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(fresh, encoding="utf-8")
        print(f"wrote {VIEW}: {fresh.count(chr(10))} lines")
        return 0
    current = target.read_text(encoding="utf-8") if target.exists() else None
    if current != fresh:
        print(f"{VIEW} is {'missing' if current is None else 'out of date'}: a ledger or a shipped file changed. Run: uv run python scripts/lab_ledger.py --write", file=sys.stderr)
        return 1
    print(f"{VIEW} is current")
    return 0


if __name__ == "__main__":
    sys.exit(main())
