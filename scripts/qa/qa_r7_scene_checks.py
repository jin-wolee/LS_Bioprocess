"""Plant lifecycle and low-viewport checks, registered by the plant QA gate."""
from qa_checks import Result
from qa_plant_helpers import TOUR_SEEN_JS

PLANT = "#/plant?scenario=default&arch=a_manual,b_lims_lite,c_context&seed=1&t=721800&schema=1"


def check_short_plant(plant):
    wrap = plant.locator(".plant-wrap")
    assert wrap.evaluate("e => e.scrollHeight <= e.clientHeight"), "plant controls overflow the scene wrapper"
    assert plant.locator(".plant-bar button").last.evaluate("e => e.getBoundingClientRect().bottom <= e.closest('.plant-wrap').getBoundingClientRect().bottom"), "plant action bar is clipped"


def check_context_recovery(plant):
    plant.locator('.plant-time button').first.click()
    plant.wait_for_timeout(150)
    t0 = plant.locator('#plant').get_attribute('data-plant-t')
    plant.evaluate("window.__r7Context = document.querySelector('canvas.plant-canvas').getContext('webgl2').getExtension('WEBGL_lose_context'); window.__r7Context.loseContext()")
    plant.wait_for_timeout(500)
    assert plant.locator('#plant').get_attribute('data-plant-scene') == 'failed', 'context loss did not change scene status'
    assert "context was lost" in plant.locator('#plant-status').inner_text(), "context loss message is missing"
    plant.wait_for_timeout(250)
    t1 = plant.locator('#plant').get_attribute('data-plant-t')
    plant.wait_for_timeout(250)
    assert plant.locator('#plant').get_attribute('data-plant-t') == t1, 'clock advanced during context loss'
    assert t0 is not None
    plant.evaluate("window.__r7Context.restoreContext()")
    plant.wait_for_selector('#plant[data-plant-scene="ready"]', timeout=10000).dispose()
    plant.evaluate('delete window.__r7Context')
    after = plant.locator('#plant').get_attribute('data-plant-t')
    plant.wait_for_timeout(300)
    assert plant.locator('#plant').get_attribute('data-plant-t') == after


def check_header_height(plant):
    plant.set_viewport_size({"width": 390, "height": 844})
    plant.wait_for_timeout(250)
    measured = plant.locator(".plant-wrap").evaluate("e => ({top: e.getBoundingClientRect().top + scrollY, height: e.getBoundingClientRect().height, recorded: parseFloat(e.style.getPropertyValue('--plant-top-space'))})")
    assert abs(measured["recorded"] - measured["top"]) < 2, measured
    assert abs(measured["height"] - max(528, 844 - measured["top"])) < 3, measured


def check_repeated_entries(plant):
    cdp = plant.context.new_cdp_session(plant)
    counts = []
    for _ in range(20):
        plant.evaluate("location.hash = '#/'")
        plant.wait_for_selector('main[data-screen="home"]', timeout=10000).dispose()
        plant.wait_for_timeout(150)
        cdp.send("HeapProfiler.collectGarbage")
        metrics = cdp.send("Memory.getDOMCounters")
        counts.append((metrics["nodes"], metrics["jsEventListeners"]))
        plant.evaluate("link => location.hash = link", PLANT)
        plant.wait_for_selector('#plant[data-plant-scene="ready"]', timeout=60000).dispose()
    assert counts[-1][0] <= counts[0][0] + 5, counts
    assert counts[-1][1] <= counts[0][1] + 10, counts
    return counts


def check_plant_lifecycle(browser, url, _out):
    """Check clipping, recovery, header measurement and repeated route disposal."""
    ctx = browser.new_context(viewport={"width": 720, "height": 450})
    try:
        page = ctx.new_page()
        page.add_init_script(TOUR_SEEN_JS)
        page.goto(url.rstrip("/") + "/" + PLANT, wait_until="load")
        page.wait_for_selector('#plant[data-plant-scene="ready"]', timeout=60000).dispose()
        check_short_plant(page)
        check_context_recovery(page)
        check_header_height(page)
        counts = check_repeated_entries(page)
        return Result("plant_lifecycle", True, "recovery, controls and 20 re-entries passed", {"counters": counts})
    finally:
        ctx.close()
