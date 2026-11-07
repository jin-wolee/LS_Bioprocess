"""The check `plant_tour` of the headless QA of the plant (docs/design/plant_ui.md sections 3.5 and 10, P8b): the guided scene.

Given a fresh page (no storage), the offer of the tour stands once on the first entry and the key is written; "Not now" takes it off; a second visit does not offer it again but the HUD has the button. The
tour asks for its own run (SC3, seed 1) and lands each of its five steps on the instant the plan gives (`data-plant-t`, paused), frames its object (`data-plant-pick`, `data-plant-look`, the target at the
middle of the view), opens its panel, and says its text in a polite live region in both languages; the card table at the fourth step is the plan's cards of the sample in the three halls; the overlay is asked
at the last step and not before, shows the nine verdicts of the single-sample trace under its label, and goes back to the reader's setting when the tour ends; Skip, Escape and Finish leave no tour state;
under reduced motion the camera cuts; the box covers no bar and passes AA in light and dark; WebGL off has the same steps as text; no console error. Screenshots of every step at 1280 by 720 in both
languages and of the phone go to `tour/` under the output directory. The pure rules are in qa_plant_tour_helpers.py, the walk of the steps in qa_plant_tour_flow.py. A check takes the browsers and the URL of
the served build and returns a Result; it never exits or prints.
"""
from __future__ import annotations

from pathlib import Path

from qa_checks import Result, first_line
from qa_plant_browser import RECORD_PLANT_JS, hud_click, open_plant, settle, wait_scene
from qa_plant_drill import open_link
from qa_plant_helpers import PLANT_VIEWPORTS, split_requests
from qa_plant_tour_flow import SENT_JS, landed_on, layout_problems, settle_on_target, shoot, step_state, sweep_problems, walk_tour
from qa_plant_tour_helpers import STEP_IDS, TOUR_KEY, offer_problems, reduced_tour_problems

DEFAULT_LINK = "#/plant?scenario=default&arch=a_manual,b_lims_lite,c_context&seed=1&schema=1"
RANGE = PLANT_VIEWPORTS["1280"]
PHONE = PLANT_VIEWPORTS["390"]


def first_visit(browser, url, out: Path) -> list[str]:
    """1280 by 720, a fresh page: the offer once, its key, Not now, then a second visit with the button; then the whole tour by Next with the contrast and the numbers, Back and the keys at the last step, and
    the state the plant is left in; then Skip, Escape, and a tour begun with the overlay on."""
    problems: list[str] = []
    with open_plant(browser, url, RANGE, "light", "auto", "en", init_script=RECORD_PLANT_JS, seen=False) as (page, errors, _):
        wait_scene(page)
        page.wait_for_selector("[data-tour=offer]", timeout=15_000)
        settle(page, 3)
        first = page.locator("[data-tour=offer]").count()
        key = page.evaluate(f"localStorage.getItem('{TOUR_KEY}')")
        shoot(page, out, "offer_1280x720_en.png")
        problems += sweep_problems(page, "en", "the offer")
        page.click("[data-tour-later]")
        page.wait_for_selector("[data-tour=offer]", state="detached", timeout=5_000)
        declined = page.locator("[data-tour=offer]").count() + (0 if page.get_attribute("#plant", "data-plant-tour") is None else 1)
        page.reload(wait_until="load")
        page.wait_for_selector("#main[data-ready=true]", timeout=60_000)
        wait_scene(page)
        page.wait_for_timeout(1500)
        again = page.locator("[data-tour=offer]").count()
        button = page.query_selector("[data-tour-start]:not([disabled])") is not None
        problems += offer_problems(first, key, declined, again, button)
        problems += tour_from_button(page, out)
        problems += [f"console: {e[:140]}" for e in errors]
    return problems


def attempt(problems: list[str], page, name: str, stretch) -> None:
    """Run a stretch of the flow. A wait that times out is a finding of its own that names the stretch and what the host said, so the stretches after it still run and the problems before it are kept."""
    try:
        problems += stretch()
    except Exception as e:  # noqa: BLE001 - the timeout is the finding
        problems.append(f"{name}: {first_line(e)} (the host says {step_state(page)})")


def tour_from_button(page, out: Path) -> list[str]:
    """The whole tour from the button of the HUD, and the ways out of it."""
    problems: list[str] = []
    page.click("[data-tour-start]")
    page.wait_for_selector("#plant[data-plant-tour]", timeout=10_000)
    attempt(problems, page, "walk", lambda: walk_tour(page, "en", out, "1280x720", deep=True))
    attempt(problems, page, "back and the keys", lambda: back_and_keys(page))
    attempt(problems, page, "finish", lambda: finish(page))
    attempt(problems, page, "skip and escape", lambda: skip_flows(page))
    attempt(problems, page, "leaving the plant", lambda: leave_flow(page))
    return problems


def leave_flow(page) -> list[str]:
    """Leaving the plant at the last step (the overlay is on, the tour's) puts the overlay back as the reader had it: it is off when the reader comes back, and no tour is on."""
    hud_click(page, "[data-truth-switch]")  # the flow before left the reader's switch on: the reader turns it off
    page.wait_for_selector("#plant[data-plant-truth=off]", timeout=15_000)
    page.click("[data-tour-start]")
    for step_id in STEP_IDS[:4]:
        landed_on(page, step_id)
        page.click("[data-tour-next]")
    landed_on(page, "truth")
    page.wait_for_selector("#plant[data-plant-truth=on]", timeout=15_000)
    page.click("#nav-home")
    page.wait_for_selector("#main[data-screen=home]", timeout=10_000)
    page.click("#enter-plant")
    page.wait_for_selector("#plant[data-plant-scene=ready]", timeout=60_000)
    s = step_state(page)
    problems = [f"back in the plant after leaving at the last step, the overlay is {s['truth']}, the reader had it off"] if s["truth"] != "off" else []
    return problems + ([f"back in the plant after leaving, a tour is on ({s['tour']})"] if s["tour"] is not None or page.query_selector("[data-tour=step]") is not None else [])


def back_and_keys(page) -> list[str]:
    """At the last step: Back leaves the overlay and the record, the keys step on and back (the arrow keys do not walk the figure), and the overlay is asked again when the step is entered again."""
    problems: list[str] = []
    asked = len(page.evaluate(SENT_JS))
    page.click("[data-tour-back]")
    page.wait_for_selector("#plant[data-plant-tour=records][data-plant-truth=off]", timeout=15_000)
    if page.query_selector("[data-plant-record]") is not None or page.query_selector("[data-tour-verdicts]") is not None:
        problems.append("Back from the truth step left the record or the verdict table open")
    for key, step_id in (("ArrowRight", "truth"), ("ArrowLeft", "records"), ("ArrowDown", "truth"), ("ArrowUp", "records"), ("ArrowRight", "truth")):
        page.keyboard.press(key)
        page.wait_for_selector(f"#plant[data-plant-tour={step_id}]", timeout=15_000)
    page.wait_for_selector("#plant[data-plant-truth=on]", timeout=15_000)
    if asked >= len(page.evaluate(SENT_JS)):
        problems.append("stepping back and on again asked the Worker for nothing: the overlay was not asked again")
    return problems


def finish(page) -> list[str]:
    """The last step reads Finish; pressing it leaves the plant where the tour left it."""
    problems: list[str] = []
    t_last = step_state(page)["t"]
    if "Finish" not in page.inner_text("[data-tour-next]"):
        problems.append("the last step's button does not read Finish")
    page.click("[data-tour-next]")
    page.wait_for_selector("[data-tour]", state="detached", timeout=10_000)
    try:
        page.wait_for_function("document.activeElement.matches('[data-tour-start]')", timeout=5_000)
    except Exception:  # noqa: BLE001 - the timeout is the finding
        problems.append(f"the focus did not go back to the button that started the tour: {page.evaluate('document.activeElement.outerHTML.slice(0, 80)')}")
    return problems + left_problems(page, t_last, "Finish")


def left_problems(page, t: str, how: str, truth: str = "off") -> list[str]:
    """No tour state is left after a tour ends: no box, no attribute, the overlay as the reader had it, the clock paused where the tour left it, the place card back, nothing picked."""
    s = step_state(page)
    problems = []
    if s["tour"] is not None or page.query_selector("[data-tour]") is not None:
        problems.append(f"after {how} a tour attribute or element is left")
    if s["truth"] != truth:
        problems.append(f"after {how} the overlay is {s['truth']}, the reader had it {truth}")
    if (s["t"], s["playing"]) != (t, "false"):
        problems.append(f"after {how} the clock is at {s['t']} (playing {s['playing']}), the tour left it at {t} paused")
    if s["pick"] is not None or page.query_selector("[data-plant-panel]") is not None or page.query_selector("[data-plant-record]") is not None:
        problems.append(f"after {how} a picked object, a panel or a record is still open")
    if not page.is_visible("[data-plant-hud=place]"):
        problems.append(f"after {how} the place card is not back")
    return problems


def skip_flows(page) -> list[str]:
    """Skip at step 2 by the button, Escape at step 3, and a tour begun with the overlay on, which stays on."""
    problems: list[str] = []
    page.click("[data-tour-start]")
    landed_on(page, "draw")
    page.click("[data-tour-next]")
    landed_on(page, "feed")
    t = step_state(page)["t"]
    page.click("[data-tour-skip]")
    page.wait_for_selector("[data-tour]", state="detached", timeout=10_000)
    problems += left_problems(page, t, "Skip")
    page.click("[data-tour-start]")
    landed_on(page, "draw")
    page.keyboard.press("ArrowRight")
    landed_on(page, "feed")
    page.keyboard.press("ArrowRight")
    landed_on(page, "run")
    t = step_state(page)["t"]
    page.keyboard.press("Escape")
    page.wait_for_selector("[data-tour]", state="detached", timeout=10_000)
    problems += left_problems(page, t, "Escape")
    hud_click(page, "[data-truth-switch]")
    page.wait_for_selector("#plant[data-plant-truth=on]", timeout=15_000)
    page.click("[data-tour-start]")
    seen = []
    for step_id, after in (("draw", "feed"), ("feed", "run"), ("run", "records")):
        landed_on(page, step_id)
        seen.append(step_state(page)["truth"])
        page.click("[data-tour-next]")
        landed_on(page, after)
    t = step_state(page)["t"]
    page.click("[data-tour-skip]")
    page.wait_for_selector("[data-tour]", state="detached", timeout=10_000)
    if seen != ["on", "on", "on"]:
        problems.append(f"a reader who had the overlay on saw it {seen} during the tour")
    problems += left_problems(page, t, "a tour begun with the overlay on", truth="on")
    return problems


def korean(browser, url, out: Path) -> list[str]:
    """The same tour in Korean at 1280 by 720, a returning reader: every step lands, reads in Korean, and the contrast and the numbers hold."""
    with open_plant(browser, url, RANGE, "light", "auto", "ko", init_script=RECORD_PLANT_JS) as (page, errors, _):
        wait_scene(page)
        page.click("[data-tour-start]")
        page.wait_for_selector("#plant[data-plant-tour]", timeout=15_000)
        problems = walk_tour(page, "ko", out, "1280x720", deep=True)
        page.click("[data-tour-skip]")
        return problems + [f"console: {e[:140]}" for e in errors]


def reduced_motion(browser, url) -> list[str]:
    """Two frames after a step the camera is on its target under reduced motion (it cuts), and is not without the preference (the control). The clock is paused in both."""
    seen: dict[str, dict] = {}
    for name, mode in (("reduced", "reduce"), ("normal", "no-preference")):
        with open_link(browser, url, DEFAULT_LINK, RANGE, RECORD_PLANT_JS, reduced_motion=mode) as (page, _):
            wait_scene(page)
            page.click("[data-tour-start]")
            page.wait_for_selector("#plant[data-plant-tour=draw]", timeout=60_000)
            for step_id in ("draw", "feed"):
                landed_on(page, step_id)
                page.click("[data-tour-next]")
            landed_on(page, "run")
            page.click("[data-tour-next]")
            landed_on(page, "records")
            settle_on_target(page, 15_000)  # the halls, the camera at rest on them
            page.click("[data-tour-back]")  # back to the tube: eleven metres south, behind the camera as it stands, so a camera that glides is far from its target for many frames, whatever the machine's frame time
            page.wait_for_function("document.querySelector('#plant').dataset.plantLook === 'sample:U03-D10-2'", timeout=15_000)
            settle(page, 2)
            s = step_state(page)
            seen[name] = {"ndc": s["ndc"] or [9.0, 9.0], "playing": s["playing"]}
    problems = reduced_tour_problems(seen["reduced"], seen["normal"])
    return problems + [f"the clock plays at a step ({n})" for n, v in seen.items() if v["playing"] != "false"]


def phone(browser, url, out: Path) -> list[str]:
    """390 by 844, a first visit: the offer and a step with the card table are a sheet at the foot of the floor inside the width, covering neither bar, and the tour ends by Skip."""
    problems: list[str] = []
    with open_plant(browser, url, PHONE, "light", "auto", "en", init_script=RECORD_PLANT_JS, seen=False) as (page, errors, _):
        wait_scene(page)
        page.wait_for_selector("[data-tour=offer]", timeout=15_000)
        shoot(page, out, "offer_390x844_en.png")
        rect = page.evaluate("(() => { const r = document.querySelector('[data-tour=offer]').getBoundingClientRect(); return [r.left, r.right]; })()")
        if rect[0] < -1 or rect[1] > PHONE[0] + 1:
            problems.append(f"phone: the offer runs outside the width of the screen {rect}")
        page.click("[data-tour-take]")
        for step_id in STEP_IDS[:4]:
            page.wait_for_selector(f"#plant[data-plant-tour={step_id}]", timeout=60_000)
            landed_on(page, step_id)
            if step_id != "records":
                settle_on_target(page, 15_000)
                page.click("[data-tour-next]")
        wait_scene(page)
        settle_on_target(page, 15_000)
        problems += layout_problems(page, "phone step 4")
        box = page.evaluate("(() => { const r = document.querySelector('[data-tour=step]').getBoundingClientRect(); return [r.left, r.right]; })()")
        if box[0] < -1 or box[1] > PHONE[0] + 1:
            problems.append(f"phone: the box runs outside the width of the screen {box}")
        shoot(page, out, "step4_records_390x844_en.png")
        page.click("[data-tour-skip]")
        page.wait_for_selector("[data-tour]", state="detached", timeout=10_000)
        problems += [f"console: {e[:140]}" for e in errors]
    return problems


def text_alternative(pw, url) -> list[str]:
    """WebGL off: the text alternative has the guided scene as text, with the link to the tour's run; following it gives the five steps in order, and the plant chunk is never requested."""
    problems: list[str] = []
    browser = pw.chromium.launch(headless=True, args=["--disable-3d-apis"])
    try:
        ctx = browser.new_context(viewport={"width": RANGE[0], "height": RANGE[1]}, locale="en-US", reduced_motion="reduce")
        page = ctx.new_page()
        requests: list[str] = []
        page.on("request", lambda r: requests.append(r.url))
        page.goto(url, wait_until="load")
        page.wait_for_selector("#main[data-ready=true]", timeout=60_000)
        page.focus("#enter-plant")
        page.keyboard.press("Enter")
        page.wait_for_selector("[data-tour-open-run]", timeout=60_000)
        if page.query_selector("[data-tour]") is not None or page.query_selector("[data-tour-start]") is not None:
            problems.append("without WebGL the offer or the button of the tour is on the page")
        page.focus("[data-tour-open-run]")
        page.keyboard.press("Enter")
        page.wait_for_function("document.querySelectorAll('[data-tour-text-step]').length === 5", timeout=90_000)
        order = page.evaluate("[...document.querySelectorAll('[data-tour-text-step]')].map((e) => e.dataset.tourTextStep)")
        if order != STEP_IDS:
            problems.append(f"the text alternative lists the steps {order}, expected {STEP_IDS}")
        body = page.inner_text("#plant-tour-text")
        if "U03-D10-2" not in body or "day 10 09:57" not in body or "day 10 10:19" not in body:
            problems.append("the text alternative does not name the sample and the instants of the trace (day 10 09:57 and day 10 10:19)")
        if split_requests(requests)["plant"]:
            problems.append("the plant chunk was requested without WebGL")
        ctx.close()
    finally:
        browser.close()
    return problems


def check_plant_tour(pw, browser, url, out: Path) -> Result:
    parts = [
        ("first visit and the tour", lambda: first_visit(browser, url, out)),
        ("korean", lambda: korean(browser, url, out)),
        ("reduced motion", lambda: reduced_motion(browser, url)),
        ("phone", lambda: phone(browser, url, out)),
        ("webgl off", lambda: text_alternative(pw, url)),
    ]
    problems: list[str] = []
    for name, part in parts:
        try:
            problems += [f"{name}: {p}" for p in part()]
        except Exception as e:  # noqa: BLE001 - a part that crashed is a failure of the check
            problems.append(f"{name}: {first_line(e)}")
    detail = "offer once, five steps on their instants, panels, tables and text in both languages, the overlay at its step only, Skip, Escape and Finish, reduced motion, phone, WebGL off: " + ("all as they must be" if not problems else f"{len(problems)} problems | {problems[0]}")
    return Result("plant_tour", not problems, detail, {"problems": problems})
