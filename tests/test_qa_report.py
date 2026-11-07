"""Verdicts for the existing QA result shape and their presentation."""
from __future__ import annotations

import json
import sys

import pytest

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts" / "qa"))
from qa_checks import Result  # noqa: E402
import qa_report  # noqa: E402


@pytest.mark.parametrize(
    ("ok", "data", "expected"),
    [
        (False, {}, "FAIL"),
        (False, {"skipped": True, "qa_retry": {"flaky": True}}, "FAIL"),
        (True, {"skipped": True}, "SKIP"),
        (True, {"skipped": True, "qa_retry": {"flaky": True}}, "SKIP"),
        (True, {"qa_retry": {"flaky": True}}, "FLAKY"),
        (True, {"skipped": False, "qa_retry": {"flaky": False}}, "PASS"),
        (True, {}, "PASS"),
    ],
)
def test_verdict_priority(ok, data, expected):
    result = Result("example", ok, "detail", data)
    verdict = getattr(qa_report, "verdict", lambda _: "not implemented")
    assert verdict(result) == expected


def test_report_displays_each_verdict_without_changing_result_data(tmp_path):
    results = [
        Result("pass", True, "ok"),
        Result("skip", True, "not run", {"skipped": True}),
        Result("retry", True, "recovered", {"qa_retry": {"flaky": True}}),
        Result("fail", False, "broken", {"skipped": True}),
    ]
    table = qa_report.report(results, tmp_path, "Example QA")
    summary = (tmp_path / "summary.md").read_text(encoding="utf-8")
    for name, status in (("pass", "PASS"), ("skip", "SKIP"), ("retry", "FLAKY"), ("fail", "FAIL")):
        assert any(name in line and status in line for line in table.splitlines())
        assert any(name in line and f"| {status} |" in line for line in summary.splitlines())
    saved = json.loads((tmp_path / "results.json").read_text(encoding="utf-8"))
    assert saved == [r.__dict__ for r in results]
    assert [r.ok for r in results] == [True, True, True, False]


@pytest.mark.parametrize(("module", "tag"), [("qa_infographic", "qa_infographic"), ("qa_site", "qa_site")])
def test_driver_failure_lines_are_scannable_and_limit_details(tmp_path, module, tag):
    import importlib

    driver = importlib.import_module(module)
    results = [Result("skipped", True, "not run", {"skipped": True}), Result("broken", False, "x" * 310)]
    lines = driver.report(results, tmp_path).splitlines()
    assert [line for line in lines if line.startswith("FAIL  ")] == [f"FAIL  {tag} broken: " + "x" * 300]
