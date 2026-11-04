"""What a first visit to the explainer leads to (P11, an outside review the author shared on 2026-11-04: the strength reaches a first visitor too slowly): the call to action follows one sample into the
plant, the case the page makes is said in one sentence above the figure of the three moments, and the footer links to the source code instead of a placeholder.

The expected texts are typed by hand from the brief, not read from the page. The numbers rule (invariant 3) is in tests/test_explainer_numbers.py: the case sentence holds no digit, so it needs no ledger
id, and the Korean may not add one. The header's link to the lab and the other addresses of the page are in tests/test_site_links.py, the first screen's headline, picture and phone header in
tests/test_explainer_first_screen.py, and the status note's promises in tests/test_status_line.py. The link to github.com is a link the reader follows, never a request the page makes (the origin rule of
qa_infographic.py `origin` and qa_site.py `infographic_origin` count requests, and the page makes none there).
"""
from __future__ import annotations

import re
import sys

import pytest

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts" / "qa"))
import qa_infographic as qa  # noqa: E402

INFOGRAPHIC = REPO / "site" / "infographic"

REPO_URL = "https://github.com/jin-wolee/LS_Bioprocess"
FOOTER_EN = "Source code on GitHub"
FOOTER_KO = "GitHub에서 소스 코드 보기"
FOLLOW_EN, FOLLOW_KO = "Follow one sample", "시료 하나 따라가기"
LAB_EN, LAB_KO = "or open the lab", "랩 홈으로"
CASE_EN = "Join a result to the process by the time it was measured, and a sample drawn before a feed lands on the post-feed state it never saw."
CASE_KO = "결과를 측정 시각으로 공정에 붙이면, 피드 전에 채취한 시료가 자신이 보지 못한 피드 이후 상태에 놓입니다."


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


def anchor(html: str, ident: str) -> re.Match:
    m = re.search(rf'<a\b([^>]*\bid="{ident}"[^>]*)>(.*?)</a>', html, re.S)
    assert m, f"no link {ident}"
    return m


def attr(tag_attrs: str, name: str) -> str | None:
    m = re.search(rf'\b{name}="([^"]*)"', tag_attrs)
    return m.group(1) if m else None


# ---- the footer -------------------------------------------------------------------------------------


def test_the_footer_links_to_the_source_code_on_github_in_both_languages():
    for html in (source(), page()):
        foot = html[html.index('<footer class="foot">'):html.index("</footer>")]
        m = anchor(foot, "repo-link")
        assert attr(m.group(1), "href") == REPO_URL
        assert attr(m.group(1), "data-i18n") == "m.repo"
        assert attr(m.group(1), "rel") == "noopener"
        assert m.group(2) == FOOTER_EN
    assert korean(dictionary(), "m.repo") == FOOTER_KO
    assert f'"m.repo": "{FOOTER_KO}"' in page()


def test_no_text_of_the_placeholder_is_left_in_either_language_and_nothing_styles_a_placeholder():
    texts = {p: (INFOGRAPHIC / p).read_text(encoding="utf-8") for p in ("src/body.html", "src/i18n.js", "src/style.css", "build.py", "index.html")}
    gone = ("added at publication", "repository link", "공개 시점에 추가", "저장소 링크", 'class="placeholder"', ".placeholder")
    assert [(p, w) for p, t in texts.items() for w in gone if w in t] == []


def test_the_link_to_github_is_an_anchor_the_reader_follows_and_not_a_resource_the_page_loads():
    # nothing the page fetches by itself (a script, a style sheet, a picture, a frame, a preload) names github.com
    for html in (source(), page()):
        loads = re.findall(r'<(?:script|link|img|iframe|source|video|audio)\b[^>]*\b(?:src|href|srcset)="([^"]*)"', html)
        assert not [u for u in loads if "github.com" in u], loads
        assert re.findall(r'href="(https://github\.com[^"]*)"', html) == [REPO_URL]


# ---- the call to action ------------------------------------------------------------------------------


def test_the_large_button_follows_one_sample_into_the_plant_and_the_small_link_beside_it_still_opens_the_lab():
    for html in (source(), page()):
        row = re.search(r'<p class="cta-row">(.*?)</p>', html, re.S).group(1)
        follow, lab = anchor(row, "hero-follow"), anchor(row, "hero-lab")
        assert row.index('id="hero-follow"') < row.index('id="hero-lab"'), "the button comes first, the text link beside it"
        assert attr(follow.group(1), "href") == "lab/#/plant" and attr(follow.group(1), "data-i18n") == "p.cta.follow" and follow.group(2) == FOLLOW_EN
        assert re.search(r"\bbtn\b", attr(follow.group(1), "class")) and re.search(r"\bcta\b", attr(follow.group(1), "class"))
        assert attr(lab.group(1), "href") == "lab/" and attr(lab.group(1), "data-i18n") == "p.cta.lab" and lab.group(2) == LAB_EN
        assert "btn" not in (attr(lab.group(1), "class") or ""), "the link to the lab is the smaller one"
        for a in (follow, lab):
            assert "target=" not in a.group(1)
    ko = dictionary()
    assert korean(ko, "p.cta.follow") == FOLLOW_KO and korean(ko, "p.cta.lab") == LAB_KO
    assert f'"p.cta.follow": "{FOLLOW_KO}"' in page() and f'"p.cta.lab": "{LAB_KO}"' in page()


def test_the_header_link_is_as_it_was_and_the_button_no_longer_reads_open_the_lab():
    for html in (source(), page()):
        header = anchor(html, "lab-link")
        assert attr(header.group(1), "href") == "lab/" and attr(header.group(1), "data-i18n") == "ui.lab" and header.group(2) == "Open the lab"
        assert anchor(html, "hero-follow").group(2) != "Open the lab"
    assert korean(dictionary(), "ui.lab") == "랩 열기"


def test_the_texts_of_the_call_to_action_hold_no_digit():
    assert not re.search(r"\d", FOLLOW_EN + FOLLOW_KO + LAB_EN + LAB_KO + FOOTER_EN + FOOTER_KO)


# ---- the case at the centre ----------------------------------------------------------------------------


def case_element(html: str) -> re.Match:
    m = re.search(r'<p\b([^>]*\bdata-i18n="p\.case"[^>]*)>(.*?)</p>', html, re.S)
    assert m, "no case sentence"
    return m


def test_the_case_is_one_sentence_in_both_languages_with_no_digit_and_no_source_id():
    for html in (source(), page()):
        m = case_element(html)
        assert m.group(2) == CASE_EN
        assert "data-src" not in m.group(1)  # no number, so no ledger id to cite
    assert korean(dictionary(), "p.case") == CASE_KO and f'"p.case": "{CASE_KO}"' in page()
    for text in (CASE_EN, CASE_KO):
        assert not re.search(r"\d", text), text
        assert len(re.findall(r"[.?!](?: |$)", text)) == 1, text
    assert not re.search(r"\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\b", CASE_EN, re.I)  # a number word is a number the ledger would want an id for


def test_the_case_names_the_wrong_clock_and_the_state_the_sample_never_saw():
    assert "measured" in CASE_EN and "drawn before a feed" in CASE_EN and "post-feed state it never saw" in CASE_EN
    assert "측정 시각" in CASE_KO and "피드 전에 채취한 시료" in CASE_KO and "보지 못한 피드 이후 상태" in CASE_KO


def test_the_case_sits_under_the_hero_directly_above_the_figure_of_the_three_moments_and_the_status_note_comes_after_the_figure():
    for html in (source(), page()):
        first = html[html.index('<section id="premise"'):html.index("</section>", html.index('<section id="premise"'))]
        order = [first.index(t) for t in ('<div class="hero">', '<figure class="hero-pic">', '<p class="case"', '<figure class="fig"', '<div class="notice quiet"')]
        assert order == sorted(order), order
        between = first[first.index('<p class="case"'):first.index('<figure class="fig"')]
        assert between.count("<") == 2, "nothing stands between the case and the figure"  # the p's own two tags
        assert "One sample, three moments" in first[first.index('<figure class="fig"'):first.index('<div class="notice quiet"')]  # the figure the case stands above is the existing one


# ---- what a reader sees (headless Chromium; skipped where it is not installed) --------------------------


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
  const r = s => { const b = document.querySelector(s).getBoundingClientRect(); return {top: b.top + scrollY, bottom: b.bottom + scrollY, left: b.left, right: b.right}; };
  const t = s => document.querySelector(s).textContent.trim();
  const btn = r('#hero-follow'), alt = r('#hero-lab');
  return {btn, alt, pic: r('.hero-pic'), caseBox: r('.case'), fig: r('#premise .fig'), notice: r('.notice.quiet'), innerH: innerHeight, innerW: innerWidth, scrollW: document.documentElement.scrollWidth,
          btnHref: document.querySelector('#hero-follow').href, labHref: document.querySelector('#hero-lab').href, repoHref: document.querySelector('#repo-link').href,
          texts: {follow: t('#hero-follow'), lab: t('#hero-lab'), case: t('.case'), repo: t('#repo-link')}};
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
            return page_.evaluate(GEOMETRY), url
        finally:
            ctx.close()


@pytest.mark.parametrize("size", [(1280, 800), (390, 844)])
@pytest.mark.parametrize("lang, texts", [("en", (FOLLOW_EN, LAB_EN, CASE_EN, FOOTER_EN)), ("ko", (FOLLOW_KO, LAB_KO, CASE_KO, FOOTER_KO))])
def test_a_reader_sees_the_button_the_link_the_case_and_the_footer_link_in_the_language_chosen(browser, size, lang, texts):
    g, url = look(browser, size, lang)
    assert (g["texts"]["follow"], g["texts"]["lab"], g["texts"]["case"], g["texts"]["repo"]) == texts
    assert g["btnHref"] == url + "lab/#/plant" and g["labHref"] == url + "lab/" and g["repoHref"] == REPO_URL
    assert g["scrollW"] <= g["innerW"], "horizontal scroll"
    assert g["btn"]["bottom"] <= g["innerH"], "the button is on the first screen"
    assert g["btn"]["bottom"] - g["btn"]["top"] > g["alt"]["bottom"] - g["alt"]["top"], "the link to the lab is the smaller one"
    assert g["alt"]["left"] >= g["btn"]["right"] - 1 or g["alt"]["top"] >= g["btn"]["bottom"] - 1, "the text link sits beside or under the button, never over it"
    # the case under the hero, the figure directly under the case, the status note under the figure
    assert g["pic"]["bottom"] <= g["caseBox"]["top"] + 1
    assert g["caseBox"]["bottom"] <= g["fig"]["top"] + 1 and g["fig"]["top"] - g["caseBox"]["bottom"] < 80
    assert g["fig"]["bottom"] <= g["notice"]["top"] + 1


def test_at_1280_px_the_button_and_the_text_link_share_a_row(browser):
    g, _ = look(browser, (1280, 800), "en")
    assert abs(g["btn"]["top"] - g["alt"]["top"]) < 40 and g["alt"]["left"] > g["btn"]["right"]
