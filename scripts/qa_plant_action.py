"""The check `plant_action` of the headless QA of the plant (docs/design/plant_ui.md section 10, P6a), assembled: the flows of qa_plant_act.py (the eight actions through the bar by the keyboard with their undo,
the round trip of five accepted actions, the refusals past, outside_window, limit and locked), the two refusals that come with a link (`unknown_target`, `closed_loop`), and the screenshots: the bar with a form
open, the reader's list after three actions and the sampling board in the scene, in English and Korean at 1280 by 720, and one at 390 by 844, with the sweep of the numbers over the page with a form open (every
digit under a data-ref, data-result or data-label). A check takes a browser and the URL of the served build and returns a Result; it never exits or prints. The pages it opens are closed.
"""
from __future__ import annotations

import json
import statistics
from pathlib import Path
from urllib.parse import parse_qs

from qa_checks import Result, first_line
from qa_lab_browser import NUMBERS_JS, set_lang
from qa_lab_helpers import number_offenders
from qa_plant_act import AT, INIT, enter, refusals, round_trip, the_eight, the_eight_actions
from qa_plant_act_browser import act_state, bring_bar_into_view, fill_form, open_form, wait_epoch
from qa_plant_act_helpers import SENTENCES, fields_of
from qa_plant_browser import open_plant, pause, plant_messages, seek, settle, settle_camera, wait_scene
from qa_plant_drill import open_link
from qa_plant_drill_helpers import plant_hash
from qa_plant_helpers import PLANT_VIEWPORTS, plan_from_messages


def both_languages(page, path: Path, name: str, size: str = "1280x720") -> None:
    """A screenshot in English and then in Korean (the language goes back to English)."""
    page.screenshot(path=str(path / f"{name}_{size}_en.png"))
    set_lang(page, "ko")
    page.wait_for_timeout(200)
    page.screenshot(path=str(path / f"{name}_{size}_ko.png"))
    set_lang(page, "en")


def sweep(page, problems: list[str], tag: str) -> None:
    problems += [f"{tag}: a number outside a data-ref, data-result or data-label: '{o['text']}' in {o['where']}" for o in number_offenders(page.evaluate(NUMBERS_JS))]


def screens(browser, url, out: Path, problems: list[str]) -> str:
    """The pictures, and the numbers swept with a form open. Returns the engine version the page wrote into its address."""
    shot = out / "act"
    with open_plant(browser, url, PLANT_VIEWPORTS["1280"], init_script=INIT) as (page, errors, _):
        wait_scene(page)
        pause(page)
        plan = plan_from_messages(plant_messages(page), 1)
        seek(page, AT)
        settle(page)
        # the bar with the form of a move open, a row picked, and the numbers of the page swept with it open
        move, row = the_eight(plan)[2]
        open_form(page, "move_draw")
        fill_form(page, fields_of(move), row)
        sweep(page, problems, "the move form")
        bring_bar_into_view(page)
        both_languages(page, shot, "act_form")
        page.keyboard.press("Escape")
        # the reader's list after three actions: a feed, an alarm, the capture path
        for i, k in enumerate((0, 1, 6)):
            enter(page, *the_eight(plan)[k])
            wait_epoch(page, i + 2)
        open_form(page, "analyzer_down")
        sweep(page, problems, "the list and the window form")
        page.keyboard.press("Escape")
        both_languages(page, shot, "act_list")
        engine = parse_qs(act_state(page)["hash"].partition("?")[2]).get("engine", [""])[0]
        # the sampling board in the scene: the objects list brings the camera to it and opens the form of the move on its bay; the form is closed for the picture of the board
        page.click("[data-object-key='board:B1']")
        page.wait_for_selector("[data-action-form=move_draw]", timeout=15_000)
        if page.query_selector("[data-board=B1]") is None:
            problems.append("the board of the first bay is not on the form that its button of the objects list opened")
        page.keyboard.press("Escape")
        page.evaluate("window.scrollTo(0, 0)")
        (shot / "act_board_1280x720_en.png").write_bytes(settle_camera(page))
        set_lang(page, "ko")
        page.wait_for_timeout(200)
        page.screenshot(path=str(shot / "act_board_1280x720_ko.png"))
        set_lang(page, "en")
        problems += [f"screens: console: {e[:140]}" for e in errors]
    with open_plant(browser, url, PLANT_VIEWPORTS["390"], init_script=INIT) as (page, errors, _):
        wait_scene(page)
        pause(page)
        seek(page, AT)
        open_form(page, "add_feed")
        fill_form(page, {"unit": "U10"})
        bring_bar_into_view(page)
        page.screenshot(path=str(shot / "act_form_390x844_en.png"))
        if page.evaluate("document.documentElement.scrollWidth > window.innerWidth"):
            problems.append("the bar with a form open scrolls sideways at 390 px")
        problems += [f"phone: console: {e[:140]}" for e in errors]
    return engine


def link_refusals(browser, url, engine: str, problems: list[str]) -> None:
    """`unknown_target` and `closed_loop` come with a link: a unit the run does not have, and a kind that acts on a recorded result. The head of the route says the sentence of the reason in both languages."""
    cases = [("unknown_target", {"kind": "add_feed", "at": AT, "unit_id": "U99"}), ("closed_loop", {"kind": "hold", "at": AT, "unit_id": "U10"})]
    for reason, action in cases:
        with open_link(browser, url, plant_hash(None, engine, [action])) as (page, errors):
            page.wait_for_selector("[data-note=refusal]", timeout=180_000)
            for lang in ("en", "ko"):
                set_lang(page, lang)
                said = page.inner_text("[data-note=refusal]")
                if SENTENCES[lang][reason] not in said:
                    problems.append(f"link {reason} ({lang}): the head of the route says '{said[:80]}', expected the sentence with '{SENTENCES[lang][reason]}'")
            if page.get_attribute("#plant", "data-plant-epoch") is not None:
                problems.append(f"link {reason}: a plan is on screen for a link whose action the Worker refused")
            problems += [f"link {reason}: console: {e[:140]}" for e in errors][:2]


def check_plant_action(browser, url, out: Path) -> Result:
    (out / "act").mkdir(parents=True, exist_ok=True)
    problems: list[str] = []
    samples: list[float] = []
    engine = ""

    def run(name: str, step) -> None:
        try:
            step()
        except Exception as e:  # a page that crashed is a finding
            problems.append(f"{name}: {first_line(e)}")

    def timed() -> None:
        samples.extend(round_trip(browser, url, problems))

    def pictures() -> None:
        nonlocal engine
        engine = screens(browser, url, out, problems)

    run("the eight actions", lambda: the_eight_actions(browser, url, problems))
    run("the refusals", lambda: refusals(browser, url, out, problems))
    run("the round trip", timed)
    run("the screens", pictures)
    run("the links", lambda: link_refusals(browser, url, engine or "0.0.0", problems))
    trip = f"round trip of five accepted actions {', '.join(f'{s:.0f}' for s in samples)} ms (median {statistics.median(samples):.0f}; limits 600 and 1000)" if samples else "the round trip was not measured"
    detail = (f"each of the eight actions entered by the keyboard (the epoch up, the clock on resume_at, the list in words with the instant as an assumed input, the address, the undo back to the hashes before), the clock plays on after the "
              f"answer; refusals past, outside_window, limit, locked, unknown_target and closed_loop shown in both languages with the Worker's message, the action not kept; {trip}")
    return Result("plant_action", not problems, detail + (f" | {problems[0]}" if problems else ""), {"problems": problems, "round_trip_ms": samples, "json": json.dumps(samples)})
