"""Results from the plant in the check `drilldown` of the headless QA of the plant (docs/design/plant_ui.md sections 7 and 10, P6b; docs/design/lab_ui.md section 22). Given a plant opened by a link that holds four
actions (a feed on U10, a window of AN-1, the move of one draw and the capture path): from the card and from the analyzer, Setup holds the feed and the window and neither the draw nor the capture path, lists the
two it left out with the reason, and the bar of the screen names the kinds Results carries and the count; Run, over two seeds, sends the two actions as the `actions` of the `run` request (seen through the wrapper of
the Worker's messages) and Results lists them above its inputs and among them, each instant with its ledger entry; a Setup edited so that a unit is gone is refused with the sentence of its reason and the place of the
action; dropping the actions sends a run with none; a Setup opened without the plant shows no list and sends a run with no `actions`. Screenshots at 1280 by 720 in English and in Korean go to `drill/`. A flow takes
a browser and the URL of the served build and appends its findings to `problems`; it never exits or prints.
"""
from __future__ import annotations

from pathlib import Path

from qa_lab_browser import set_lang
from qa_plant_browser import settle, state, wait_scene
from qa_plant_drill_helpers import clock_problems, late_sample, plant_hash, results_inputs_problems, run_problems, setup_lists_problems
from qa_plant_helpers import BUSY_START_S

DAY = 86400
BUSY_S = BUSY_START_S + 25 * 60
KEPT = ["add_feed", "analyzer_down"]
LEFT = ["move_draw", "set_capture_path"]
# the inputs the Worker prints for the two actions that Results carries, by name, and whether each is an instant (its entry is the one the plant's own list prints for the instants it shows, read from that page)
PRINTED = [("act-1 add_feed U10 at", True), ("act-2 analyzer_down AN-1 from", True), ("act-2 analyzer_down AN-1 length", False)]
LISTS_JS = ("() => ({kept: [...document.querySelectorAll('[data-run-action]')].map((e) => e.dataset.runAction), left: [...document.querySelectorAll('[data-left-out]')].map((e) => e.dataset.leftOut), "
            "why: [...document.querySelectorAll('[data-left-out]')].map((e) => e.querySelector('[data-i18n^=\"setup.actions.why.\"]').dataset.i18n)})")
INPUTS_JS = "() => [...document.querySelectorAll('.inputs-printed .inputs li')].map((e) => ({name: e.querySelector('.input-name').innerText, ref: e.querySelector('.ref-id').innerText, value: e.querySelector('.ref-value').innerText}))"


def actions_of(plan: dict) -> list[dict] | None:
    """The four actions of the check: a feed, a window of AN-1 later that day, the move of a draw planned late that morning, and the capture path; all acting at day 8 09:00."""
    at = 8 * DAY + 9 * 3600
    moved = late_sample(plan, 8, 10, 14)
    if moved is None:
        return None
    return [
        {"kind": "add_feed", "at": at, "unit_id": "U10"},
        {"kind": "analyzer_down", "at": at, "analyzer": "AN-1", "from": 8 * DAY + 14 * 3600, "length_min": 60},
        {"kind": "move_draw", "at": at, "sample_id": moved[0], "to": moved[1]},
        {"kind": "set_capture_path", "at": at, "path": "adapter_ingest"},
    ]


def setup_holds(page, problems: list[str], tag: str) -> None:
    """Setup opened from the plant: the kinds it carries and the kinds it left out, in the order of the plant's list; the reason of each; the bar's count."""
    # both lists: the form of an earlier visit may still be on the screen for a moment, and the plant the screen was opened from is read in the same turn as the link
    page.wait_for_selector("[data-setup-left-out]", timeout=15_000)
    page.wait_for_selector("[data-setup-actions]", timeout=15_000)
    got = page.evaluate(LISTS_JS)
    problems += [f"{tag}: {p}" for p in setup_lists_problems(got["kept"], got["left"], KEPT, LEFT)]
    if got["why"] != ["setup.actions.why.draw", "setup.actions.why.lab_setting"]:
        problems.append(f"{tag}: the reasons for the actions left out are {got['why']}, expected the draw and then the lab setting")
    said = page.inner_text("[data-note=origin-results]")
    if "2 of the 4" not in said:
        problems.append(f"{tag}: the bar says '{said[:120]}', expected it to count 2 of the 4 actions of the plant")
    if "actions=" not in page.input_value("#share-link"):
        problems.append(f"{tag}: the link of this setup does not hold the actions")


def pictures(page, out: Path, name: str, scroll: str) -> None:
    page.eval_on_selector(scroll, "e => e.scrollIntoView({block: 'start'})")
    page.wait_for_timeout(300)
    page.screenshot(path=str(out / "drill" / f"drill_{name}_1280x720_en.png"))
    set_lang(page, "ko")
    page.wait_for_timeout(300)
    page.screenshot(path=str(out / "drill" / f"drill_{name}_1280x720_ko.png"))
    set_lang(page, "en")


def results_actions(browser, url: str, out: Path, engine: str, plan: dict, problems: list[str]) -> None:
    # imported here: qa_plant_drill calls this module, and the helpers of its flows are in that one
    from qa_plant_drill import follow, open_link, open_panel, sent

    actions = actions_of(plan)
    if actions is None:
        return problems.append("the plan of the default run has no draw planned between 10:00 and 14:00 of day 8 to move")
    with open_link(browser, url, plant_hash(BUSY_S, engine, actions)) as (page, errors):
        wait_scene(page)
        settle(page, 3)
        if state(page)["t"] != str(BUSY_S):
            problems.append(f"results: the plant opened at {state(page)['t']}, the link says {BUSY_S}")
        instant_ref = page.eval_on_selector("[data-act-list] [data-ref]", "e => e.dataset.ref")
        # the card: Setup over the lens hall, with the feed and the window and not the draw or the capture path
        page.focus("[data-card-sample]")
        page.keyboard.press("Enter")
        page.wait_for_selector("[data-plant-record]", timeout=30_000)
        follow(page, "[data-plant-record]", "results", "setup", problems, "card results", t=BUSY_S)
        setup_holds(page, problems, "card")
        pictures(page, out, "setup_actions", "[data-setup-actions]")
        page.click("#back-to-plant")
        page.wait_for_selector("#main[data-screen=plant]", timeout=10_000)
        wait_scene(page)
        # the analyzer: the same lists; Run over two seeds sends the two actions, and Results lists them above its inputs and among them
        open_panel(page, "analyzer:AN-1", "analyzer")
        follow(page, "[data-plant-panel=analyzer]", "results", "setup", problems, "analyzer results", t=BUSY_S)
        setup_holds(page, problems, "analyzer")
        page.fill("#seeds", "1, 2")
        page.click("#run")
        page.wait_for_selector("[data-utilisation]", timeout=240_000)
        problems += [f"run with actions: {p}" for p in run_problems(sent(page), KEPT, [1, 2])]
        shown = page.eval_on_selector_all("[data-results-action]", "els => els.map((e) => e.dataset.resultsAction)")
        if shown != KEPT:
            problems.append(f"Results lists the actions {shown} above its inputs, expected {KEPT}")
        problems += [f"Results: {p}" for p in results_inputs_problems(page.evaluate(INPUTS_JS), [(name, instant_ref if instant else None) for name, instant in PRINTED])]
        problems += [f"Results: {p}" for p in clock_problems(page.evaluate(INPUTS_JS), [name for name, instant in PRINTED if instant])]
        if page.query_selector("[data-note=origin-results]") is None:
            problems.append("Results from the plant does not say which actions it carries")
        pictures(page, out, "results_actions", "[data-results-actions]")
        # a Setup edited so that the unit is gone is refused with the sentence of its reason and the place of the action in the list that was sent (the page shows an error of a run on Results, as for any run)
        page.click("#nav-setup")
        page.wait_for_selector("#run", timeout=15_000)
        page.fill("#n", "6")
        page.click("#run")
        page.wait_for_selector("[data-problem=refused]", timeout=60_000)
        said = page.inner_text("[data-problem=refused]")
        if "Action 1 of the list that was sent" not in said or "U10" not in said or "no such unit" not in said:
            problems.append(f"the refusal reads '{said[:200]}', expected the sentence of unknown_target, the place of the feed on U10 and the Worker's message")
        # dropping the actions sends a run with none
        page.click("#nav-setup")
        page.wait_for_selector("[data-drop-actions]", timeout=15_000)
        page.click("[data-drop-actions]")
        if page.query_selector("[data-run-action]") is not None:
            problems.append("the carried actions are still listed after the control that drops them all")
        page.fill("#seeds", "1")
        page.click("#run")
        page.wait_for_selector("[data-result]", timeout=240_000)
        problems += [f"run after dropping: {p}" for p in run_problems(sent(page), None, [1])]
        problems += [f"results: console: {e[:140]}" for e in errors]
    # a Setup opened without the plant: no list, no bar, and a run with no `actions`
    with open_link(browser, url, "#/setup") as (page, errors):
        page.wait_for_selector("#run", timeout=15_000)
        if page.query_selector("[data-setup-actions]") is not None or page.query_selector("[data-plant-origin]") is not None:
            problems.append("a Setup opened without the plant shows the actions of a plant or its bar")
        page.fill("#seeds", "1")
        page.click("#run")
        page.wait_for_selector("[data-result]", timeout=240_000)
        problems += [f"setup alone: {p}" for p in run_problems(sent(page), None, [1])]
        problems += [f"setup alone: console: {e[:140]}" for e in errors]
