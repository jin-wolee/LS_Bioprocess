"""The flows of the check `plant_action` of the headless QA of the plant (docs/design/plant_ui.md section 10, P6a), which qa_plant_action.py assembles. Given the default plant paused at day 8 at 09:00: each of
the eight actions is entered through its form (opened with Enter on its button, filled, sent with Enter): an accepted one increases the epoch, the clock lands on the `resume_at` of the Worker's answer, the list in
the HUD says it in words with its instant, the address holds it, and an undo returns the truth hash and the cells digests of the run before it. The round trip of five accepted actions, from the click to the first
frame of the new plan, stays within the budget (median at most 600 ms, the slowest at most 1 s). One refusal for each reason the default run shows through the bar (`past`, `outside_window`, `limit`) and `locked`
with a challenge open on the run are shown in words in English and in Korean with the Worker's message, and the action is not kept. A flow takes a browser and the URL of the served build and appends its
findings to `problems`; it never exits or prints.
"""
from __future__ import annotations

from pathlib import Path

from qa_lab_browser import go, set_lang, start_challenge
from qa_lab_conditions import load_average, of_page
from qa_plant_act_browser import ROUND_TRIP_JS, RUN_TIMEOUT, act_state, apply, bring_bar_into_view, fill_form, list_items, open_form, ready_of, refusal, runs_sent, undo, wait_epoch, wait_refusal
from qa_plant_act_helpers import clock_text, fields_of, refusal_problems, round_trip_problems
from qa_plant_browser import RECORD_PLANT_JS, open_plant, pause, plant_messages, seek, settle, wait_scene
from qa_plant_helpers import PLANT_VIEWPORTS, ROUND_TRIP_MEASURED, plan_from_messages

DAY = 86400
AT = 8 * DAY + 9 * 3600  # day 8 09:00 of the default run, a Tuesday, inside the first shift
INIT = RECORD_PLANT_JS + ROUND_TRIP_JS
LABEL_KINDS = ("set_flag", "set_capture_path", "set_labelling")


def the_eight(plan) -> list[tuple[dict, str | None]]:
    """The eight actions of the check, each with the row of the sampling board it picks (a move picks the row of a draw planned at least two hours after the clock, on the board of the clock's day)."""
    row = next(s for s in plan["samples"] if not s["skipped"] and s["drawn_s"] and AT + 2 * 3600 <= s["planned_s"] < AT + 6 * 3600)
    return [
        ({"kind": "add_feed", "at": AT, "unit_id": "U10"}, None),
        ({"kind": "raise_alarm", "at": AT, "unit_id": "U12"}, None),
        ({"kind": "move_draw", "at": AT, "sample_id": row["id"], "to": AT + 3600}, row["id"]),
        ({"kind": "analyzer_down", "at": AT, "analyzer": "AN-1", "from": AT + 5 * 3600, "length_min": 60}, None),
        ({"kind": "change_lot", "at": AT, "analyzer": "AN-2", "effective": 9 * DAY}, None),
        ({"kind": "set_flag", "at": AT, "architecture": "c_context", "flag": "audit_trail", "on": False}, None),
        ({"kind": "set_capture_path", "at": AT, "path": "adapter_ingest"}, None),
        ({"kind": "set_labelling", "at": AT, "method": "preprinted_barcode"}, None),
    ]


def enter(page, action: dict, row: str | None) -> None:
    open_form(page, action["kind"])
    fill_form(page, fields_of(action), row)
    apply(page)


def one_action(page, action: dict, row: str | None, problems: list[str], play: bool = False) -> None:
    """One action through its form, then its undo: the epoch, the clock, the list, the address, the checks of the answer and the hashes after the undo."""
    kind = action["kind"]
    before = act_state(page)
    epoch = int(before["epoch"])
    enter(page, action, row)
    wait_epoch(page, epoch + 1)
    page.wait_for_function("() => location.hash.includes('actions=')", timeout=30_000)
    after = act_state(page)
    ready = ready_of(page, epoch + 1)
    if ready is None:
        return problems.append(f"{kind}: no plant_ready of the epoch {epoch + 1}")
    if ready["resume_at"] != action["at"]:
        problems.append(f"{kind}: the Worker resumes at {ready['resume_at']}, the action acted at {action['at']}")
    page.wait_for_function("(t) => Number(document.querySelector('#plant').dataset.plantT) >= t", arg=ready["resume_at"], timeout=30_000)
    if not play and after["t"] != str(ready["resume_at"]):
        problems.append(f"{kind}: the clock reads {after['t']} after the answer, expected resume_at {ready['resume_at']}")
    if play and after["playing"] != "true":
        problems.append(f"{kind}: the clock was playing when the reader acted and is not playing after the answer")
    if not play and after["playing"] != "false":
        problems.append(f"{kind}: the clock was paused when the reader acted and plays after the answer")
    check = "truth_equal" if kind in LABEL_KINDS else "prefix_equal"
    if ready["checks"][check] is not True:
        problems.append(f"{kind}: {check} is {ready['checks'][check]}, expected true")
    if kind in LABEL_KINDS and kind != "set_labelling" and ready["hashes"]["truth"] != before["runHash"]:
        problems.append(f"{kind}: a lab setting changed the truth hash")
    items = list_items(page)
    if [i["kind"] for i in items] != [kind] or clock_text(action["at"]) not in items[0]["text"] or "assumed" not in items[0]["text"]:
        problems.append(f"{kind}: the list says {items}, expected one action in words with its instant printed as assumed")
    if after["actions"] != "1" or "actions=" not in after["hash"]:
        problems.append(f"{kind}: actions {after['actions']}, address {after['hash'][:60]}; expected one action in the spec and in the address")
    if page.query_selector(f"[data-action-form={kind}]") is not None:
        problems.append(f"{kind}: the form stayed open after the action was applied")
    # the undo: the hashes of the run before, an empty list, the address without the actions
    undo(page)
    wait_epoch(page, epoch + 2)
    page.wait_for_function("() => !location.hash.includes('actions=')", timeout=30_000)
    back = act_state(page)
    if (back["runHash"], back["cellsHash"]) != (before["runHash"], before["cellsHash"]):
        problems.append(f"{kind}: after the undo the hashes are not those of the run before the action")
    if list_items(page) or back["actions"] != "0" or "actions=" in back["hash"]:
        problems.append(f"{kind}: after the undo the list has {len(list_items(page))} actions, the spec {back['actions']}, the address {back['hash'][:60]}")
    undone = ready_of(page, epoch + 2)
    if undone is None or undone["resume_at"] != action["at"]:
        problems.append(f"{kind}: the undo resumes at {undone and undone['resume_at']}, expected {action['at']}")


def the_eight_actions(browser, url, problems: list[str]) -> None:
    with open_plant(browser, url, PLANT_VIEWPORTS["1280"], init_script=INIT) as (page, errors, _):
        wait_scene(page)
        pause(page)
        plan = plan_from_messages(plant_messages(page), 1)
        seek(page, AT)
        settle(page)
        for action, row in the_eight(plan):
            one_action(page, action, row, problems)
        # the clock was playing when the reader acted: it plays on after the answer
        page.click("[data-time=play]")
        page.wait_for_function("() => document.querySelector('#plant').dataset.plantPlaying === 'true'", timeout=10_000)
        epoch = int(act_state(page)["epoch"])
        enter(page, {"kind": "add_feed", "at": AT, "unit_id": "U10"}, None)  # `at` is the clock reading of the click, rounded up: only the state is judged here
        wait_epoch(page, epoch + 1)
        page.wait_for_function("() => document.querySelector('#plant').dataset.plantPlaying === 'true'", timeout=10_000)
        problems += [f"console: {e[:140]}" for e in errors]


def round_trip(browser, url, problems: list[str]) -> tuple[list[float], dict]:
    """Five accepted actions one after another, timed in the page from the click to the first frame of the new plan, with the conditions of the machine they were timed under."""
    load = load_average()
    five = [{"kind": "add_feed", "at": AT, "unit_id": "U10"}, {"kind": "add_feed", "at": AT, "unit_id": "U11"}, {"kind": "raise_alarm", "at": AT, "unit_id": "U12"},
            {"kind": "set_capture_path", "at": AT, "path": "adapter_ingest"}, {"kind": "analyzer_down", "at": AT, "analyzer": "AN-1", "from": AT + 5 * 3600, "length_min": 60}]
    with open_plant(browser, url, PLANT_VIEWPORTS["1280"], init_script=INIT) as (page, errors, _):
        wait_scene(page)
        pause(page)
        seek(page, AT)
        for i, action in enumerate(five):
            enter(page, action, None)
            wait_epoch(page, i + 2)
        page.wait_for_function("() => window.__rt.length >= 5", timeout=30_000)
        samples = page.evaluate("window.__rt")
        problems += round_trip_problems(samples)
        if len(samples) != 5:
            problems.append(f"the round trip was timed {len(samples)} times, expected 5")
        problems += [f"console: {e[:140]}" for e in errors]
        return samples, of_page(browser, page, load, PLANT_VIEWPORTS["1280"], ROUND_TRIP_MEASURED)


def say(page, reason: str, lang: str, problems: list[str], tag: str) -> None:
    """The refusal block in the language of the page: its reason, its sentence and the Worker's message."""
    problems += [f"{tag} ({lang}): {p}" for p in refusal_problems(refusal(page), reason, lang)]


def refusals(browser, url, out: Path, problems: list[str]) -> None:
    """past, outside_window and limit through the bar, each in both languages, the action not kept; then locked."""
    shot = out / "act"
    with open_plant(browser, url, PLANT_VIEWPORTS["1280"], init_script=INIT) as (page, errors, _):
        wait_scene(page)
        pause(page)
        plan = plan_from_messages(plant_messages(page), 1)
        seek(page, AT)
        settle(page)
        epoch = act_state(page)["epoch"]

        def unkept(tag: str) -> None:
            s = act_state(page)
            if s["actions"] != "0" or s["epoch"] != epoch or list_items(page) or "actions=" in s["hash"]:
                problems.append(f"{tag}: the refused action was kept: actions {s['actions']}, epoch {s['epoch']} (was {epoch}), {len(list_items(page))} in the list")

        # past: a window that starts before the clock
        open_form(page, "analyzer_down")
        fill_form(page, {"analyzer": "AN-1", "day": "8", "time": "08:00", "length": "60"})
        apply(page)
        wait_refusal(page)
        say(page, "past", "en", problems, "past")
        bring_bar_into_view(page)
        page.screenshot(path=str(shot / "act_refusal_1280x720_en.png"))
        set_lang(page, "ko")
        say(page, "past", "ko", problems, "past")
        page.screenshot(path=str(shot / "act_refusal_1280x720_ko.png"))
        set_lang(page, "en")
        unkept("past")
        page.keyboard.press("Escape")
        if page.evaluate("document.activeElement && document.activeElement.dataset.action") != "analyzer_down":
            problems.append("Escape did not close the form and give the focus back to its button")
        # outside_window: a feed on a reactor that is not in culture yet, at the opening of the run
        late = next(u["id"] for u in plan["units"] if u["start_s"] is not None and u["start_s"] > 28800)
        seek(page, 28800)
        open_form(page, "add_feed")
        fill_form(page, {"unit": late})
        apply(page)
        wait_refusal(page)
        say(page, "outside_window", "en", problems, "outside_window")
        set_lang(page, "ko")
        say(page, "outside_window", "ko", problems, "outside_window")
        set_lang(page, "en")
        unkept("outside_window")
        page.keyboard.press("Escape")
        # limit: the same feed twice at one instant
        seek(page, AT)
        enter(page, {"kind": "add_feed", "at": AT, "unit_id": "U10"}, None)
        wait_epoch(page, runs_sent(page))  # the refused requests before it took epochs too
        open_form(page, "add_feed")
        fill_form(page, {"unit": "U10"})
        apply(page)
        wait_refusal(page)
        say(page, "limit", "en", problems, "limit")
        set_lang(page, "ko")
        say(page, "limit", "ko", problems, "limit")
        set_lang(page, "en")
        if act_state(page)["actions"] != "1" or len(list_items(page)) != 1:
            problems.append("limit: the duplicate was kept, or the first feed was lost")
        problems += [f"console: {e[:140]}" for e in errors]
    locked_through_the_bar(browser, url, problems)


def locked_through_the_bar(browser, url, problems: list[str]) -> None:
    """A challenge open on the run of the plan (the default scenario, seed 1): an action is locked."""
    with open_plant(browser, url, PLANT_VIEWPORTS["1280"], init_script=INIT) as (page, errors, _):
        wait_scene(page)
        pause(page)
        start_challenge(page, "sample", shown="a_manual", seed=1, timeout=RUN_TIMEOUT)
        go(page, "plant")
        wait_scene(page)
        seek(page, AT)
        open_form(page, "add_feed")
        fill_form(page, {"unit": "U10"})
        apply(page)
        wait_refusal(page)
        say(page, "locked", "en", problems, "locked")
        set_lang(page, "ko")
        say(page, "locked", "ko", problems, "locked")
        if act_state(page)["actions"] != "0":
            problems.append("locked: the action was kept")
        problems += [f"locked: console: {e[:140]}" for e in errors if "locked" not in e.lower()][:2]
