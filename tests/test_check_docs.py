"""scripts/check_docs.py in every mode, against a throwaway git repo (see conftest.repo)."""
from __future__ import annotations

import pytest

from helpers import BANNED

ADR = """# ADR-0003: Title text
- **Status:** Proposed
- **Date:** 2026-10-28
## Context
## Options
## Decision
## Consequences
## Evidence
## Decider's note
_(author only — Claude never writes here)_
"""

SOURCES = """sources:
  - id: S001
    title: A main-reread source
    publisher: Publisher
    url: https://example.org/a
    accessed: 2026-10-28
    type: paper
    supports: something
    verification: main-reread
    used_in: []
  - id: S002
    title: A snippet-only source
    publisher: Publisher
    url: https://example.org/b
    accessed: 2026-10-28
    type: web
    supports: something else
    verification: snippet
    used_in: []
"""

ASSUMPTIONS = """assumptions:
  - id: A001
    name: Analyzer turnaround
    default: 30
    range: [20, 40]
    unit: min
    grade: P
    sources: [S001]
    notes: none
"""

UNKNOWN_S = "S" + "999"
UNKNOWN_A = "A" + "999"


def ledgers(repo, sources=SOURCES, assumptions=ASSUMPTIONS):
    repo.write("docs/research/sources.yaml", sources)
    repo.write("docs/research/assumptions.yaml", assumptions)


# ---------- banned tokens ----------
@pytest.mark.parametrize("tracked", [True, False])
def test_all_flags_banned_token(repo, tracked):
    repo.write("notes.md", f"contains {BANNED.upper()} here\n")
    if tracked:
        repo.git("add", "notes.md")
    r = repo.check("--all")
    assert r.returncode == 1
    assert "notes.md" in r.stdout


def test_all_passes_on_clean_repo(repo):
    repo.write("notes.md", "nothing to see\n")
    assert repo.check("--all").returncode == 0


def test_all_ignores_gitignored_private_files(repo):
    repo.write("docs/private/raw.md", f"{BANNED}\n")
    assert repo.check("--all").returncode == 0


def test_missing_guardrail_list_fails_instead_of_passing(repo):
    (repo.root / ".guardrails.local.txt").unlink()
    assert repo.check("--all").returncode == 1
    hook = repo.check("--hook", stdin='{"tool_name":"Write","tool_input":{"file_path":"x"}}')
    assert hook.returncode == 2


def test_terms_can_come_from_environment(repo):
    (repo.root / ".guardrails.local.txt").unlink()
    repo.write("notes.md", f"{BANNED}\n")
    assert repo.check("--all", env={"GUARDRAIL_TERMS": f"{BANNED}\n"}).returncode == 1


# ---------- --hook ----------
def test_hook_blocks_banned_token_and_marks_dirty(repo):
    p = repo.write("notes.md", f"{BANNED}\n")
    r = repo.hook(p)
    assert r.returncode == 2
    assert "banned" in r.stderr
    assert (repo.root / ".claude/.dirty").exists()


def test_hook_skips_ignored_paths(repo):
    p = repo.write("docs/private/raw.md", f"{BANNED}\n")
    assert repo.hook(p).returncode == 0


def test_hook_skips_paths_outside_the_repo(repo, tmp_path):
    outside = tmp_path / "outside.md"
    outside.write_text(f"{BANNED}\n", encoding="utf-8")
    assert repo.hook(outside).returncode == 0


def test_hook_checks_adr_format(repo):
    p = repo.write("docs/adr/0003-title-text.md", ADR.replace("## Evidence\n", ""))
    assert repo.hook(p).returncode == 2


# ---------- ADR ----------
def test_valid_adr_passes(repo):
    repo.write("docs/adr/0003-title-text.md", ADR)
    assert repo.check("--all").returncode == 0


def test_adr_template_is_exempt(repo):
    repo.write("docs/adr/0000-template.md", "# ADR-NNNN: <title>\nfree-form\n")
    assert repo.check("--all").returncode == 0


@pytest.mark.parametrize(
    "text",
    [
        ADR.replace("Proposed", "Maybe"),
        ADR.replace("## Evidence\n", ""),
        ADR.replace("# ADR-0003:", "# ADR-0004:"),
        ADR.replace("- **Date:** 2026-10-28\n", ""),
    ],
    ids=["bad-status", "missing-section", "number-mismatch", "missing-date"],
)
def test_invalid_adr_fails(repo, text):
    repo.write("docs/adr/0003-title-text.md", text)
    assert repo.check("--all").returncode == 1


def test_adr_file_name_must_be_numbered_kebab(repo):
    repo.write("docs/adr/3_Title.md", ADR)
    assert repo.check("--all").returncode == 1


def test_accepted_adr_with_empty_note_warns_and_fails_only_in_ci(repo):
    repo.write("docs/adr/0003-title-text.md", ADR.replace("Proposed", "Accepted"))
    plain = repo.check("--all")
    assert plain.returncode == 0
    assert "WARN" in plain.stdout
    assert repo.check("--all", "--ci").returncode == 1


# ---------- ledgers ----------
def test_valid_ledgers_pass(repo):
    ledgers(repo)
    assert repo.check("--all").returncode == 0


@pytest.mark.parametrize(
    "sources",
    [
        SOURCES.replace("    url: https://example.org/a\n", ""),
        SOURCES.replace("verification: main-reread", "verification: guess"),
        SOURCES.replace("accessed: 2026-10-28", "accessed: 28/10/2026", 1),
        SOURCES.replace("id: S002", "id: S001"),
        SOURCES.replace("id: S002", "id: SX2"),
    ],
    ids=["missing-url", "bad-verification", "bad-date", "duplicate-id", "bad-id"],
)
def test_sources_schema_errors_fail(repo, sources):
    ledgers(repo, sources=sources)
    assert repo.check("--all").returncode == 1


@pytest.mark.parametrize(
    "assumptions",
    [
        ASSUMPTIONS.replace("sources: [S001]", "sources: []"),
        ASSUMPTIONS.replace("sources: [S001]", f"sources: [{UNKNOWN_S}]"),
        ASSUMPTIONS.replace("grade: P", "grade: X"),
        ASSUMPTIONS.replace("id: A001", "id: B001"),
        ASSUMPTIONS.replace("    name: Analyzer turnaround\n", ""),
    ],
    ids=["grade-needs-source", "unknown-source", "bad-grade", "bad-id", "missing-name"],
)
def test_assumptions_schema_errors_fail(repo, assumptions):
    ledgers(repo, assumptions=assumptions)
    assert repo.check("--all").returncode == 1


def test_grade_a_assumption_needs_no_source(repo):
    ledgers(repo, assumptions=ASSUMPTIONS.replace("grade: P", "grade: A").replace("sources: [S001]", "sources: []"))
    assert repo.check("--all").returncode == 0


# ---------- ledger schema: range / unit / components / range_grade ----------
def entry(aid, grade="S", sources="[S001]", rng="[1, 2]", unit="min", notes="plain", extra=""):
    lines = [f"  - id: {aid}", f"    name: thing_{aid.lower()}", "    default: 1", f"    grade: {grade}", f"    sources: {sources}"]
    if rng is not None:
        lines.append(f"    range: {rng}")
    if unit is not None:
        lines.append(f"    unit: {unit}")
    if notes is not None:
        lines.append(f'    notes: "{notes}"')
    return "\n".join(lines) + "\n" + extra


def ledger(*entries):
    return "assumptions:\n" + "".join(entries)


def bundle(bundle_grade, *, member_grades=("S", "D"), components=None):
    """A001, A002 (...) are the members; A009 is the bundle built from them."""
    members = [entry(f"A00{i + 1}", grade=g) for i, g in enumerate(member_grades)]
    ids = components or ", ".join(f"A00{i + 1}" for i in range(len(member_grades)))
    return ledger(*members, entry("A009", grade=bundle_grade, extra=f"    components: [{ids}]\n"))


@pytest.mark.parametrize(
    "assumptions",
    [
        ledger(entry("A001", rng=None)),
        ledger(entry("A001", unit=None)),
        ledger(entry("A001", rng="n/a", notes=None)),
        ledger(entry("A001", rng="null", notes=None)),
        ledger(entry("A001", unit="n/a", notes="")),
        ledger(entry("A001", unit="null", notes="  ")),
    ],
    ids=["no-range-key", "no-unit-key", "range-na-unexplained", "range-null-unexplained", "unit-na-empty-notes", "unit-null-blank-notes"],
)
def test_range_and_unit_are_required(repo, assumptions):
    ledgers(repo, assumptions=assumptions)
    r = repo.check("--all")
    assert r.returncode == 1
    assert "A001" in r.stdout


@pytest.mark.parametrize("empty", ["n/a", "null"])
def test_na_or_null_range_and_unit_are_allowed_when_notes_explain(repo, empty):
    ledgers(repo, assumptions=ledger(entry("A001", rng=empty, unit=empty, notes="Rule, so no range or unit applies")))
    assert repo.check("--all").returncode == 0


@pytest.mark.parametrize(
    "bundle_grade, member_grades",
    [("D", ("S", "D")), ("A", ("S", "A")), ("P", ("S", "P", "S")), ("S", ("S", "S"))],
    ids=["S+D->D", "S+A->A", "S+P+S->P", "S+S->S"],
)
def test_bundle_grade_equals_weakest_component(repo, bundle_grade, member_grades):
    ledgers(repo, assumptions=bundle(bundle_grade, member_grades=member_grades))
    assert repo.check("--all").returncode == 0


@pytest.mark.parametrize(
    "bundle_grade, member_grades",
    [("S", ("S", "D")), ("P", ("S", "D")), ("D", ("S", "A")), ("S", ("S", "P"))],
    ids=["S-over-D", "P-over-D", "D-over-A", "S-over-P"],
)
def test_bundle_grade_stronger_than_weakest_component_fails(repo, bundle_grade, member_grades):
    ledgers(repo, assumptions=bundle(bundle_grade, member_grades=member_grades))
    r = repo.check("--all")
    assert r.returncode == 1
    assert "A009" in r.stdout and "weakest" in r.stdout


def test_bundle_grade_weaker_than_weakest_component_fails(repo):
    ledgers(repo, assumptions=bundle("A", member_grades=("S", "D")))
    assert repo.check("--all").returncode == 1


def test_unknown_component_id_fails(repo):
    ledgers(repo, assumptions=bundle("D", components="A001, A002, A777"))
    r = repo.check("--all")
    assert r.returncode == 1
    assert "A777" in r.stdout


def test_component_may_be_defined_after_the_bundle(repo):
    first = entry("A009", grade="D", extra="    components: [A001, A002]\n")
    ledgers(repo, assumptions=ledger(first, entry("A001", grade="S"), entry("A002", grade="D")))
    assert repo.check("--all").returncode == 0


@pytest.mark.parametrize("grade, ok", [("S", True), ("P", True), ("D", True), ("A", True), ("X", False), ("s", False)])
def test_range_grade_is_optional_but_must_be_a_grade(repo, grade, ok):
    ledgers(repo, assumptions=ledger(entry("A001", extra=f"    range_grade: {grade}\n")))
    assert (repo.check("--all").returncode == 0) is ok


def test_range_grade_may_be_omitted(repo):
    ledgers(repo, assumptions=ledger(entry("A001")))
    assert repo.check("--all").returncode == 0


# ---------- ID references ----------
def test_unknown_reference_fails_only_after_bootstrap(repo):
    ledgers(repo)
    repo.write("docs/design/notes.md", f"value {UNKNOWN_S} and {UNKNOWN_A}\n")
    assert repo.check("--all").returncode == 0
    assert repo.check("--all", "--ci").returncode == 1
    repo.write(".claude/.bootstrap-done", "")
    r = repo.check("--all")
    assert r.returncode == 1
    assert UNKNOWN_S in r.stdout and UNKNOWN_A in r.stdout


def test_known_references_pass_after_bootstrap(repo):
    ledgers(repo)
    repo.write(".claude/.bootstrap-done", "")
    repo.write("docs/design/notes.md", "turnaround A001 from S001 and S002\n")
    assert repo.check("--all").returncode == 0


GATED = ["README.md", "docs/research/README.md", "infographic/index.html"]


def gated(repo, rel, text, assumptions=ASSUMPTIONS):
    ledgers(repo, assumptions=assumptions)
    repo.write(".claude/.bootstrap-done", "")
    repo.write(rel, text)
    return repo.check("--all")


@pytest.mark.parametrize("rel", GATED)
def test_public_number_must_cite_main_reread_sources(repo, rel):
    assert gated(repo, rel, "a figure (S001)\n").returncode == 0
    r = gated(repo, rel, "a figure (S002)\n")
    assert r.returncode == 1
    assert rel in r.stdout and "S002" in r.stdout and "main-reread" in r.stdout


@pytest.mark.parametrize("label", ["provisional", "Provisional", "PROVISIONAL figure"])
def test_provisional_on_the_same_line_allows_an_unverified_source(repo, label):
    assert gated(repo, "README.md", f"about 30 min (S002), {label}\n").returncode == 0


def test_provisional_on_another_line_does_not_help(repo):
    r = gated(repo, "README.md", "provisional\nabout 30 min (S002)\n")
    assert r.returncode == 1
    assert "S002" in r.stdout


def test_provisional_label_covers_only_its_own_line(repo):
    r = gated(repo, "README.md", "ok (S002) provisional\nnot ok (S002)\n")
    assert r.returncode == 1
    assert r.stdout.count("S002") == 1


def test_assumption_citation_follows_its_sources(repo):
    snippet_backed = ASSUMPTIONS.replace("sources: [S001]", "sources: [S002]")
    assert gated(repo, "README.md", "turnaround (A001)\n").returncode == 0
    r = gated(repo, "README.md", "turnaround (A001)\n", assumptions=snippet_backed)
    assert r.returncode == 1
    assert "README.md" in r.stdout and "A001" in r.stdout and "S002" in r.stdout and "main-reread" in r.stdout


def test_provisional_also_covers_an_assumption_citation(repo):
    snippet_backed = ASSUMPTIONS.replace("sources: [S001]", "sources: [S002]")
    assert gated(repo, "README.md", "turnaround (A001), provisional\n", assumptions=snippet_backed).returncode == 0


def test_one_unverified_source_of_several_fails_the_assumption(repo):
    mixed = ASSUMPTIONS.replace("sources: [S001]", "sources: [S001, S002]")
    assert gated(repo, "README.md", "turnaround (A001)\n", assumptions=mixed).returncode == 1


def test_grade_a_assumption_without_sources_is_allowed_in_public_files(repo):
    unsourced = ASSUMPTIONS.replace("grade: P", "grade: A").replace("sources: [S001]", "sources: []")
    assert gated(repo, "README.md", "assumed turnaround (A001)\n", assumptions=unsourced).returncode == 0


def test_files_outside_the_public_list_may_cite_unverified_sources(repo):
    assert gated(repo, "docs/design/notes.md", "a figure (S002) and A001\n").returncode == 0


def test_tests_directory_may_use_fixture_ids(repo):
    ledgers(repo)
    repo.write(".claude/.bootstrap-done", "")
    repo.write("tests/test_fixture.py", f'ID = "{UNKNOWN_S}"\n')
    assert repo.check("--all").returncode == 0


# ---------- --staged / --history ----------
def test_staged_refuses_private_path(repo):
    repo.write("docs/private/x.md", "harmless\n")
    repo.git("add", "-f", "docs/private/x.md")
    r = repo.check("--staged")
    assert r.returncode == 1
    assert "private" in r.stderr


def test_staged_refuses_banned_token(repo):
    repo.write("notes.md", f"{BANNED}\n")
    repo.git("add", "notes.md")
    assert repo.check("--staged").returncode == 1


def test_staged_passes_clean_changes(repo):
    repo.write("notes.md", "fine\n")
    repo.git("add", "notes.md")
    assert repo.check("--staged").returncode == 0


def test_history_catches_a_token_that_was_later_removed(repo):
    repo.write("notes.md", "fine\n")
    assert repo.commit("clean").returncode == 0
    assert repo.check("--history").returncode == 0
    repo.write("notes.md", f"{BANNED}\n")
    repo.commit("leak")
    repo.write("notes.md", "fine again\n")
    repo.commit("fix")
    r = repo.check("--history")
    assert r.returncode == 1
    assert "history" in r.stderr


def test_history_catches_a_private_path(repo):
    repo.write("docs/private/x.md", "harmless\n")
    repo.git("add", "-f", "docs/private/x.md")
    repo.commit("oops")
    assert repo.check("--history").returncode == 1
