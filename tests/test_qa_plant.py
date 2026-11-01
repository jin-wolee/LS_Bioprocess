"""Pure helpers of scripts/qa_plant_checks.py (the headless QA of the plant, docs/design/plant_ui.md section 10).

Expected values are hand arithmetic, never taken from the code under test. The browser checks themselves run through `uv run python scripts/qa_plant.py`.
"""
from __future__ import annotations

import json
import sys

import pytest

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts"))
import qa_plant_checks as qp  # noqa: E402

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
    assert qp.DEFAULT_OBJECTS == {"reactor": 24, "analyzer": 2, "hall": 3}  # the scenario file's 24 reactors and 2 analyzers, and the three presets
    assert qp.counts_problems({"reactor": 24, "analyzer": 2, "hall": 3}, {"reactor": 24, "analyzer": 2, "hall": 3}) == []


def test_a_scene_or_a_list_with_a_different_count_is_a_problem():
    scene = qp.counts_problems({"reactor": 23, "analyzer": 2, "hall": 3}, {"reactor": 24, "analyzer": 2, "hall": 3})
    assert scene == ["the scene built 23 reactor objects, the scenario has 24"]
    listed = qp.counts_problems({"reactor": 24, "analyzer": 2, "hall": 3}, {"reactor": 24, "analyzer": 1, "hall": 3})
    assert listed == ["the objects list holds 1 analyzer entries, the scenario has 2"]
    assert qp.counts_problems({"reactor": 24, "analyzer": 2, "hall": 3, "tank": 1}, {"reactor": 24, "analyzer": 2, "hall": 3}) == ["the scene built tank objects, which the scenario does not have"]
    assert len(qp.counts_problems({}, {})) == 6  # nothing built, nothing listed: both fail for each of the three kinds


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
