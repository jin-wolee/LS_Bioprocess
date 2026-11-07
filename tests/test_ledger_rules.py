"""Cross-references in the source and assumption ledgers."""
from __future__ import annotations

import sys

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts"))
from ledger_rules import load_ledgers  # noqa: E402


SOURCE = """sources:
  - id: S001
    title: Title
    publisher: Publisher
    url: https://example.org
    accessed: 2026-01-01
    type: paper
    supports: A claim
    verification: snippet
    used_in: [A001]
"""
ASSUMPTION = """assumptions:
  - id: A001
    name: Example
    default: 1
    range: [0, 2]
    unit: count
    grade: S
    sources: [S001]
    notes: Based on S001.
"""


def errors_at(tmp_path, sources=SOURCE, assumptions=ASSUMPTION):
    directory = tmp_path / "docs/research"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "sources.yaml").write_text(sources, encoding="utf-8")
    (directory / "assumptions.yaml").write_text(assumptions, encoding="utf-8")
    return load_ledgers(tmp_path)[2]


def test_dead_ids_in_notes_and_used_in_are_reported(tmp_path):
    errors = errors_at(tmp_path, SOURCE.replace("[A001]", "[A001, A999]"), ASSUMPTION.replace("Based on S001.", "Based on S999 and A998."))
    assert all(any(ref in error for error in errors) for ref in ("A999", "S999", "A998"))


def test_source_and_assumption_references_must_agree_both_ways(tmp_path):
    assert errors_at(tmp_path) == []
    missing = errors_at(tmp_path, SOURCE.replace("[A001]", "[]"))
    assert any("S001" in e and "A001" in e and "used_in" in e for e in missing)
    extra = errors_at(tmp_path, assumptions=ASSUMPTION.replace("grade: S", "grade: A").replace("[S001]", "[]"))
    assert any("S001" in e and "A001" in e and "sources" in e for e in extra)


def test_used_in_rejects_non_ids_and_cited_in_accepts_readme(tmp_path):
    bad = errors_at(tmp_path, SOURCE.replace("[A001]", "[A001, README]"))
    assert any("README" in e and "used_in" in e for e in bad)
    assert errors_at(tmp_path, SOURCE + "    cited_in: [README]\n") == []


def test_source_prose_and_malformed_used_in_are_checked(tmp_path):
    source = SOURCE.replace("supports: A claim", "supports: See S999 and A998").replace("used_in: [A001]", "used_in: A001")
    errors = errors_at(tmp_path, source)
    assert all(any(ref in error for error in errors) for ref in ("S999", "A998", "used_in"))


# R3/R4b: references are checked independently, including Korean prose.
def test_korean_particles_and_unicode_codepoints():
    from ledger_rules import ID_RE

    assert ID_RE.findall("A001은 S002와 A999는") == ["A001", "S002", "A999"]
    assert ID_RE.findall("U+A720 U+A720-A721 U+0A720-A721") == []
    assert ID_RE.findall("prefixA001 A001suffix A0012") == []


def test_unknown_korean_reference_fails_even_if_labeled():
    from ledger_rules import check_references

    errors = check_references("README.ko.md", "A999는 (provisional)", {}, {})
    assert any("unknown A999" in error for error in errors)


def test_public_gate_covers_nested_design_and_adr_files():
    from ledger_rules import check_references

    sources = {"S001": {"verification": "snippet"}}
    for path in ("docs/design/deep/page.md", "docs/adr/nested/decision.md"):
        assert any("S001" in e and "not main-reread" in e for e in check_references(path, "See S001.", sources, {}))
    assert check_references("docs/designated/page.md", "See S001.", sources, {}) == []


def test_only_each_adjacent_label_exempts_its_reference():
    from ledger_rules import check_references

    sources = {"S001": {"verification": "snippet"}, "S002": {"verification": "agent-read"}}
    text = "S001 (provisional); S002 is unsupported; a provisional note elsewhere."
    errors = check_references("docs/design/spec.md", text, sources, {})
    assert len(errors) == 1 and "S002" in errors[0]
    errors = check_references("docs/design/spec.md", "S001 (provisional); S001 is unsupported.", sources, {})
    assert len(errors) == 1 and "S001" in errors[0]
    assert check_references("docs/design/spec.md", "S001 (provisional); S002 (provisional)", sources, {}) == []


def test_adjacent_label_forms_korean_and_unrelated_words():
    from ledger_rules import check_references

    sources = {"S001": {"verification": "snippet"}}
    for text in ("(S001) provisional", "(S001, provisional)", "`S001` (provisional)", "S001은 (provisional)"):
        assert check_references("README.md", text, sources, {}) == [], text
    for text in ("provisional context: S001", "S001 is unrelated to provisional status", "S001 (not provisional)"):
        assert check_references("README.md", text, sources, {}), text


def test_public_gate_follows_assumptions_and_allows_main_reread_or_sourceless():
    from ledger_rules import check_references

    sources = {"S001": {"verification": "snippet"}, "S002": {"verification": "main-reread"}}
    assumptions = {"A001": {"sources": ["S001"]}, "A002": {"sources": ["S002"]}, "A003": {"sources": []}}
    errors = check_references("docs/adr/decision.md", "A001과 A002 그리고 A003", sources, assumptions)
    assert len(errors) == 1 and "A001" in errors[0] and "S001" in errors[0]


def test_structured_yaml_comment_labels_only_listed_ids_on_its_line():
    from ledger_rules import check_references

    sources = {"S001": {"verification": "snippet"}, "S002": {"verification": "snippet"}}
    path = "docs/design/dictionary.yaml"
    text = 'entry: {source: S001, other: S002} # provisional: S001\n'
    errors = check_references(path, text, sources, {})
    assert len(errors) == 1 and "S002" in errors[0]
    assert check_references(path, 'value: "S001 # provisional: S001"\n', sources, {})
    assert check_references(path, "entry: S001 # provisional: S999\n", sources, {})


def test_html_citation_labels_are_per_id_and_per_element():
    from ledger_rules import check_references

    sources = {"S001": {"verification": "snippet"}, "S002": {"verification": "snippet"}}
    path = "site/infographic/index.html"
    text = '<p data-src="S001 S002" data-status="provisional" data-provisional-refs="S001">text</p>'
    errors = check_references(path, text, sources, {})
    assert len(errors) == 1 and "S002" in errors[0]
    separate = '<p data-src="S001" data-status="provisional" data-provisional-refs="S001"></p><p data-src="S002"></p>'
    assert len(check_references(path, separate, sources, {})) == 1
    assert check_references(path, '<p data-src="S001" data-provisional-refs="S001"></p>', sources, {})
    assert check_references(path, '<p data-src="S001" data-status="provisional" data-provisional-refs="S999"></p>', sources, {})


def test_r5_default_load_uses_only_the_actual_sampling_defaults():
    import yaml

    assumptions = {a["id"]: a for a in yaml.safe_load((REPO / "docs/research/assumptions.yaml").read_text())["assumptions"]}
    assert assumptions["A001"]["default"].startswith("24 reactors")
    daily = 24 * (assumptions["A014"]["default"] + assumptions["A015"]["default"])
    minutes = daily * assumptions["A023"]["default"]
    assert round(daily, 1) == 38.4
    assert round(minutes, 1) == 172.8
    assert assumptions["A074"]["default"] == 14.4
    assert assumptions["A074"]["range"] == [14.4, 14.4]
    body = (REPO / "site/infographic/src/body.html").read_text()
    korean = (REPO / "site/infographic/src/i18n.js").read_text()
    load = next(line for line in body.splitlines() if 'data-i18n="c.load"' in line)
    translation = next(line for line in korean.splitlines() if line.startswith('"c.load"'))
    assert '1.4' not in load and '33.6' not in load and '1.6' in load and '38.4' in load
    assert '1.4' not in translation and '33.6' not in translation and '1.6' in translation and '38.4' in translation
    assert all(ref in load for ref in ('A014', 'A015'))


def test_r5_ledger_notes_distinguish_source_scope_and_manual_column():
    import yaml

    assumptions = {a["id"]: a for a in yaml.safe_load((REPO / "docs/research/assumptions.yaml").read_text())["assumptions"]}
    sources = {s["id"]: s for s in yaml.safe_load((REPO / "docs/research/sources.yaml").read_text())["sources"]}
    assert 'combines' in assumptions['A005']['notes'] and '200 L' in assumptions['A005']['notes'] and '1000-3000 L' in assumptions['A005']['notes']
    research = (REPO / 'docs/research/README.md').read_text()
    assert '2-4 d at 200 L and 3-5 d at 1000-3000 L' in research
    assert 'DOE' in assumptions['A007']['notes'] and '0.7' in assumptions['A007']['notes']
    assert '5.1' in assumptions['A049']['notes'] and '6.13' in assumptions['A049']['notes'] and 'must' not in assumptions['A049']['notes']
    assert 'with Osm48' in sources['S003']['supports'] and '275 uL' in sources['S003']['supports']
    assert sources['S003']['verification'] == 'agent-read'
