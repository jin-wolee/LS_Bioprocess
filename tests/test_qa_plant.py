"""Pure helpers of scripts/qa_plant_helpers.py (the headless QA of the plant, docs/design/plant_ui.md section 10).

Expected values are hand arithmetic, never taken from the code under test. The browser checks themselves run through `uv run python scripts/qa_plant.py`.
"""
from __future__ import annotations

import json
import sys

import pytest

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts"))
import qa_plant_helpers as qp  # noqa: E402

HASH = "a" * 64


# ---------- the budgets are the author's (plant_ui.md section 8 and section 12, item 3) ----------
def test_the_budgets_are_the_ones_of_the_design():
    assert qp.FIRST_LOAD_LIMIT == 300 * 1024
    assert qp.LOADER_LIMIT == 4 * 1024
    assert qp.PLANT_LIMIT == 200 * 1024
    assert (qp.FRAMES, qp.FRAMES_DROPPED) == (300, 5)
    assert (qp.MEDIAN_LIMIT_MS, qp.P95_LIMIT_MS) == (50.0, 80.0)
    assert qp.PLANT_VIEWPORTS == {"1280": (1280, 720), "390": (390, 844)}


# ---------- percentile and the frame statistics ----------
def test_percentile_is_the_nearest_rank():
    assert qp.percentile(range(1, 101), 95) == 95  # ceil(0.95 x 100) = 95th of 100
    assert qp.percentile(range(1, 101), 50) == 50
    assert qp.percentile([5, 1, 3], 50) == 3  # ceil(0.5 x 3) = 2nd of 1, 3, 5
    assert qp.percentile([7], 95) == 7
    assert qp.percentile([1, 2, 3, 4], 100) == 4


def test_percentile_of_nothing_is_an_error():
    with pytest.raises(ValueError):
        qp.percentile([], 50)


def test_frame_intervals_drop_the_first_five_and_keep_the_next_three_hundred():
    stamps = [i * 20.0 for i in range(400)]  # a frame every 20 ms: 399 intervals
    got = qp.frame_intervals(stamps)
    assert len(got) == 300 and set(got) == {20.0}
    stamps = [0, 10, 30, 60, 100, 150, 210, 280]  # intervals 10, 20, 30, 40, 50, 60, 70; the first five go
    assert qp.frame_intervals(stamps, frames=10) == [60, 70]
    assert qp.frame_intervals([0, 16.7]) == []


def test_two_callbacks_in_one_frame_are_one_frame():
    # Playwright's own polling and the scene's loop both ask for an animation frame: the same time stamp twice is one frame
    stamps = [0, 0, 16.7, 16.7, 33.4, 33.4, 50.1, 50.1, 66.8, 66.8, 83.5, 83.5, 100.2]
    assert qp.frame_intervals(stamps, frames=3, dropped=0) == [pytest.approx(16.7)] * 3
    assert qp.frame_intervals(stamps, frames=2, dropped=3) == [pytest.approx(16.7), pytest.approx(16.7)]


def test_frame_stats_of_hand_made_intervals():
    assert qp.frame_stats([33.4] * 150 + [50.1] * 150) == {"n": 300, "median": 33.4, "p95": 50.1}
    assert qp.frame_stats([]) == {"n": 0, "median": None, "p95": None}


@pytest.mark.parametrize("median, p95, frames, ok", [
    (33.4, 50.1, 300, True),  # the spike
    (50.0, 80.0, 300, True),  # on the limits
    (50.1, 70.0, 300, False),
    (40.0, 80.1, 300, False),
    (33.4, 50.1, 299, False),  # too few frames is not a pass
])
def test_the_frame_budget(median, p95, frames, ok):
    assert (qp.frames_problems({"n": frames, "median": median, "p95": p95}) == []) is ok


def test_the_frame_budget_names_what_is_over():
    problems = qp.frames_problems({"n": 300, "median": 60.0, "p95": 90.0})
    assert len(problems) == 2 and "median" in problems[0] and "95th" in problems[1]
    assert "only 12 frames" in qp.frames_problems({"n": 12, "median": 1.0, "p95": 1.0})[0]


# ---------- the files of a cold load ----------
def test_the_plant_chunk_and_the_loader_chunk_are_told_by_their_names():
    assert qp.is_plant_chunk("assets/plant_scene-1Hbf8OAX.js")
    assert qp.is_plant_chunk("assets/plant_scene-a_b-c.js")
    assert not qp.is_plant_chunk("assets/plant-loader-CjbtyyCg.js")
    assert not qp.is_plant_chunk("assets/index-B3w5TGYY.js")
    assert not qp.is_plant_chunk("assets/plant_scene-x.css")
    assert qp.is_loader_chunk("assets/plant-loader-CjbtyyCg.js")
    assert not qp.is_loader_chunk("assets/plant_scene-1Hbf8OAX.js")


def test_requests_are_split_by_role_and_deduplicated():
    paths = ["index.html", "assets/index-A.js", "assets/plant-loader-B.js", "assets/index-A.js", "assets/worker-C.js", "reference.json", "assets/plant_scene-D.js", None]
    got = qp.split_requests(paths)
    assert got["plant"] == ["assets/plant_scene-D.js"]
    assert got["loader"] == ["assets/plant-loader-B.js"]
    assert got["first"] == ["index.html", "assets/index-A.js", "assets/plant-loader-B.js", "assets/worker-C.js", "reference.json"]


@pytest.mark.parametrize("first, loader, plant, expected", [
    (300 * 1024, 4096, 200 * 1024, 0),  # on the limits
    (300 * 1024 + 1, 4096, 200 * 1024, 1),
    (160_000, 4097, 140_000, 1),
    (160_000, 1044, 200 * 1024 + 1, 1),
    (160_000, None, 140_000, 1),  # the loader was not asked for
    (160_000, 1044, None, 1),  # entering the plant did not request the chunk: nothing was measured
    (400_000, 9_000, 300_000, 3),
])
def test_the_size_budgets(first, loader, plant, expected):
    assert len(qp.size_problems(first, loader, plant)) == expected


# ---------- the objects ----------
def test_the_default_scene_holds_what_the_scenario_has():
    # the scenario file's 24 reactors and 2 analyzers, the four operators of its two shifts (P5b: the staff are objects of the list), and the three presets
    assert qp.DEFAULT_OBJECTS == {"reactor": 24, "analyzer": 2, "staff": 4, "hall": 3}
    assert qp.counts_problems({"reactor": 24, "analyzer": 2, "staff": 4, "hall": 3}, {"reactor": 24, "analyzer": 2, "staff": 4, "hall": 3}) == []


def test_a_scene_or_a_list_with_a_different_count_is_a_problem():
    full = {"reactor": 24, "analyzer": 2, "staff": 4, "hall": 3}
    scene = qp.counts_problems({**full, "reactor": 23}, full)
    assert scene == ["the scene built 23 reactor objects, the scenario has 24"]
    listed = qp.counts_problems(full, {**full, "analyzer": 1})
    assert listed == ["the objects list holds 1 analyzer entries, the scenario has 2"]
    assert qp.counts_problems({**full, "tank": 1}, full) == ["the scene built tank objects, which the scenario does not have"]
    assert qp.counts_problems({**full, "staff": 3}, full) == ["the scene built 3 staff objects, the scenario has 4"]
    assert len(qp.counts_problems({}, {})) == 8  # nothing built, nothing listed: both fail for each of the four kinds


# ---------- the hashes the page shows ----------
def test_the_hashes_are_64_digit_hex_and_there_is_one_per_hall():
    cells = json.dumps({"a_manual": HASH, "b_lims_lite": "b" * 64, "c_context": "0" * 64})
    assert qp.hash_problems(HASH, cells) == []
    assert qp.hash_problems(None, cells)
    assert qp.hash_problems("xyz", cells)
    assert qp.hash_problems("A" * 64, cells)  # upper case is not what the engine writes
    assert qp.hash_problems(HASH, "not json") == ["data-cells-hash is not JSON"]
    assert qp.hash_problems(HASH, json.dumps({"a_manual": HASH}))  # halls missing
    assert qp.hash_problems(HASH, json.dumps({"a_manual": HASH, "b_lims_lite": "short", "c_context": HASH})) == ["digest of b_lims_lite is not a 64-digit hash"]


# ---------- the screenshot ----------
@pytest.mark.parametrize("std, colours, ok", [(0.0, 1, False), (7.9, 500, False), (8.0, 12, True), (30.0, 11, False), (40.0, 900, True)])
def test_a_screenshot_is_blank_when_it_has_no_spread_or_almost_no_colours(std, colours, ok):
    assert qp.not_blank({"std": std, "colours": colours}) is ok


# ---------- the plan opens at the first shift ----------
def test_the_plan_opens_at_eight_on_day_zero_and_the_halls_are_the_three_presets():
    assert qp.DEFAULT_START_S == 8 * 3600
    assert qp.DEFAULT_HALLS == ["a_manual", "b_lims_lite", "c_context"]


# ---------- the clock and the motion (P4) ----------
def test_the_speed_presets_are_the_ones_of_the_design():
    assert qp.SPEEDS == [30, 120, 600, 3600]  # section 4.2
    assert qp.DEFAULT_SPEED == 120


def test_the_busy_stretch_and_the_instants_of_the_shots_are_typed_by_hand():
    # a day is 86400 s; day 8 at 08:30 is 691200 + 28800 + 1800 s, 08:40 is 600 s later; day 6 at 08:35 is 518400 + 28800 + 2100; day 6 at 23:00 is 518400 + 82800
    assert qp.BUSY_START_S == 721800
    assert qp.SHOT_INSTANTS == {"rush": 722400, "rerun": 549300, "night": 601200}
    assert qp.FIXED_INSTANT_S == 722400


@pytest.mark.parametrize("t, day, time", [(0, 0, "00:00"), (86399, 0, "23:59"), (28800, 0, "08:00"), (722400, 8, "08:40"), (549300, 6, "08:35"), (601200, 6, "23:00"), (86400 + 1800, 1, "00:30")])
def test_the_clock_reading_is_the_day_and_the_time(t, day, time):
    assert qp.clock_reading(t) == (day, time)


def test_a_clock_that_played_through_the_busy_stretch_has_no_problem():
    assert qp.motion_problems(721800, 722300, "true", 10, "120") == []


@pytest.mark.parametrize("start, end, playing, tubes, speed, fragment", [
    (721800, 722300, "false", 10, "120", "should be playing"),
    (721800, 721800, "true", 10, "120", "did not advance"),
    (721800, 721000, "true", 10, "120", "did not advance"),
    (721800, 722300, "true", 10, "600", "expected 120"),
    (721800, 722300, "true", 0, "120", "no tube"),
])
def test_a_clock_that_did_not_move_samples_is_a_problem(start, end, playing, tubes, speed, fragment):
    problems = qp.motion_problems(start, end, playing, tubes, speed)
    assert len(problems) == 1 and fragment in problems[0]


def test_screenshots_of_different_instants_must_differ():
    one = {"rush": qp.shot_digest(b"a"), "rerun": qp.shot_digest(b"b"), "night": qp.shot_digest(b"c")}
    assert qp.shots_problems(one) == []
    same = {"rush": qp.shot_digest(b"a"), "rerun": qp.shot_digest(b"a"), "night": qp.shot_digest(b"c")}
    assert qp.shots_problems(same) == ["the pictures of rerun and rush are identical: the scene did not change with the clock"]
    assert len(qp.shots_problems({"a": "x", "b": "x", "c": "x"})) == 3  # every identical pair is named


def test_the_digest_is_sha256_of_the_bytes():
    assert qp.shot_digest(b"") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"


def test_two_runs_at_the_fixed_instant_must_differ_in_no_pixel():
    assert qp.repro_problems(0, 921600) == []
    assert qp.repro_problems(7, 921600) == ["two runs at the fixed instant differ in 7 of 921600 pixels"]


def test_each_script_of_the_plant_qa_is_a_small_file_of_one_concern():
    # the repository's target for a source file is 300 lines (prompts/PRINCIPLES.md section 3): the checks are split by concern as the lab's are
    for path in sorted((REPO / "scripts").glob("qa_plant*.py")):
        assert len(path.read_text(encoding="utf-8").splitlines()) <= 300, path.name


# ---------- the record halls (P5a) ----------
def card(shown_s, available_s=None):
    return {"sample": 0, "shown_s": shown_s, "available_s": available_s, "slots": [], "findings": [], "version_s": []}


def message(at, type_, epoch=1, **data):
    return {"at": at, "data": {"type": type_, "id": 1, "epoch": epoch, **data}}


def ready(at, records, cells, epoch=1):
    return message(at, "plant_ready", epoch, plan={"horizon_s": 100, "records": records}, hashes={"truth": HASH, "cells": cells})


def hall(name, cards):
    return {"architecture": name, "flags_on": [], "cards": cards}


def test_the_instants_of_the_halls_checks_are_day_0_noon_day_10_noon_and_the_horizon():
    assert qp.HALL_INSTANTS == {"early": 43200, "mid": 907200, "end": 1814400}  # 12 h; 10 days and 12 h; 21 days
    assert qp.CLOSEUP_INSTANT_S == 907200
    assert qp.HALL_CARDS_END == {"a_manual": 391, "b_lims_lite": 394, "c_context": 394}


def test_the_plan_the_page_received_is_the_first_hall_with_the_halls_that_followed_in_order():
    msgs = [ready(1, [hall("a", [card(5)])], {"a": HASH}), message(2, "plant_halls", records=[hall("b", [])], cells={"b": HASH}), message(3, "plant_halls", records=[hall("c", [card(9)])], cells={"c": HASH})]
    assert [r["architecture"] for r in qp.plan_from_messages(msgs, 1)["records"]] == ["a", "b", "c"]
    assert qp.plan_from_messages(msgs, 2) is None
    other = [*msgs, message(4, "plant_halls", epoch=2, records=[hall("z", [])], cells={})]
    assert [r["architecture"] for r in qp.plan_from_messages(other, 1)["records"]] == ["a", "b", "c"]  # a hall of another epoch is not in the plan


def test_cards_expected_counts_the_cards_shown_and_the_knowable_ones_from_their_instants():
    plan = {"records": [hall("a", [card(10), card(20), card(30)]), hall("c", [card(10, 15), card(20, 50), card(30, None)])]}
    assert qp.cards_expected(plan, 9) == {"a": {"shown": 0, "knowable": 0}, "c": {"shown": 0, "knowable": 0}}
    assert qp.cards_expected(plan, 10) == {"a": {"shown": 1, "knowable": 0}, "c": {"shown": 1, "knowable": 0}}
    assert qp.cards_expected(plan, 15) == {"a": {"shown": 1, "knowable": 0}, "c": {"shown": 1, "knowable": 1}}
    assert qp.cards_expected(plan, 25) == {"a": {"shown": 2, "knowable": 0}, "c": {"shown": 2, "knowable": 1}}
    assert qp.cards_expected(plan, 50) == {"a": {"shown": 3, "knowable": 0}, "c": {"shown": 3, "knowable": 2}}


def test_cards_problems_compares_the_attribute_with_the_counts_computed_from_the_plan():
    want = {"a": {"shown": 2, "knowable": 0}}
    assert qp.cards_problems('{"a":{"shown":2,"knowable":0}}', want) == []
    assert "says" in qp.cards_problems('{"a":{"shown":3,"knowable":0}}', want)[0]
    assert qp.cards_problems(None, want) == ["data-plant-cards is not JSON: None"]
    assert qp.cards_problems("{not json", want)[0].startswith("data-plant-cards is not JSON")


def test_the_halls_arrive_one_after_the_other_in_the_order_of_the_spec():
    good = [ready(10, [hall("a", [])], {"a": HASH}), message(40, "plant_halls", records=[hall("b", [])], cells={"b": HASH}), message(70, "plant_halls", records=[hall("c", [])], cells={"c": HASH})]
    assert qp.halls_arrival_problems(good, ["a", "b", "c"]) == []
    assert qp.halls_arrival_problems([], ["a"]) == ["no plant_ready arrived"]


@pytest.mark.parametrize("fault,fragment", [
    ("all in ready", "plant_ready holds the halls"),
    ("order", "in the order of the spec"),
    ("same instant", "did not arrive one after the other"),
    ("missing digest", "the digests are for"),
])
def test_a_progressive_answer_that_breaks_a_rule_is_a_problem(fault, fragment):
    a, b, c = hall("a", []), hall("b", []), hall("c", [])
    msgs = {
        "all in ready": [ready(10, [a, b, c], {"a": HASH, "b": HASH, "c": HASH})],
        "order": [ready(10, [a], {"a": HASH}), message(40, "plant_halls", records=[c], cells={"c": HASH}), message(70, "plant_halls", records=[b], cells={"b": HASH})],
        "same instant": [ready(10, [a], {"a": HASH}), message(10, "plant_halls", records=[b], cells={"b": HASH}), message(70, "plant_halls", records=[c], cells={"c": HASH})],
        "missing digest": [ready(10, [a], {"a": HASH}), message(40, "plant_halls", records=[b], cells={}), message(70, "plant_halls", records=[c], cells={"c": HASH})],
    }[fault]
    got = qp.halls_arrival_problems(msgs, ["a", "b", "c"])
    assert got and fragment in " ".join(got)


# ---------- the launch arguments are those of the spike ----------
def test_the_software_gl_arguments_are_the_spikes():
    assert qp.SOFTWARE_GL == ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]


# ---------- --plant: the end-to-end run of the plant (docs/design/plant_ui.md section 10) ----------
# The throwaway repo gets stubs in place of scripts/qa_plant.py and scripts/qa_lab.py that log each run into the gitignored qa_out/ and exit as told, as the tests of --lab do.
import json  # noqa: E402

from helpers import run  # noqa: E402

UV_ENV = {"UV_PROJECT_ENVIRONMENT": str(REPO / ".venv")}
PROBE_TEST = "def test_probe():\n    assert True\n"
STUB = '''import sys
from pathlib import Path

Path("qa_out").mkdir(exist_ok=True)
with Path("qa_out/NAME-ran.log").open("a") as f:
    f.write("ran\\n")
print("1 check  PASS  stub")
if EXIT:
    print("FAIL  NAME check: the stub fails on purpose")
sys.exit(EXIT)
'''


@pytest.fixture
def lab(repo):
    repo.write("tests/test_probe.py", PROBE_TEST)
    return repo


def stub(lab, name: str, exit_code: int = 0) -> None:
    lab.write(f"scripts/{name}.py", STUB.replace("NAME", name).replace("EXIT", str(exit_code)))


def ran(lab, name: str) -> int:
    log = lab.root / f"qa_out/{name}-ran.log"
    return len(log.read_text().splitlines()) if log.exists() else 0


def check_all(lab, *args, stdin=""):
    return run(["bash", "scripts/check_all.sh", *args], cwd=lab.root, stdin=stdin, env=UV_ENV)


def test_manual_plant_runs_the_plant_checks_once_and_passes(lab):
    stub(lab, "qa_plant")
    stub(lab, "qa_lab")
    r = check_all(lab, "--manual", "--plant")
    assert r.returncode == 0, r.stdout + r.stderr
    assert (ran(lab, "qa_plant"), ran(lab, "qa_lab")) == (1, 0)  # --plant alone does not run the lab page's checks


def test_the_two_flags_run_each_set_of_checks_once(lab):
    stub(lab, "qa_plant")
    stub(lab, "qa_lab")
    assert check_all(lab, "--manual", "--lab", "--plant").returncode == 0
    assert (ran(lab, "qa_plant"), ran(lab, "qa_lab")) == (1, 1)


def test_manual_without_the_flag_does_not_run_the_plant_checks(lab):
    stub(lab, "qa_plant")
    assert check_all(lab, "--manual").returncode == 0
    assert ran(lab, "qa_plant") == 0


def test_manual_plant_fails_when_the_plant_checks_fail_and_the_summary_names_the_failing_check(lab):
    stub(lab, "qa_plant", 1)
    r = check_all(lab, "--manual", "--plant")
    assert r.returncode == 1, r.stdout + r.stderr
    lines = r.stdout.splitlines()
    assert "FAIL  qa_plant failed (exit 1)" in lines, r.stdout
    assert "FAIL  qa_plant check: the stub fails on purpose" in lines, r.stdout
    assert "check_all --manual: FAIL" in lines


def test_the_stop_hook_never_runs_the_plant_checks(lab):
    stub(lab, "qa_plant", 1)
    r = check_all(lab, stdin=json.dumps({"stop_hook_active": False}))
    assert r.returncode == 0
    assert ran(lab, "qa_plant") == 0


def test_the_batch_marker_does_not_defer_the_plant_checks(lab):
    stub(lab, "qa_plant")
    lab.write(".claude/.batch-running", "P3 plant shell\n")
    r = check_all(lab, "--manual", "--plant")
    assert r.returncode == 0 and "deferred" not in r.stdout + r.stderr
    assert ran(lab, "qa_plant") == 1


def test_an_unknown_flag_is_refused_and_names_the_plant_flag_among_the_flags(lab):
    r = check_all(lab, "--manual", "--plantt")
    assert r.returncode == 2
    assert "--plantt" in r.stdout + r.stderr and "--plant" in r.stdout + r.stderr


# ---------- three.js stays out of the first load ----------
def test_three_js_is_told_by_the_prefix_of_its_own_messages():
    assert qp.holds_three('console.warn("THREE.WebGLRenderer: Context Lost.")')
    assert not qp.holds_three("function three(){return 3}")
    assert not qp.holds_three("three.js is the library, THREE_ is not its prefix")


def test_the_first_load_is_free_of_three_js(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets/index-A.js").write_text("export const a = 1;")
    (tmp_path / "assets/index-B.js").write_text('warn("THREE.Object3D: foo")')
    (tmp_path / "index.html").write_text("<!doctype html>")
    assert qp.three_in(["assets/index-A.js", "index.html"], tmp_path) == []
    assert qp.three_in(["assets/index-A.js", "assets/index-B.js", "index.html"], tmp_path) == ["assets/index-B.js"]
