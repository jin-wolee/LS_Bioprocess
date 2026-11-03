"""Pure helpers of the P6b checks of the headless QA of the plant (docs/design/plant_ui.md section 10): the matrix of the flags board against the plan, the flag form against the cell it was opened
from, the `run` request of Results against the actions Setup carried, the actions printed among the inputs of Results, and the sample a draw is moved for. Expected values are hand arithmetic on plans
and requests typed here, never taken from the code under test. The browser checks run through `uv run python scripts/qa/qa_plant.py`.
"""
from __future__ import annotations

import sys

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts" / "qa"))
import qa_plant_act_helpers as qa  # noqa: E402
import qa_plant_drill_helpers as qd  # noqa: E402

FLAGS = ["system_issued_id", "two_clocks", "audit_trail"]


def _plan(halls, records):
    return {"layout": {"architectures": halls}, "records": [{"architecture": a, "flags_on": on, "cards": []} for a, on in records]}


# ---------- the flags board ----------
def test_the_expected_matrix_is_on_off_or_pending_for_every_hall_of_the_layout_and_every_flag():
    plan = _plan(["a_manual", "c_context_minus_audit_trail", "b_lims_lite"], [("a_manual", []), ("c_context_minus_audit_trail", ["system_issued_id", "two_clocks"])])
    assert qa.expected_matrix(plan, FLAGS) == {
        "a_manual:system_issued_id": "off", "a_manual:two_clocks": "off", "a_manual:audit_trail": "off",
        "c_context_minus_audit_trail:system_issued_id": "on", "c_context_minus_audit_trail:two_clocks": "on", "c_context_minus_audit_trail:audit_trail": "off",
        "b_lims_lite:system_issued_id": "pending", "b_lims_lite:two_clocks": "pending", "b_lims_lite:audit_trail": "pending",
    }


def test_a_board_that_equals_the_plan_has_no_problem_and_one_that_differs_names_the_cell():
    plan = _plan(["a_manual", "c_context"], [("a_manual", ["audit_trail"]), ("c_context", FLAGS)])
    cells = qa.expected_matrix(plan, FLAGS)
    assert qa.matrix_problems(cells, plan, FLAGS) == []
    assert qa.matrix_problems({**cells, "a_manual:audit_trail": "off"}, plan, FLAGS) == ["the cell a_manual:audit_trail reads off, the plan's hall has it on"]
    missing = {k: v for k, v in cells.items() if k != "c_context:two_clocks"}
    assert qa.matrix_problems(missing, plan, FLAGS) == ["the board has no cell c_context:two_clocks"]
    assert qa.matrix_problems({**cells, "c_context_minus_x:two_clocks": "on"}, plan, FLAGS) == ["the board has a cell c_context_minus_x:two_clocks that the plan's halls do not have"]


def test_a_derived_hall_is_read_from_its_own_record_not_from_the_one_it_was_made_from():
    # C minus audit_trail has the flag off; a board that took the flags of C would say on
    plan = _plan(["c_context_minus_audit_trail"], [("c_context_minus_audit_trail", ["system_issued_id", "two_clocks"])])
    assert qa.matrix_problems({"c_context_minus_audit_trail:audit_trail": "on", "c_context_minus_audit_trail:system_issued_id": "on", "c_context_minus_audit_trail:two_clocks": "on"}, plan, FLAGS) == [
        "the cell c_context_minus_audit_trail:audit_trail reads on, the plan's hall has it off"]


def test_the_flag_form_of_a_cell_is_the_opposite_state_on_the_record_the_run_began_with():
    cells = {"c_context_minus_audit_trail:two_clocks": "on", "a_manual:audit_trail": "off", "b_lims_lite:audit_trail": "pending"}
    ok = {"architecture": "c_context", "flag": "two_clocks", "on": "false"}
    assert qa.flag_form_problems(ok, cells, "c_context_minus_audit_trail", "c_context") == []
    assert qa.flag_form_problems({**ok, "on": "true"}, cells, "c_context_minus_audit_trail", "c_context") == ["the form switches two_clocks in c_context_minus_audit_trail to true, the cell is on so the opposite is false"]
    assert qa.flag_form_problems({**ok, "architecture": "c_context_minus_audit_trail"}, cells, "c_context_minus_audit_trail", "c_context") == [
        "the form names the hall c_context_minus_audit_trail, expected the record the run began with: c_context"]
    # off or not yet arrived: the opposite is on
    assert qa.flag_form_problems({"architecture": "a_manual", "flag": "audit_trail", "on": "true"}, cells, "a_manual", "a_manual") == []
    assert qa.flag_form_problems({"architecture": "b_lims_lite", "flag": "audit_trail", "on": "true"}, cells, "b_lims_lite", "b_lims_lite") == []
    assert qa.flag_form_problems({"architecture": "a_manual", "flag": "nonesuch", "on": "true"}, cells, "a_manual", "a_manual") == ["the board has no cell a_manual:nonesuch for the form to be opened from"]


# ---------- Results from the plant ----------
def test_the_run_request_carries_the_kinds_and_the_seeds_the_setup_screen_showed():
    sent = [{"type": "plant_run"}, {"type": "run", "kinds": ["add_feed", "analyzer_down"], "seeds": [1, 2]}]
    assert qd.run_problems(sent, ["add_feed", "analyzer_down"], [1, 2]) == []
    assert qd.run_problems(sent, ["add_feed"], [1, 2]) == ["the last run request carries the actions ['add_feed', 'analyzer_down'], expected ['add_feed']"]
    assert qd.run_problems(sent, ["add_feed", "analyzer_down"], [1]) == ["the last run request is for the seeds [1, 2], expected [1]"]
    assert qd.run_problems([{"type": "plant_run"}], None, [1]) == ["the page sent no run request"]


def test_a_setup_opened_without_the_plant_sends_a_run_with_no_actions_field():
    assert qd.run_problems([{"type": "run", "kinds": None, "seeds": [1]}], None, [1]) == []
    assert qd.run_problems([{"type": "run", "kinds": [], "seeds": [1]}], None, [1]) == ["the last run request carries the actions [], expected none (the field is absent)"]


def test_the_printed_inputs_of_results_hold_each_action_with_its_ledger_entry():
    printed = [{"name": "act-1 add_feed U10 at", "ref": "A228"}, {"name": "act-2 analyzer_down AN-1 from", "ref": "A228"}, {"name": "act-2 analyzer_down AN-1 length", "ref": "A096"}, {"name": "min_seeds", "ref": "A103"}]
    want = [("act-1 add_feed U10 at", "A228"), ("act-2 analyzer_down AN-1 from", "A228"), ("act-2 analyzer_down AN-1 length", "A096")]
    assert qd.results_inputs_problems(printed, want) == []
    assert qd.results_inputs_problems(printed[:2] + printed[3:], want) == ["the inputs of Results do not list act-2 analyzer_down AN-1 length (A096)"]
    # an entry of None only has to be a ledger id
    assert qd.results_inputs_problems(printed, [("act-2 analyzer_down AN-1 length", None)]) == []
    assert qd.results_inputs_problems([{"name": "x", "ref": "nope"}], [("x", None)]) == ["the input x carries 'nope', which is no ledger id"]
    wrong = [{**printed[0], "ref": "A001"}, *printed[1:]]
    assert qd.results_inputs_problems(wrong, want) == ["the input act-1 add_feed U10 at carries A001, expected A228"]


def test_the_two_lists_of_setup_are_the_kept_and_the_left_out_actions_in_the_order_of_the_plant():
    assert qd.setup_lists_problems(["add_feed", "analyzer_down"], ["move_draw", "set_capture_path"], ["add_feed", "analyzer_down"], ["move_draw", "set_capture_path"]) == []
    assert qd.setup_lists_problems(["add_feed", "move_draw"], [], ["add_feed"], ["move_draw"]) == [
        "Setup carries the actions ['add_feed', 'move_draw'], expected ['add_feed']", "Setup leaves out [], expected ['move_draw']"]


def test_the_sample_a_draw_is_moved_for_is_the_first_planned_in_the_window_of_the_day_and_not_skipped():
    day = 86400
    plan = {"samples": [
        {"id": "U01-D08-1", "planned_s": 8 * day + 9 * 3600, "skipped": False},   # before the window
        {"id": "U02-D08-1", "planned_s": 8 * day + 10 * 3600 + 20 * 60, "skipped": True},  # skipped
        {"id": "U03-D08-1", "planned_s": 8 * day + 11 * 3600 + 5 * 60, "skipped": False},  # the one
        {"id": "U04-D08-1", "planned_s": 8 * day + 12 * 3600, "skipped": False},
    ]}
    assert qd.late_sample(plan, 8, 10, 14) == ("U03-D08-1", 8 * day + 11 * 3600 + 20 * 60)
    assert qd.late_sample(plan, 8, 15, 16) is None
