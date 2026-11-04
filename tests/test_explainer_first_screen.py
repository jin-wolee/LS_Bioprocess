"""The first screen of the explainer (P10, the author's request of 2026-11-04): a headline that asks a concrete question, a plain eyebrow, a quiet status note, a picture of the plant with a call to action,
and a header that fits in fewer rows on a phone.

The expected texts are typed by hand from the brief, not read from the page. What the status note must still promise is pinned in tests/test_status_line.py, the numbers rule in
tests/test_explainer_numbers.py (the alt text of the picture counts as prose there), the link to the lab in tests/test_site_links.py, the folder in tests/test_assemble_site.py and the file's limits in
tests/test_media.py. This file holds the rest: the headline in both languages, the picture (present, sized, described, the file the page names), the call to action beside it, the fragment for the Artifact
viewer, and, in a headless browser where one is installed, what a reader sees at 1280 and at 390 px.
"""
from __future__ import annotations

import importlib.util
import re
import sys

import pytest

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts" / "qa"))
sys.path.insert(0, str(REPO / "scripts" / "media"))
import qa_infographic as qa  # noqa: E402
from media_files import HERO_MAX_BYTES, jpeg_size  # noqa: E402

INFOGRAPHIC = REPO / "site" / "infographic"
HEADLINE_EN = "When reactors share analyzers, which reactor and which moment does a result belong to?"
HEADLINE_KO = "분석기를 함께 쓰면, 이 측정값은 어느 리액터의, 언제의 값일까?"
OLD_HEADLINES = ("N bioreactors", "where does the context go", "바이오리액터 N대", "맥락은 어디로 사라지는가")


def source() -> str:
    return (INFOGRAPHIC / "src" / "body.html").read_text(encoding="utf-8")


def dictionary() -> str:
    return (INFOGRAPHIC / "src" / "i18n.js").read_text(encoding="utf-8")


def page() -> str:
    return (INFOGRAPHIC / "index.html").read_text(encoding="utf-8")


def korean(js: str, key: str) -> str:
    m = re.search(rf'^"{re.escape(key)}": "(.*)",?$', js, re.M)
    assert m, f"{key} not found"
    return m.group(1)


def h1(html: str) -> re.Match:
    m = re.search(r"<h1\b([^>]*)>(.*?)</h1>", html, re.S)
    assert m, "no h1"
    return m


def img(html: str) -> dict:
    tags = re.findall(r"<img\b[^>]*>", html)
    assert len(tags) == 1, f"{len(tags)} img elements, expected the one picture of the plant"
    return dict(re.findall(r'([\w-]+)="([^"]*)"', tags[0]))


# ---- the headline -----------------------------------------------------------------------------------


def test_the_headline_is_the_question_of_the_brief_in_english_in_the_source_and_in_the_committed_page():
    for html in (source(), page()):
        m = h1(html)
        assert m.group(2) == HEADLINE_EN
        assert 'data-i18n="p.h1"' in m.group(1)


def test_the_headline_is_the_question_of_the_brief_in_korean_in_the_dictionary_and_in_the_committed_page():
    assert korean(dictionary(), "p.h1") == HEADLINE_KO
    assert f'"p.h1": "{HEADLINE_KO}"' in page()


def test_the_headline_holds_no_digit_so_it_names_no_ledger_id_and_the_old_headline_is_gone():
    # it states no quantity (the old one said "N" and "2", which the panel below it contradicts), so a data-src on it would cite a source for nothing
    assert not re.search(r"\d", HEADLINE_EN) and not re.search(r"\d", HEADLINE_KO)
    for html in (source(), page()):
        assert "data-src" not in h1(html).group(1)
    for text in (source(), dictionary(), page(), (INFOGRAPHIC / "build.py").read_text(encoding="utf-8")):
        assert not [w for w in OLD_HEADLINES if w in text], [w for w in OLD_HEADLINES if w in text]


def test_the_description_of_the_page_says_what_the_headline_asks_and_not_the_old_framing():
    spec = importlib.util.spec_from_file_location("infographic_build", INFOGRAPHIC / "build.py")
    build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build)
    assert "reactor and the moment" in build.DESCRIPTION and "N bioreactors" not in build.DESCRIPTION
    assert not re.search(r"\d", build.DESCRIPTION)


# ---- the picture ------------------------------------------------------------------------------------


def test_the_picture_is_one_img_of_the_pages_own_folder_with_its_size_and_a_description_in_both_languages():
    for html in (source(), page()):
        pic = img(html)
        assert pic["src"] == "media/plant.jpg"  # relative: the page asks no other origin, and the assembled folder holds media/
        assert (int(pic["width"]), int(pic["height"])) == jpeg_size((INFOGRAPHIC / "media" / "plant.jpg").read_bytes())  # the size the file has: no shift of the layout when it loads
        assert pic["data-i18n-alt"] == "p.hero.alt"
        assert pic["alt"] and len(pic["alt"]) >= 40 and not re.search(r"\d", pic["alt"]), pic["alt"]  # a sentence a reader can follow, with no number (it would need its ledger id)
        assert not re.search(r"\.jpg|image of|picture of|screenshot of", pic["alt"], re.I), pic["alt"]  # it describes the plant, not the file or the medium
        assert pic.get("loading") != "lazy"  # it is on the first screen


def test_the_korean_description_is_its_own_sentence_with_no_digit_and_is_in_the_committed_page():
    ko = korean(dictionary(), "p.hero.alt")
    assert len(ko) >= 25 and not re.search(r"\d", ko) and ko != img(source())["alt"]
    assert f'"p.hero.alt": "{ko}"' in page()


def test_the_caption_says_it_is_a_screenshot_of_a_synthetic_run_in_both_languages_without_a_digit():
    en = re.search(r'<figcaption data-i18n="p.hero.cap">(.*?)</figcaption>', source(), re.S).group(1)
    ko = korean(dictionary(), "p.hero.cap")
    assert "screenshot" in en and "synthetic" in en and "스크린샷" in ko and "합성" in ko
    assert not re.search(r"\d", en + ko)


def test_the_file_the_page_names_exists_is_a_jpeg_and_is_under_the_size_limit():
    f = INFOGRAPHIC / "media" / "plant.jpg"
    assert f.is_file() and f.read_bytes()[:2] == b"\xff\xd8"
    assert f.stat().st_size <= HERO_MAX_BYTES, f.stat().st_size


def test_the_picture_sits_in_the_first_section_with_the_call_to_action_beside_it_and_the_status_note_after_the_figure():
    # P11 moved the status note below the figure of the three moments and put the case sentence between the hero and that figure (tests/test_explainer_visit.py)
    body = source()
    first = body[body.index('<section id="premise"'):body.index("</section>", body.index('<section id="premise"'))]
    hero = first[first.index('<div class="hero">'):first.index('<p class="case"')]
    assert "<img" in hero and 'id="hero-follow"' in hero, "the picture and the call to action share the hero block"
    assert first.index("<h1") < first.index('<div class="hero">') < first.index('<figure class="fig"') < first.index('<div class="notice quiet"')


# ---- the build ---------------------------------------------------------------------------------------


def build_output():
    spec = importlib.util.spec_from_file_location("infographic_build", INFOGRAPHIC / "build.py")
    build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build)
    return build.render()


def test_the_committed_page_is_the_build_of_the_sources_and_the_fragment_carries_the_picture_as_a_data_address():
    built, fragment, errors = build_output()
    assert errors == []
    assert built == page()
    assert 'src="media/plant.jpg"' in built
    assert 'src="media/' not in fragment and 'src="data:image/jpeg;base64,/9j/' in fragment  # the viewer cannot reach local files


# ---- what a reader sees (headless Chromium; skipped where it is not installed) ----------------------


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


GEOMETRY = """() => {
  const box = s => { const r = document.querySelector(s).getBoundingClientRect(); return {top: r.top, bottom: r.bottom, left: r.left, right: r.right}; };
  const tops = ['.brand', '#lang-toggle', '#lab-link', '#theme-select', '#story-toggle'].map(s => document.querySelector(s).getBoundingClientRect().top).sort((a, b) => a - b);
  let rows = 1; for (let i = 1; i < tops.length; i++) if (tops[i] - tops[i - 1] > 20) rows++;
  const pic = document.querySelector('.hero-pic img');
  return {rows, cta: box('#hero-follow'), pic: box('.hero-pic img'), h1: box('h1'), loaded: pic.complete && pic.naturalWidth > 0, alt: pic.getAttribute('alt'),
          scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, innerH: window.innerHeight};
}"""


def look(browser, size, lang):
    with qa.serve(INFOGRAPHIC) as url:
        ctx = browser.new_context(viewport={"width": size[0], "height": size[1]}, locale="en-US")
        try:
            page_ = ctx.new_page()
            page_.goto(url, wait_until="load")
            if lang == "ko":
                page_.click("#lang-toggle")
                page_.wait_for_function("document.documentElement.lang === 'ko'")
            page_.evaluate("document.fonts.ready")
            page_.wait_for_timeout(300)
            return page_.evaluate(GEOMETRY), page_.inner_text("h1")
        finally:
            ctx.close()


@pytest.mark.parametrize("lang, headline", [("en", HEADLINE_EN), ("ko", HEADLINE_KO)])
def test_at_390_px_the_header_controls_sit_in_two_rows_and_the_call_to_action_is_on_the_first_screen(browser, lang, headline):
    g, text = look(browser, (390, 844), lang)
    assert text == headline
    assert g["rows"] <= 2, g["rows"]  # the brand with the language button, then the link, the theme and story mode (it was three rows)
    assert g["scrollW"] <= g["innerW"], "horizontal scroll"
    assert g["cta"]["bottom"] <= g["innerH"], g["cta"]
    assert g["loaded"]


@pytest.mark.parametrize("lang", ["en", "ko"])
def test_at_1280_px_the_header_is_one_row_and_the_headline_the_call_to_action_and_the_picture_are_on_the_first_screen(browser, lang):
    g, _ = look(browser, (1280, 800), lang)
    assert g["rows"] == 1, g["rows"]
    assert g["cta"]["bottom"] <= g["innerH"] and g["pic"]["top"] < g["innerH"] - 200, (g["cta"], g["pic"])  # the picture is beside the text, not under the fold
    assert g["pic"]["left"] > g["cta"]["right"] - 1, "the picture sits beside the call to action"
    assert g["loaded"] and g["scrollW"] <= g["innerW"]


def test_the_alt_text_follows_the_language(browser):
    en, _ = look(browser, (1280, 800), "en")
    ko, _ = look(browser, (1280, 800), "ko")
    assert en["alt"] == img(source())["alt"] and ko["alt"] == korean(dictionary(), "p.hero.alt") and en["alt"] != ko["alt"]
