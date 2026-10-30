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


def make_root(tmp_path, scenario_refs=("A001",), i18n_text="", ledger_assumptions=ASSUMPTIONS):
    """A throwaway repo with two tiny ledgers, src/worker/data.ts importing one scenario file, and an optional dictionary."""
    (tmp_path / "docs/research").mkdir(parents=True)
    (tmp_path / "docs/research/sources.yaml").write_text(SOURCES, encoding="utf-8")
    (tmp_path / "docs/research/assumptions.yaml").write_text(ledger_assumptions, encoding="utf-8")
    (tmp_path / "scenarios").mkdir()
    settings = {f"s{i}": {"value": 1, "unit": "u", "ref": ref} for i, ref in enumerate(scenario_refs)}
    (tmp_path / "scenarios/x.json").write_text(json.dumps({"settings": settings, "stability": [{"rate": {"value": 1, "unit": "u", "ref": scenario_refs[0]}}]}), encoding="utf-8")
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
