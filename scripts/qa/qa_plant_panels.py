"""The check `plant_panels` of the headless QA of the plant (docs/design/plant_ui.md section 10, P5b): the panels of the reactor, the sample, the analyzer and the staff. Given the plant paused at an instant,
each panel opens from the objects list by the keyboard (Enter on its button puts the focus in the panel, Escape closes it and the focus returns to the button) and by a click in the scene on the object
(the camera brought to it by its button, then a click in the middle of the view), in both languages; the figures in a panel equal what the check computes from the plan the page received at that instant;
follow keeps a picked tube on the screen over 100 frames of play and ends when the reader moves the camera; with a sample picked the step lands on that sample's next event, and with none picked on the
next event of the floor, which is nearer. A check takes a browser and the URL of the served build and returns a Result; it never exits or prints.
"""
from __future__ import annotations

from pathlib import Path

from qa_checks import Result, first_line
from qa_plant_browser import RECORD_PLANT_JS, open_plant, pause, plant_messages, seek, settle, settle_camera, state, wait_scene
from qa_plant_helpers import BUSY_START_S, DAY_S, PLANT_VIEWPORTS, plan_from_messages
from qa_plant_truth_helpers import follow_problems, panel_numbers, quiet_instant, sample_times

# A busy instant of the morning of day 8 (tubes on the floor, both operators of the first shift at work), a quiet one at night (nothing in the lane, nothing in an analyzer: a click on a reactor or an
# analyzer meets it and not a tube in front of it), and the number of frames the follow is read for.
BUSY_S = BUSY_START_S + 25 * 60
NIGHT_S = 8 * DAY_S + 22 * 3600
FOLLOW_FRAMES = 100
# Records every value of the position of the followed tube on the screen (`data-plant-follow-ndc`), one for each frame the scene draws it.
FOLLOW_JS = """(() => {
  window.__plantFollow = [];
  new MutationObserver((records) => { for (const r of records) window.__plantFollow.push(r.target.getAttribute('data-plant-follow-ndc')); })
    .observe(document, { subtree: true, attributes: true, attributeFilter: ['data-plant-follow-ndc'] });
})();"""
INIT_JS = RECORD_PLANT_JS + FOLLOW_JS
# The figures of a panel the check reads, by the name the panel gives them (`data-panel-field`).
NUMBER_JS = """(f) => { const e = document.querySelector(`[data-plant-panel] [data-panel-field=${f}]`); return e ? e.textContent.trim() : null; }"""
IN_PANEL_JS = "() => !!document.activeElement && !!document.activeElement.closest && document.activeElement.hasAttribute('data-plant-panel')"
FOCUS_KEY_JS = "() => document.activeElement && document.activeElement.dataset ? (document.activeElement.dataset.objectKey || document.activeElement.dataset.tubeSample || null) : null"


def open_by_keyboard(page, button: str, kind: str, key: str, problems: list[str], lang: str) -> bool:
    """Enter on the button of the list: the panel of the kind opens with the focus in it and names the pick on the host."""
    page.focus(button)
    page.keyboard.press("Enter")
    try:
        page.wait_for_selector(f"[data-plant-panel={kind}]", timeout=10_000)
        page.wait_for_function(IN_PANEL_JS, timeout=5_000)
    except Exception:  # noqa: BLE001 - the timeout is the finding
        problems.append(f"{lang} {key}: Enter on its button did not open the {kind} panel with the focus in it")
        return False
    if page.get_attribute("#plant", "data-plant-pick") != key:
        problems.append(f"{lang} {key}: data-plant-pick is {page.get_attribute('#plant', 'data-plant-pick')}")
    return True


def close_by_keyboard(page, button: str, key: str, problems: list[str], lang: str) -> None:
    """Escape closes the panel and the focus returns to the button that opened it."""
    page.keyboard.press("Escape")
    try:
        page.wait_for_selector("[data-plant-panel]", state="detached", timeout=5_000)
    except Exception:  # noqa: BLE001
        problems.append(f"{lang} {key}: Escape did not close the panel")
        return
    page.wait_for_timeout(300)  # the panel gives the focus back when it unmounts
    back = page.evaluate(FOCUS_KEY_JS)
    if back != page.get_attribute(button, "data-object-key") and back != page.get_attribute(button, "data-tube-sample"):
        problems.append(f"{lang} {key}: Escape did not give the focus back to its button ({back})")
    if page.get_attribute("#plant", "data-plant-pick") is not None:
        problems.append(f"{lang} {key}: the pick stayed after the panel was closed")


def figure_problems(page, plan, kind: str, index: int, t: int, key: str, lang: str) -> list[str]:
    """The figures of the open panel against the counts of the plan at the instant."""
    want = panel_numbers(plan, kind, index, t)
    problems = []
    for name, value in want.items():
        if kind == "sample" and name == "visits":
            got = page.evaluate("() => { const e = document.querySelector('[data-plant-panel] [data-panel-field=visits]'); return e ? Number(e.dataset.visits) : 0; }")
        elif name == "lane":
            got = page.evaluate("() => { const e = document.querySelector('[data-plant-panel] [data-panel-field=lane]'); return e ? Number(e.dataset.laneLength) : -1; }")
        else:
            text = page.evaluate(NUMBER_JS, name)
            got = int(text) if text is not None and text.isdigit() else text
        if got != value:
            problems.append(f"{lang} {key}: the panel's {name} is {got}, the plan gives {value} at {t} s")
    return problems


def click_pick(page, button: str, key: str, problems: list[str], lang: str) -> None:
    """The click in the scene: the button brings the camera to the object (and opens its panel, which is closed again), the camera settles, and a click in the middle of the view picks the object."""
    page.focus(button)
    page.keyboard.press("Enter")
    page.wait_for_selector("[data-plant-panel]", timeout=10_000)
    page.wait_for_function(IN_PANEL_JS, timeout=5_000)  # the panel listens for Escape from the moment it has the focus
    page.keyboard.press("Escape")
    page.wait_for_selector("[data-plant-panel]", state="detached", timeout=5_000)
    page.wait_for_timeout(300)  # the focus goes back to the button, which is below the scene: the page scrolls to it, and the scene is brought back into view
    page.evaluate("document.querySelector('.plant-wrap').scrollIntoView({block: 'start'})")
    settle_camera(page)
    box = page.locator("canvas.plant-canvas").bounding_box()
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.wait_for_timeout(400)
    got = page.get_attribute("#plant", "data-plant-pick")
    if got != key:
        problems.append(f"{lang} {key}: a click in the middle of the view picked {got}")
    elif page.query_selector("[data-plant-panel]") is None:
        problems.append(f"{lang} {key}: the click picked it but no panel opened")
    page.keyboard.press("Escape")


def lonely_tube(page, plan, problems: list[str]) -> int | None:
    """An instant of the morning at which exactly one tube is on the floor (so that a click on it meets nothing else), found by looking at the instants in steps of five minutes."""
    for t in range(BUSY_START_S - 600, BUSY_START_S + 4 * 3600, 300):
        seek(page, t)
        settle(page, 2)
        if state(page)["tubes"] == "1":
            return t
    problems.append("no instant of the morning has exactly one tube on the floor")
    return None


def panels_cell(browser, url, out: Path, lang: str) -> list[str]:
    """The four panels by the keyboard and by a click, in one language; the screenshots of each panel (English)."""
    problems: list[str] = []
    (out / "panels").mkdir(parents=True, exist_ok=True)
    with open_plant(browser, url, PLANT_VIEWPORTS["1280"], lang=lang, init_script=INIT_JS) as (page, errors, _):
        wait_scene(page)
        pause(page)
        plan = plan_from_messages(plant_messages(page), 1)
        seek(page, BUSY_S)
        settle(page, 5)
        unit = next(i for i, u in enumerate(plan["units"]) if u["id"] == "U10")
        cases = [("reactor", unit, "reactor:U10", "[data-object-key='reactor:U10']"), ("analyzer", 0, "analyzer:AN-1", "[data-object-key='analyzer:AN-1']"),
                 ("staff", 0, "staff:OP-01", "[data-object-key='staff:OP-01']")]
        tube = page.get_attribute("[data-tube-sample]", "data-tube-sample")
        if tube:
            index = next(i for i, s in enumerate(plan["samples"]) if s["id"] == tube)
            cases.append(("sample", index, f"sample:{tube}", f"[data-tube-sample='{tube}']"))
        else:
            problems.append(f"{lang}: no tube is on the floor at {BUSY_S} s")
        for kind, index, key, button in cases:
            if not open_by_keyboard(page, button, kind, key, problems, lang):
                continue
            problems += figure_problems(page, plan, kind, index, BUSY_S, key, lang)
            if lang == "en":
                page.wait_for_timeout(600)
                page.screenshot(path=str(out / "panels" / f"plant_panel_{kind}_1280x720_en.png"))
            close_by_keyboard(page, button, key, problems, lang)
        # a click in the scene: a reactor and an analyzer at night, an operator at rest, a tube alone on the floor
        seek(page, NIGHT_S)
        settle(page, 5)
        for key in ("reactor:U10", "analyzer:AN-1"):
            click_pick(page, f"[data-object-key='{key}']", key, problems, lang)
        rest = quiet_instant(plan, 0, BUSY_S)
        if rest is None:
            problems.append(f"{lang}: no quiet instant for OP-01")
        else:
            seek(page, rest)
            settle(page, 5)
            click_pick(page, "[data-object-key='staff:OP-01']", "staff:OP-01", problems, lang)
        alone = lonely_tube(page, plan, problems)
        if alone is not None:
            settle(page, 5)
            alone_id = page.get_attribute("[data-tube-sample]", "data-tube-sample")
            click_pick(page, f"[data-tube-sample='{alone_id}']", f"sample:{alone_id}", problems, lang)
        problems += [f"{lang}: console: {e[:140]}" for e in errors]
    return problems


def follow_and_step(browser, url, out: Path) -> list[str]:
    """Follow keeps the tube on the screen for 100 frames of play and ends when the camera is moved; the step with a sample picked lands on its own next events, with none picked on the floor's next."""
    problems: list[str] = []
    with open_plant(browser, url, PLANT_VIEWPORTS["1280"], init_script=INIT_JS) as (page, errors, _):
        wait_scene(page)
        pause(page)
        plan = plan_from_messages(plant_messages(page), 1)
        seek(page, BUSY_S)
        settle(page, 5)
        tube = page.get_attribute("[data-tube-sample]", "data-tube-sample")
        index = next(i for i, s in enumerate(plan["samples"]) if s["id"] == tube)
        page.focus(f"[data-tube-sample='{tube}']")
        page.keyboard.press("Enter")
        page.wait_for_selector("[data-plant-panel=sample]", timeout=10_000)
        page.wait_for_function(IN_PANEL_JS, timeout=5_000)
        # the step with the sample picked: from the whole minute after its draw (the scrubber has whole minutes), each press lands on the next instant of that sample and not on the nearer ones of the floor
        times = sample_times(plan, index)
        start = -(-times[0] // 60) * 60
        after = [t for t in times if t > start]
        seek(page, start)
        settle(page, 3)
        page.keyboard.press("Escape")  # unpick: the step over the whole floor, which is nearer than the sample's own next event
        page.wait_for_selector("[data-plant-panel]", state="detached", timeout=5_000)
        page.keyboard.press(".")
        page.wait_for_function("(t) => Number(document.querySelector('#plant').dataset.plantT) > t", arg=start, timeout=5_000)
        floor_next = int(state(page)["t"])
        if not start < floor_next < after[0]:
            problems.append(f"the step with nothing picked went from {start} to {floor_next}, which should be before the sample's own next event {after[0]}")
        seek(page, start)
        settle(page, 3)
        page.focus(f"[data-tube-sample='{tube}']")
        page.keyboard.press("Enter")
        page.wait_for_selector("[data-plant-panel=sample]", timeout=10_000)
        page.wait_for_function(IN_PANEL_JS, timeout=5_000)
        landed = []
        for _ in range(3):
            page.keyboard.press(".")
            page.wait_for_timeout(250)
            landed.append(int(state(page)["t"]))
        # at its last event the clock stays: three presses land on its next events, and on the last one again if it has fewer than three
        want = [after[min(i, len(after) - 1)] for i in range(3)]
        if landed != want:
            problems.append(f"the step with {tube} picked landed on {landed}, expected its own next events {want}")
        page.keyboard.press(",")
        page.wait_for_timeout(250)
        back = max([t for t in times if t < want[-1]], default=want[-1])
        if int(state(page)["t"]) != back:
            problems.append(f"the step back with {tube} picked landed on {state(page)['t']}, expected {back}")
        # follow: F on the picked sample; the tube stays on the screen over 100 frames of play; the reader moving the camera ends it
        seek(page, start)
        settle(page, 3)
        page.keyboard.press("f")
        page.wait_for_function("(id) => document.querySelector('#plant').dataset.plantFollow === id", arg=tube, timeout=5_000)
        page.evaluate("window.__plantFollow.length = 0")
        page.click("[data-time=play]")
        page.wait_for_function(f"window.__plantFollow.length >= {FOLLOW_FRAMES}", polling=500, timeout=120_000)
        frames = page.evaluate(f"window.__plantFollow.slice(0, {FOLLOW_FRAMES})")
        problems += follow_problems(frames)
        pause(page)
        page.keyboard.press("q")  # the reader turns the camera
        page.wait_for_timeout(300)
        if page.get_attribute("#plant", "data-plant-follow") is not None:
            problems.append("the follow went on after the reader turned the camera")
        problems += [f"console: {e[:140]}" for e in errors]
    return problems


def check_plant_panels(browser, url, out: Path) -> Result:
    problems: list[str] = []
    for lang in ("en", "ko"):
        try:
            problems += panels_cell(browser, url, out, lang)
        except Exception as e:  # a cell that crashed is a failed cell
            problems.append(f"{lang}: {first_line(e)}")
    try:
        problems += follow_and_step(browser, url, out)
    except Exception as e:
        problems.append(f"follow and step: {first_line(e)}")
    detail = ("the reactor, sample, analyzer and staff panels open from the objects list by the keyboard and by a click in the scene in both languages, their figures equal the plan's at the instant, "
              f"follow keeps a tube on the screen for {FOLLOW_FRAMES} frames, the step with a sample picked lands on its own events")
    return Result("plant_panels", not problems, detail + (f" | {problems[0]}" if problems else ""), {"problems": problems})
