"""scripts/adr_accept.py against fixture ADR files in a temp dir, plus the recorded review file in the real repo."""
from __future__ import annotations

import json
import sys

import pytest

from helpers import REPO, run

SCRIPT = REPO / "scripts" / "adr_accept.py"
PLACEHOLDER = "_(author only — Claude never writes here)_"
NOTE_1 = 'Decided by the author in a guided review on 2026-10-29: chose "Accept".'
NOTE_2 = 'Decided by the author in a guided review on 2026-10-29: chose "Accept, I commit it".'


def adr(number: str, note_body: str = PLACEHOLDER) -> str:
    return (
        f"# ADR-{number}: Title {number}\n- **Status:** Proposed\n- **Date:** 2026-10-28\n"
        "## Context\n## Options\n## Decision\n## Consequences\n## Evidence\n"
        f"## Decider's note\n\n{note_body}\n"
    )


def index(statuses: dict[str, str]) -> str:
    rows = "".join(f"| [{n}]({n}-x.md) | Title {n} | with | pipes | {s} |\n" for n, s in statuses.items())
    return f"# Architecture decision records\n\n| Number | Title | Status |\n|---|---|---|\n{rows}\nKeep this table in step.\n"


@pytest.fixture
def root(tmp_path):
    (tmp_path / "docs/adr").mkdir(parents=True)
    for n in ("0001", "0002", "0003"):
        (tmp_path / f"docs/adr/{n}-x.md").write_text(adr(n), encoding="utf-8")
    (tmp_path / "docs/adr/README.md").write_text(index({"0001": "Proposed", "0002": "Proposed", "0003": "Proposed"}), encoding="utf-8")
    review = {
        "0001": {"status": "Accepted", "chosen_option": "Accept", "decider_note": NOTE_1},
        "0002": {"status": "Accepted", "chosen_option": "Accept, I commit it", "decider_note": NOTE_2},
    }
    (tmp_path / "review.json").write_text(json.dumps(review), encoding="utf-8")
    return tmp_path


def accept(root, *flags):
    return run([sys.executable, SCRIPT, "--root", root, *flags, root / "review.json"], cwd=REPO)


def snapshot(root):
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


def test_apply_sets_status_note_and_index_row_for_listed_adrs_only(root):
    before = snapshot(root)
    r = accept(root)
    assert r.returncode == 0, r.stderr
    after = snapshot(root)
    first = (root / "docs/adr/0001-x.md").read_text(encoding="utf-8")
    assert first == adr("0001", NOTE_1).replace("**Status:** Proposed", "**Status:** Accepted")
    assert "- **Date:** 2026-10-28\n" in first
    assert NOTE_2 in (root / "docs/adr/0002-x.md").read_text(encoding="utf-8")
    assert after["docs/adr/0003-x.md"] == before["docs/adr/0003-x.md"]
    assert (root / "docs/adr/README.md").read_text(encoding="utf-8") == index({"0001": "Accepted", "0002": "Accepted", "0003": "Proposed"})


def test_dry_run_prints_a_unified_diff_and_writes_nothing(root):
    before = snapshot(root)
    r = accept(root, "--dry-run")
    assert r.returncode == 0, r.stderr
    assert snapshot(root) == before
    for expected in ("--- a/docs/adr/0001-x.md", "+++ b/docs/adr/0001-x.md", "-- **Status:** Proposed", "+- **Status:** Accepted", f"+{NOTE_1}", "+| [0002]"):
        assert expected in r.stdout


def test_running_again_after_success_changes_nothing(root):
    assert accept(root).returncode == 0
    after_first = snapshot(root)
    r = accept(root)
    assert r.returncode == 0, r.stderr
    assert snapshot(root) == after_first
    assert "@@" not in accept(root, "--dry-run").stdout


def test_refuses_to_overwrite_the_authors_own_note_and_writes_nothing(root):
    own = root / "docs/adr/0002-x.md"
    own.write_text(adr("0002", "My own words."), encoding="utf-8")
    before = snapshot(root)
    r = accept(root)
    assert r.returncode != 0
    assert "0002" in r.stderr and "note" in r.stderr
    assert snapshot(root) == before  # all-or-nothing: 0001 is untouched too


@pytest.mark.parametrize("flags", [(), ("--dry-run",)])
def test_missing_adr_file_fails_and_writes_nothing(root, flags):
    (root / "docs/adr/0002-x.md").unlink()
    before = snapshot(root)
    r = accept(root, *flags)
    assert r.returncode != 0
    assert "0002" in r.stderr
    assert snapshot(root) == before


def test_missing_placeholder_fails(root):
    (root / "docs/adr/0001-x.md").write_text(adr("0001", ""), encoding="utf-8")
    r = accept(root)
    assert r.returncode != 0
    assert "0001" in r.stderr


def test_missing_index_row_fails_and_writes_nothing(root):
    (root / "docs/adr/README.md").write_text(index({"0001": "Proposed", "0003": "Proposed"}), encoding="utf-8")
    before = snapshot(root)
    r = accept(root)
    assert r.returncode != 0
    assert "0002" in r.stderr
    assert snapshot(root) == before


def test_recorded_review_file_covers_adr_0001_to_0014_with_the_authors_labels():
    review = json.loads((REPO / "docs/adr/review_2026-10-29.json").read_text(encoding="utf-8"))
    assert list(review) == [f"{n:04d}" for n in range(1, 15)]
    for number, entry in review.items():
        assert entry["status"] == "Accepted"
        expected = f'Decided by the author in a guided review on 2026-10-29: chose "{entry["chosen_option"]}".'
        if number == "0013":
            expected += " Break-out events move to session S3; cell-line and operating-mode profiles stay in S4."
        assert entry["decider_note"] == expected
    assert review["0002"]["chosen_option"] == "수락 — 반영은 내가 직접 커밋 (Recommended)"
    assert review["0008"]["chosen_option"] == "코드 MIT + 문서 CC BY 4.0 (Recommended)"
    assert review["0013"]["chosen_option"] == "break-out을 앞당김(S3)"
    assert {e["chosen_option"] for n, e in review.items() if n not in ("0002", "0008", "0013")} == {"수락 (Recommended)"}


def test_real_repo_dry_run_matches_every_adr_file_and_index_row():
    r = run([sys.executable, SCRIPT, "--dry-run"], cwd=REPO)
    assert r.returncode == 0, r.stderr
