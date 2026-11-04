"""Pure helpers of scripts/qa/qa_lab_oneflag_helpers.py (the check `one_flag`: the card on Home, A3, docs/design/lab_ui.md section 26).

Expected values are typed by hand (the seeds are the first 20 of data/scenarios/experiments/experiment1.json as the file lists them), never taken from the code under test. The browser check itself
runs through `uv run python scripts/qa/qa_lab.py`.
"""
from __future__ import annotations

import copy
import sys

import pytest

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts" / "qa"))
import qa_lab_oneflag_helpers as of  # noqa: E402

SEEDS = [1009, 1103, 1259, 1381, 1511, 1627, 1777, 1913, 2003, 2129, 2269, 2381, 2551, 2663, 2791, 2903, 3041, 3181, 3329, 3457]
ARCHS = ["c_context", "c_context_minus_two_clocks"]
METRICS = {
    "mismatch": ["alignment_error.context_mismatch"],
    "detection": ["detection.by_type.feed_in_gap.recall", "detection.by_type.feed_in_gap.precision", "detection.by_type.feed_in_gap.false_alarm", "detection.by_type.feed_in_gap.realised"],
    "cost": ["hold_limit.rejected", "availability.available"],
}


def _figure(metric, status="reported", value="median 0.5, range 0.25-0.75"):
    return {"metric": metric, "status": status, "value": value, "in_block": True}


def _found(**over):
    questions = [
        {"id": q, "title": f"title of {q}", "note_cost": q == "cost",
         "columns": [{"arch": a, "head": a + (" C with one flag off Two clocks two_clocks" if a == ARCHS[1] else " preset"), "figures": [_figure(m) for m in METRICS[q]]} for a in ARCHS]}
        for q in ("mismatch", "detection", "cost")
    ]
    found = {"card": True, "answer": True, "results_in_card": 1, "facts": {"scenario": "sc03_feed_in_gap", "seeds": ", ".join(str(s) for s in SEEDS), "engine": "1.0.0", "architectures": ", ".join(ARCHS), "check": "passed"},
             "questions": questions, "figures_outside": 0, "text": "What one stored timestamp changes. Run a synthetic case.", "overflow": 0}
    return {**found, **over}


def test_the_seeds_are_the_first_twenty_of_the_experiment_file():
    assert of.one_flag_seeds() == SEEDS
    assert of.ONE_FLAG_ARCHS == ARCHS
    assert of.ONE_FLAG_QUESTIONS == METRICS


def test_the_questions_of_the_design_never_include_exact_reconstruction():
    assert not any("exact_reconstruction" in m for ms in of.ONE_FLAG_QUESTIONS.values() for m in ms)


def test_an_answer_that_is_as_the_design_says_has_no_problem():
    assert of.one_flag_problems(_found()) == []
    assert of.one_flag_problems(_found(), "ko") == []


def test_a_page_without_the_card_or_without_the_answer_is_one_problem():
    assert of.one_flag_problems({"card": False}) == ["Home has no card #one-flag"]
    assert of.one_flag_problems(_found(answer=False)) == ["the card shows no answer"]


def test_two_result_blocks_in_the_card_are_named():
    problems = of.one_flag_problems(_found(results_in_card=2))
    assert len(problems) == 1 and "2 result blocks" in problems[0], problems


@pytest.mark.parametrize("key, value", [("scenario", "default"), ("seeds", "1009, 1103"), ("architectures", "c_context_minus_two_clocks, c_context")])
def test_a_block_that_does_not_say_what_was_run_is_named(key, value):
    found = _found()
    found["facts"][key] = value
    problems = of.one_flag_problems(found)
    assert len(problems) == 1 and key in problems[0], problems


def test_questions_out_of_order_or_missing_are_named():
    found = _found()
    found["questions"].reverse()
    assert any("questions are" in p for p in of.one_flag_problems(found))
    found = _found()
    found["questions"].pop()
    assert any("questions are" in p for p in of.one_flag_problems(found))


def test_records_sorted_by_value_instead_of_the_order_of_the_run_are_named_in_every_question():
    found = _found()
    for q in found["questions"]:
        q["columns"].reverse()
    problems = of.one_flag_problems(found)
    assert len([p for p in problems if "the records stand in the order" in p]) == 3, problems


def test_a_question_that_lacks_a_figure_or_holds_another_is_named():
    found = _found()
    found["questions"][1]["columns"][0]["figures"].pop(1)  # a recall without its precision
    problems = of.one_flag_problems(found)
    assert len(problems) == 1 and "detection / c_context" in problems[0], problems
    found = _found()
    found["questions"][0]["columns"][1]["figures"][0] = _figure("exact_reconstruction")
    problems = of.one_flag_problems(found)
    assert len(problems) == 1 and "exact_reconstruction" in problems[0], problems


def test_a_figure_outside_the_result_block_is_named_by_figure_and_by_count():
    found = _found(figures_outside=1)
    found["questions"][2]["columns"][1]["figures"][1]["in_block"] = False
    problems = of.one_flag_problems(found)
    assert len(problems) == 2 and any("outside the result block" in p for p in problems) and any("1 figures" in p for p in problems), problems


def test_a_status_that_is_not_the_reports_is_named_and_a_reported_figure_must_show_a_number():
    found = _found()
    found["questions"][0]["columns"][0]["figures"][0]["status"] = "great"
    assert any("status 'great'" in p for p in of.one_flag_problems(found))
    found = _found()
    found["questions"][0]["columns"][0]["figures"][0]["value"] = "no figure"
    assert any("reported, but the figure shows no number" in p for p in of.one_flag_problems(found))


def test_a_figure_with_no_value_may_show_a_reason_with_a_digit_of_the_engine_and_is_not_judged_by_its_digits():
    found = _found()
    figure = found["questions"][1]["columns"][1]["figures"][0]
    figure.update(status="not_evaluable", value="not evaluable reason: VR-010: sampled_at is not stored (two_clocks off)")
    assert of.one_flag_problems(found) == []


def test_the_note_on_the_cost_of_the_second_clock_belongs_to_the_third_question_alone():
    found = _found()
    found["questions"][0]["note_cost"] = True
    assert any("belongs to the question 'cost' alone" in p for p in of.one_flag_problems(found))
    found = _found()
    found["questions"][2]["note_cost"] = False
    assert any("belongs to the question 'cost' alone" in p for p in of.one_flag_problems(found))


@pytest.mark.parametrize("head", ["c_context", "c_context_minus_two_clocks"])
def test_the_head_of_a_record_names_its_id_and_the_flag_only_for_the_ablation(head):
    found = _found()
    found["questions"][0]["columns"][0 if head == "c_context" else 1]["head"] = "preset two_clocks" if head == "c_context" else "ablation"
    problems = of.one_flag_problems(found)
    assert len(problems) == 1 and "the head of the record" in problems[0], problems


@pytest.mark.parametrize("text, words", [("C is the best record", ["best"]), ("C wins and ranks first", ["wins", "ranks"]), ("a higher share and more requests", ["higher", "more"]), ("the rule rejects results", [])])
def test_words_that_rank_or_compare_the_records_in_english_are_found(text, words):
    assert of.ordering_found(text, "en") == words
    assert of.one_flag_problems(_found(text=text)) == ([] if not words else [f"en: words that rank or compare the records: {words}"])


@pytest.mark.parametrize("text, words", [("C가 더 좋습니다", ["더 좋"]), ("가장 많은 요청", ["가장"]), ("거절한 요청의 비율", [])])
def test_words_that_rank_or_compare_the_records_in_korean_are_found(text, words):
    assert of.ordering_found(text, "ko") == words


def test_a_sideways_scroll_is_named():
    problems = of.one_flag_problems(_found(overflow=12))
    assert len(problems) == 1 and "12 px" in problems[0], problems


def test_the_statuses_and_the_signature_follow_the_order_shown():
    found = _found()
    found["questions"][2]["columns"][1]["figures"][0].update(status="not_evaluable", value="not evaluable")
    shown = of.statuses(found)
    assert shown[0] == ("mismatch", "c_context", "alignment_error.context_mismatch", "reported")
    assert shown[-2] == ("cost", "c_context_minus_two_clocks", "hold_limit.rejected", "not_evaluable")
    assert len(shown) == 2 * (1 + 4 + 2)
    assert of.signature(found)[-2][4] == "not evaluable"
    assert copy.deepcopy(of.signature(found)) == of.signature(found)


# ---------- what the page sent ----------
def test_a_page_that_asked_for_no_run_with_an_architecture_before_a_click_has_no_problem():
    assert of.one_flag_load_problems([{"type": "run", "architectures": []}, {"type": "fleet_check"}, {"type": "plant_run"}]) == []
    assert of.one_flag_load_problems([]) == []


def test_a_run_with_an_architecture_before_any_click_is_named():
    problems = of.one_flag_load_problems([{"type": "run", "architectures": []}, {"type": "run", "architectures": ARCHS}])
    assert len(problems) == 1 and "before any click" in problems[0], problems


def _request(**over):
    return {**{"type": "run", "scenario": "sc03_feed_in_gap", "architectures": ARCHS, "seeds": SEEDS, "settings": {}, "has_actions": False, "keys": ["schema_version", "scenario", "settings", "architectures", "seeds"]}, **over}


def test_the_run_of_the_design_is_the_only_request_a_click_may_send():
    assert of.one_flag_request_problems(_request()) == []
    assert of.one_flag_request_problems(None) == ["no run request was sent by the click"]


@pytest.mark.parametrize("over, word", [({"scenario": "default"}, "scenario"), ({"architectures": ARCHS[::-1]}, "in this order"), ({"architectures": ["c_context"]}, "in this order"), ({"seeds": SEEDS[:2]}, "seeds"),
                                        ({"settings": {"reactor_count": 3}}, "settings"), ({"has_actions": True}, "actions"), ({"keys": ["schema_version", "scenario", "settings", "architectures", "seeds", "capture_path"]}, "keys")])
def test_a_request_that_differs_from_the_design_is_named(over, word):
    problems = of.one_flag_request_problems(_request(**over))
    assert len(problems) == 1 and word in problems[0], problems


# ---------- the setup the link fills ----------
def _form(**over):
    return {**{"scenario": "sc03_feed_in_gap", "archs": {"a_manual": False, "b_lims_lite": False, "c_context": True}, "ablation": "c_context_minus_two_clocks", "seeds": ", ".join(str(s) for s in SEEDS), "running": False}, **over}


def test_the_setup_the_link_fills_is_the_settings_of_the_run_and_started_nothing():
    assert of.setup_problems(_form()) == []


@pytest.mark.parametrize("over, word", [({"scenario": "default"}, "scenario"), ({"archs": {"a_manual": True, "b_lims_lite": False, "c_context": True}}, "presets"), ({"ablation": ""}, "ablation"), ({"seeds": "1009"}, "seeds"), ({"running": True}, "started a run")])
def test_a_setup_that_is_not_the_run_of_the_card_or_that_started_one_is_named(over, word):
    problems = of.setup_problems(_form(**over))
    assert len(problems) == 1 and word in problems[0], problems
