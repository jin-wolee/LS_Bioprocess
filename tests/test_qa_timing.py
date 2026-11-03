"""The timing mode of the browser QA (P9, audit item 21; docs/design/lab_ui.md section 13): scripts/qa_timing.py and the places that use it.

The author's decision of 2026-11-03: the Pages workflow runs the browser QA before a deploy, and a CI runner's software renderer is not the machine the budgets were measured on. In the mode `report` the checks
that measure time (the lab's `time`, the plant's `plant_frames`, the round trip of `plant_action`, the times of a spec of `plant_sweep`) print their numbers with their conditions and do not fail on a limit; a time
that was not measured, or too few frames, still fails. Every expected value is typed by hand from that rule.
"""
from __future__ import annotations

import sys

import pytest

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts"))
import qa_plant_act_helpers as act  # noqa: E402
import qa_plant_helpers as ph  # noqa: E402
import qa_plant_sweep_helpers as sw  # noqa: E402
import qa_timing as qt  # noqa: E402

OVER = {"n": 300, "median": 61.2, "p95": 95.0}
WITHIN = {"n": 300, "median": 33.3, "p95": 50.0}
SHORT = {"n": 120, "median": 33.3, "p95": 50.0}


@pytest.fixture(autouse=True)
def judge_mode():
    qt.set_report_only(False)
    yield
    qt.set_report_only(False)


def test_the_default_mode_judges_a_time_over_its_limit():
    assert qt.report_only() is False
    assert qt.over_limit(["median 61.2 ms is over 50 ms"]) == (["median 61.2 ms is over 50 ms"], [])


def test_the_report_mode_turns_each_line_over_a_limit_into_a_note_and_fails_nothing():
    qt.set_report_only(True)
    problems, notes = qt.over_limit(["median 61.2 ms is over 50 ms", "95th percentile 95.0 ms is over 80 ms"])
    assert problems == []
    assert notes == ["reported, not judged (timing mode report): median 61.2 ms is over 50 ms", "reported, not judged (timing mode report): 95th percentile 95.0 ms is over 80 ms"]
    assert qt.over_limit([]) == ([], [])


def test_the_mode_is_chosen_by_name_and_an_unknown_name_is_refused():
    qt.set_mode("report")
    assert qt.report_only() is True
    qt.set_mode("judge")
    assert qt.report_only() is False
    with pytest.raises(ValueError):
        qt.set_mode("ignore")


# ---- the frames: too few frames is a defect of the run, a frame over its limit is a time ----------------------------------------------
def test_too_few_frames_is_not_a_time_and_a_frame_over_its_limit_is_one():
    assert ph.frames_short(SHORT) == ["only 120 frames measured, 300 needed"]
    assert ph.frames_over(SHORT) == []
    assert ph.frames_short(OVER) == []
    assert ph.frames_over(OVER) == ["median 61.2 ms is over 50 ms", "95th percentile 95.0 ms is over 80 ms"]
    assert ph.frames_short(WITHIN) == [] and ph.frames_over(WITHIN) == []


def test_frames_problems_is_the_two_together_as_before():
    assert ph.frames_problems(SHORT) == ["only 120 frames measured, 300 needed"]
    assert ph.frames_problems(OVER) == ["median 61.2 ms is over 50 ms", "95th percentile 95.0 ms is over 80 ms"]
    assert ph.frames_problems(WITHIN) == []


# ---- the round trip ----------------------------------------------------------------------------------------------------------------------
def test_no_round_trip_measured_is_not_a_time_and_a_slow_one_is():
    assert act.round_trip_missing([]) == ["no round trip was measured"]
    assert act.round_trip_over([]) == []
    assert act.round_trip_missing([700, 710, 720, 730, 1200]) == []
    assert act.round_trip_over([700, 710, 720, 730, 1200]) == ["the median round trip is 720 ms, over the 600 ms limit", "the slowest round trip is 1200 ms, over the 1000 ms limit"]
    assert act.round_trip_problems([500, 510, 520, 530, 540]) == []
    assert act.round_trip_problems([]) == ["no round trip was measured"]


# ---- the times of a spec of the sweep ------------------------------------------------------------------------------------------------
def test_a_judged_spec_over_a_limit_fails_unless_the_mode_reports():
    problems, notes = sw.time_findings(True, 1500.0, OVER)
    assert len(problems) == 3 and notes == []
    problems, notes = sw.time_findings(True, 1500.0, OVER, report=True)
    assert problems == []
    assert len(notes) == 2 and "round trip is 1500 ms" in notes[0] and "median 61.2 ms" in notes[1]


def test_a_time_that_was_not_measured_fails_in_both_modes():
    assert sw.time_findings(True, None, None, report=True)[0] == ["no round trip was measured"]
    assert sw.time_findings(True, 400.0, SHORT, report=True)[0] == ["only 120 frames measured, 300 needed"]


# ---- the three scripts take the mode, and the workflow names it ----------------------------------------------------------------------
@pytest.mark.parametrize("script", ["qa_lab.py", "qa_plant.py", "qa_site.py"])
def test_each_browser_qa_takes_the_timing_mode_and_sets_it_before_its_checks(script):
    source = (REPO / "scripts" / script).read_text(encoding="utf-8")
    assert '"--timing"' in source and 'choices=("judge", "report")' in source
    assert source.index("set_mode(args.timing)") < source.index("sync_playwright() as pw")


@pytest.mark.parametrize(("script", "judges", "not_this"), [
    ("qa_lab_checks.py", "over_limit(", None),
    ("qa_plant_motion.py", "over_limit(frames_over(", "frames_problems("),
    ("qa_plant_act.py", "over_limit(round_trip_over(", "round_trip_problems("),
    ("qa_plant_sweep.py", "report_only()", None),
])
def test_each_check_that_measures_time_asks_the_timing_mode_what_to_do_with_a_time_over_its_limit(script, judges, not_this):
    # the call sites cannot be run without a browser: this keeps a check from going back to failing on a limit in the mode `report` (the mutation of P9: the combined function in place of the split)
    source = (REPO / "scripts" / script).read_text(encoding="utf-8")
    assert judges in source
    if not_this:
        assert not_this not in source
