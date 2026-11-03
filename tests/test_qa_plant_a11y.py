"""Tests of the pure helpers of the check `plant_a11y` (scripts/qa_plant_a11y_helpers.py; docs/design/plant_ui.md section 10, P8a). Expected values are hand arithmetic on small rectangles."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from qa_plant_a11y_helpers import (  # noqa: E402
    FLOOR_MIN, TABS_TO_LIST, contrast_problems, cover_problems, cut_problems, hum_problems, inside, overlaps, reduced_problems, share_problems, tab_problems,
)


def box(x, y, w, h):
    return {"x": x, "y": y, "w": w, "h": h}


class TestRectangles:
    def test_two_rectangles_that_share_an_area_overlap_and_ones_that_touch_do_not(self):
        assert overlaps(box(0, 0, 10, 10), box(5, 5, 10, 10))
        assert not overlaps(box(0, 0, 10, 10), box(10, 0, 10, 10))
        assert not overlaps(box(0, 0, 10, 10), box(0, 20, 10, 10))

    def test_a_box_that_cuts_its_content_does_not_hold_it(self):
        assert inside(box(2, 2, 6, 6), box(0, 0, 10, 10))
        assert not inside(box(2, 2, 6, 10), box(0, 0, 10, 10))
        assert inside(box(0, 0, 10, 10.5), box(0, 0, 10, 10))  # within a pixel

    def test_a_panel_over_the_right_end_of_the_bar_is_a_cover_and_a_panel_beside_it_is_not(self):
        bar = box(100, 600, 800, 40)
        assert cover_problems({"panel": box(868, 150, 400, 480), "bar": bar}, [("panel", "bar")], "1280x720") == ["1280x720: panel covers bar"]
        assert cover_problems({"panel": box(868, 150, 400, 440), "bar": bar}, [("panel", "bar")], "1280x720") == []

    def test_a_name_with_no_box_is_a_problem_of_its_own(self):
        assert cover_problems({"panel": None, "bar": box(0, 0, 1, 1)}, [("panel", "bar")], "x") == ["x: panel has no box"]

    def test_an_item_cut_at_the_foot_of_its_box_is_named_by_its_number(self):
        card = box(12, 223, 384, 300)
        items = [box(20, 260, 360, 40), box(20, 310, 360, 60), box(20, 480, 360, 60)]
        assert cut_problems(items, card, "actions") == ["actions: item 3 is cut by its box"]
        assert cut_problems(items[:2], card, "actions") == []
        assert cut_problems(items, None, "actions") == ["actions: the box has no rectangle"]


class TestPaths:
    def test_a_path_must_be_found_and_within_its_presses(self):
        assert tab_problems(35, TABS_TO_LIST, "the objects list") == []
        assert tab_problems(121, TABS_TO_LIST, "the objects list") == ["the objects list took 121 presses of Tab, over 120"]
        assert tab_problems(None, 60, "the button") == ["the button was not reached by Tab in 60 presses"]


class TestHum:
    GOOD = dict(made_before=0, pressed_before=False, made_after=1, pressed_after=True, stored="on", made_reload=0, pressed_reload=True, made_gesture=1)

    def test_a_hum_that_waits_for_the_reader_and_is_kept_is_clean(self):
        assert hum_problems(**self.GOOD) == []

    def test_a_hum_that_started_by_itself_is_named(self):
        problems = hum_problems(**{**self.GOOD, "made_before": 1, "pressed_before": True})
        assert problems and problems[0].startswith("the hum was on before the reader asked")

    def test_a_visit_that_sounds_before_a_gesture_is_named(self):
        assert any("before any gesture" in p for p in hum_problems(**{**self.GOOD, "made_reload": 1}))

    def test_a_choice_that_is_not_kept_is_named(self):
        assert hum_problems(**{**self.GOOD, "stored": None}) == ["the choice was kept as None, expected 'on'"]


class TestReducedMotion:
    REDUCED = {"playing": "false", "t_before": "720000", "t_after": "720000", "ring_display": "none", "ring_animation": "none", "follow_ndc": (0.02, -0.01)}
    NORMAL = {"playing": "true", "t_before": "720000", "t_after": "720180", "ring_display": "inline-block", "ring_animation": "plant-spin", "follow_ndc": (0.0, 0.0)}

    def test_a_plant_that_starts_paused_and_cuts_is_clean(self):
        assert reduced_problems(self.REDUCED, self.NORMAL) == []

    def test_a_clock_that_plays_or_a_ring_that_turns_or_a_glide_is_named(self):
        assert any("clock plays" in p for p in reduced_problems({**self.REDUCED, "playing": "true", "t_after": "720100"}, self.NORMAL))
        assert any("ring is drawn" in p for p in reduced_problems({**self.REDUCED, "ring_display": "inline-block"}, self.NORMAL))
        assert any("glides" in p for p in reduced_problems({**self.REDUCED, "follow_ndc": (0.6, 0.0)}, self.NORMAL))

    def test_a_control_that_does_not_differ_makes_the_check_vacuous_and_is_named(self):
        assert any("control of the check" in p for p in reduced_problems(self.REDUCED, {**self.NORMAL, "playing": "false", "t_after": "720000"}))


class TestShareAndContrast:
    def test_the_free_share_is_the_points_nothing_covers(self):
        assert share_problems([True, False, False, False]) == []  # three of four free
        assert share_problems([True, True, False, False]) == []  # exactly half is enough
        assert share_problems([True, True, True, False]) == ["the chrome leaves 25% of the plant free, under the 50% it must"]
        assert share_problems([]) == ["no point of the plant was sampled"]
        assert FLOOR_MIN == 0.5

    def test_a_cell_with_a_low_text_colour_is_named(self):
        cells = [{"cell": "light/en", "low": []}, {"cell": "dark/ko", "low": ["3.1:1 plant-hum"]}]
        assert contrast_problems(cells) == ["dark/ko: 1 text colours below AA, worst 3.1:1 plant-hum"]
