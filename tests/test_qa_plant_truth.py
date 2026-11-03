"""Pure helpers of scripts/qa_plant_truth_helpers.py (the checks `plant_truth` and `plant_panels` of the headless QA of the plant, docs/design/plant_ui.md section 10, P5b).

Expected values are hand arithmetic on a plan typed by hand, never taken from the code under test. The browser checks themselves run through `uv run python scripts/qa_plant.py`.
"""
from __future__ import annotations

import sys

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts"))
import qa_plant_truth_helpers as qp  # noqa: E402

# A plan typed by hand (the shape of the Worker's ScenePlan, the parts the helpers read): two halls over five samples (the fourth skipped, the fifth never drawn), two operators, two analyzers of one group.
def _plan():
    def visit(analyzer, queued, started, ended, attempt=1):
        return {"analyzer": analyzer, "queued_s": queued, "started_s": started, "run_started_s": started, "ended_s": ended, "attempt": attempt, "qc": "qc_passed", "setup_s": 0, "diluted": False}

    def sample(id_, unit, operator, drawn, visits, skipped=False):
        return {"id": id_, "unit": unit, "operator": operator, "planned_s": drawn - 10, "drawn_s": drawn, "arrived_s": None if skipped else drawn + 100, "label": None, "kind": "routine", "skipped": skipped, "visits": visits}

    return {
        "units": [{"id": "U01"}, {"id": "U02"}], "analyzers": [{"id": "AN-1", "group": "AIO"}, {"id": "AN-2", "group": "AIO"}], "staff": [{"id": "OP-01"}, {"id": "OP-02"}],
        "samples": [
            sample("U01-D00-1", 0, 0, 1000, [visit(0, 1100, 1100, 1370)]),
            sample("U01-D00-2", 0, 0, 2000, [visit(0, 2100, 2500, 2770), visit(1, 2770, 2770, 3040, 2)]),
            sample("U02-D00-1", 1, 1, 3000, []),
            sample("U02-D00-2", 1, None, 4000, [], skipped=True),
            {**sample("U02-D00-3", 1, 1, 5000, []), "drawn_s": None, "arrived_s": None},
        ],
        "records": [
            {"architecture": "a", "cards": [{"sample": 0}, {"sample": 1}]},
            {"architecture": "b", "cards": [{"sample": 0}, {"sample": 1}, {"sample": 2}]},
        ],
    }


def test_the_plan_walk_finds_the_keys_and_values_of_the_overlay_and_of_the_hidden_fields():
    clean = {"type": "plant_ready", "plan": {"samples": [{"id": "x", "skipped": False}]}, "hashes": {"truth": "abc"}}
    assert qp.truth_leaks([clean]) == []
    for bad in ({"verdict": "correct"}, {"x": {"answers": []}}, {"placeholders": []}, {"realised_errors": []}, {"true_value": 1}, {"true_state": {}}, {"drift_before_pct": 1}, {"list": [{"why": "skipped"}]}):
        assert qp.truth_leaks([{"type": "plant_halls", **bad}]), bad
    assert qp.truth_leaks([{"type": "plant_ready", "plan": {"marks": [{"kind": "contamination_onset"}]}}])
    assert qp.truth_leaks([{"type": "plant_halls", "records": [{"note": "unanswerable"}]}])
    assert qp.truth_leaks([{"type": "plant_ready", "plan": {"x": "label_error"}}])


def test_the_overlay_messages_are_not_leaks():
    # a plant_truth_view is the one message that may carry them; the walk is for the plan, the halls and the record view only
    assert qp.truth_leaks([{"type": "plant_truth_view", "view": {"kind": "halls", "halls": [{"placeholders": []}]}}]) == []


def test_the_placeholders_at_an_instant_are_the_drawn_samples_with_no_card_in_the_hall():
    plan = _plan()
    # a has no card for sample 2 (drawn 3000) and 3 (skipped, 4000); b has a card for 0, 1, 2 and none for the skipped one; sample 4 is never drawn, so no hall lacks it
    assert qp.absences_expected(plan, 10_000) == {"a": 2, "b": 1}
    assert qp.absences_expected(plan, 3999) == {"a": 1, "b": 0}
    assert qp.absences_expected(plan, 2999) == {"a": 0, "b": 0}
    assert qp.absences_expected(plan, 0) == {"a": 0, "b": 0}


def test_the_overlay_elements_must_each_say_that_they_are_the_simulations_view():
    label = "Simulation's own view, not available to any record"
    short = "Simulation's view"
    # the switch says the whole sentence; each marker in the scene says the short label (P8a)
    assert qp.label_problems([{"text": label}, {"text": f"a holds none of 3 samples\n{short}", "marker": True}], label, short) == []
    out = qp.label_problems([{"text": label}, {"text": "a holds none of 3 samples", "marker": True}], label, short)
    assert len(out) == 1 and "2nd" in out[0] and "short label" in out[0]
    out = qp.label_problems([{"text": label}, {"text": "a holds none of 3 samples"}], label, short)
    assert len(out) == 1 and "2nd" in out[0] and "lacks the label" in out[0]
    assert qp.label_problems([], label, short) == ["no element of the overlay is marked data-overlay"]


def test_a_marker_that_repeats_the_whole_sentence_is_one_caption_too_many_and_the_page_must_say_it_once():
    label = "Simulation's own view, not available to any record"
    short = "Simulation's view"
    out = qp.label_problems([{"text": label}, {"text": f"Origin ML-3\n{label}\n{short}", "marker": True}], label, short)
    assert len(out) == 1 and "repeats the whole sentence" in out[0]
    out = qp.label_problems([{"text": f"a holds none\n{short}", "marker": True}], label, short)
    assert out == ["no element of the page says the whole sentence of the label"]


def test_the_numbers_of_a_panel_are_counts_of_the_rows_of_the_plan_up_to_the_instant():
    plan = _plan()
    # reactor U01 (unit 0) at 2500: the samples drawn on it are the two of unit 0; U02 (unit 1) at 3500: one (the skipped draw left no sample, the undrawn one is not drawn)
    assert qp.panel_numbers(plan, "reactor", 0, 2500) == {"drawn": 2}
    assert qp.panel_numbers(plan, "reactor", 0, 1500) == {"drawn": 1}
    assert qp.panel_numbers(plan, "reactor", 1, 6000) == {"drawn": 1}
    # OP-01 (operator 0) drew the first two, OP-02 the third; the skipped draw has no operator
    assert qp.panel_numbers(plan, "staff", 0, 2500) == {"drawn": 2}
    assert qp.panel_numbers(plan, "staff", 1, 6000) == {"drawn": 1}
    # AN-1 finished the visits that ended by the instant on it: 1370 and 2770; AN-2 one at 3040. The lane holds the visits queued and not started: sample 1's first visit waits from 2100 to 2500
    assert qp.panel_numbers(plan, "analyzer", 0, 2300) == {"finished": 1, "lane": 1}
    assert qp.panel_numbers(plan, "analyzer", 0, 2770) == {"finished": 2, "lane": 0}
    assert qp.panel_numbers(plan, "analyzer", 1, 3040) == {"finished": 1, "lane": 0}
    # a sample: the visits queued by the instant, and the operator's id
    assert qp.panel_numbers(plan, "sample", 1, 2200) == {"visits": 1, "operator": "OP-01"}
    assert qp.panel_numbers(plan, "sample", 1, 2800) == {"visits": 2, "operator": "OP-01"}


def test_the_screen_of_a_tube_is_inside_the_view_when_both_coordinates_are_between_minus_one_and_one():
    assert qp.follow_problems(["[0.000,0.000]", "[0.5,-0.5]", "[1,1]"]) == []
    assert qp.follow_problems(["[0.0,0.0]", "[1.2,0.0]", "[0,-1.5]"]) == ["frame 2: the tube is at [1.2,0.0], outside the view", "frame 3: the tube is at [0,-1.5], outside the view"]
    assert qp.follow_problems([]) == ["no frame of the follow was read"]
    assert qp.follow_problems(["nonsense"]) == ["frame 1: the tube position is not read: nonsense"]


def test_the_instants_of_a_sample_are_its_draw_its_arrival_and_the_instants_of_its_visits():
    plan = _plan()
    # sample 1: drawn at 2000, arrived at 2100; visits queued 2100, started 2500, run started 2500, ended 2770, and queued 2770, started 2770, run started 2770, ended 3040
    assert qp.sample_times(plan, 1) == [2000, 2100, 2500, 2770, 3040]
    assert qp.sample_times(plan, 3) == [4000]  # a skipped draw: the skip, no arrival
    assert qp.sample_times(plan, 4) == []  # never drawn


def test_a_quiet_instant_is_on_a_shift_and_far_from_every_draw_of_the_operator():
    plan = {**_plan(), "horizon_s": 20000, "staff": [{"id": "OP-01", "on_duty": [[0, 10000]]}, {"id": "OP-02", "on_duty": [[12000, 20000]]}]}
    # OP-01 drew at 1000 and 2000 (samples 0 and 1); from 600 on in steps of 300 the first instant more than 900 s from both is 3000 (2700 is 700 s from the draw at 2000, 3000 is 1000 s)
    assert qp.quiet_instant(plan, 0, 600) == 3000
    assert qp.quiet_instant(plan, 0, 9300) == 9300  # still on the shift at 9300 and far from the draws
    assert qp.quiet_instant(plan, 1, 0) == 12000  # off duty before 12000; OP-02 drew at 3000 and 5000 (the undrawn sample has no instant)
    assert qp.quiet_instant(plan, 0, 10000) is None  # the shift is over and there is no other
