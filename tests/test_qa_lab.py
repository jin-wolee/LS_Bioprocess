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
    assert qc.EXPECTED_FLAG_LISTS == ["setup-matrix", "setup-ablation", "results-legend", "notes-table"]


def test_missing_flag_lists_reports_an_expected_list_that_is_not_on_the_page():
    lists = [{"name": "setup-matrix", "flags": FLAGS}, {"name": "notes-table", "flags": FLAGS}]
    assert qc.missing_flag_lists(lists) == ["setup-ablation", "results-legend"]


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


def test_screens_are_the_four_that_exist_now():
    assert qc.SCREENS == ["home", "setup", "results", "notes"]


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
