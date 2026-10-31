"""Pure helpers of scripts/qa_lab_helpers.py (the headless QA of the lab page, docs/design/lab_ui.md section 12).

Expected values are hand arithmetic, never taken from the code under test. The browser checks themselves run through `uv run python scripts/qa_lab.py`.
"""
from __future__ import annotations

import gzip
import json
import sys

import pytest

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts"))
import qa_lab_breakout_helpers as bo  # noqa: E402
import qa_lab_helpers as qc  # noqa: E402
from qa_checks import VIEWPORTS  # noqa: E402

BASE = "http://127.0.0.1:8123/"


# ---------- median and the two budgets ----------
def test_median_of_an_odd_and_an_even_list():
    assert qc.median([5, 1, 3, 4, 2]) == 3
    assert qc.median([10, 20, 30, 40]) == 25


def test_median_of_one_value_and_of_nothing():
    assert qc.median([7.5]) == 7.5
    with pytest.raises(ValueError):
        qc.median([])


def test_the_budgets_are_the_ones_of_the_design():
    assert qc.SIZE_LIMIT == 300 * 1024
    assert qc.TIME_LIMIT_MS == 1000


@pytest.mark.parametrize("runs, ok", [([100, 90, 110, 95, 105], True), ([1000, 1000, 1000, 1000, 1000], True), ([1001, 1001, 1001, 1001, 1001], False), ([900, 900, 900, 1500, 1500], True), ([], False)])
def test_time_verdict_uses_the_median_of_the_runs_against_one_second(runs, ok):
    assert qc.time_verdict(runs)[1] is ok


def test_time_verdict_reports_the_median():
    assert qc.time_verdict([30, 10, 20, 50, 40]) == (30, True)


@pytest.mark.parametrize("total, ok", [(0, True), (307200, True), (307201, False)])
def test_size_verdict_is_a_limit_of_300_kb_in_bytes(total, ok):
    assert qc.size_verdict(total) is ok


# ---------- the request log ----------
def test_served_path_maps_a_url_of_the_server_to_a_file_of_the_build():
    assert qc.served_path(BASE, BASE) == "index.html"
    assert qc.served_path(BASE + "index.html", BASE) == "index.html"
    assert qc.served_path(BASE + "assets/worker-abc.js", BASE) == "assets/worker-abc.js"
    assert qc.served_path(BASE + "reference.json?x=1", BASE) == "reference.json"


def test_served_path_is_none_for_another_origin():
    assert qc.served_path("https://fonts.googleapis.com/css2?family=X", BASE) is None
    assert qc.served_path("http://127.0.0.1:9999/index.html", BASE) is None


def test_cross_origin_lists_every_request_to_another_origin_and_ignores_data_and_blob_urls():
    urls = [BASE, BASE + "assets/a.js", "https://example.org/x.js", "data:image/png;base64,AAAA", "blob:http://127.0.0.1:8123/uuid", "http://127.0.0.1:9/y"]
    assert qc.cross_origin(urls, BASE) == ["https://example.org/x.js", "http://127.0.0.1:9/y"]


def test_request_gzip_total_sums_the_gzip_size_of_each_file_once(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<p>" + "lineage " * 400 + "</p>", encoding="utf-8")
    (tmp_path / "assets/a.js").write_text("x" * 5000, encoding="utf-8")
    expected = sum(len(gzip.compress(p.read_bytes(), 6, mtime=0)) for p in (tmp_path / "index.html", tmp_path / "assets/a.js"))
    assert qc.request_gzip_total(["index.html", "assets/a.js", "index.html"], tmp_path) == expected


def test_request_gzip_total_fails_loudly_for_a_requested_file_that_the_build_lacks(tmp_path):
    with pytest.raises(FileNotFoundError):
        qc.request_gzip_total(["assets/missing.js"], tmp_path)


# ---------- the altered reference of the check ----------
REFERENCE = json.dumps(
    {
        "schema_version": "1",
        "engine_version": "0.2.0",
        "node": {"version": "v25.6.1", "flags": ["--no-maglev-escape-analysis"]},
        "truth": [{"seed": 1, "log_hash": "a" * 64}, {"seed": 2, "log_hash": "b" * 64}, {"seed": 3, "log_hash": "c" * 64}],
        "cells": {"seed": 1, "architectures": ["a_manual"], "digest": "d" * 64},
    },
    indent=2,
)


def test_alter_reference_changes_exactly_one_hex_digit_of_the_first_truth_hash():
    altered = json.loads(qc.alter_reference(REFERENCE))
    original = json.loads(REFERENCE)
    assert altered["truth"][0]["log_hash"] != original["truth"][0]["log_hash"]
    diff = [i for i, (x, y) in enumerate(zip(altered["truth"][0]["log_hash"], original["truth"][0]["log_hash"])) if x != y]
    assert len(diff) == 1 and len(altered["truth"][0]["log_hash"]) == 64
    assert all(c in "0123456789abcdef" for c in altered["truth"][0]["log_hash"])
    altered["truth"][0]["log_hash"] = original["truth"][0]["log_hash"]
    assert altered == original


def test_alter_reference_keeps_the_document_otherwise_byte_for_byte():
    # same text but for one character
    altered = qc.alter_reference(REFERENCE)
    assert len(altered) == len(REFERENCE)
    assert sum(1 for x, y in zip(altered, REFERENCE) if x != y) == 1


def test_alter_reference_of_a_hash_starting_with_the_replacement_digit_still_changes_it():
    ref = REFERENCE.replace("a" * 64, "0" + "a" * 63)
    assert json.loads(qc.alter_reference(ref))["truth"][0]["log_hash"] != "0" + "a" * 63


# ---------- words that must (not) appear ----------
def test_found_words_is_case_insensitive_and_reports_each_word_once():
    assert qc.found_words("The Browser check FAILED. Reproducible? byte for byte", ["reproducible", "byte for byte", "passed"]) == ["reproducible", "byte for byte"]
    assert qc.found_words("nothing here", ["reproducible"]) == []


def test_the_failed_state_must_not_contain_the_words_of_the_passed_state():
    assert qc.PASSED_ONLY_WORDS == ["reproducib", "byte for byte"]


# ---------- the numbers walk ----------
def test_number_offenders_keeps_the_text_nodes_that_have_a_digit_and_no_marked_ancestor():
    nodes = [
        {"text": "24 reactors", "marked": True, "where": "span.ref"},
        {"text": "Sample Lineage Lab", "marked": False, "where": "strong.brand"},
        {"text": "about 12 hours", "marked": False, "where": "p.lead"},
        {"text": "0.2.0", "marked": True, "where": "span"},
    ]
    assert qc.number_offenders(nodes) == [{"text": "about 12 hours", "where": "p.lead"}]


def test_number_offenders_ignores_whitespace_and_empty_nodes():
    assert qc.number_offenders([{"text": "   ", "marked": False, "where": "p"}, {"text": "", "marked": False, "where": "p"}]) == []


# ---------- themes ----------
def test_the_lab_sweeps_four_themes_and_two_viewports():
    assert [t[0] for t in qc.LAB_THEMES] == ["light", "dark", "auto-light", "auto-dark"]
    assert VIEWPORTS == {"1440": (1440, 900), "390": (390, 844)}


# ---------- the flags check (lab_ui.md section 11) ----------
FLAGS = ["system_issued_id", "two_clocks", "audit_trail"]


def test_flag_list_problems_is_empty_when_every_list_has_exactly_the_flags_of_ready():
    lists = [{"name": "setup-matrix", "flags": ["system_issued_id", "two_clocks", "audit_trail"]}, {"name": "notes-table", "flags": ["audit_trail", "two_clocks", "system_issued_id"]}]
    assert qc.flag_list_problems(lists, FLAGS) == []


def test_flag_list_problems_names_a_list_that_lacks_a_flag():
    problems = qc.flag_list_problems([{"name": "results-legend", "flags": ["system_issued_id", "two_clocks"]}], FLAGS)
    assert len(problems) == 1 and "results-legend" in problems[0] and "lacks audit_trail" in problems[0]


def test_flag_list_problems_names_a_list_that_has_a_flag_ready_does_not():
    problems = qc.flag_list_problems([{"name": "setup-matrix", "flags": [*FLAGS, "ninth"]}], FLAGS)
    assert len(problems) == 1 and "names ninth" in problems[0]


def test_flag_list_problems_names_a_flag_listed_twice():
    problems = qc.flag_list_problems([{"name": "setup-matrix", "flags": [*FLAGS, "two_clocks"]}], FLAGS)
    assert len(problems) == 1 and "twice" in problems[0] and "two_clocks" in problems[0]


def test_flag_list_problems_fails_when_there_is_no_list_at_all():
    assert qc.flag_list_problems([], FLAGS) == ["no list of flags (data-flag-list) on the screens checked"]


def test_the_lists_the_flags_check_expects_are_the_ones_that_exist_now():
    assert qc.EXPECTED_FLAG_LISTS == ["setup-matrix", "setup-ablation", "results-legend", "notes-table", "lineage-column", "lineage-ablation", "challenge-ablations"]


def test_missing_flag_lists_reports_an_expected_list_that_is_not_on_the_page():
    lists = [{"name": "setup-matrix", "flags": FLAGS}, {"name": "notes-table", "flags": FLAGS}]
    assert qc.missing_flag_lists(lists) == ["setup-ablation", "results-legend", "lineage-column", "lineage-ablation", "challenge-ablations"]


def test_the_break_out_lists_are_expected_only_where_the_page_offers_the_screen():
    assert qc.BREAKOUT_FLAG_LISTS == ["breakout-ablations", "breakout-column"]
    lists = [{"name": n, "flags": FLAGS} for n in qc.EXPECTED_FLAG_LISTS]
    assert qc.missing_flag_lists(lists) == []
    assert qc.missing_flag_lists(lists, breakout=True) == ["breakout-ablations", "breakout-column"]
    assert qc.missing_flag_lists(lists + [{"name": "breakout-ablations", "flags": FLAGS}], breakout=True) == ["breakout-column"]


# ---------- the label-error sentence (lab_ui.md section 10) ----------
SENTENCE = (
    "Without system_issued_id, a label error is not detected here. A conflict of the duplicate-file check (VR-008b) cannot tell a replayed file from two analyses that a label error gave the same "
    "label, and the double-label check (VR-009) looks for two different ids, so the error appears as false alarms of the type duplicate_replay. The numbers are shown as they are."
)


def test_label_error_sentence_is_the_one_of_the_design_note():
    assert qc.LABEL_ERROR_SENTENCE == SENTENCE


def test_label_sentence_ok_ignores_white_space_and_the_code_marks():
    assert qc.label_sentence_ok(SENTENCE)
    assert qc.label_sentence_ok("  " + SENTENCE.replace(". ", ".\n  ") + " ")
    assert not qc.label_sentence_ok(SENTENCE.replace("not detected", "detected"))
    assert not qc.label_sentence_ok("")


# ---------- no text that orders the architectures ----------
def test_ordering_words_finds_words_that_rank_or_declare_a_winner_and_nothing_else():
    assert qc.ordering_words("A is the best record; C wins and ranks first") == ["best", "wins", "ranks"]
    assert qc.ordering_words("the median of the spread across seeds, no single score") == []


def test_ordering_words_matches_whole_words_only():
    assert qc.ordering_words("a better-known bestiary rankine") == ["better"]


# ---------- recall beside precision and the false-alarm rate (spec section 8, rule 3) ----------
def test_detection_order_problems_accepts_recall_then_precision_then_false_alarm():
    groups = [{"type": "label_error", "figures": ["recall", "precision", "false_alarm", "realised"]}, {"type": "lost_rerun", "figures": ["recall", "false_alarm"]}]
    assert qc.detection_order_problems(groups) == []


def test_detection_order_problems_names_a_type_with_precision_and_no_recall():
    problems = qc.detection_order_problems([{"type": "feed_in_gap", "figures": ["precision", "false_alarm"]}])
    assert len(problems) == 1 and "feed_in_gap" in problems[0] and "no recall" in problems[0]


def test_detection_order_problems_names_a_type_where_precision_comes_before_recall():
    problems = qc.detection_order_problems([{"type": "label_error", "figures": ["precision", "recall", "false_alarm"]}])
    assert len(problems) == 1 and "before" in problems[0]


def test_detection_order_problems_fails_when_no_detection_block_exists():
    assert qc.detection_order_problems([]) == ["no detection block on the Results screen"]


# ---------- the small run of the end-to-end path ----------
def test_the_small_run_is_two_seeds_of_the_list_with_architectures_a_and_c():
    assert qc.SMALL_RUN == {"seeds": 2, "architectures": ["a_manual", "c_context"]}


def test_screens_are_the_seven_that_exist_now_and_break_out_sits_before_notes():
    assert qc.SCREENS == ["home", "setup", "results", "lineage", "challenge", "breakout", "notes"]


# ---------- a Ref inside running text stays on the line of its sentence (lab_ui.md section 6) ----------
REF = {"text": "A103", "top": 100, "bottom": 124}


def test_refs_off_their_line_accepts_text_before_and_after_on_the_line_of_the_ref():
    assert qc.refs_off_their_line([{**REF, "before": {"top": 102, "bottom": 120}, "after": {"top": 102, "bottom": 120}}]) == []


def test_refs_off_their_line_accepts_a_ref_at_the_start_or_end_of_its_text():
    assert qc.refs_off_their_line([{**REF, "before": None, "after": {"top": 102, "bottom": 120}}, {**REF, "before": {"top": 102, "bottom": 120}, "after": None}]) == []


def test_refs_off_their_line_names_text_before_the_ref_on_the_line_above():
    problems = qc.refs_off_their_line([{**REF, "before": {"top": 70, "bottom": 90}, "after": {"top": 102, "bottom": 120}}])
    assert len(problems) == 1 and "A103" in problems[0] and "before" in problems[0]


def test_refs_off_their_line_names_text_after_the_ref_on_the_line_below():
    problems = qc.refs_off_their_line([{**REF, "before": {"top": 102, "bottom": 120}, "after": {"top": 130, "bottom": 150}}])
    assert len(problems) == 1 and "after" in problems[0]


def test_refs_off_their_line_names_both_sides_of_a_block_level_ref():
    # the defect of the S3c review: the ref on a line of its own, the sentence in three lines
    problems = qc.refs_off_their_line([{**REF, "before": {"top": 70, "bottom": 90}, "after": {"top": 130, "bottom": 150}}])
    assert len(problems) == 2


# ---------- the lineage and challenge checks (lab_ui.md sections 8, 9 and 12) ----------
FIXTURE = {  # two of the three architectures of the single-sample trace, the answers typed as the read-only fixture holds them
    "a_manual": {"answers": {"unit": {"answer": "U03", "verdict": "correct"}, "sampled_at": {"answer": None, "verdict": "unanswerable"},
                             "process_context": {"answer": {"batch_phase": "after_shift", "feed_epoch": 4}, "verdict": "wrong"}}},
    "c_context": {"answers": {"unit": {"answer": "U03", "verdict": "correct"}, "sampled_at": {"answer": 899841, "verdict": "correct"},
                              "process_context": {"answer": {"batch_phase": "after_shift", "feed_epoch": 3}, "verdict": "correct"}}},
}


def page_answers(changes=None):
    """The answers as the page marks them: the answer as JSON text, one element per architecture and question."""
    rows = []
    for arch, body in FIXTURE.items():
        for question, a in body["answers"].items():
            rows.append({"architecture": arch, "question": question, "verdict": a["verdict"], "answer": json.dumps(a["answer"])})
    for r in rows:
        r.update((changes or {}).get((r["architecture"], r["question"]), {}))
    return rows


def test_lineage_answer_problems_accepts_the_answers_of_the_fixture():
    assert qc.lineage_answer_problems(page_answers(), FIXTURE) == []


def test_lineage_answer_problems_names_a_verdict_that_differs():
    got = qc.lineage_answer_problems(page_answers({("c_context", "sampled_at"): {"verdict": "wrong"}}), FIXTURE)
    assert got == ["c_context sampled_at: verdict wrong, the fixture says correct"]


def test_lineage_answer_problems_names_an_answer_that_differs_whatever_the_key_order_of_the_json():
    same = {("a_manual", "process_context"): {"answer": '{"feed_epoch": 4, "batch_phase": "after_shift"}'}}
    assert qc.lineage_answer_problems(page_answers(same), FIXTURE) == []
    other = {("a_manual", "process_context"): {"answer": '{"feed_epoch": 3, "batch_phase": "after_shift"}'}}
    assert qc.lineage_answer_problems(page_answers(other), FIXTURE) == ['a_manual process_context: answer {"feed_epoch": 3, "batch_phase": "after_shift"}, the fixture says {"batch_phase": "after_shift", "feed_epoch": 4}']


def test_lineage_answer_problems_names_a_missing_column_and_a_missing_question():
    rows = [r for r in page_answers() if not (r["architecture"] == "c_context" and r["question"] == "unit")]
    assert qc.lineage_answer_problems(rows, FIXTURE) == ["c_context unit: not on the page"]
    assert qc.lineage_answer_problems([], FIXTURE)[0] == "a_manual unit: not on the page"


def test_the_hand_typed_cells_are_those_of_the_cell_tables_for_a_b_and_c():
    # engine/tests/support/cell_tables.ts, the first three columns: A, B, C
    assert qc.HAND_CELLS == {"label_error": ["invisible", "prevented", "prevented"], "unit_rekey": ["invisible", "invisible", "prevented"], "duplicate_replay": ["invisible", "prevented", "prevented"]}


def reveal(kind, outcomes, evidence=None):
    names = ["a_manual", "b_lims_lite", "c_context"]
    return {"planted": {"type": kind}, "per_architecture": [{"architecture": n, "outcome": o, "evidence": (evidence or {}).get(n, [])} for n, o in zip(names, outcomes)]}


def test_outcome_problems_accepts_the_typed_cells():
    assert qc.outcome_problems(reveal("label_error", ["invisible", "prevented", "prevented"])) == []
    assert qc.outcome_problems(reveal("unit_rekey", ["invisible", "invisible", "prevented"])) == []


def test_outcome_problems_names_an_architecture_whose_outcome_differs_from_the_cell():
    got = qc.outcome_problems(reveal("duplicate_replay", ["invisible", "invisible", "prevented"]))
    assert got == ["duplicate_replay in b_lims_lite: invisible, the typed cell says prevented"]


def test_outcome_problems_names_evidence_where_the_cell_has_none_and_a_type_that_has_no_cell():
    got = qc.outcome_problems(reveal("label_error", ["detected", "prevented", "prevented"], {"a_manual": ["VR-009"]}))
    assert got == ["label_error in a_manual: detected (VR-009), the typed cell says invisible"]
    assert qc.outcome_problems(reveal("clock_offset", ["invisible"] * 3)) == ["clock_offset: no typed cell for this type"]


def test_the_messages_the_page_may_receive_before_the_guess_have_a_closed_list_of_types():
    assert qc.ALLOWED_BEFORE_GUESS == ["ready", "check", "progress", "result", "error", "challenge_ready", "sample_record", "lineage"]


def test_message_problems_accepts_a_start_that_carries_the_record_and_nothing_about_the_plant():
    ready = {"type": "challenge_ready", "id": 5, "challenge": "challenge-1", "announced_type": "label_error", "inputs": [], "record": {"samples": [{"sample_id": "S9"}]}}
    assert qc.message_problems([{"type": "ready"}, {"type": "progress", "id": 5, "done": 1, "total": 2}, ready], ["S9"]) == []


def test_message_problems_names_a_type_outside_the_list_a_reveal_key_and_a_planted_key_at_any_depth():
    reveal_early = {"type": "challenge_reveal", "id": 6, "reveal": {"planted": {"type": "label_error"}}}
    got = qc.message_problems([reveal_early], [])
    assert "message type challenge_reveal is not in the list the page may receive before the guess" in got
    assert "key reveal in a challenge_reveal message" in got and "key planted in a challenge_reveal message" in got


def test_message_problems_names_the_planted_id_wherever_it_is_outside_the_record_tables():
    leaky = {"type": "challenge_ready", "id": 5, "challenge": "challenge-1", "announced_type": "S9 mixed up", "record": {"samples": [{"sample_id": "S9"}]}}
    assert qc.message_problems([leaky], ["S9"]) == ["the planted id S9 is in a challenge_ready message outside its record"]
    assert qc.message_problems([{"type": "progress", "id": 5, "done": 1, "total": 2, "note": "S9"}], ["S9"]) == ["the planted id S9 is in a progress message outside its record"]


def test_message_problems_lets_a_drill_down_hold_the_id_it_is_about():
    assert qc.message_problems([{"type": "sample_record", "id": 7, "sample": {"nodes": [{"key": "S9"}]}}], ["S9"]) == []


def test_row_shape_problems_names_a_table_whose_rows_do_not_all_have_the_same_keys():
    ok = {"samples": [{"a": 1, "b": 2}, {"b": 3, "a": 4}], "findings": []}
    assert qc.row_shape_problems(ok) == []
    marked = {"samples": [{"a": 1, "b": 2}, {"a": 3, "b": 4, "planted": True}]}
    assert qc.row_shape_problems(marked) == ["the rows of samples do not all have the same keys"]


# ---------- the type on every sample (lab_ui.md section 9, the author's ruling of 2026-10-30) ----------
def test_ubiquitous_problems_accepts_a_with_the_one_type_typed_from_the_flag_table_noted_once_and_a_miss():
    # A has no audit_trail, so every sample is unattributable by construction; the page notes it once and a wrong guess is a miss
    a = {"ubiquitous": ["unattributable_record"]}
    assert qc.ubiquitous_problems("a_manual", a, ["unattributable_record"], {"score": {"result": "miss"}}) == []


def test_ubiquitous_problems_names_the_old_rule_a_wrong_guess_in_a_scored_background_for_the_type_on_every_sample():
    a = {"ubiquitous": ["unattributable_record"]}
    got = qc.ubiquitous_problems("a_manual", a, ["unattributable_record"], {"score": {"result": "background", "background_type": "unattributable_record"}})
    assert got == ["a_manual: scored background for unattributable_record, a type on every sample of the record"]


def test_ubiquitous_problems_lets_another_type_be_background_and_a_hit_or_a_give_up_pass():
    a = {"ubiquitous": ["unattributable_record"]}
    assert qc.ubiquitous_problems("a_manual", a, ["unattributable_record"], {"score": {"result": "background", "background_type": "lost_rerun"}}) == []
    assert qc.ubiquitous_problems("a_manual", a, ["unattributable_record"], {"score": {"result": "hit"}}) == []
    assert qc.ubiquitous_problems("a_manual", a, ["unattributable_record"], {"score": None}) == []


def test_ubiquitous_problems_names_a_record_that_lacks_the_list_a_wrong_type_for_a_and_a_note_that_differs_from_the_list():
    assert qc.ubiquitous_problems("b_lims_lite", {}, [], {"score": {"result": "miss"}}) == ["b_lims_lite: the record has no ubiquitous list"]
    assert qc.ubiquitous_problems("a_manual", {"ubiquitous": []}, [], {"score": {"result": "miss"}}) == ["a_manual: the record names ubiquitous [], the typed list says ['unattributable_record']"]
    assert qc.ubiquitous_problems("b_lims_lite", {"ubiquitous": ["planned_vs_actual"]}, [], {"score": {"result": "miss"}}) == ["b_lims_lite: the page notes [], the record names ['planned_vs_actual']"]


# ---------- the Break-out screen (lab_ui.md sections 12 and 20) ----------
ARCHS = ["a_manual", "b_lims_lite", "c_context", "c_context_minus_material_lot_links", "c_context_minus_equipment_links"]
FLAG_STATES = {  # the link flags of the five records: A has neither, B has equipment_links, C has both, and C without each of them
    "a_manual": ["material_lot_links:off", "equipment_links:off"], "b_lims_lite": ["material_lot_links:off", "equipment_links:on"], "c_context": ["material_lot_links:on", "equipment_links:on"],
    "c_context_minus_material_lot_links": ["material_lot_links:off", "equipment_links:on"], "c_context_minus_equipment_links": ["material_lot_links:on", "equipment_links:off"],
}


def cell_of(cell):
    if cell is None:
        return {"status": "not_reachable", "kind": "not_reachable", "num": None, "den": None}
    return {"status": "reported" if cell[1] else "none_occurred", "kind": "share" if cell[1] else "undefined", "num": str(cell[0]), "den": str(cell[1])}


def page_of(expected=None, flags=None):
    """What the page shows for the typed report: built from the typed table itself, so the helper is tested against a page that is right and then against one that is wrong in one place."""
    expected = expected or bo.BREAKOUT_EXPECTED
    out = []
    for arch in ARCHS:
        want = expected[arch]
        states = (flags or FLAG_STATES)[arch]
        out.append({"id": arch, "reach": "not_reachable" if want["d3"] is None else "readable", "d1": dict(want["d1"]), "d3": None if want["d3"] is None else dict(want["d3"]),
                    "reflagged": want["reflagged"], "cells": {m: cell_of(c) for m, c in want["cells"].items()}, "flags": list(states)})
    return out


def test_the_typed_table_lists_the_five_records_in_the_order_of_the_form():
    assert list(bo.BREAKOUT_EXPECTED) == ARCHS == bo.BREAKOUT_ARCHS


def test_a_page_that_equals_the_typed_report_has_no_problem():
    assert bo.breakout_problems(page_of()) == []


def test_the_typed_table_says_what_the_design_says_about_direction_3():
    # not reachable in A, where neither link flag is on; an empty set that was looked for in B and in C without material_lot_links; a set in C and in C without equipment_links
    e = bo.BREAKOUT_EXPECTED
    assert e["a_manual"]["d3"] is None and all(v is None for k, v in e["a_manual"]["cells"].items() if "direction_3" in k)
    assert e["b_lims_lite"]["d3"] == {} and e["c_context_minus_material_lot_links"]["d3"] == {}
    assert sum(e["c_context"]["d3"].values()) == 54 and e["c_context"]["cells"]["identification.direction_3.precision"] == (2, 54)
    assert e["c_context"]["cells"]["retro_flag_completeness"] == (6, 6) and e["a_manual"]["cells"]["retro_flag_completeness"] == (0, 6)


def test_a_not_reachable_figure_shown_as_recall_zero_is_a_problem():
    page = page_of()
    page[0]["cells"]["identification.direction_3.recall"] = {"status": "reported", "kind": "share", "num": "0", "den": "2"}
    problems = bo.breakout_problems(page)
    assert any("a_manual identification.direction_3.recall" in p for p in problems)


def test_a_not_reachable_figure_that_carries_a_count_is_a_problem():
    page = page_of()
    page[0]["cells"]["identification.direction_3.recall"]["num"] = "0"
    assert any("not reachable" in p and "count" in p for p in bo.breakout_problems(page))


def test_an_empty_set_shown_as_not_reachable_and_the_reverse_are_problems():
    page = page_of()
    page[1]["d3"] = None  # B looked at equipment and found nothing: not "not reachable"
    page[0]["d3"] = {}  # A could not look: not an empty set
    problems = bo.breakout_problems(page)
    assert any("b_lims_lite: direction 3 is not reachable, the report says a set" in p for p in problems)
    assert any("a_manual: direction 3 is a set, the report says not reachable" in p for p in problems)


def test_a_figure_that_differs_from_the_report_is_named_with_both_counts():
    page = page_of()
    page[2]["cells"]["retro_flag_completeness"]["num"] = "5"
    page[2]["reflagged"] = 89
    problems = bo.breakout_problems(page)
    assert any("c_context retro_flag_completeness" in p and "6 of 6" in p for p in problems)
    assert any("89 results re-flagged, the report says 90" in p for p in problems)


def test_a_set_that_differs_from_the_report_is_a_problem_in_each_direction():
    page = page_of()
    page[2]["d3"]["material_lot"] = 2
    page[0]["d1"] = {"batch": 1}
    problems = bo.breakout_problems(page)
    assert any("c_context: direction 3 returned" in p for p in problems)
    assert any("a_manual: direction 1 returned" in p for p in problems)


def test_reach_must_follow_the_link_flags_whatever_the_table_says():
    page = page_of(flags={**FLAG_STATES, "b_lims_lite": ["material_lot_links:off", "equipment_links:off"]})
    assert any(p.startswith("b_lims_lite: reach is readable") for p in bo.breakout_problems(page))


def test_recall_without_precision_is_a_problem():
    page = page_of()
    del page[2]["cells"]["identification.direction_1.precision"]
    problems = bo.breakout_problems(page)
    assert any("direction 1 shows only ['recall', 'false_alarm']" in p for p in problems)


def test_architectures_in_another_order_or_missing_are_a_problem():
    page = page_of()
    assert bo.breakout_problems(list(reversed(page)))[0].startswith("architectures")
    assert bo.breakout_problems(page[:3])[0].startswith("architectures")


def test_the_observed_table_is_checked_against_the_typed_plant():
    rows = [["64", "signal_observed", "U01 · DO low"], ["64", "deviation_opened", "DEV-1 · U01"], ["66", "confirm_sample_drawn", "U01-CONF · bioburden, sterility"], ["66", "confirm_sample_drawn", "U02-CONF · bioburden, sterility"],
            ["74", "signal_observed", "U05 · DO low"], ["76", "confirm_sample_drawn", "U05-SIG-CONF · bioburden, sterility"], ["186", "confirm_result", "U01-CONF · bioburden · detected"]]
    assert bo.observed_problems(rows) == []
    assert bo.observed_problems(rows[1:])[0].startswith("the first observed event")
    assert any("confirming draws" in p for p in bo.observed_problems(rows[:3]))
    assert any("time order" in p for p in bo.observed_problems([rows[0], rows[4], rows[1], rows[2], rows[3], rows[5]]))
    assert bo.observed_problems([]) == ["no observed event on the page"]


def test_a_break_out_result_with_a_key_of_the_hidden_script_is_a_problem():
    assert bo.breakout_result_problems({"per_architecture": [{"rows": [], "walk": {}}], "event": {"type": "bacterial"}}) == []
    assert bo.breakout_result_problems({"event": {"contamination_onset": 1}, "x": [{"answer_key": 2}]}) == ["key contamination_onset in the breakout_result", "key answer_key in the breakout_result"]
