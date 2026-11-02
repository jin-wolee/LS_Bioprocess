"""Pure helpers of scripts/qa_lab_conditions.py: the conditions every time measurement of the QA records (docs/design/plant_ui.md section 8, "The conditions of a measurement"; the audit's item 23).

Expected values are hand arithmetic or text typed by hand, never taken from the code under test. The browser checks that call it run through `uv run python scripts/qa_plant.py` and `qa_lab.py`.
"""
from __future__ import annotations

import sys

import pytest

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts"))
import qa_lab_conditions as qc  # noqa: E402


class FakeBrowser:
    version = "156.0.8078.4"


class FakePage:
    def __init__(self, renderer):
        self.renderer = renderer
        self.asked = []

    def evaluate(self, script):
        self.asked.append(script)
        return self.renderer


SWIFTSHADER = "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)"


def record(**changes):
    base = dict(load_start=(2.36, 3.7, 5.41), chromium="156.0.8078.4", renderer=SWIFTSHADER, viewport=(1280, 720), measured="from a to b", load_end=(3.1, 3.8, 5.4), cpus=8)
    return qc.record(**{**base, **changes})


def test_a_record_holds_the_load_at_the_start_and_the_end_the_cpus_chromium_the_renderer_the_viewport_and_what_was_measured():
    got = record()
    assert got == {
        "load_start": [2.36, 3.7, 5.41], "load_end": [3.1, 3.8, 5.4], "cpus": 8, "chromium": "156.0.8078.4", "renderer": SWIFTSHADER, "viewport": [1280, 720], "measured": "from a to b",
    }
    assert tuple(got) == qc.FIELDS


def test_a_record_made_without_an_end_or_cpus_reads_them_from_the_machine_now():
    got = qc.record(load_start=(1, 2, 3), chromium="1", renderer="r", viewport=(1, 1), measured="m")
    assert len(got["load_end"]) == 3 and all(x >= 0 for x in got["load_end"])
    assert got["cpus"] >= 1


def test_the_load_average_is_three_figures_of_one_five_and_fifteen_minutes():
    got = qc.load_average()
    assert len(got) == 3 and all(isinstance(x, float) and x >= 0 for x in got)


def test_of_page_takes_the_chromium_version_from_the_browser_and_the_renderer_from_the_page():
    page = FakePage(SWIFTSHADER)
    got = qc.of_page(FakeBrowser(), page, (1.0, 2.0, 3.0), (390, 844), "from a to b")
    assert (got["chromium"], got["renderer"], got["viewport"], got["load_start"]) == ("156.0.8078.4", SWIFTSHADER, [390, 844], [1.0, 2.0, 3.0])
    assert page.asked == [qc.RENDERER_JS]


def test_a_page_without_webgl_says_so_instead_of_leaving_the_renderer_blank():
    assert qc.of_page(FakeBrowser(), FakePage(None), (1.0, 2.0, 3.0), (1280, 720), "m")["renderer"] == "no WebGL context"


def test_the_summary_names_the_load_the_cpus_chromium_the_renderer_and_the_viewport():
    assert qc.summary(record()) == (
        f"load 2.36/3.7/5.41 to 3.1/3.8/5.4 (1, 5 and 15 min) on 8 CPUs; Chromium 156.0.8078.4; renderer {SWIFTSHADER}; viewport 1280x720"
    )


def test_the_summary_of_a_record_without_the_load_says_the_load_is_missing_instead_of_failing():
    without = {k: v for k, v in record().items() if k not in ("load_start", "load_end")}
    assert qc.summary(without).startswith("load missing to missing (1, 5 and 15 min) on 8 CPUs; Chromium 156.0.8078.4")
    assert qc.summary({}).startswith("load missing to missing")


def test_a_complete_record_has_no_problem():
    assert qc.problems(record()) == []


@pytest.mark.parametrize(
    "field, value, fragment",
    [
        ("load_start", (), "the load at the start"),
        ("load_start", (1.0, 2.0), "the load at the start"),
        ("load_end", (), "the load at the end"),
        ("cpus", 0, "the number of CPUs"),
        ("chromium", "", "the version of Chromium"),
        ("renderer", "  ", "the renderer"),
        ("viewport", (0, 720), "the viewport"),
        ("measured", "", "what was measured"),
    ],
)
def test_a_record_that_lacks_a_part_names_it(field, value, fragment):
    got = qc.problems(record(**{field: value}))
    assert len(got) == 1 and fragment in got[0]


def test_a_record_written_without_the_load_is_a_problem_for_both_ends():
    without = {k: v for k, v in record().items() if k not in ("load_start", "load_end")}
    got = qc.problems(without)
    assert any("the load at the start" in p for p in got) and any("the load at the end" in p for p in got)


def test_a_record_that_is_not_a_record_is_one_problem():
    assert qc.problems(None) == ["no conditions were recorded"]
