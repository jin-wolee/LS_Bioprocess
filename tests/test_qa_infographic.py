"""Pure helpers of scripts/qa_checks.py (contrast maths, alpha compositing, size, i18n diff).

Expected values are hand arithmetic from the WCAG 2.x definitions, never taken from the code under test.
"""
from __future__ import annotations

import gzip
import sys

import pytest

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts"))
import qa_checks as qc  # noqa: E402
import qa_infographic as qa  # noqa: E402


def test_luminance_of_black_and_white():
    assert qc.relative_luminance((0, 0, 0)) == 0.0
    assert qc.relative_luminance((255, 255, 255)) == pytest.approx(1.0)


def test_luminance_uses_the_linear_branch_for_very_dark_channels():
    # 10/255 = 0.0392 <= 0.04045, so L = 0.0392 / 12.92 = 0.003035 (red weight 0.2126)
    assert qc.relative_luminance((10, 0, 0)) == pytest.approx(0.2126 * 10 / 255 / 12.92)


def test_contrast_black_on_white_is_21():
    assert qc.contrast_ratio((0, 0, 0), (255, 255, 255)) == pytest.approx(21.0)


def test_contrast_is_symmetric_and_one_for_equal_colors():
    assert qc.contrast_ratio((255, 255, 255), (0, 0, 0)) == pytest.approx(21.0)
    assert qc.contrast_ratio((30, 60, 90), (30, 60, 90)) == pytest.approx(1.0)


def test_contrast_of_the_well_known_aa_boundary_greys_on_white():
    # #767676 -> L 0.1812 -> 1.05 / 0.2312 = 4.54 (passes AA); #777777 -> 4.48 (fails)
    assert qc.contrast_ratio((0x76, 0x76, 0x76), (255, 255, 255)) == pytest.approx(4.54, abs=0.01)
    assert qc.contrast_ratio((0x77, 0x77, 0x77), (255, 255, 255)) == pytest.approx(4.48, abs=0.01)


@pytest.mark.parametrize(
    "px, weight, needed",
    [(16, 400, 4.5), (23.9, 400, 4.5), (24, 400, 3.0), (18.66, 700, 3.0), (18.66, 400, 4.5), (14, 700, 4.5)],
)
def test_required_ratio_follows_the_large_text_rule(px, weight, needed):
    assert qc.required_ratio(px, weight) == needed


def test_over_blends_straight_alpha_onto_an_opaque_color():
    assert qc.over((0, 0, 0, 0.5), (255, 255, 255)) == pytest.approx((127.5, 127.5, 127.5))
    assert qc.over((10, 20, 30, 1), (255, 255, 255)) == (10, 20, 30)
    assert qc.over((10, 20, 30, 0), (200, 100, 50)) == (200, 100, 50)


def test_effective_background_stacks_layers_nearest_first_on_a_base():
    # nearest layer: black at 50% over (white at 100% is the base) -> mid grey 127.5
    assert qc.effective_background([(0, 0, 0, 0.5)], (255, 255, 255)) == pytest.approx((127.5,) * 3)
    # two layers: inner white 50% over outer black 50% over white base -> outer = 127.5; inner = 191.25
    assert qc.effective_background([(255, 255, 255, 0.5), (0, 0, 0, 0.5)], (255, 255, 255)) == pytest.approx((191.25,) * 3)
    assert qc.effective_background([], (1, 2, 3)) == (1, 2, 3)


def test_unchanged_keys_lists_keys_whose_text_did_not_change():
    en = {"a": "Premise", "b": "SiLA 2", "c": "Capacity"}
    ko = {"a": "전제", "b": "SiLA 2", "c": "Capacity"}
    assert qc.unchanged_keys(en, ko) == ["b", "c"]


def test_unchanged_keys_counts_a_key_missing_in_ko_as_untranslated():
    assert qc.unchanged_keys({"a": "x", "b": "y"}, {"a": "엑스"}) == ["b"]


def test_gzip_size_matches_a_reference_compression(tmp_path):
    page = tmp_path / "index.html"
    page.write_text("<p>" + "lineage " * 500 + "</p>", encoding="utf-8")
    size = qc.gzip_size(page)
    assert 0 < size < page.stat().st_size
    assert size == len(gzip.compress(page.read_bytes(), 6, mtime=0))


def test_fmt_ratio_is_two_decimals():
    assert qc.fmt_ratio(4.4999) == "4.50"
    assert qc.fmt_ratio(21) == "21.00"


def test_cut_sides_reports_only_sides_cut_by_more_than_two_px():
    clip = (0, 0, 390, 844)
    assert qc.cut_sides((0, 0, 400, 100), clip) == {"right": 10.0}
    assert qc.cut_sides((-5, 10, 100, 50), clip) == {"left": 5.0}
    assert qc.cut_sides((0, 0, 392, 100), clip) == {}  # exactly 2 px is tolerated
    assert qc.cut_sides((0, 0, 392.5, 100), clip) == {"right": 2.5}
    assert qc.cut_sides((10, 10, 100, 900), clip) == {"bottom": 56.0}


def test_cut_sides_ignores_unbounded_sides():
    assert qc.cut_sides((0, 0, 500, 900), (0, 0, 390, None)) == {"right": 110.0}
    assert qc.cut_sides((0, 0, 500, 900), (None, None, None, None)) == {}


# ---- check 8 end to end: needs headless chromium, skipped where it is not installed ----------------------

FIXTURES = REPO / "tests" / "fixtures" / "infographic"


@pytest.fixture(scope="module")
def browser():
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        try:
            b = pw.chromium.launch(headless=True)
        except Exception as e:  # browser binary missing
            pytest.skip(f"headless chromium not available: {e}")
        yield b
        b.close()


def clipping(browser, root):
    with qa.serve(root) as url:
        return qc.check_clipping(browser, url)


def test_clipping_fixture_is_caught_with_hand_computed_amounts(browser):
    res = clipping(browser, FIXTURES / "clipping")
    assert not res.ok
    found = {(o["vp"], o["sel"]): o for o in res.data["offenders"]}
    # 390: body padding 16 + 358 wrapper -> clip right 374; SVG right 16 + 600 -> 242 px cut
    wide = found[("390", "svg#wide")]
    assert wide["section"] == "premise" and wide["cut"] == {"right": pytest.approx(242, abs=1)}
    # 390: diagram right 16 + 500 = 516 against the 390 px viewport -> about 126 px
    assert found[("390", "div.diagram")]["cut"]["right"] == pytest.approx(126, abs=16)
    # the label runs past its 200 px SVG at both widths
    for vp in ("390", "1440"):
        out = found[(vp, "svg#label-out")]
        assert out["kind"] == "text outside svg" and out["section"] == "capacity"
        assert out["texts"][0]["text"] == "measured_at 09:25"
        assert 20 < out["texts"][0]["cut"]["right"] < 120
    # a 600 px SVG in a 928 px column fits on desktop; scrollable and fitting SVGs are never reported
    assert ("1440", "svg#wide") not in found and ("1440", "div.diagram") not in found
    assert not [k for k in found if k[1] in ("svg#scrolled", "svg#fits")]


def test_good_fixture_has_no_clipping_offenders(browser):
    res = clipping(browser, FIXTURES)
    assert res.ok, res.detail
    assert res.data["checked"] >= 4  # two SVGs at each of the two widths


# ---- the origin check: the page asks no other origin for anything (FONT1) ----------------------------------

BASE = "http://127.0.0.1:8000/"


def test_a_clean_cold_load_has_no_origin_problem():
    requests = [BASE, BASE + "fonts/archivo-latin.woff2", BASE + "fonts/ibm-plex-mono-400-latin.woff2", "data:,"]
    assert qa.origin_problems(requests, ["Archivo", "IBM Plex Mono"], BASE) == []


def test_every_request_to_another_origin_is_named():
    requests = [BASE, "https://fonts.googleapis.com/css2?family=Archivo", "https://fonts.gstatic.com/s/archivo/v25/x.woff2", "data:,"]
    assert qa.origin_problems(requests, ["Archivo", "IBM Plex Mono"], BASE) == [
        "asked another origin for https://fonts.googleapis.com/css2?family=Archivo",
        "asked another origin for https://fonts.gstatic.com/s/archivo/v25/x.woff2",
    ]


def test_a_family_that_did_not_load_is_a_problem_even_when_no_origin_was_asked():
    assert qa.origin_problems([BASE], ["Archivo"], BASE) == ["IBM Plex Mono did not load from the page's own files"]
    assert qa.origin_problems([BASE], [], BASE) == ["Archivo did not load from the page's own files", "IBM Plex Mono did not load from the page's own files"]
