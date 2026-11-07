#!/usr/bin/env python3
"""The ledger view of the lab page (docs/design/lab_ui.md section 6): grade, range and sources of the ids the lab names.

    uv run python scripts/lab_ledger.py --write    # write src/generated/ledger_view.json, ledger_view_public.json and breakout_public.ts
    uv run python scripts/lab_ledger.py --check    # fail when a committed file differs from a fresh generation (npm run build:lab runs this)

The ids are exactly those that the shipped JSON (the files src/worker/data.ts imports: the `ref` of every parameter and the `bundle` of every profile file) and the dictionaries (src/i18n/*.ts) name; an id that is in no ledger is an error.
An A### is followed to its S### sources, and it is provisional when any of them is below `main-reread` (invariant 3). The ledgers are never edited here.

The view also holds the rule for the public build (lab_ui.md sections 6 and 20; ADR-0013): `breakout` lists the ids that the Break-out screen shows, the sources behind them that are below `main-reread`,
and `public`, true only when there is none. The page offers the screen in the public build only when `public` is true; a local build offers it marked "not for publication".
A build that refuses the screen bundles none of its files, so it must not carry their ids either: `ledger_view_public.json` is the view over the files such a build bundles (no SC12 scenario, event-type
profile, SC12 config or Break-out dictionary) and has no `breakout` block, which lists those ids. src/ledger.ts reads the full view when the build offers the screen and this one when it refuses it.
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from ledger_rules import ID_RE, load_ledgers, unverified_sources  # noqa: E402

REPO = HERE.parent
VIEW = Path("src/generated/ledger_view.json")
PUBLIC_VIEW = Path("src/generated/ledger_view_public.json")
# the same rule as a TypeScript constant: a bundler folds `import.meta.env.VITE_LAB_LOCAL === "1" || BREAKOUT_PUBLIC` and drops the Break-out files from a build that refuses the screen,
# which it cannot do through a property of a JSON module (src/worker/data.ts)
PUBLIC_TS = Path("src/generated/breakout_public.ts")
DATA_TS = Path("src/worker/data.ts")
I18N_DIR = Path("src/i18n")
JSON_IMPORT = re.compile(r'from\s+"([^"]+\.json)"')
# the files of the Break-out screen: its scenarios (the `breakout` block and the horizon setting are shown; the process settings are not), its event-type profiles and its dictionaries
BREAKOUT_SCENARIO = re.compile(r"(^|/)data/scenarios/sc12_[^/]+\.json$")
BREAKOUT_PROFILE = re.compile(r"(^|/)data/scenarios/profiles/breakout/[^/]+\.json$")
BREAKOUT_EXPERIMENT = re.compile(r"(^|/)data/scenarios/experiments/sc12\.json$")
BREAKOUT_DICTIONARY = "*breakout*.ts"


def breakout_file(rel: str) -> bool:
    """A file that only a build offering the Break-out screen bundles (src/worker/data.ts, src/i18n)."""
    return any(p.search(rel) for p in (BREAKOUT_SCENARIO, BREAKOUT_PROFILE, BREAKOUT_EXPERIMENT)) or fnmatch.fnmatch(Path(rel).name, BREAKOUT_DICTIONARY)


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


def named_ids(root: Path, public: bool = False) -> dict[str, list[str]]:
    """Each id the lab names, with the files that name it. `public`: only the files that a build refusing the Break-out screen bundles."""
    where: dict[str, list[str]] = {}
    for path in shipped_json(root):
        if public and breakout_file(path.relative_to(root).as_posix()):
            continue
        found: set[str] = set()
        refs_in(json.loads(path.read_text(encoding="utf-8")), found)
        for ref in found:
            where.setdefault(ref, []).append(str(path.relative_to(root)))
    for path in sorted((root / I18N_DIR).glob("*.ts")) if (root / I18N_DIR).exists() else []:
        if public and breakout_file(path.relative_to(root).as_posix()):
            continue
        for ref in set(ID_RE.findall(path.read_text(encoding="utf-8"))):
            where.setdefault(ref, []).append(str(path.relative_to(root)))
    return where


def breakout_ids(root: Path) -> set[str]:
    """The ids the Break-out screen shows: the `breakout` block and the horizon of each SC12 scenario, every ref of the event-type profiles, and the ids of its dictionaries."""
    ids: set[str] = set()
    for path in shipped_json(root):
        rel = path.relative_to(root).as_posix()
        doc = json.loads(path.read_text(encoding="utf-8"))
        if BREAKOUT_SCENARIO.search(rel):
            refs_in(doc.get("breakout"), ids)
            refs_in((doc.get("settings") or {}).get("horizon_days"), ids)
        elif BREAKOUT_PROFILE.search(rel):
            refs_in(doc, ids)
    for path in sorted((root / I18N_DIR).glob(BREAKOUT_DICTIONARY)) if (root / I18N_DIR).exists() else []:
        ids.update(ID_RE.findall(path.read_text(encoding="utf-8")))
    return ids


def build(root: Path, public: bool = False) -> dict:
    """The view of the lab page; `public` is the one of a build that refuses the Break-out screen (the ids of its files, and the `breakout` block that lists them, left out)."""
    sources, assumptions, errors = load_ledgers(root)
    if errors:
        raise SystemExit("the ledgers do not validate (run check_docs.py): " + "; ".join(errors[:3]))
    where = named_ids(root, public)
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
    view = {"schema_version": "1", "assumptions": view_assumptions, "sources": dict(sorted(view_sources.items()))}
    if public:
        return view
    shown = breakout_ids(root)
    below = sorted({s for ref in shown for s in unverified_sources(ref, sources, assumptions)})
    return {**view, "breakout": {"ids": sorted(shown), "below_main_reread": below, "public": not below}}


def render(view: dict) -> str:
    return json.dumps(view, indent=2, ensure_ascii=False) + "\n"


def render_public(view: dict) -> str:
    return (
        "// Written by scripts/lab_ledger.py from the ledgers (the `breakout` rule of src/generated/ledger_view.json): do not edit.\n"
        "// True when no id of the Break-out screen follows to a source below main-reread, so the public build may offer the screen (lab_ui.md section 20).\n"
        f"export const BREAKOUT_PUBLIC = {'true' if view['breakout']['public'] else 'false'};\n"
    )


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true", help=f"write {VIEW}, {PUBLIC_VIEW} and {PUBLIC_TS}")
    mode.add_argument("--check", action="store_true", help=f"fail when {VIEW}, {PUBLIC_VIEW} or {PUBLIC_TS} differs from a fresh generation")
    ap.add_argument("--root", type=Path, default=REPO, help="repository root (tests use a throwaway one)")
    args = ap.parse_args(argv)
    view = build(args.root)
    fresh = {VIEW: render(view), PUBLIC_VIEW: render(build(args.root, public=True)), PUBLIC_TS: render_public(view)}
    if args.write:
        for rel, text in fresh.items():
            (args.root / rel).parent.mkdir(parents=True, exist_ok=True)
            (args.root / rel).write_text(text, encoding="utf-8")
            print(f"wrote {rel}: {text.count(chr(10))} lines")
        return 0
    stale = [rel for rel, text in fresh.items() if (args.root / rel).read_text(encoding="utf-8") != text] if all((args.root / rel).exists() for rel in fresh) else list(fresh)
    if stale:
        print(f"{', '.join(map(str, stale))} {'is' if len(stale) == 1 else 'are'} missing or out of date: a ledger or a shipped file changed. Run: uv run python scripts/lab_ledger.py --write", file=sys.stderr)
        return 1
    print(f"{VIEW}, {PUBLIC_VIEW} and {PUBLIC_TS} are current")
    return 0


if __name__ == "__main__":
    sys.exit(main())
