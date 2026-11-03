"""Pure helpers of scripts/qa/qa_plant_sc12_helpers.py (the check `sc12` on the plant of the headless QA, docs/design/plant_ui.md section 10, P7c).

Expected values are hand arithmetic on a plan typed by hand (the case of src/plant/fixture_case.ts: ML-1 added to U01 and U02 at 3000 s, SL-A taken at 1000 and 2000 s, TL-1 used at 4000 and 8000 s, U01-CONF
and U02-CONF drawn at 9000 s, U01-SIG-CONF at 12000 s, U02-SIG-CONF skipped, the results at 20000 and 30000 s, the holds of c_context at 7500, 10000 and 25000 s), never taken from the code under test.
The browser checks themselves run through `uv run python scripts/qa/qa_plant.py`.
"""
from __future__ import annotations

import sys

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts" / "qa"))
import qa_plant_sc12_helpers as q  # noqa: E402


def _confirm(id_, unit, operator, drawn, skipped=False):
    return {"id": id_, "unit": unit, "operator": operator, "planned_s": drawn, "drawn_s": drawn, "arrived_s": None, "label": None, "kind": "confirm", "skipped": skipped, "visits": []}


def _routine(id_, unit, drawn):
    return {"id": id_, "unit": unit, "operator": 0, "planned_s": drawn - 10, "drawn_s": drawn, "arrived_s": drawn + 100, "label": None, "kind": "routine", "skipped": False, "visits": []}


def _hold(t, event, on, target):
    return {"t": t, "event": event, "on": on, "target": target}


def _plan():
    return {
        "horizon_s": 40000,
        "layout": {"bays": [{"size": 2, "profile": "bench_manual"}], "analyzers": [], "architectures": ["a_manual", "c_context"]},
        "units": [{"id": "U01"}, {"id": "U02"}], "analyzers": [{"id": "AN-1"}, {"id": "AN-2"}], "staff": [{"id": "OP-01"}, {"id": "OP-02"}],
        "samples": [_routine("U01-D00-1", 0, 2000), _routine("U02-D00-1", 1, 2100), _confirm("U01-CONF", 0, 0, 9000), _confirm("U02-CONF", 1, 1, 9000), _confirm("U02-SIG-CONF", 1, None, 9500, True), _confirm("U01-SIG-CONF", 0, 0, 12000)],
        "marks": [{"t": 3000, "unit": 0, "kind": "medium_addition", "item": "ML-1"}, {"t": 3000, "unit": 1, "kind": "medium_addition", "item": "ML-1"}, {"t": 6000, "unit": 1, "kind": "medium_addition", "item": "ML-2"},
                  {"t": 7000, "unit": 1, "kind": "signal_observed", "item": "DO"}, {"t": 8000, "unit": 1, "kind": "equipment_use", "item": "TL-1"}],
        "lots": [{"id": "ML-1", "kind": "medium", "uses": [{"unit": 0, "t": 3000}, {"unit": 1, "t": 3000}]}, {"id": "ML-2", "kind": "medium", "uses": [{"unit": 1, "t": 6000}]},
                 {"id": "SL-A", "kind": "seed", "uses": [{"unit": 0, "t": 1000}, {"unit": 1, "t": 2000}]}],
        "equipment": [{"id": "TL-1", "uses": [{"unit": 0, "t": 4000}, {"unit": 1, "t": 8000}]}],
        "confirms": [{"sample": 2, "test": "bioburden", "result_s": 20000, "outcome": "detected"}, {"sample": 3, "test": "bioburden", "result_s": 20000, "outcome": "not_detected"},
                     {"sample": 2, "test": "sterility", "result_s": 30000, "outcome": "detected"}],
        "records": [
            {"architecture": "a_manual", "holds": [_hold(9000, "hold_placed", "unit", 1)]},
            {"architecture": "c_context", "holds": [_hold(7500, "hold_placed", "unit", 1), _hold(7500, "hold_placed", "lot", 0), _hold(7500, "hold_placed", "equipment", 0), _hold(10000, "hold_quarantined", "unit", 1),
                                                    _hold(10000, "hold_quarantined", "lot", 0), _hold(25000, "hold_released", "lot", 0), _hold(25000, "hold_released", "equipment", 0),
                                                    _hold(26000, "hold_released", "sample", 0)]},
        ],
    }


def test_confirm_slots_skip_the_skipped_draw_and_follow_the_order_of_the_plan():
    assert q.confirm_slots(_plan()) == {2: 0, 3: 1, 5: 2}


def test_confirm_slots_stop_at_two_for_each_vessel():
    plan = _plan()
    plan["samples"] += [_confirm(f"X{i}", 0, 0, 13000 + i) for i in range(3)]
    assert list(q.confirm_slots(plan).values()) == [0, 1, 2, 3]  # four slots for two vessels


def test_expected_objects_count_the_kinds_of_a_case():
    assert q.expected_objects(_plan()) == {"reactor": 2, "analyzer": 2, "staff": 2, "hall": 2, "board": 1, "flags": 1, "lot": 3, "equipment": 1, "confirm": 3}


def test_tape_follows_placed_quarantined_and_released_and_ignores_a_sample():
    holds = _plan()["records"][1]["holds"]
    assert [q.tape_of(holds, "lot", 0, t) for t in (7499, 7500, 10000, 25000)] == [None, "held", "quarantined", None]
    assert q.tape_of(holds, "sample", 0, 40000) is None
    assert q.tape_of(holds, "lot", 1, 40000) is None


def test_items_expected_at_the_instants_worked_by_hand():
    plan = _plan()
    zero = {"lot": 0, "equipment": 0, "unit": 0}
    # 3000 s: ML-1 on two vessels (progress 0) and SL-A on U02 (1000 of 1200 s gone): three links
    assert q.items_expected(plan, 3000, "c_context") == {"links": 3, "shelf": 0, "stamps": 0, "held": zero, "quarantined": zero}
    # 3199 and 3200 s: the use of SL-A at 2000 s is 1199 and 1200 s old
    assert q.items_expected(plan, 3199, "c_context")["links"] == 3 and q.items_expected(plan, 3200, "c_context")["links"] == 2
    # 10000 s: two tubes on the shelf, TL-1 held, ML-1 and U02 quarantined
    assert q.items_expected(plan, 10000, "c_context") == {"links": 0, "shelf": 2, "stamps": 0, "held": {"lot": 0, "equipment": 1, "unit": 0}, "quarantined": {"lot": 1, "equipment": 0, "unit": 1}}
    # 30000 s: three tubes, three stamps (two at 20000 s and one at 30000 s), ML-1 and TL-1 released, U02 still quarantined
    assert q.items_expected(plan, 30000, "c_context") == {"links": 0, "shelf": 3, "stamps": 3, "held": zero, "quarantined": {"lot": 0, "equipment": 0, "unit": 1}}


def test_items_expected_reads_the_hall_the_lens_names():
    plan = _plan()
    assert q.items_expected(plan, 10000, "a_manual")["held"] == {"lot": 0, "equipment": 0, "unit": 1}
    assert q.items_expected(plan, 10000, "b_lims_lite")["held"] == {"lot": 0, "equipment": 0, "unit": 0}


def test_items_problems_names_the_lens_and_the_instant():
    plan = _plan()
    right = '{"links":0,"shelf":2,"stamps":0,"held":{"lot":0,"equipment":1,"unit":0},"quarantined":{"lot":1,"equipment":0,"unit":1}}'
    assert q.items_problems(right, plan, 10000, "c_context") == []
    assert "lens c_context at 10000 s" in q.items_problems(right.replace('"shelf":2', '"shelf":3'), plan, 10000, "c_context")[0]
    assert q.items_problems("nonsense", plan, 10000, "c_context")[0].startswith("data-plant-items is not JSON")


def test_instants_of_a_case():
    assert q.instants_of(_plan()) == {"before": 999, "addition": 3000, "signal": 7000, "results": 30000}


def test_objects_problems_compare_the_scene_the_list_and_the_plan():
    plan = _plan()
    built = {"reactor": 2, "analyzer": 2, "staff": 2, "hall": 2, "board": 1, "flags": 1, "lot": 3, "equipment": 1, "confirm": 3}
    assert q.objects_problems(built, dict(built), plan) == []
    assert q.objects_problems({**built, "lot": 2}, dict(built), plan) == ["the scene built 2 lot objects, the plan has 3"]
    assert q.objects_problems(built, {**built, "confirm": 2}, plan) == ["the objects list holds 2 confirm entries, the plan has 3"]
    assert q.objects_problems({**built, "comet": 1}, dict(built), plan) == ["the scene built comet objects, which the plan does not have"]
    # a case with no equipment: the list has no entry, which is zero
    bare = {**_plan(), "equipment": []}
    listed = {k: v for k, v in built.items() if k != "equipment"}
    assert q.objects_problems({**built, "equipment": 0}, listed, bare) == []


def test_hashes_of_messages_assemble_the_halls_of_an_epoch():
    messages = [{"data": {"type": "plant_ready", "epoch": 1, "hashes": {"truth": "T", "cells": {"a": "1"}}}}, {"data": {"type": "plant_halls", "epoch": 1, "cells": {"b": "2"}}},
                {"data": {"type": "plant_halls", "epoch": 2, "cells": {"c": "3"}}}]
    assert q.hashes_of_messages(messages, 1) == ("T", {"a": "1", "b": "2"})
    assert q.hashes_of_messages(messages, 3) == (None, {})


def test_hash_problems_name_the_digest_that_differs():
    assert q.hash_problems("T", '{"a":"1","b":"2"}', "T", {"a": "1", "b": "2"}, "Worker") == []
    got = q.hash_problems("U", '{"a":"1","b":"9"}', "T", {"a": "1", "b": "2"}, "Node reference")
    assert got[0].startswith("data-run-hash U is not the Node reference's T") and got[1].startswith("digest of b: 9, the Node reference has 2")


def test_reference_entry_is_the_case_at_the_first_seed_under_the_five_records():
    ref = {"breakout": [{"case": "sc12_medium_lot", "seed": 9013, "architectures": q.ARCHS, "truth": "T", "cells": {}}]}
    assert q.reference_entry(ref, "sc12_medium_lot") is ref["breakout"][0]
    assert q.reference_entry(ref, "sc12_equipment") is None
    assert q.reference_entry({}, "sc12_medium_lot") is None


def _view(origin_kind, origin_id, hours, affected):
    return {"event": {"origin_kind": origin_kind, "origin_id": origin_id, "contaminated_at": None if hours is None else {"value": hours, "unit": "h"}}, "affected": affected}


def test_breakout_expected_marks_the_origin_from_its_instant_and_the_units_from_their_onsets():
    plan = _plan()
    view = _view("medium_lot", "ML-1", 1, [{"unit": 0, "onset_s": 3000}, {"unit": 1, "onset_s": 6000}])
    assert q.breakout_expected(plan, view, 3599) == {"origin": None, "reached": ["U01"]}
    assert q.breakout_expected(plan, view, 3600) == {"origin": "ML-1", "reached": ["U01"]}
    assert q.breakout_expected(plan, view, 6000) == {"origin": "ML-1", "reached": ["U01", "U02"]}


def test_breakout_expected_for_equipment_a_unit_and_a_sampling_origin():
    plan = _plan()
    assert q.breakout_expected(plan, _view("shared_equipment", "TL-1", 2, []), 7200) == {"origin": "TL-1", "reached": []}
    assert q.breakout_expected(plan, _view("unit_equipment", "U02", 2, []), 7199)["origin"] is None
    assert q.breakout_expected(plan, _view("unit_equipment", "U02", 2, []), 7200)["origin"] == "U02"
    # the sampling origin is the vessel of the sample, from its draw (U02-D00-1... here U01-D00-1 at 2000 s)
    sampling = _view("sampling", "U01-D00-1", None, [{"unit": 0, "onset_s": 2000}])
    assert q.breakout_expected(plan, sampling, 1999) == {"origin": None, "reached": []}
    assert q.breakout_expected(plan, sampling, 2000) == {"origin": "U01", "reached": ["U01"]}
    assert q.breakout_expected(plan, _view("medium_lot", "ML-9", 0, []), 9000)["origin"] is None


def test_breakout_problems_and_event_problems():
    plan = _plan()
    view = _view("medium_lot", "ML-1", 1, [{"unit": 0, "onset_s": 3000}])
    assert q.breakout_problems('{"origin":"ML-1","reached":["U01"]}', plan, view, 3600) == []
    assert "data-plant-breakout says" in q.breakout_problems('{"origin":null,"reached":[]}', plan, view, 3600)[0]
    q.EXPECTED_EVENT["case_x"] = {"origin": "ML-1", "reached": ["U01"]}
    try:
        assert q.event_problems("case_x", view, plan) == []
        assert "the scenario names" in q.event_problems("case_x", _view("medium_lot", "ML-2", 1, []), plan)[0]
    finally:
        del q.EXPECTED_EVENT["case_x"]


def test_the_typed_events_of_the_five_cases():
    assert sorted(q.EXPECTED_EVENT) == sorted(q.CASES)
    assert q.EXPECTED_EVENT["sc12_medium_lot"] == {"origin": "ML-3", "reached": ["U01", "U05"]}
    assert q.EXPECTED_EVENT["sc12_equipment"] == {"origin": "TL-1", "reached": ["U01", "U02"]}


def test_ask_problems_wants_nothing_before_and_two_picks_after():
    assert q.ask_problems([], [{"halls": True}, {"breakout": True}]) == []
    assert q.ask_problems([{"halls": True}], [{"halls": True}, {"breakout": True}])[0].startswith("1 plant_truth requests were sent before the switch")
    assert "expected one" in q.ask_problems([], [{"halls": True}])[0]
    assert "expected one" in q.ask_problems([], [{"halls": True}, {"breakout": True}, {"breakout": True}])[0]


def test_sent_picks_filters_by_epoch():
    sent = [{"type": "plant_truth", "epoch": 1, "pick": {"halls": True}}, {"type": "plant_run", "epoch": 1}, {"type": "plant_truth", "epoch": 2, "pick": {"breakout": True}}]
    assert q.sent_picks(sent) == [{"halls": True}, {"breakout": True}]
    assert q.sent_picks(sent, 2) == [{"breakout": True}]


def test_breakout_request_problems():
    ok = [{"type": "breakout", "case": "sc12_medium_lot", "seed": 9013, "halls": q.ARCHS, "actions": 0}]
    assert q.breakout_request_problems(ok, "sc12_medium_lot") == []
    assert q.breakout_request_problems([], "sc12_medium_lot") == ["0 breakout requests were sent, expected one"]
    bad = [{**ok[0], "case": "sc12_equipment", "halls": ["a_manual"], "actions": None}]
    assert len(q.breakout_request_problems(bad, "sc12_medium_lot")) == 3


def test_back_problems():
    assert q.back_problems("#/plant?case=sc12_medium_lot&arch=a_manual&seed=9013&t=305640&schema=1", "sc12_medium_lot", 305626) == []
    assert q.back_problems("#/plant?case=sc12_equipment&t=1", "sc12_medium_lot", 1)[0].startswith("the way back names the case")
    assert q.back_problems("#/plant?case=sc12_medium_lot&t=900", "sc12_medium_lot", 1000)[0].startswith("the way back holds the instant 900")
    assert q.back_problems(None, "sc12_medium_lot", 1) == ["the way back is None"]


def test_breakout_request_problems_wants_the_actions_of_the_plant():
    asked = [{"type": "breakout", "case": "sc12_medium_lot", "seed": 9013, "halls": q.ARCHS, "actions": 1}]
    assert q.breakout_request_problems(asked, "sc12_medium_lot", 1) == []
    assert q.breakout_request_problems(asked, "sc12_medium_lot") == ["the breakout request carries 1 actions, expected 0"]


def test_case_href_carries_actions_as_percent_encoded_json_between_the_seed_and_the_instant():
    feed = [{"kind": "add_feed", "at": 291600, "unit_id": "U03"}]
    assert q.case_href("sc12_medium_lot", "9.9.9", 5, feed) == (
        f"#/plant?case=sc12_medium_lot&arch={q.HALLS_ARG}&seed=9013&actions=%5B%7B%22kind%22%3A%22add_feed%22%2C%22at%22%3A291600%2C%22unit_id%22%3A%22U03%22%7D%5D&t=5&schema=1&engine=9.9.9"
    )


def test_case_href_has_the_key_order_of_the_plant_link():
    assert q.case_href("sc12_medium_lot", "9.9.9", 5) == f"#/plant?case=sc12_medium_lot&arch={q.HALLS_ARG}&seed=9013&t=5&schema=1&engine=9.9.9"
    assert q.case_href("sc12_medium_lot") == f"#/plant?case=sc12_medium_lot&arch={q.HALLS_ARG}&seed=9013&schema=1"
