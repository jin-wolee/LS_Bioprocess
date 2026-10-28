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


def test_public_number_must_cite_main_reread_sources(repo):
    ledgers(repo)
    repo.write(".claude/.bootstrap-done", "")
    repo.write("README.md", "a figure (S001)\n")
    assert repo.check("--all").returncode == 0
    repo.write("README.md", "a figure (S002)\n")
    r = repo.check("--all")
    assert r.returncode == 1
    assert "main-reread" in r.stdout


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
