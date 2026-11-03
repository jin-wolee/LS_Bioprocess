"""The parts of the check `plant_a11y` that concern what moves and what sounds, and the plant without WebGL (docs/design/plant_ui.md section 9, P8a): reduced motion (the clock starts paused, the turning ring is not
drawn, a follow cuts), the optional room hum (off until the reader turns it on, the press makes one audio context and is kept, a later visit makes none before a gesture), and the text alternative that stands
in for the scene when WebGL is off (shown with the keyboard and reduced motion, and the plant chunk is never requested). Each function takes the browsers and the URL of the served build and returns the
list of problems it found; none exits or prints.
"""
from __future__ import annotations

import json

from qa_lab_helpers import served_path
from qa_plant_a11y_helpers import hum_problems, reduced_problems
from qa_plant_browser import settle, state, wait_scene
from qa_plant_drill import open_link
from qa_plant_helpers import DEFAULT_OBJECTS, PLANT_VIEWPORTS, split_requests

# The plant with no instant in its link: the clock opens where the plan does, and plays unless the reader prefers reduced motion.
START = "#/plant?scenario=default&arch=a_manual,b_lims_lite,c_context&seed=1&schema=1"
# What the style sheet says of the turning ring of the recompute line, read from an element of its class made in the page: drawn or not, and the animation it has.
RING_JS = """() => { const e = document.createElement('span'); e.className = 'plant-ring'; document.body.append(e); const cs = getComputedStyle(e); const out = {display: cs.display, animation: cs.animationName}; e.remove(); return out; }"""
# A stand-in for the Web Audio context that counts how many are made (window.__audio): the page ships none of it.
AUDIO_JS = """(() => {
  window.__audio = 0;
  window.AudioContext = class {
    constructor() { window.__audio++; this.destination = {}; }
    createOscillator() { return {type: '', frequency: {value: 0}, connect() {}, start() {}}; }
    createGain() { return {gain: {value: 0}, connect() {}}; }
    createBiquadFilter() { return {type: '', frequency: {value: 0}, connect() {}}; }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  };
})();"""


def tab_until(page, predicate_js: str, limit: int) -> int | None:
    """The number of presses of Tab that brought the focus to the element the script describes, or None when `limit` presses did not."""
    for n in range(1, limit + 1):
        page.keyboard.press("Tab")
        if page.evaluate(predicate_js):
            return n
    return None


def _open(browser, url: str, href: str, reduced: bool, size=PLANT_VIEWPORTS["1280"]):
    """A fresh context that prefers reduced motion or not, the plant opened on a link and its first plan drawn. Returns (context, page); the caller closes the context."""
    ctx = browser.new_context(viewport={"width": size[0], "height": size[1]}, locale="en-US", reduced_motion="reduce" if reduced else "no-preference")
    page = ctx.new_page()
    page.goto(url.rstrip("/") + "/" + href, wait_until="load")
    page.wait_for_selector("#main[data-ready=true]", timeout=60_000)
    wait_scene(page)
    return ctx, page


def reduced_check(browser, url: str, busy_link: str) -> list[str]:
    seen: dict[str, dict] = {}
    for name, reduced in (("reduced", True), ("normal", False)):
        ctx, page = _open(browser, url, START, reduced)
        try:
            before = state(page)
            page.wait_for_timeout(1500)
            after = state(page)
            ring = page.evaluate(RING_JS)
            seen[name] = {"playing": after["playing"], "t_before": before["t"], "t_after": after["t"], "ring_display": ring["display"], "ring_animation": ring["animation"], "follow_ndc": (0.0, 0.0)}
        finally:
            ctx.close()
    # a follow under reduced motion: a sample picked from the list of tubes, followed, then the clock stepped to its next event: the tube is near the middle of the view three frames later
    ctx, page = _open(browser, url, busy_link, True)
    try:
        page.focus("[data-tube-sample]")
        page.keyboard.press("Enter")
        page.wait_for_selector("[data-plant-panel=sample]", timeout=10_000)
        page.focus("[data-panel-action=follow]")
        page.keyboard.press("Enter")
        page.wait_for_selector("#plant[data-plant-follow]", timeout=10_000)
        page.keyboard.press(".")
        settle(page, 3)
        ndc = page.get_attribute("#plant", "data-plant-follow-ndc")
        if ndc is None:
            return ["the follow ended or the tube left the floor at the first step: no place on the screen to judge"]
        seen["reduced"]["follow_ndc"] = tuple(json.loads(ndc))
    finally:
        ctx.close()
    return reduced_problems(seen["reduced"], seen["normal"])


def hum_check(browser, url: str, busy_link: str) -> list[str]:
    with open_link(browser, url, busy_link, PLANT_VIEWPORTS["1280"], AUDIO_JS) as (page, _):
        wait_scene(page)
        made_before = page.evaluate("window.__audio")
        pressed_before = page.get_attribute("[data-hum]", "aria-pressed") == "true"
        page.focus("[data-hum]")
        page.keyboard.press("Enter")
        page.wait_for_selector("[data-hum][aria-pressed=true]", timeout=5_000)
        made_after = page.evaluate("window.__audio")
        stored = page.evaluate("localStorage.getItem('plant.hum')")
        page.reload(wait_until="load")
        page.wait_for_selector("#main[data-ready=true]", timeout=60_000)
        wait_scene(page)
        made_reload = page.evaluate("window.__audio")
        pressed_reload = page.get_attribute("[data-hum]", "aria-pressed") == "true"
        page.keyboard.press("Shift")
        made_gesture = page.evaluate("window.__audio")
    return hum_problems(made_before, pressed_before, made_after, True, stored, made_reload, pressed_reload, made_gesture)


def fallback_problems(pw, url: str) -> list[str]:
    """WebGL off (`--disable-3d-apis`) and reduced motion: Home offers the plant as text, the keyboard enters it, the text alternative and the plain objects list show with a polite live region, the checkbox that
    switches the reading off is reached by Tab, and the plant chunk is never requested."""
    problems: list[str] = []
    browser = pw.chromium.launch(headless=True, args=["--disable-3d-apis"])
    try:
        size = PLANT_VIEWPORTS["1280"]
        ctx = browser.new_context(viewport={"width": size[0], "height": size[1]}, locale="en-US", reduced_motion="reduce")
        page = ctx.new_page()
        requests: list[str] = []
        page.on("request", lambda r: requests.append(r.url))
        page.goto(url, wait_until="load")
        page.wait_for_selector("#main[data-ready=true]", timeout=60_000)
        page.focus("#enter-plant")
        page.keyboard.press("Enter")
        page.wait_for_selector("#main[data-screen=plant]", timeout=10_000)
        page.wait_for_selector("#plant-text", timeout=60_000)
        page.wait_for_function("(n) => document.querySelectorAll('[data-plant-table=halls] tbody tr').length >= n", arg=DEFAULT_OBJECTS["hall"], timeout=60_000)
        if page.query_selector("[data-plant-fallback]") is None:
            problems.append("the notice of the fallback is missing")
        live = page.query_selector("#plant-live")
        if live is None or live.get_attribute("aria-live") != "polite" or not live.inner_text().strip():
            problems.append("the live region is missing, not polite or empty")
        if tab_until(page, "() => !!document.activeElement && document.activeElement.matches('[data-plant-log-switch]')", 200) is None:
            problems.append("the switch of the reading is not reached by Tab")
        listed = page.evaluate("Object.fromEntries([...document.querySelectorAll('#plant-objects [data-object-kind]')].reduce((m, e) => m.set(e.dataset.objectKind, (m.get(e.dataset.objectKind) || 0) + 1), new Map()))")
        if listed != DEFAULT_OBJECTS:
            problems.append(f"the objects list holds {listed}")
        asked = split_requests(served_path(u, url) for u in requests)
        if asked["plant"]:
            problems.append(f"the plant chunk was requested without WebGL: {asked['plant']}")
        ctx.close()
    finally:
        browser.close()
    return problems
