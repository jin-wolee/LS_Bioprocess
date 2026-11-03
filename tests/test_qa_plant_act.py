"""Pure helpers of scripts/qa/qa_plant_act_helpers.py (the checks `plant_action`, `plant_equal` and `plant_prefix` of the headless QA of the plant, docs/design/plant_ui.md section 10, P6a).

Expected values are hand arithmetic on instants and plans typed by hand (day 3 at 09:00 is 3 x 86,400 + 9 x 3,600 = 291,600 s), never taken from the code under test. The browser checks themselves run
through `uv run python scripts/qa/qa_plant.py`.
"""
from __future__ import annotations

import sys

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts" / "qa"))
import qa_plant_act_helpers as qa  # noqa: E402

SMALL_KEYS = "scenario=default&set.bay_size=6&set.cohort_size=6&set.horizon_days=8&set.production_days=6&set.reactor_count=6&arch=a_manual,b_lims_lite,c_context&seed=1"


def test_the_clock_reading_of_an_instant_is_the_day_and_the_time_of_day():
    assert qa.clock_text(291600) == "day 3 09:00"
    assert qa.clock_text(723600) == "day 8 09:00"
    assert qa.clock_text(0) == "day 0 00:00"
    assert qa.time_of(297000) == "10:30"
    assert qa.time_of(306000) == "13:00"


def test_each_action_names_the_fields_of_its_form():
    assert qa.fields_of({"kind": "add_feed", "at": 291600, "unit_id": "U03"}) == {"unit": "U03"}
    assert qa.fields_of({"kind": "raise_alarm", "at": 295200, "unit_id": "U05"}) == {"unit": "U05"}
    assert qa.fields_of({"kind": "move_draw", "at": 291600, "sample_id": "U03-D03-1", "to": 297000}) == {"time": "10:30"}
    assert qa.fields_of({"kind": "analyzer_down", "at": 291600, "analyzer": "AN-1", "from": 306000, "length_min": 120}) == {"analyzer": "AN-1", "day": "3", "time": "13:00", "length": "120"}
    assert qa.fields_of({"kind": "change_lot", "at": 291600, "analyzer": "AN-2", "effective": 345600}) == {"analyzer": "AN-2", "day": "4", "time": "00:00"}
    assert qa.fields_of({"kind": "set_flag", "at": 291600, "architecture": "c_context", "flag": "audit_trail", "on": False}) == {"architecture": "c_context", "flag": "audit_trail", "on": "false"}
    assert qa.fields_of({"kind": "set_flag", "at": 291600, "architecture": "b_lims_lite", "flag": "available_at", "on": True})["on"] == "true"
    assert qa.fields_of({"kind": "set_capture_path", "at": 291600, "path": "adapter_ingest"}) == {"path": "adapter_ingest"}
    assert qa.fields_of({"kind": "set_labelling", "at": 291600, "method": "preprinted_barcode"}) == {"method": "preprinted_barcode"}


def test_the_link_of_the_small_default_scenario_carries_its_settings_in_the_order_of_their_names_and_the_actions_as_json():
    assert qa.small_link("0.2.0", []) == f"#/plant?{SMALL_KEYS}&schema=1&engine=0.2.0"
    feed = {"kind": "add_feed", "at": 291600, "unit_id": "U03"}
    assert qa.small_link("0.2.0", [feed]) == f"#/plant?{SMALL_KEYS}&actions=%5B%7B%22kind%22%3A%22add_feed%22%2C%22at%22%3A291600%2C%22unit_id%22%3A%22U03%22%7D%5D&schema=1&engine=0.2.0"


def test_the_round_trip_is_judged_by_its_median_and_its_slowest_of_five():
    assert qa.round_trip_problems([300, 320, 310, 330, 340]) == []
    assert qa.round_trip_problems([100, 200, 600, 900, 1000]) == []  # the median of these is 600, the limit
    assert qa.round_trip_problems([700, 650, 610, 900, 800]) == ["the median round trip is 700 ms, over the 600 ms limit"]
    assert qa.round_trip_problems([300, 310, 320, 330, 1200]) == ["the slowest round trip is 1200 ms, over the 1000 ms limit"]
    assert qa.round_trip_problems([]) == ["no round trip was measured"]


def _plan():
    return {
        "marks": [{"t": 100, "unit": 0, "kind": "feed"}, {"t": 500, "unit": 1, "kind": "alarm"}],
        "samples": [
            {"id": "U01-D00-1", "unit": 0, "operator": 0, "planned_s": 90, "drawn_s": 200, "arrived_s": 260, "skipped": False, "label": None,
             "visits": [{"analyzer": 0, "queued_s": 260, "started_s": 270, "run_started_s": 270, "ended_s": 290, "attempt": 1}]},
            {"id": "U01-D00-2", "unit": 0, "operator": 1, "planned_s": 380, "drawn_s": 400, "arrived_s": 460, "skipped": False, "label": None,
             "visits": [{"analyzer": 0, "queued_s": 460, "started_s": 470, "run_started_s": 470, "ended_s": 490, "attempt": 1}]},
        ],
        "windows": [{"analyzer": 0, "kind": "qc", "from_s": 50, "to_s": 80}, {"analyzer": 1, "kind": "maintenance", "from_s": 600, "to_s": 700}],
        "calibrations": [{"analyzer": 0, "t": 150}, {"analyzer": 1, "t": 650}],
    }


def test_the_floor_before_an_instant_is_the_same_when_only_what_comes_after_changed():
    before = _plan()
    after = _plan()
    after["marks"].append({"t": 400, "unit": 2, "kind": "feed"})  # a feed at 400, after the action at 300
    after["samples"][1]["drawn_s"] = 420  # a draw that was after the instant moved
    after["samples"][1]["visits"][0]["ended_s"] = 510
    after["windows"].append({"analyzer": 0, "kind": "maintenance", "from_s": 400, "to_s": 460})
    assert qa.prefix_problems(before, after, 300) == []


def test_the_floor_before_an_instant_differs_when_a_mark_a_draw_a_visit_a_window_or_a_calibration_before_it_changed():
    def changed(edit):
        after = _plan()
        edit(after)
        return qa.prefix_problems(_plan(), after, 300)

    assert changed(lambda p: p["marks"].append({"t": 250, "unit": 2, "kind": "feed"})) == ["the marks before 300 s differ"]
    assert changed(lambda p: p["samples"][0].update(operator=1)) == ["the draws before 300 s differ"]
    assert changed(lambda p: p["samples"][0]["visits"][0].update(ended_s=295)) == ["the visits that ended before 300 s differ"]
    assert changed(lambda p: p["windows"][0].update(to_s=90)) == ["the windows that began before 300 s differ"]
    assert changed(lambda p: p["calibrations"].append({"analyzer": 1, "t": 200})) == ["the calibrations before 300 s differ"]


def test_an_entry_of_the_reference_is_compared_with_the_hashes_on_the_host():
    entry = {"name": "add_feed", "truth": "aa", "cells": {"a_manual": "11", "c_context": "33"}}
    assert qa.reference_problems(entry, "aa", '{"c_context":"33","a_manual":"11"}') == []
    assert qa.reference_problems(entry, "bb", '{"a_manual":"11","c_context":"33"}') == ["add_feed: the truth hash on the page is bb, the reference has aa"]
    assert qa.reference_problems(entry, "aa", '{"a_manual":"11","c_context":"44"}') == ["add_feed: the cells digest of c_context on the page is 44, the reference has 33"]
    assert qa.reference_problems(entry, "aa", '{"a_manual":"11"}') == ["add_feed: the page shows the halls ['a_manual'], the reference has ['a_manual', 'c_context']"]
    assert qa.reference_problems(entry, None, None) == ["add_feed: the host shows no truth hash"]


def test_a_refusal_block_is_judged_by_its_reason_its_sentence_in_the_language_and_the_engines_message():
    block = {"reason": "past", "text": "The action was not applied\nThe past is not rewritten: the instant is earlier\nThe Worker says: the window starts before the action", "message": "the window starts before the action"}
    assert qa.refusal_problems(block, "past", "en") == []
    assert qa.refusal_problems(block, "limit", "en") == ["the refusal says past, expected limit"]
    assert qa.refusal_problems({**block, "text": "nothing"}, "past", "en") == ["the refusal has no sentence of the reason past in en (expected 'The past is not rewritten')"]
    assert qa.refusal_problems({**block, "message": ""}, "past", "en") == ["the refusal shows no message of the Worker"]
    korean = {"reason": "past", "text": "조작이 적용되지 않았습니다\n과거는 고쳐 쓰지 않습니다. 그 시각이", "message": "x"}
    assert qa.refusal_problems(korean, "past", "ko") == []
    assert qa.refusal_problems(korean, "past", "en") == ["the refusal has no sentence of the reason past in en (expected 'The past is not rewritten')"]
