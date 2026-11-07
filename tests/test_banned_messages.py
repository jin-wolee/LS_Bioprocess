"""A banned-token hit says where and which list item, never the term.

The list is private (.guardrails.local.txt, or the CI secret GUARDRAIL_TERMS), and once the repository is public
its Actions logs are public too. Every test uses made-up terms; none of them is in a real list.
"""
from __future__ import annotations

import pytest

from helpers import REPO, run

ALPHA, BETA, GAMMA = "zzbannedtermalpha", "zzbannedtermbeta", "zzbannedtermgamma"
TERMS = (ALPHA, BETA, GAMMA)
# comment and blank lines are not items: alpha is item 1, beta item 2, gamma item 3
LIST = f"# local list\n\n{ALPHA}\n# a comment between terms\n{BETA}\n\n{GAMMA}\n"
NOTE = "(see .guardrails.local.txt or GUARDRAIL_TERMS; the terms are not printed)"
UV_ENV = {"UV_PROJECT_ENVIRONMENT": str(REPO / ".venv")}  # reuse the project env instead of building one per test

# line 2 holds alpha; line 4 holds beta and gamma (upper case: the match ignores case); line 5 is clean
NOTES = f"first line is clean\nsays {ALPHA}\nalso clean\n{BETA.upper()} and {GAMMA}\nlast line\n"


@pytest.fixture
def listed(repo):
    repo.write(".guardrails.local.txt", LIST)
    return repo


def assert_no_term(*outputs: str) -> None:
    for out in outputs:
        for term in TERMS:
            assert term not in out.lower()


def assert_reports_notes(out: str) -> None:
    assert f"notes.md:2: banned token(s): list item 1 {NOTE}" in out
    assert f"notes.md:4: banned token(s): list item 2, 3 {NOTE}" in out
    assert "notes.md:1:" not in out and "notes.md:3:" not in out and "notes.md:5:" not in out


# ---------- --all, --ci ----------
@pytest.mark.parametrize("flags", [("--all",), ("--all", "--ci")])
def test_all_reports_file_line_and_item_but_not_the_term(listed, flags):
    listed.write("notes.md", NOTES)
    r = listed.check(*flags, env={"GUARDRAIL_TERMS": LIST} if "--ci" in flags else None)
    assert r.returncode == 1
    assert_reports_notes(r.stdout)
    assert_no_term(r.stdout, r.stderr)


@pytest.mark.parametrize("flags", [("--all",), ("--all", "--ci")])
def test_all_numbers_the_items_of_the_secret_the_same_way(listed, flags):
    # the Pages job has no list file, only the secret; blank and comment lines are not items there either
    (listed.root / ".guardrails.local.txt").unlink()
    listed.write("notes.md", NOTES)
    r = listed.check(*flags, env={"GUARDRAIL_TERMS": LIST})
    assert r.returncode == 1
    if "--ci" in flags:
        assert_reports_notes(r.stdout)
    else:
        assert "no banned-token list" in r.stderr
        assert not r.stdout  # a local check cannot silently substitute a CI secret for its file
    assert_no_term(r.stdout, r.stderr)


def test_all_still_passes_a_clean_repo_with_the_list(listed):
    listed.write("notes.md", "nothing to see\n")
    r = listed.check("--all")
    assert r.returncode == 0
    assert_no_term(r.stdout, r.stderr)


# ---------- --hook ----------
def test_hook_reports_file_line_and_item_but_not_the_term(listed):
    p = listed.write("notes.md", NOTES)
    r = listed.hook(p)
    assert r.returncode == 2
    assert_reports_notes(r.stderr)
    assert_no_term(r.stdout, r.stderr)


# ---------- --staged and the pre-commit hook ----------
def test_staged_reports_file_line_and_item_but_not_the_term(listed):
    listed.write("notes.md", NOTES)
    listed.git("add", "notes.md")
    r = listed.check("--staged")
    assert r.returncode == 1
    assert_reports_notes(r.stderr)
    assert_no_term(r.stdout, r.stderr)


def test_pre_commit_reports_file_line_and_item_but_not_the_term(listed):
    listed.git("config", "core.hooksPath", "scripts/git-hooks")
    listed.write("notes.md", NOTES)
    r = listed.commit("leak", env=UV_ENV)
    assert r.returncode != 0
    assert_reports_notes(r.stderr)
    assert_no_term(r.stdout, r.stderr)


# ---------- --history and the pre-push hook ----------
def leak_history(repo) -> None:
    repo.write("notes.md", "fine\n")
    repo.commit("clean")
    repo.write("notes.md", f"{BETA}\n")
    repo.commit("leak")
    repo.write("notes.md", "fine again\n")
    repo.commit(f"mentions {GAMMA} in the message")


def test_history_reports_the_items_but_not_the_term(listed):
    leak_history(listed)
    r = listed.check("--history")
    assert r.returncode == 1
    assert f"banned token(s): list item 2, 3 {NOTE}" in r.stderr
    assert_no_term(r.stdout, r.stderr)


def test_pre_push_prints_no_term(listed):
    leak_history(listed)  # committed before the hooks are on, as an earlier leak would have been
    listed.git("config", "core.hooksPath", "scripts/git-hooks")
    r = run(["scripts/git-hooks/pre-push", "origin", "url"], cwd=listed.root, stdin="", env={**UV_ENV, "ALLOW_PUSH": "1"})
    assert r.returncode != 0
    assert "list item 2, 3" in r.stderr
    assert_no_term(r.stdout, r.stderr)
