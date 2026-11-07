"""Focused explainer language and keyboard-accessibility checks."""
import importlib.util
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "site/infographic/src"


def translation_keys(body, dictionary):
    used = set(re.findall(r'data-i18n(?:-aria|-alt)?="([^"]+)"', body))
    defined = set(re.findall(r'^"([^"]+)":', dictionary, re.M))
    return used, defined


def test_every_markup_translation_key_has_exactly_one_dictionary_key():
    body = (SRC / "body.html").read_text()
    dictionary = (SRC / "i18n.js").read_text()
    used, defined = translation_keys(body, dictionary)
    keys = re.findall(r'^"([^"]+)":', dictionary, re.M)
    assert len(keys) == len(set(keys)), "duplicate dictionary key"
    assert used == defined, {"missing": sorted(used - defined), "unused": sorted(defined - used)}
    # A missing entry must make the comparison fail, even when all remaining entries are used.
    mutated = re.sub(r'^"ui\.skip":.*\n', '', dictionary, count=1, flags=re.M)
    assert translation_keys(body, mutated)[0] != translation_keys(body, mutated)[1]


@pytest.fixture(scope="module")
def browser():
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        try:
            browser = pw.chromium.launch(headless=True)
        except Exception as exc:
            pytest.skip(f"headless chromium unavailable: {exc}")
        yield browser
        browser.close()


@pytest.fixture(scope="module")
def html():
    spec = importlib.util.spec_from_file_location("infographic_r7", SRC.parent / "build.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    result, _, errors = module.render()
    assert errors == []
    return result


@pytest.mark.parametrize("lang", ["en", "ko"])
def test_reduced_motion_explains_disabled_story_and_guards_activation(browser, html, lang):
    context = browser.new_context(reduced_motion="reduce")
    try:
        page = context.new_page()
        page.set_content(html, wait_until="load")
        if lang == "ko":
            page.locator("#lang-toggle").click()
        story = page.locator("#story-toggle")
        assert story.get_attribute("aria-disabled") == "true"
        assert not story.evaluate("el => el.disabled")
        note = page.locator("#story-note")
        assert note.is_visible()
        assert note.inner_text() == ("Story mode is unavailable while reduced motion is on." if lang == "en" else "동작 줄이기가 켜져 있어 스토리 모드를 사용할 수 없습니다.")
        assert "story-note" in (story.get_attribute("aria-describedby") or "").split()
        story.focus()
        assert story.evaluate("el => el === document.activeElement")
        story.press("Enter")
        assert story.get_attribute("aria-pressed") == "false"
        assert page.locator("html").get_attribute("data-story") is None
        page.emulate_media(reduced_motion="no-preference")
        page.wait_for_function("document.querySelector('#story-note').hidden")
        assert not note.is_visible()
        assert story.get_attribute("aria-disabled") != "true"
        story.click()
        assert story.get_attribute("aria-pressed") == "true"
        page.emulate_media(reduced_motion="reduce")
        page.wait_for_function("!document.querySelector('#story-note').hidden")
        assert note.is_visible()
        assert story.get_attribute("aria-pressed") == "false"
    finally:
        context.close()


@pytest.mark.parametrize("lang", ["en", "ko"])
def test_each_focusable_scroll_region_has_a_localized_accessible_name(browser, html, lang):
    context = browser.new_context()
    try:
        page = context.new_page()
        page.set_content(html, wait_until="load")
        if lang == "ko":
            page.locator("#lang-toggle").click()
        regions = page.locator('.fig-scroll[tabindex="0"], .tablewrap[tabindex="0"]')
        assert regions.count() > 0
        for region in regions.all():
            assert region.get_attribute("role") == "region"
            label = region.get_attribute("aria-labelledby")
            assert label and page.locator(f'[id="{label}"]').count() == 1
            text = page.locator(f'[id="{label}"]').inner_text().strip()
            assert text
            snapshot = region.aria_snapshot()
            assert 'region "' in snapshot and text in snapshot, snapshot
        assert page.locator('.toc a').first.inner_text() == ("premise" if lang == "en" else "문제")
    finally:
        context.close()


def test_korean_diagram_and_table_labels_are_translated_or_explicitly_english(browser, html):
    context = browser.new_context()
    try:
        page = context.new_page()
        page.set_content(html, wait_until="load")
        page.locator("#lang-toggle").click()
        for key, expected in {
            "fig.due": "결정 시각 10:00",
            "graph.room": "실온",
            "graph.qcfail": "QC 실패, 보류",
            "graph.qcpass": "재실행, QC 통과",
            "graph.instrument": "기기 상태",
            "graph.sample1": "시료 SMP-0412",
            "rec.unitbatch": "리액터, 배치",
            "ph.mean.range": "0.02–0.06, 평균 약 0.04",
        }.items():
            target = page.locator(f'[data-i18n="{key}"]')
            assert target.count() > 0, f"missing Korean translation for {key}"
            assert target.first.text_content() == expected
        for node in page.locator("svg title[id], svg desc[id]").all():
            assert node.get_attribute("lang") == "en"
    finally:
        context.close()
