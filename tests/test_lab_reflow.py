"""Reflow contracts for the pre-start challenge controls and explainer fieldset."""
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope='module')
def browser():
    with sync_playwright() as p:
        instance = p.chromium.launch(headless=True)
        yield instance
        instance.close()


@pytest.mark.parametrize('width', [320, 390])
def test_unstarted_challenge_options_fit_phone(browser, width):
    page = browser.new_page(viewport={'width': width, 'height': 844})
    try:
        page.set_content('<main><label class="check-option disabled"><input type="checkbox">'
                         '<span>c_context_minus_instrument_state_snapshot</span>'
                         '<span class="disabled-reason">every drawn type is prevented in this record</span>'
                         '</label></main>')
        page.add_style_tag(path=str(ROOT / 'src/ui/style.css'))
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    finally:
        page.close()


def test_korean_prose_preserves_words(browser):
    page = browser.new_page()
    try:
        page.set_content('<main lang="ko"><p id="prose">시뮬레이션 결과를 비교합니다</p></main>')
        page.add_style_tag(path=str(ROOT / 'src/ui/style.css'))
        assert page.locator('#prose').evaluate('(e) => getComputedStyle(e).wordBreak') == 'keep-all'
    finally:
        page.close()
