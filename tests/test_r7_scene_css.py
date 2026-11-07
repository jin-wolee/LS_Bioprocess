"""Focused browser checks for the plant and infographic layout."""
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        yield browser
        browser.close()


@pytest.mark.parametrize("width", [320, 390])
def test_infographic_fieldset_fits(browser, width):
    page = browser.new_page(viewport={"width": width, "height": 844})
    try:
        body = (ROOT / "site/infographic/src/body.html").read_text()
        page.set_content(body)
        page.add_style_tag(path=str(ROOT / "site/infographic/src/style.css"))
        assert page.locator("#flag-toggles").evaluate("e => e.getBoundingClientRect().right <= innerWidth")
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    finally:
        page.close()


@pytest.mark.parametrize("width", [320, 390])
def test_flag_identifiers_fit_without_breaking(browser, width):
    page = browser.new_page(viewport={"width": width, "height": 844})
    try:
        page.set_content('''<main><table class="flag-matrix"><thead><tr><th>Flag</th><th>a_manual</th><th>b_lims_lite</th><th>c_context</th></tr></thead><tbody>
          <tr><th scope="row">Write time <code class="flag-name"><span>write_time_keys</span></code></th><td>✓ on</td><td>✓ on</td><td>✓ on</td></tr>
          <tr><th scope="row">Capture</th><td><span>manual_transcription</span></td><td><span>adapter_ingest</span></td><td><span>adapter_ingest</span></td></tr>
          </tbody></table></main>''')
        page.add_style_tag(path=str(ROOT / "src/ui/style.css"))
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        assert page.locator(".flag-matrix tbody td span, .flag-name span").evaluate_all("els => els.every(e => e.getClientRects().length === 1)")
    finally:
        page.close()


@pytest.mark.parametrize("width,height", [(720, 450), (1280, 720)])
def test_short_plant_wrap_keeps_bottom_controls_inside(browser, width, height):
    page = browser.new_page(viewport={"width": width, "height": height})
    try:
        page.set_content('''<main data-screen="plant" style="--plant-top-space:127px"><div class="plant-wrap"><div class="plant-gl"></div><div class="plant-huds">
          <div class="plant-hud plant-hud-left" style="height:300px">Place and actions</div>
          <div class="plant-bottom"><div class="plant-time" style="height:90px">Clock</div><div class="plant-bar" style="height:100px"><button>Add a feed</button></div></div>
          </div></div></main>''')
        page.add_style_tag(path=str(ROOT / "src/ui/style.css"))
        page.add_style_tag(path=str(ROOT / "src/plant/plant.css"))
        assert page.locator(".plant-wrap").evaluate("e => e.scrollHeight <= e.clientHeight")
        assert page.locator(".plant-bar button").evaluate("e => e.getBoundingClientRect().bottom <= e.closest('.plant-wrap').getBoundingClientRect().bottom")
        assert page.locator(".plant-huds").evaluate("e => e.getBoundingClientRect().bottom >= e.closest('.plant-wrap').getBoundingClientRect().bottom - 14")
    finally:
        page.close()


def test_mobile_hero_picture_is_visible_in_first_screen(browser):
    page = browser.new_page(viewport={"width": 390, "height": 844})
    try:
        page.set_content((ROOT / "site/infographic/src/body.html").read_text())
        page.add_style_tag(path=str(ROOT / "site/infographic/src/style.css"))
        picture = page.locator(".hero-pic img")
        assert picture.evaluate("e => e.getBoundingClientRect().top < innerHeight - 100")
        assert page.locator("#hero-follow").evaluate("e => e.getBoundingClientRect().bottom <= innerHeight")
    finally:
        page.close()
