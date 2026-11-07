"""C3: `qa_plant.py --retry-failed 1` runs each failed check once more after the others and keeps the first failure beside the second verdict; a check that fails twice still fails."""
from __future__ import annotations

import sys

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts" / "qa"))
from qa_checks import Result  # noqa: E402
from qa_plant import run_checks  # noqa: E402


def check(name: str, verdicts: list[bool], calls: list[str]):
    """A fake check that gives the next verdict of the list on each call and records the call."""
    def fn() -> Result:
        calls.append(name)
        ok = verdicts.pop(0)
        return Result(name, ok, f"{name} {'ok' if ok else 'timed out'}")
    return name, fn


def test_without_retries_each_check_runs_once_and_a_failure_stays():
    calls: list[str] = []
    results = run_checks([check("a", [True], calls), check("b", [False, True], calls)])
    assert calls == ["a", "b"]
    assert [(r.name, r.ok) for r in results] == [("a", True), ("b", False)]


def test_a_failed_check_runs_once_more_after_the_others_and_says_so_when_it_passes():
    calls: list[str] = []
    results = run_checks([check("a", [False, True], calls), check("b", [True], calls)], retries=1)
    assert calls == ["a", "b", "a"]  # the second try comes after every check has run once
    assert [r.ok for r in results] == [True, True]
    assert "[passed on the second try; the first try: a timed out]" in results[0].detail


def test_a_check_that_fails_twice_still_fails_with_both_tries_in_its_detail():
    calls: list[str] = []
    results = run_checks([check("a", [False, False], calls)], retries=1)
    assert calls == ["a", "a"]
    assert not results[0].ok
    assert results[0].detail.startswith("a timed out [failed twice; the first try: a timed out]")


def test_a_check_that_passed_is_never_run_again():
    calls: list[str] = []
    run_checks([check("a", [True], calls), check("b", [True], calls)], retries=1)
    assert calls == ["a", "b"]


def test_recovered_check_is_reported_as_flaky_without_changing_success(tmp_path):
    import json
    from qa_plant import report

    calls: list[str] = []
    result = run_checks([check("a", [False, True], calls)], retries=1)[0]
    assert result.ok
    assert result.data["qa_retry"]["flaky"] is True
    assert result.data["qa_retry"]["first_detail"] == "a timed out"
    assert "FLAKY" in report([result], tmp_path)
    assert "FLAKY" in (tmp_path / "summary.md").read_text()
    assert json.loads((tmp_path / "results.json").read_text())[0]["data"]["qa_retry"]["flaky"] is True


def test_failed_retry_is_not_reported_as_flaky(tmp_path):
    from qa_plant import report

    calls: list[str] = []
    result = run_checks([check("a", [False, False], calls)], retries=1)[0]
    assert not result.ok
    assert "FAIL" in report([result], tmp_path)
    assert "FLAKY" not in (tmp_path / "summary.md").read_text()


def test_report_uses_shared_verdicts_totals_and_preserves_failure_lines(tmp_path):
    from qa_plant import report

    results = [Result("ok", True, "ok"), Result("omitted", True, "skipped", {"skipped": True}),
               Result("recover", True, "passed retry", {"qa_retry": {"flaky": True}}), Result("bad", False, "reason")]
    output = report(results, tmp_path)
    assert "SKIP" in output and "FLAKY" in output
    assert "PASS 1" in output and "SKIP 1" in output and "FLAKY 1" in output and "FAIL 1" in output
    assert "FAIL  qa_plant bad: reason" in output
