"""scripts/lab_ledger.py: the ledger view of the lab page (docs/design/lab_ui.md section 6).

Expected values are read off the ledgers by hand (the header of docs/research/assumptions.yaml lists the main-reread sources), never taken from the generator.
"""
from __future__ import annotations

import json
import sys

import pytest

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts"))
import lab_ledger as ll  # noqa: E402

SOURCES = """sources:
  - id: S001
    title: "t"
    publisher: "p"
    url: "https://example.org/1"
    accessed: 2026-10-30
    type: vendor-doc
    supports: "x"
    verification: main-reread
  - id: S002
    title: "t"
    publisher: "p"
    url: "https://example.org/2"
    accessed: 2026-10-30
    type: paper
    supports: "x"
    verification: snippet
"""
ASSUMPTIONS = """assumptions:
  - id: A001
    name: first
    default: 24
    range: [5, 100]
    unit: reactors
    grade: S
    sources: [S001]
    notes: "n"
  - id: A002
    name: second
    default: 2
    range: [1, 6]
    unit: analyzers
    grade: S
    sources: [S001, S002]
    notes: "n"
  - id: A003
    name: third
    default: 1
    range: "n/a"
    unit: flag
    grade: A
    sources: []
    notes: "no range: a switch"
"""


def make_root(tmp_path, scenario_refs=("A001",), i18n_text="", ledger_assumptions=ASSUMPTIONS, bundle=None):
    """A throwaway repo with two tiny ledgers, src/worker/data.ts importing one scenario file, and an optional dictionary. `bundle`: the `bundle` field a profile file has."""
    (tmp_path / "docs/research").mkdir(parents=True)
    (tmp_path / "docs/research/sources.yaml").write_text(SOURCES, encoding="utf-8")
    (tmp_path / "docs/research/assumptions.yaml").write_text(ledger_assumptions, encoding="utf-8")
    (tmp_path / "scenarios").mkdir()
    settings = {f"s{i}": {"value": 1, "unit": "u", "ref": ref} for i, ref in enumerate(scenario_refs)}
    doc = {"settings": settings, "stability": [{"rate": {"value": 1, "unit": "u", "ref": scenario_refs[0]}}]}
    if bundle is not None:
        doc["bundle"] = bundle
    (tmp_path / "scenarios/x.json").write_text(json.dumps(doc), encoding="utf-8")
    (tmp_path / "src/worker").mkdir(parents=True)
    (tmp_path / "src/worker/data.ts").write_text('import x from "../../scenarios/x.json";\nexport const D = x;\n', encoding="utf-8")
    if i18n_text:
        (tmp_path / "src/i18n").mkdir()
        (tmp_path / "src/i18n/en.ts").write_text(i18n_text, encoding="utf-8")
    return tmp_path


def view_of(root):
    return ll.build(root)


# ---------- what the view holds ----------
def test_a_main_reread_source_is_not_provisional_and_the_view_holds_grade_range_unit_and_sources(tmp_path):
    view = view_of(make_root(tmp_path, ("A001",)))
    assert view["assumptions"]["A001"] == {"grade": "S", "range": [5, 100], "unit": "reactors", "sources": ["S001"], "provisional": False}
    assert view["sources"] == {"S001": {"verification": "main-reread"}}


def test_an_a_id_is_followed_to_its_sources_and_is_provisional_when_any_is_below_main_reread(tmp_path):
    view = view_of(make_root(tmp_path, ("A002",)))
    assert view["assumptions"]["A002"]["provisional"] is True
    assert view["sources"] == {"S001": {"verification": "main-reread"}, "S002": {"verification": "snippet"}}


def test_an_a_id_with_no_source_is_grade_a_and_not_provisional(tmp_path):
    entry = view_of(make_root(tmp_path, ("A003",)))["assumptions"]["A003"]
    assert entry["grade"] == "A" and entry["provisional"] is False and entry["sources"] == [] and entry["range"] == "n/a"


def test_an_s_id_named_directly_appears_under_sources_only(tmp_path):
    view = view_of(make_root(tmp_path, ("S002",)))
    assert view["assumptions"] == {}
    assert view["sources"] == {"S002": {"verification": "snippet"}}


def test_ids_in_the_dictionaries_are_included_and_every_id_is_listed_once_in_id_order(tmp_path):
    view = view_of(make_root(tmp_path, ("A002",), i18n_text='export const en = { "x": "see A001 and A003" } as const;\n'))
    assert list(view["assumptions"]) == ["A001", "A002", "A003"]


def test_the_ids_are_those_of_the_files_data_ts_imports_not_of_every_scenario_file(tmp_path):
    root = make_root(tmp_path, ("A001",))
    (root / "scenarios/not_shipped.json").write_text(json.dumps({"settings": {"a": {"value": 1, "unit": "u", "ref": "A003"}}}), encoding="utf-8")
    assert "A003" not in view_of(root)["assumptions"]


def test_the_bundle_field_of_a_shipped_profile_file_is_named_like_a_ref_and_its_grade_comes_from_the_ledger(tmp_path):
    view = view_of(make_root(tmp_path, ("A001",), bundle="A002"))
    assert view["assumptions"]["A002"] == {"grade": "S", "range": [1, 6], "unit": "analyzers", "sources": ["S001", "S002"], "provisional": True}
    assert list(view["assumptions"]) == ["A001", "A002"]
    assert view["sources"] == {"S001": {"verification": "main-reread"}, "S002": {"verification": "snippet"}}


def test_a_bundle_id_in_no_ledger_fails_and_names_the_file(tmp_path):
    with pytest.raises(SystemExit) as e:
        view_of(make_root(tmp_path, ("A001",), bundle="A998"))
    assert "A998" in str(e.value) and "scenarios/x.json" in str(e.value)


def test_a_bundle_grade_follows_the_ledger_when_the_ledger_changes(tmp_path):
    changed = ASSUMPTIONS.replace("range: [1, 6]\n    unit: analyzers\n    grade: S", "range: [1, 6]\n    unit: analyzers\n    grade: D")
    assert view_of(make_root(tmp_path, ("A001",), bundle="A002", ledger_assumptions=changed))["assumptions"]["A002"]["grade"] == "D"


# ---------- unknown ids and ledger errors ----------
def test_an_id_in_no_ledger_fails_and_names_the_id_and_the_file(tmp_path):
    with pytest.raises(SystemExit) as e:
        view_of(make_root(tmp_path, ("A001", "A999")))
    assert "A999" in str(e.value) and "scenarios/x.json" in str(e.value)


def test_an_unknown_id_in_a_dictionary_fails_and_names_the_dictionary(tmp_path):
    with pytest.raises(SystemExit) as e:
        view_of(make_root(tmp_path, ("A001",), i18n_text='export const en = { "x": "see S777" } as const;\n'))
    assert "S777" in str(e.value) and "src/i18n/en.ts" in str(e.value)


def test_a_ledger_that_does_not_validate_stops_the_generation(tmp_path):
    with pytest.raises(SystemExit) as e:
        view_of(make_root(tmp_path, ("A001",), ledger_assumptions=ASSUMPTIONS.replace("sources: [S001]\n    notes: \"n\"\n  - id: A002", "sources: []\n    notes: \"n\"\n  - id: A002", 1)))
    assert "ledgers do not validate" in str(e.value)


# ---------- the two modes ----------
def test_write_then_check_passes_and_a_ledger_change_is_drift(tmp_path):
    root = make_root(tmp_path, ("A001", "A002"))
    assert ll.main(["--root", str(root), "--check"]) == 1  # no file yet
    assert ll.main(["--root", str(root), "--write"]) == 0
    assert ll.main(["--root", str(root), "--check"]) == 0
    # the infographic rule at work: a source drops below main-reread and the grade-derived chip must follow
    (root / "docs/research/sources.yaml").write_text(SOURCES.replace("verification: main-reread", "verification: agent-read"), encoding="utf-8")
    assert ll.main(["--root", str(root), "--check"]) == 1


def test_check_does_not_write(tmp_path):
    root = make_root(tmp_path, ("A001",))
    ll.main(["--root", str(root), "--check"])
    assert not (root / "src/generated/ledger_view.json").exists()


# ---------- the committed file (the drift test of the brief) ----------
def test_the_committed_view_equals_a_fresh_generation():
    """A grade, range or verification change in a ledger shows up here, in the next check."""
    committed = (REPO / "src/generated/ledger_view.json").read_text(encoding="utf-8")
    assert committed == ll.render(ll.build(REPO)), "run: uv run python scripts/lab_ledger.py --write"


def test_the_committed_view_follows_the_header_of_the_ledger():
    # docs/research/assumptions.yaml: A001 is grade A with no source; A004 is grade S on S017 (main-reread) and S019 (not in the header's list of eleven)
    view = json.loads((REPO / "src/generated/ledger_view.json").read_text(encoding="utf-8"))
    assert view["assumptions"]["A001"] == {"grade": "A", "range": [5, 100], "unit": "reactors", "sources": [], "provisional": False}
    assert view["assumptions"]["A004"]["provisional"] is True
    assert view["sources"]["S017"] == {"verification": "main-reread"}
    assert view["sources"]["S019"]["verification"] != "main-reread"


def test_the_committed_view_names_every_ref_of_the_shipped_files():
    refs: set[str] = set()
    for path in ll.shipped_json(REPO):
        ll.refs_in(json.loads(path.read_text(encoding="utf-8")), refs)
    view = json.loads((REPO / "src/generated/ledger_view.json").read_text(encoding="utf-8"))
    known = set(view["assumptions"]) | set(view["sources"])
    assert refs and refs <= known


# ---------- the bundles of the profile files (no second list of their ids in src/worker) ----------
# Hand-typed from the "bundle ..., grade ..." of each profile file's description and from docs/research/assumptions.yaml (A065 to A073; A066, the mini-scale class, has no profile file yet).
# S3g: A158, the bundle of both event-type profiles of the Break-out screen (profile_contamination_detection, grade A in the ledger), ships with them.
BUNDLE_GRADES = {"A065": "D", "A067": "D", "A068": "A", "A069": "D", "A070": "A", "A071": "A", "A072": "A", "A073": "A", "A158": "A"}


def test_the_committed_view_holds_the_grade_of_the_bundle_of_every_profile_file_the_worker_bundles():
    view = json.loads((REPO / "src/generated/ledger_view.json").read_text(encoding="utf-8"))
    bundles = {}
    for path in ll.shipped_json(REPO):
        doc = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(doc, dict) and "bundle" in doc:
            bundles[doc["bundle"]] = view["assumptions"].get(doc["bundle"], {}).get("grade")
    assert bundles == BUNDLE_GRADES


def test_no_second_list_of_the_bundle_ids_ships_in_src_worker():
    assert not (REPO / "src/worker/profile_bundles.json").exists()


# ---------- the public build and the Break-out screen (lab_ui.md sections 6 and 20; ADR-0013) ----------
# The screen shows the ids of its own files: the `breakout` block (and the horizon setting) of each scenarios/sc12_*.json, every ref of the event-type profiles, and the ids of its dictionaries.
# While any of them follows to a source below main-reread, the public build does not offer the screen. Throwaway ledgers; the real ledgers are never edited.
def make_breakout_root(tmp_path, block_refs=("A001",), other_refs=(), profile_refs=(), i18n_text="", ledger_sources=SOURCES):
    root = make_root(tmp_path, ("A001",), i18n_text="")
    (root / "docs/research/sources.yaml").write_text(ledger_sources, encoding="utf-8")
    param = lambda ref: {"value": 1, "unit": "u", "ref": ref}  # noqa: E731
    sc12 = {"settings": {f"other{i}": param(r) for i, r in enumerate(other_refs)} | {"horizon_days": param("A001")}, "breakout": {"origin": {"contaminated_at": param(block_refs[0])}, "inputs": {f"i{i}": param(r) for i, r in enumerate(block_refs)}}}
    (root / "scenarios/sc12_x.json").write_text(json.dumps(sc12), encoding="utf-8")
    (root / "scenarios/profiles/breakout").mkdir(parents=True)
    (root / "scenarios/profiles/breakout/bact.json").write_text(json.dumps({"bundle": profile_refs[0] if profile_refs else "A001", "params": {f"p{i}": param(r) for i, r in enumerate(profile_refs)}}), encoding="utf-8")
    data_ts = root / "src/worker/data.ts"
    data_ts.write_text(data_ts.read_text(encoding="utf-8") + 'import s from "../../scenarios/sc12_x.json";\nimport p from "../../scenarios/profiles/breakout/bact.json";\n', encoding="utf-8")
    if i18n_text:
        (root / "src/i18n").mkdir(exist_ok=True)
        (root / "src/i18n/en_breakout.ts").write_text(i18n_text, encoding="utf-8")
    return root


def test_the_screen_is_not_public_while_an_id_it_shows_follows_to_a_source_below_main_reread(tmp_path):
    view = view_of(make_breakout_root(tmp_path, block_refs=("A001", "A002")))  # A002 follows to S001 (main-reread) and S002 (snippet)
    assert view["breakout"] == {"ids": ["A001", "A002"], "below_main_reread": ["S002"], "public": False}


def test_a_copy_of_the_ledger_where_those_sources_read_main_reread_makes_the_screen_public(tmp_path):
    reread = SOURCES.replace("verification: snippet", "verification: main-reread")
    view = view_of(make_breakout_root(tmp_path, block_refs=("A001", "A002"), ledger_sources=reread))
    assert view["breakout"] == {"ids": ["A001", "A002"], "below_main_reread": [], "public": True}


def test_an_id_of_a_profile_file_counts(tmp_path):
    view = view_of(make_breakout_root(tmp_path, block_refs=("A001",), profile_refs=("A002",)))
    assert view["breakout"]["public"] is False and view["breakout"]["below_main_reread"] == ["S002"]


def test_an_id_of_a_break_out_dictionary_counts(tmp_path):
    view = view_of(make_breakout_root(tmp_path, block_refs=("A001",), i18n_text='export const enBreakout = { "x": "see A002" } as const;\n'))
    assert view["breakout"]["public"] is False and "A002" in view["breakout"]["ids"]


def test_an_id_that_a_scenario_file_names_outside_the_break_out_block_is_not_an_id_of_the_screen(tmp_path):
    # the process settings of an SC12 scenario are not shown on the screen; the horizon (A189 in the real file) is
    view = view_of(make_breakout_root(tmp_path, block_refs=("A001",), other_refs=("A002",)))
    assert view["breakout"] == {"ids": ["A001"], "below_main_reread": [], "public": True}
    assert "A002" in view["assumptions"]  # the view still holds the id: the Setup pages may show it with a provisional chip


def test_a_grade_a_id_with_no_source_does_not_make_the_screen_provisional(tmp_path):
    assert view_of(make_breakout_root(tmp_path, block_refs=("A003",)))["breakout"]["public"] is True


def test_a_build_with_no_break_out_file_has_nothing_to_refuse(tmp_path):
    assert view_of(make_root(tmp_path, ("A001",)))["breakout"] == {"ids": [], "below_main_reread": [], "public": True}


def test_the_ids_of_the_screen_are_listed_once_in_id_order(tmp_path):
    view = view_of(make_breakout_root(tmp_path, block_refs=("A002", "A001", "A002"), profile_refs=("A001",)))
    assert view["breakout"]["ids"] == ["A001", "A002"]


# the real ledgers: the screen is not public today, and a copy of them where the sources behind it read main-reread makes it public (the real ledgers are not touched)
def real_breakout():
    return json.loads((REPO / "src/generated/ledger_view.json").read_text(encoding="utf-8"))["breakout"]


def test_the_real_screen_is_not_public_today_and_its_ids_include_the_extension_inputs():
    b = real_breakout()
    assert b["public"] is False and b["below_main_reread"]
    # typed from the break-out rows of docs/research/assumptions.yaml: both delays and the topology, the origin instant, the horizon, the mycoplasma inputs and the volumes
    for i in ("A176", "A177", "A157", "A189", "A219", "A220", "A221", "A222", "A223", "A224", "A225", "A226"):
        assert i in b["ids"], i


def test_a_copy_of_the_real_ledgers_with_those_sources_re_read_makes_the_real_screen_public(tmp_path):
    import shutil

    import yaml

    for d in ("docs/research", "scenarios", "src/worker", "src/i18n"):
        shutil.copytree(REPO / d, tmp_path / d)
    sources = yaml.safe_load((tmp_path / "docs/research/sources.yaml").read_text(encoding="utf-8"))
    text = (tmp_path / "docs/research/sources.yaml").read_text(encoding="utf-8")
    assert sources and ll.build(tmp_path)["breakout"]["public"] is False  # the copy starts like the original
    for s in real_breakout()["below_main_reread"]:
        head, _, tail = text.partition(f"- id: {s}\n")
        tail = tail.replace("verification: agent-read", "verification: main-reread", 1).replace("verification: snippet", "verification: main-reread", 1)
        text = head + f"- id: {s}\n" + tail
    (tmp_path / "docs/research/sources.yaml").write_text(text, encoding="utf-8")
    view = ll.build(tmp_path)
    assert view["breakout"]["public"] is True and view["breakout"]["below_main_reread"] == []
    # and the original is untouched
    assert real_breakout()["public"] is False


# the rule as a constant a bundler can fold: the public build drops the Break-out files only through it (src/worker/data.ts)
def test_write_also_writes_the_rule_as_a_typescript_constant(tmp_path):
    root = make_breakout_root(tmp_path, block_refs=("A001", "A002"))
    assert ll.main(["--root", str(root), "--write"]) == 0
    assert "export const BREAKOUT_PUBLIC = false;" in (root / "src/generated/breakout_public.ts").read_text(encoding="utf-8")
    (root / "docs/research/sources.yaml").write_text(SOURCES.replace("verification: snippet", "verification: main-reread"), encoding="utf-8")
    assert ll.main(["--root", str(root), "--check"]) == 1  # the constant (and the view) must follow the ledger
    assert ll.main(["--root", str(root), "--write"]) == 0
    assert "export const BREAKOUT_PUBLIC = true;" in (root / "src/generated/breakout_public.ts").read_text(encoding="utf-8")
    assert ll.main(["--root", str(root), "--check"]) == 0


def test_check_fails_when_only_the_constant_is_stale(tmp_path):
    root = make_breakout_root(tmp_path, block_refs=("A001", "A002"))
    ll.main(["--root", str(root), "--write"])
    (root / "src/generated/breakout_public.ts").write_text("export const BREAKOUT_PUBLIC = true;\n", encoding="utf-8")
    assert ll.main(["--root", str(root), "--check"]) == 1


def test_the_committed_constant_equals_a_fresh_generation_and_the_view():
    committed = (REPO / "src/generated/breakout_public.ts").read_text(encoding="utf-8")
    assert committed == ll.render_public(ll.build(REPO)), "run: uv run python scripts/lab_ledger.py --write"
    assert f"BREAKOUT_PUBLIC = {'true' if real_breakout()['public'] else 'false'};" in committed
