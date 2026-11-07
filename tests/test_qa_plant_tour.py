"""Tests of the pure helpers of the check `plant_tour` (scripts/qa/qa_plant_tour_helpers.py; docs/design/plant_ui.md sections 3.5 and 10, P8b). Expected values are typed from the single-sample trace of SC3
(docs/design/single_sample_trace.md) and hand arithmetic on it, never read off the helpers."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "qa"))

from qa_plant_tour_helpers import (  # noqa: E402
    card_cells, centre_problems, expected_steps, offer_problems, reduced_tour_problems, step_problems, tour_sample, trace_problems, truth_request_problems, verdict_problems,
)


def visit(analyzer, run, ended, attempt=1):
    return {"analyzer": analyzer, "queued_s": run, "started_s": run, "run_started_s": run, "ended_s": ended, "attempt": attempt, "qc": "qc_passed", "setup_s": 0, "diluted": False}


def sample(id_, unit, drawn, visits, **extra):
    return {"id": id_, "unit": unit, "operator": 0, "planned_s": (drawn or 0) - 225, "drawn_s": drawn, "arrived_s": None, "label": "handwritten", "kind": "routine", "skipped": False, "visits": visits, **extra}


def card(index, sampled_at, basis):
    slots = [{"name": "unit", "stored": True}, {"name": "sampled_at", "stored": sampled_at}, {"name": "context", "stored": True, "basis": basis}, {"name": "value", "stored": True}]
    return {"sample": index, "shown_s": 900887, "available_s": None, "slots": slots, "findings": [], "version_s": [901157]}


def plan():
    return {
        "units": [{"id": "U01"}, {"id": "U02"}, {"id": "U03"}],
        "analyzers": [{"id": "AN-1"}, {"id": "AN-2"}],
        "samples": [
            sample("U01-D10-1", 0, 899200, [visit(0, 899500, 899700)]),
            sample("U02-D10-1", 1, 899841, [visit(1, 900887, 901157)]),
            sample("U03-D10-2", 2, 899841, [visit(0, 900887, 901157)]),
            sample("U03-D10-3", 2, 899900, [visit(1, 900950, 901200)]),
        ],
        "marks": [{"t": 899100, "unit": 0, "kind": "feed"}, {"t": 900000, "unit": 0, "kind": "feed"}, {"t": 900000, "unit": 2, "kind": "feed"}, {"t": 910000, "unit": 1, "kind": "feed"}],
        "layout": {"architectures": ["a_manual", "b_lims_lite", "c_context"]},
        "records": [
            {"architecture": "a_manual", "cards": [card(2, False, "measured_at")]},
            {"architecture": "b_lims_lite", "cards": [card(2, False, "measured_at")]},
            {"architecture": "c_context", "cards": [card(2, True, "sampled_at")]},
        ],
    }


class TestTheSampleAndTheSteps:
    def test_the_sample_of_the_trace_is_found_by_the_rule_and_the_decoys_are_not(self):
        s = tour_sample(plan())
        assert (s["id"], s["unit"], s["drawn"], s["feeds"], s["run"], s["end"], s["analyzer"]) == ("U03-D10-2", 2, 899841, [900000], 900887, 901157, 0)

    def test_a_feed_outside_the_gap_by_a_second_does_not_count_and_one_on_either_end_does(self):
        def one(feed):
            p = {**plan(), "samples": [sample("U03-D10-2", 2, 899841, [visit(0, 900887, 901157)])], "marks": [{"t": feed, "unit": 2, "kind": "feed"}]}
            return tour_sample(p)
        assert one(899841) is not None and one(900887) is not None
        assert one(899840) is None and one(900888) is None

    def test_the_five_steps_have_the_instants_picks_and_frames_of_the_design(self):
        steps = expected_steps(plan())
        assert [s["id"] for s in steps] == ["draw", "feed", "run", "records", "truth"]
        assert [s["t"] for s in steps] == [899841, 900000, 900887, 901157, 901157]
        assert [s["pick"] for s in steps] == ["reactor:U03", "reactor:U03", "sample:U03-D10-2", None, None]
        assert [s["look"] for s in steps] == ["station:U03", "station:U03", "sample:U03-D10-2", "halls:all", "halls:all"]
        assert [s["panel"] for s in steps] == ["reactor", "reactor", "sample", None, "record"]
        assert [s["truth"] for s in steps] == ["off", "off", "off", "off", "on"]

    def test_a_plan_with_no_such_sample_has_no_step(self):
        assert expected_steps({**plan(), "marks": []}) == []

    def test_the_plan_agrees_with_the_trace_or_the_problem_is_named(self):
        assert trace_problems(expected_steps(plan())) == []
        moved = expected_steps({**plan(), "marks": [{"t": 900001, "unit": 2, "kind": "feed"}]})
        assert trace_problems(moved) == ["the feed step is at 900001 s, the trace has 900000 s"]
        assert trace_problems([]) == ["the plan gives no step"]

    def test_the_cells_of_the_card_table_are_the_slots_of_the_cards(self):
        cells = card_cells(plan(), 2)
        assert cells[("a_manual", "sampled_at")] == (False, None) and cells[("b_lims_lite", "context")] == (True, "measured_at")
        assert cells[("c_context", "sampled_at")] == (True, None) and cells[("c_context", "context")] == (True, "sampled_at")
        assert len(cells) == 12


class TestWhatThePageShows:
    WANT = {"id": "feed", "t": 900000, "pick": "reactor:U03", "look": "station:U03", "panel": "reactor", "truth": "off"}

    def got(self, **kw):
        return {"tour": "feed", "t": "900000", "playing": "false", "pick": "reactor:U03", "look": "station:U03", "truth": "off", **kw}

    def test_a_step_that_lands_where_it_must_has_no_problem(self):
        assert step_problems(self.got(), self.WANT, "step 2") == []

    def test_each_attribute_that_differs_is_named(self):
        assert step_problems(self.got(t="900001"), self.WANT, "step 2") == ["step 2: the clock is at 900001, the step's instant is 900000"]
        assert step_problems(self.got(playing="true"), self.WANT, "step 2") == ["step 2: the clock is playing; a step holds it paused"]
        assert step_problems(self.got(pick=None), self.WANT, "step 2") == ["step 2: the picked object is None, expected reactor:U03"]
        assert step_problems(self.got(look="station:U04"), self.WANT, "step 2") == ["step 2: the camera was brought to station:U04, expected station:U03"]
        assert step_problems(self.got(truth="on"), self.WANT, "step 2") == ["step 2: the overlay is on, expected off"]

    def test_the_camera_is_on_its_target_when_its_place_on_the_screen_is_the_middle(self):
        assert centre_problems([0.0, 0.0], 0.05, "x") == []
        assert centre_problems([0.3, 0.0], 0.05, "x") == ["x: the camera is at (0.30, 0.00) from its target, not within 0.05"]
        assert centre_problems(None, 0.05, "x") == ["x: the page wrote no place for the camera's target"]

    def test_the_overlay_is_asked_at_its_step_and_not_before(self):
        none = []
        halls = {"type": "plant_truth", "pick": {"halls": True}}
        one = {"type": "plant_truth", "pick": {"sample_id": "U03-D10-2"}}
        assert truth_request_problems(none, "records") == []
        assert truth_request_problems([halls, one], "truth") == []
        assert truth_request_problems([halls], "records") == ["the overlay was asked before its step: 1 plant_truth request(s) at the step records"]
        assert truth_request_problems([halls], "truth") == ["the overlay's step asked for 1 plant_truth request(s): the halls and the sample were expected"]

    def test_the_verdicts_are_the_ones_of_the_trace(self):
        want = {"a_manual:unit": "correct", "a_manual:sampled_at": "unanswerable", "a_manual:process_context": "wrong",
                "b_lims_lite:unit": "correct", "b_lims_lite:sampled_at": "unanswerable", "b_lims_lite:process_context": "wrong",
                "c_context:unit": "correct", "c_context:sampled_at": "correct", "c_context:process_context": "correct"}
        assert verdict_problems(want) == []
        assert verdict_problems({**want, "c_context:process_context": "wrong"}) == ["c_context:process_context: the page says wrong, the trace says correct"]
        assert verdict_problems({}) == ["the verdict table has 0 cells, the trace has 9"]


class TestTheOfferAndReducedMotion:
    def test_the_offer_is_made_once_and_kept(self):
        assert offer_problems(first=1, key="seen", declined_left=0, reload_offers=0, button=True) == []
        assert offer_problems(first=0, key=None, declined_left=0, reload_offers=0, button=True) == ["the first entry showed 0 offers, expected 1", "the key plant.tour is None after the offer, expected 'seen'"]
        assert offer_problems(first=1, key="seen", declined_left=1, reload_offers=1, button=False) == ["Not now left the offer on the page", "the second visit offered the tour again", "the second visit has no button to take the tour"]

    def test_reduced_motion_cuts_and_the_control_glides(self):
        assert reduced_tour_problems({"ndc": [0.0, 0.0]}, {"ndc": [0.4, -0.2]}) == []
        assert reduced_tour_problems({"ndc": [0.4, 0.0]}, {"ndc": [0.4, -0.2]}) == ["under reduced motion the camera is at (0.40, 0.00) from its target two frames after a step: it glides instead of cutting"]
        assert reduced_tour_problems({"ndc": [0.0, 0.0]}, {"ndc": [0.0, 0.01]}) == ["without the preference the camera is already on its target two frames after a step (the control of the check)"]
