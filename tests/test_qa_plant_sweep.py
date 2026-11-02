"""Pure helpers of scripts/qa_plant_sweep_helpers.py (the settings sweep of the plant, docs/design/plant_ui.md section 10, "The sweep").

Expected values are hand arithmetic or text typed by hand, never taken from the code under test. The browser checks run through `uv run python scripts/qa_plant.py --sweep`.
"""
from __future__ import annotations

import json
import sys

import pytest

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts"))
import qa_plant_sweep_helpers as sw  # noqa: E402

HASH = "a" * 64
HALLS = ["a_manual", "b_lims_lite", "c_context"]


def spec(**changes):
    base = {"name": "x", "run": {"scenario": "default", "settings": {}, "architectures": HALLS}, "seed": 1, "look_s": 722400, "action": {"kind": "add_feed", "at": 723600, "unit_id": "U10"}, "frames": False, "gate": False}
    return {**base, **changes}


def with_run(**run):
    return spec(run={"scenario": "default", "settings": {}, "architectures": HALLS, **run})


# ---------- the list ----------
def test_the_list_is_the_ten_specs_in_order_and_the_gate_takes_two_and_seven():
    specs = sw.load_specs()
    assert [s["name"] for s in specs] == [
        "default_seed1", "default_seed2", "default_seed3", "sc02_burst_seed1", "sc03_gap_seed1", "sc05_down_seed1", "small_seed1", "large_seed1", "mixed_seed1", "capture_seed1",
    ]
    assert [s["name"] for s in sw.load_specs(gate=True)] == ["default_seed2", "small_seed1"]
    assert [s["name"] for s in specs if s["frames"]] == ["default_seed1", "small_seed1", "large_seed1"]


def test_only_the_large_plants_times_are_not_judged_the_authors_decision_of_2026_11_02():
    assert [s["name"] for s in sw.load_specs() if not s["judged"]] == ["large_seed1"]


def test_a_name_picks_one_spec_and_an_unknown_name_is_an_error():
    assert [s["name"] for s in sw.load_specs(names=["large_seed1"])] == ["large_seed1"]
    with pytest.raises(ValueError, match="nonesuch"):
        sw.load_specs(names=["nonesuch"])


# ---------- the link of a spec ----------
def test_the_link_of_the_default_scenario_names_the_scenario_the_halls_the_seed_and_the_engine():
    assert sw.spec_link(spec(), "0.2.0") == "#/plant?scenario=default&arch=a_manual,b_lims_lite,c_context&seed=1&schema=1&engine=0.2.0"


def test_the_link_lists_the_settings_by_name_then_the_profile_lists_and_the_capture_path():
    link = sw.spec_link(with_run(settings={"reactor_count": 18, "bay_size": 6}, bay_profiles=["bench_manual", "pilot", "pilot"], analyzer_profiles=["hplc"], capture_path="adapter_ingest"), "9")
    assert link == ("#/plant?scenario=default&set.bay_size=6&set.reactor_count=18&bays=bench_manual,pilot,pilot&analyzers=hplc&capture=adapter_ingest"
                    "&arch=a_manual,b_lims_lite,c_context&seed=1&schema=1&engine=9")


# ---------- the objects a spec must have, by hand rules ----------
def test_the_default_scenario_has_24_reactors_in_two_bays_two_analyzers_four_staff_and_three_halls():
    assert sw.expected_objects(spec()) == {"reactor": 24, "analyzer": 2, "staff": 4, "hall": 3, "board": 2, "flags": 1}


def test_a_small_plant_is_one_bay_and_one_board():
    got = sw.expected_objects(with_run(settings={"reactor_count": 6, "bay_size": 6, "cohort_size": 6, "horizon_days": 8, "production_days": 6}))
    assert got == {"reactor": 6, "analyzer": 2, "staff": 4, "hall": 3, "board": 1, "flags": 1}


def test_a_large_plant_has_100_reactors_in_nine_bays_six_analyzers_and_sixteen_staff():
    got = sw.expected_objects(with_run(settings={"reactor_count": 100, "bay_size": 12, "cohort_size": 25, "analyzer_count": 6, "operators_per_shift": 8, "weekend_operators": 4}))
    assert got == {"reactor": 100, "analyzer": 6, "staff": 16, "hall": 3, "board": 9, "flags": 1}  # 100 / 12 = 8.33, rounded up to 9; 2 shifts of 8


def test_the_boards_are_the_reactors_over_the_bay_size_rounded_up():
    for reactors, bay, boards in [(24, 12, 2), (25, 12, 3), (18, 6, 3), (5, 12, 1), (100, 10, 10), (100, 7, 15)]:
        assert sw.expected_objects(with_run(settings={"reactor_count": reactors, "bay_size": bay}))["board"] == boards, (reactors, bay)


def test_a_mixed_fleet_has_the_stages_of_its_profiles_as_analyzers_the_split_pair_being_two():
    got = sw.expected_objects(with_run(settings={"reactor_count": 18, "bay_size": 6}, analyzer_profiles=["split_cellcounter_metabolite", "hplc"]))
    assert got["analyzer"] == 3 and got["board"] == 3  # the cell counter and the metabolite analyzer of the pair, and the HPLC
    assert sw.expected_objects(with_run(analyzer_profiles=["allinone_atline", "allinone_atline"]))["analyzer"] == 2
    assert sw.expected_objects(with_run(analyzer_profiles=["split_cellcounter_metabolite", "split_cellcounter_metabolite"]))["analyzer"] == 4


def test_without_a_list_the_analyzers_are_the_count_times_the_stages_of_the_scenarios_profile():
    assert sw.expected_objects(with_run(settings={"analyzer_count": 5}))["analyzer"] == 5


def test_the_halls_are_the_architectures_of_the_spec():
    assert sw.expected_objects(with_run(architectures=["a_manual"]))["hall"] == 1


def test_the_staff_are_two_shifts_of_the_operators_of_a_shift():
    for ops, staff in [(2, 4), (3, 6), (8, 16)]:
        assert sw.expected_objects(with_run(settings={"operators_per_shift": ops}))["staff"] == staff


def test_the_defaults_typed_in_the_helper_are_the_ones_of_the_four_scenarios_of_the_lab():
    for name in ("default", "sc02_shift_burst", "sc03_feed_in_gap", "sc05_one_analyzer_down"):
        doc = json.loads((REPO / "scenarios" / f"{name}.json").read_text(encoding="utf-8"))
        assert {k: doc["settings"][k]["value"] for k in sw.DEFAULTS} == sw.DEFAULTS, name
        assert doc["profiles"]["analyzer"] == "allinone_atline", name


def test_the_stages_typed_in_the_helper_are_the_stages_of_the_profile_files():
    for profile, stages in sw.STAGES.items():
        doc = json.loads((REPO / "scenarios" / "profiles" / "analyzer" / f"{profile}.json").read_text(encoding="utf-8"))
        assert len(doc["route"]) == stages, profile
    assert sw.STAGES == {"allinone_atline": 1, "hplc": 1, "split_cellcounter_metabolite": 2}


# ---------- the hashes after an action: the page against the Worker's own messages ----------
def msg(type_, epoch, **data):
    return {"at": 1.0, "data": {"type": type_, "id": 1, "epoch": epoch, **data}}


def worker_messages():
    return [
        msg("plant_ready", 2, plan={}, hashes={"truth": HASH, "cells": {"a_manual": "1" * 64}}),
        msg("plant_halls", 2, records=[], cells={"b_lims_lite": "2" * 64}),
        msg("plant_halls", 2, records=[], cells={"c_context": "3" * 64}),
        msg("plant_ready", 1, plan={}, hashes={"truth": "f" * 64, "cells": {"a_manual": "9" * 64}}),
    ]


def test_the_workers_answer_is_the_truth_hash_of_the_ready_message_and_the_cells_of_the_ready_message_and_the_halls_of_its_epoch():
    truth, cells = sw.worker_hashes(worker_messages(), 2)
    assert truth == HASH
    assert cells == {"a_manual": "1" * 64, "b_lims_lite": "2" * 64, "c_context": "3" * 64}


def test_the_hashes_on_the_host_that_are_the_workers_have_no_problem():
    assert sw.worker_hash_problems(HASH, json.dumps({"a_manual": "1" * 64, "b_lims_lite": "2" * 64, "c_context": "3" * 64}), worker_messages(), 2) == []


def test_a_host_that_shows_another_truth_hash_or_another_digest_is_a_problem():
    cells = {"a_manual": "1" * 64, "b_lims_lite": "2" * 64, "c_context": "3" * 64}
    assert any("truth" in p for p in sw.worker_hash_problems("b" * 64, json.dumps(cells), worker_messages(), 2))
    assert any("b_lims_lite" in p for p in sw.worker_hash_problems(HASH, json.dumps({**cells, "b_lims_lite": "0" * 64}), worker_messages(), 2))
    assert any("halls" in p for p in sw.worker_hash_problems(HASH, json.dumps({"a_manual": "1" * 64}), worker_messages(), 2))
    assert sw.worker_hash_problems(HASH, "{}", [], 2) == ["the Worker sent no plant_ready for the epoch 2"]


# ---------- the judgement of the times of a spec ----------
def test_the_round_trip_of_one_action_is_judged_by_the_limit_of_the_slowest_since_one_sample_shows_no_median():
    assert sw.time_problems(round_trip_ms=420.0, frames=None) == []
    assert sw.time_problems(round_trip_ms=640.0, frames=None) == []  # over the 600 ms of the median, which plant_action judges over five accepted actions
    assert sw.time_problems(round_trip_ms=1000.0, frames=None) == []
    assert any("1000 ms" in p for p in sw.time_problems(round_trip_ms=1203.7, frames=None))
    assert any("round trip" in p for p in sw.time_problems(round_trip_ms=None, frames=None))


def test_the_frames_of_a_spec_that_measures_them_are_judged_by_the_budget_and_a_spec_that_does_not_has_none():
    ok = {"n": 300, "median": 33.3, "p95": 33.4}
    assert sw.time_problems(round_trip_ms=300.0, frames=ok) == []
    assert any("median" in p for p in sw.time_problems(round_trip_ms=300.0, frames={"n": 300, "median": 66.7, "p95": 83.4}))
    assert any("95th" in p for p in sw.time_problems(round_trip_ms=300.0, frames={"n": 300, "median": 33.3, "p95": 83.4}))


def test_the_times_of_a_spec_that_is_not_judged_are_reported_with_how_they_stand_against_each_limit_and_fail_nothing():
    problems, notes = sw.time_findings(False, 1966.0, {"n": 300, "median": 50.0, "p95": 50.1})
    assert problems == []
    assert notes == [
        "the round trip is 1966 ms: over the limit of 600 ms (median) and over the limit of 1000 ms (slowest)",
        "the frame interval is median 50.0 ms, at the limit of 50 ms, and 95th percentile 50.1 ms, within the limit of 80 ms",
    ]
    _, over = sw.time_findings(False, 640.0, {"n": 300, "median": 66.7, "p95": 83.4})
    assert over == [
        "the round trip is 640 ms: over the limit of 600 ms (median) and within the limit of 1000 ms (slowest)",
        "the frame interval is median 66.7 ms, over the limit of 50 ms, and 95th percentile 83.4 ms, over the limit of 80 ms",
    ]


def test_a_spec_that_is_not_judged_still_fails_when_no_round_trip_was_measured():
    problems, notes = sw.time_findings(False, None, None)
    assert problems == ["no round trip was measured"] and notes == []


def test_a_spec_that_is_judged_has_problems_and_no_notes():
    problems, notes = sw.time_findings(True, 1203.7, {"n": 300, "median": 66.7, "p95": 33.4})
    assert len(problems) == 2 and notes == []
    assert sw.time_findings(True, 300.0, None) == ([], [])


# ---------- the report ----------
GOOD = {"console": True, "counts": True, "hashes": True, "panels": True, "action": True, "times": True}


def row(name="x", **changes):
    base = {"name": name, "checks": dict(GOOD), "round_trip_ms": 312.4, "frames": None, "problems": [], "conditions": {}, "judged": True, "notes": []}
    return {**base, **changes}


def test_a_row_passes_when_every_check_passes_and_has_no_problem():
    assert sw.CHECKS == ("console", "counts", "hashes", "panels", "action", "times")
    assert sw.row_ok(row()) is True
    assert sw.row_ok(row(checks={**GOOD, "counts": False})) is False
    assert sw.row_ok(row(checks={**GOOD, "times": False})) is False
    assert sw.row_ok(row(problems=["a time is over"])) is False
    assert sw.row_ok(row(checks={"console": True})) is False  # a check that did not run is not a pass


def test_the_table_has_a_line_for_each_spec_with_pass_or_fail_per_check_and_the_numbers():
    table = sw.table([row("a"), row("b", checks={**GOOD, "counts": False}, frames={"n": 300, "median": 33.3, "p95": 50.1}, round_trip_ms=1203.7)])
    lines = table.splitlines()
    assert lines[0] == "| spec | console | counts | hashes | panels | action | times | round trip | frames median / 95th | result |"
    assert lines[1] == "|---|---|---|---|---|---|---|---|---|---|"
    assert lines[2] == "| a | pass | pass | pass | pass | pass | pass | 312 ms | not measured | PASS |"
    assert lines[3] == "| b | pass | FAIL | pass | pass | pass | pass | 1204 ms | 33.3 / 50.1 ms | FAIL |"


def test_a_row_whose_times_are_reported_and_not_judged_passes_and_the_table_says_so():
    big = row("large", judged=False, notes=["the round trip is 1966 ms: over the limit of 600 ms (median) and over the limit of 1000 ms (slowest)"], round_trip_ms=1966.0, frames={"n": 300, "median": 50.0, "p95": 50.1})
    assert sw.row_ok(big) is True
    assert sw.table([big]).splitlines()[2] == "| large | pass | pass | pass | pass | pass | reported | 1966 ms | 50.0 / 50.1 ms | PASS |"
    assert sw.row_ok({**big, "problems": ["no round trip was measured"]}) is False


def test_the_report_names_the_times_that_are_reported_for_the_author_and_not_judged():
    text = sw.report_markdown("t", [row("a"), row("large", judged=False, notes=["the round trip is 1966 ms: over the limit of 600 ms (median) and over the limit of 1000 ms (slowest)"])])
    assert "## Reported against the budgets, not judged" in text
    assert "- large: the round trip is 1966 ms: over the limit of 600 ms (median)" in text
    assert "the round trip limits are the default scenario's" in text and "the author's to decide" in text
    assert "## Reported against the budgets" not in sw.report_markdown("t", [row("a")])


def test_the_summary_says_how_many_specs_were_reported_and_not_judged():
    cond = {"load_start": [1.0, 2.0, 3.0], "load_end": [1.5, 2.0, 3.0], "cpus": 8, "chromium": "156.0.8078.4", "renderer": "SwiftShader", "viewport": [1280, 720], "measured": "m"}
    line = sw.sweep_detail([row("a", conditions={"round_trip": cond}), row("large", judged=False, notes=["the round trip is 1966 ms: over"], conditions={"round_trip": cond})])
    assert "2/2 specs pass" in line and "times of 1 spec reported, not judged (the author's to decide)" in line
    assert "reported, not judged" not in sw.sweep_detail([row("a")])


def test_the_report_lists_the_conditions_of_each_measurement_what_was_measured_and_every_problem():
    cond = {"load_start": [1.0, 2.0, 3.0], "load_end": [1.5, 2.0, 3.0], "cpus": 8, "chromium": "156.0.8078.4", "renderer": "SwiftShader", "viewport": [1280, 720], "measured": "from a to b"}
    text = sw.report_markdown("Plant settings sweep", [row("a", conditions={"round_trip": cond}), row("b", problems=["b: the counts differ"])])
    assert text.startswith("# Plant settings sweep\n")
    assert "## Conditions" in text and "- a, round_trip: load 1/2/3 to 1.5/2/3 (1, 5 and 15 min) on 8 CPUs; Chromium 156.0.8078.4; renderer SwiftShader; viewport 1280x720" in text
    assert "## What was measured" in text and "- round_trip: from a to b" in text
    assert text.count("from a to b") == 1  # once for each kind of time, not once for each spec
    assert "## Problems" in text and "- b: b: the counts differ" in text
    assert "no problems" in sw.report_markdown("t", [row("a")])


def test_the_summary_names_how_many_specs_passed_the_load_and_the_renderer():
    cond = {"load_start": [1.0, 2.0, 3.0], "load_end": [1.5, 2.0, 3.0], "cpus": 8, "chromium": "156.0.8078.4", "renderer": "SwiftShader", "viewport": [1280, 720], "measured": "m"}
    line = sw.sweep_detail([row("a", conditions={"round_trip": cond}), row("b", problems=["x"], conditions={"round_trip": cond})])
    assert "1/2 specs pass" in line and "load 1/2/3 to 1.5/2/3" in line and "SwiftShader" in line


def test_the_summary_of_a_sweep_whose_conditions_lack_the_load_says_it_is_missing_instead_of_failing():
    cond = {"cpus": 8, "chromium": "156.0.8078.4", "renderer": "SwiftShader", "viewport": [1280, 720], "measured": "m"}
    line = sw.sweep_detail([row("a", conditions={"round_trip": cond})])
    assert "load missing to missing" in line and "SwiftShader" in line


def test_the_summary_of_a_sweep_that_recorded_no_conditions_says_so():
    assert "no conditions" in sw.sweep_detail([row("a")])
