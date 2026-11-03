"""The check `plant_a11y` of the headless QA of the plant (docs/design/plant_ui.md sections 9 and 10, P8a): access, and the room the chrome leaves the floor.

Given only the keyboard, the reader reaches the objects list, opens a panel, runs an action and reads the live-region line; given reduced motion the plant starts paused, the turning ring is not drawn and a
follow cuts; the optional hum is off until the reader turns it on; given WebGL off the text alternative shows, with the keyboard and reduced motion as well, and the plant chunk is never requested
(qa_plant_a11y_motion.py); at 1280 by 720 no panel, form or list covers the bars or is cut by its box, the five lens chips of a case do not run under the truth switch, and at 390 by 844 the plant keeps at
least half of its box (qa_plant_a11y_layout.py); and no text of the plant's DOM is below AA in either theme or language (the lab's `contrast` rule). This file is the check and the path by keyboard. A check takes
the browsers and the URL of the served build and returns a Result; it never exits or prints.
"""
from __future__ import annotations

from pathlib import Path

from qa_checks import Result, first_line
from qa_plant_a11y_helpers import TABS_TO_BUTTON, TABS_TO_LIST, tab_problems
from qa_plant_a11y_layout import contrast_problems_of, layout_problems, phone_problems
from qa_plant_a11y_motion import fallback_problems, hum_check, reduced_check, tab_until
from qa_plant_browser import wait_scene
from qa_plant_drill import open_link
from qa_plant_helpers import BUSY_START_S

# The default plant opened on a busy morning (tubes on the floor); a link that holds an instant opens the clock paused, so nothing is pressed to pause it.
BUSY_S = BUSY_START_S + 25 * 60
LINK = f"#/plant?scenario=default&arch=a_manual,b_lims_lite,c_context&seed=1&t={BUSY_S}&schema=1"

IN_LIST_JS = "() => !!document.activeElement && !!document.activeElement.closest('#plant-objects')"
ON_ADD_FEED_JS = "() => !!document.activeElement && !!document.activeElement.dataset && document.activeElement.dataset.action === 'add_feed'"
ON_SUBMIT_JS = "() => !!document.activeElement && document.activeElement.matches('.plant-act button[type=submit]')"
IN_PANEL_JS = "() => !!document.activeElement && !!document.activeElement.closest('[data-plant-panel]')"


def keyboard_problems(browser, url) -> list[str]:
    """Tab to the objects list, Enter on its first button (a reactor) opens the panel with the focus in it, Tab to the button of an action, Enter opens the form, Tab to its submit, Enter sends it: the epoch
    changes and the list holds the action; then the period steps to the next event and the live region says it."""
    problems: list[str] = []
    with open_link(browser, url, LINK) as (page, errors):
        wait_scene(page)
        page.evaluate("document.activeElement && document.activeElement.blur()")
        problems += tab_problems(tab_until(page, IN_LIST_JS, TABS_TO_LIST), TABS_TO_LIST, "the objects list")
        page.keyboard.press("Enter")
        try:
            page.wait_for_selector("[data-plant-panel=reactor]", timeout=10_000)
            page.wait_for_function(IN_PANEL_JS, timeout=5_000)
        except Exception:  # noqa: BLE001 - the timeout is the finding
            return problems + ["Enter on the first button of the objects list did not open a panel with the focus in it"]
        problems += tab_problems(tab_until(page, ON_ADD_FEED_JS, TABS_TO_BUTTON), TABS_TO_BUTTON, "the button of an action")
        page.keyboard.press("Enter")
        try:
            page.wait_for_selector(".plant-act", timeout=10_000)
        except Exception:  # noqa: BLE001
            return problems + ["Enter on the button of an action did not open its form"]
        problems += tab_problems(tab_until(page, ON_SUBMIT_JS, 15), 15, "the button that applies the action")
        epoch = page.get_attribute("#plant", "data-plant-epoch")
        page.keyboard.press("Enter")
        try:
            page.wait_for_function("(e) => document.querySelector('#plant').dataset.plantEpoch !== e", arg=epoch, timeout=60_000)
            page.wait_for_selector("[data-act-list] li", timeout=10_000)
        except Exception:  # noqa: BLE001
            problems.append("the action sent by the keyboard did not give a new plan and a line in the list")
        live = page.query_selector("#plant-live")
        if live is None or live.get_attribute("aria-live") != "polite":
            return problems + ["the live region is missing or is not polite"]
        before = live.inner_text()
        page.keyboard.press(".")
        try:
            page.wait_for_function("(b) => { const t = document.querySelector('#plant-live').textContent.trim(); return t !== '' && t !== b; }", arg=before, timeout=10_000)
        except Exception:  # noqa: BLE001
            problems.append("the step to the next event, by the key, did not change the live region")
        problems += [f"console: {e[:140]}" for e in errors]
    return problems


def check_plant_a11y(pw, browser, url, out: Path) -> Result:
    parts = [
        ("keyboard", lambda: keyboard_problems(browser, url)),
        ("reduced motion", lambda: reduced_check(browser, url, LINK)),
        ("hum", lambda: hum_check(browser, url, LINK)),
        ("layout", lambda: layout_problems(browser, url, out, LINK)),
        ("phone", lambda: phone_problems(browser, url, out, LINK)),
        ("contrast", lambda: contrast_problems_of(browser, url, LINK)),
        ("webgl off", lambda: fallback_problems(pw, url)),
    ]
    problems: list[str] = []
    for name, part in parts:
        try:
            problems += [f"{name}: {p}" for p in part()]
        except Exception as e:  # noqa: BLE001 - a part that crashed is a failure of the check
            problems.append(f"{name}: {first_line(e)}")
    detail = "keyboard path, reduced motion, hum, layout at 1280 by 720, phone, contrast and WebGL off: " + ("all as they must be" if not problems else f"{len(problems)} problems | {problems[0]}")
    return Result("plant_a11y", not problems, detail, {"problems": problems})
