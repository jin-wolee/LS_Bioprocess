"""The check `plant_truth` of the headless QA of the plant (docs/design/plant_ui.md section 10, P5b): the truth overlay. Given every message of the Worker recorded through a wrapper of the Worker class,
no `plant_ready`, `plant_halls` or `plant_record_view` carries a hidden field, a truth-only type, a verdict or a placeholder; nothing is asked of the Worker and no `plant_truth_view` arrives before the
reader presses the switch; with the switch on every element marked `data-overlay` carries the sentence of the label in both languages, the placeholders on the rails at the end of the default run equal what
the check computes from the plan and its cards, and the record panel shows the truth column and the verdicts beside the record, equal to the answer the Worker sent; with a challenge open on the same run
(started on the Challenge screen after the plan was posted) the truth request is `locked`, through the page, and the page says so beside the switch. A check takes a browser and the URL of the served build
and returns a Result; it never exits or prints.
"""
from __future__ import annotations

import json
from pathlib import Path

from qa_checks import Result, first_line
from qa_lab_browser import go, set_lang, start_challenge
from qa_plant_browser import RECORD_PLANT_JS, fold_place_card, hud_click, open_plant, pause, plant_messages, seek, settle, settle_camera, state, wait_scene
from qa_plant_helpers import DEFAULT_HALLS, PLANT_VIEWPORTS, plan_from_messages
from qa_plant_truth_helpers import absences_expected, label_problems, truth_leaks

# The sentence every element of the overlay carries, in the two languages (typed from the dictionaries) and the sentence the switch says when a challenge is open.
LABEL = {"en": "Simulation's own view, not available to any record", "ko": "시뮬레이션 자체의 시점이며 어떤 기록에도 없는 정보"}
# The short label every marker in the scene carries (the whole sentence is said once, by the switch)
SHORT = {"en": "Simulation's view", "ko": "시뮬레이션의 시점"}
LOCKED = {"en": "A challenge is open on this run", "ko": "챌린지가 열려 있으므로"}
# The placeholders on the rails at the end of the default run: A holds no card for the three samples a label error keyed to another sample (U06-D09-1, U13-D03-2, U18-D03-1), B and C hold every card.
ABSENCES_END = {"a_manual": 3, "b_lims_lite": 0, "c_context": 0}
ELEMENTS_JS = "() => [...document.querySelectorAll('[data-overlay]')].map((e) => ({text: e.textContent || '', hall: e.dataset.overlayHall || null, marker: !!e.closest('.plant-labels')}))"
VERDICTS_JS = """() => [...document.querySelectorAll('[data-plant-record] [data-question][data-verdict]')].map((e) => [e.dataset.question, e.dataset.verdict])"""


def stored_slot_problems(plan) -> list[str]:
    """No card holds a slot its architecture does not store: a card of a hall without `two_clocks` stores no sampled_at, and one of a hall without `available_at` has no knowable instant."""
    problems = []
    for hall in plan["records"]:
        flags = set(hall["flags_on"])
        for c in hall["cards"]:
            stored = {s["name"] for s in c["slots"] if s["stored"]}
            if "two_clocks" not in flags and "sampled_at" in stored:
                problems.append(f"{hall['architecture']}: a card stores sampled_at but the hall has no two clocks")
            if "available_at" not in flags and c["available_s"] is not None:
                problems.append(f"{hall['architecture']}: a card is knowable but the hall stores no availability")
    return problems[:3]


def before_the_switch(page, messages, plan, problems: list[str]) -> None:
    """Nothing of the overlay before the switch: no request, no answer, no leak in the plan, the halls or the rows of a record, the switch off and no rail."""
    sent = page.evaluate("window.__plantSent.map((m) => m.type)")
    if "plant_truth" in sent:
        problems.append("the page sent plant_truth before the switch was pressed")
    if any(m["data"]["type"] == "plant_truth_view" for m in messages):
        problems.append("a plant_truth_view arrived before the switch was pressed")
    problems += [f"a message carries what only the overlay may: {p}" for p in truth_leaks([m["data"] for m in messages])[:3]]
    problems += stored_slot_problems(plan)
    if page.get_attribute("#plant", "data-plant-truth") != "off" or page.get_attribute("[data-truth-switch]", "aria-pressed") != "false":
        problems.append("the switch is not off at first")
    if page.get_attribute("#plant", "data-plant-absences") is not None:
        problems.append("data-plant-absences is written while the switch is off")


def record_beside_truth(page, messages_of, lang: str, problems: list[str]) -> None:
    """A card opened with the overlay on: the record panel shows the truth column and the three verdicts of the lens beside the rows, and they are the ones the Worker answered."""
    page.focus("[data-card-sample]")
    sample = page.get_attribute("[data-card-sample]", "data-card-sample")
    page.keyboard.press("Enter")
    page.wait_for_selector("[data-plant-record=ready]", timeout=30_000)
    page.wait_for_selector("[data-truth-block] [data-lineage-truth]", timeout=30_000)
    page.wait_for_selector("[data-plant-record] [data-question][data-verdict]", timeout=10_000)
    answered = next((m["data"] for m in messages_of() if m["data"]["type"] == "plant_truth_view" and m["data"]["view"]["kind"] == "sample" and m["data"]["view"]["sample"]["sample_id"] == sample), None)
    if answered is None:
        problems.append(f"{lang}: no plant_truth_view for the sample {sample}")
        return
    lens = page.get_attribute("[data-plant-record]", "data-record-architecture")
    column = next((c for c in answered["view"]["columns"] if c["architecture"] == lens), None)
    if column is None:
        problems.append(f"{lang}: the answer holds no column of {lens}")
        return
    want = [[a["question"], a["verdict"]] for a in column["answers"]]
    if page.evaluate(VERDICTS_JS) != want:
        problems.append(f"{lang}: the verdicts on the page {page.evaluate(VERDICTS_JS)} are not those of the Worker's answer {want}")
    if page.inner_text("[data-truth-block] [data-truth=unit]").strip() != answered["view"]["truth"]["unit_id"]:
        problems.append(f"{lang}: the truth column does not name the unit of the answer")
    if page.query_selector(f"[data-plant-record] svg[data-lineage-column={lens}]") is None:
        problems.append(f"{lang}: the record is not drawn beside its truth")


def switched_on(page, messages_of, problems: list[str]) -> dict:
    """The switch pressed at the end of the run: the answer, the rails and the label in both languages, and the record beside the truth."""
    plan = plan_from_messages(messages_of(), 1)
    horizon = plan["horizon_s"]
    seek(page, horizon)
    settle(page)
    page.click("[data-truth-switch]")
    page.wait_for_function("() => !!document.querySelector('#plant').dataset.plantAbsences", timeout=30_000)
    settle(page)
    got = json.loads(page.get_attribute("#plant", "data-plant-absences") or "{}")
    want = absences_expected(plan, horizon)
    if got != want:
        problems.append(f"the rails hold {got}, the plan and its cards give {want}")
    if want != ABSENCES_END:
        problems.append(f"at the end of the run the plan gives {want}, expected {ABSENCES_END}")
    if page.get_attribute("#plant", "data-plant-truth") != "on" or page.get_attribute("[data-truth-switch]", "aria-pressed") != "true":
        problems.append("the switch does not say it is on")
    sent = page.evaluate("window.__plantSent.filter((m) => m.type === 'plant_truth')")
    if not sent or sent[0]["pick"] != {"halls": True} or any(m["epoch"] != 1 for m in sent):
        problems.append(f"the truth requests are {sent[:3]}: the first must ask for the halls under the epoch of the plan on screen")
    for lang in ("en", "ko"):
        set_lang(page, lang)
        if lang == "en":
            record_beside_truth(page, messages_of, lang, problems)
        page.wait_for_timeout(300)
        problems += [f"{lang}: {p}" for p in label_problems(page.evaluate(ELEMENTS_JS), LABEL[lang], SHORT[lang])]
    page.keyboard.press("Escape")
    page.click("[data-truth-switch]")
    page.wait_for_function("() => document.querySelector('#plant').dataset.plantTruth === 'off' && !document.querySelector('#plant').dataset.plantAbsences", timeout=10_000)
    if page.query_selector("[data-truth-block]") is not None:
        problems.append("the truth block stayed in the record panel after the switch was turned off")
    return want


def locked_through_the_page(browser, url, problems: list[str]) -> None:
    """A challenge started on the Challenge screen for the run of the plan (the default scenario, seed 1) after the plan was posted: pressing the switch is answered with `locked`, and the page says so."""
    with open_plant(browser, url, init_script=RECORD_PLANT_JS) as (page, errors, _):
        wait_scene(page)
        start_challenge(page, "sample", shown="a_manual", seed=1, timeout=120_000)
        go(page, "plant")
        wait_scene(page)
        page.click("[data-truth-switch]")
        page.wait_for_selector("#plant[data-plant-truth=locked]", timeout=30_000)
        for lang in ("en", "ko"):
            set_lang(page, lang)
            said = page.inner_text("[data-truth-locked]")
            if LOCKED[lang] not in said:
                problems.append(f"{lang}: the page says '{said[:60]}' beside the switch, expected a sentence that names the open challenge")
        errors_seen = [m["data"] for m in plant_messages(page) if m["data"]["type"] == "error" and m["data"]["code"] == "locked"]
        if not errors_seen or any(m["epoch"] != 1 for m in errors_seen):
            problems.append(f"the Worker's answers to the truth request are {[m['code'] for m in errors_seen]}: a locked error with the epoch of the plan was expected")
        if any(m["data"]["type"] == "plant_truth_view" for m in plant_messages(page)):
            problems.append("a plant_truth_view arrived for a run that is an open challenge")
        if page.get_attribute("#plant", "data-plant-absences") is not None:
            problems.append("a rail of placeholders is drawn for a run that is an open challenge")
        problems += [f"locked: console: {e[:140]}" for e in errors if "locked" not in e.lower()][:2]


def shot_cell(browser, url, out: Path, vp: str, lang: str, problems: list[str]) -> None:
    """The screenshots of the overlay at one viewport in one language: a hall with its placeholders (the camera brought to A at the end of the run) and a record panel with the truth column."""
    with open_plant(browser, url, PLANT_VIEWPORTS[vp], lang=lang, init_script=RECORD_PLANT_JS) as (page, errors, _):
        wait_scene(page)
        pause(page)
        seek(page, plan_from_messages(plant_messages(page), 1)["horizon_s"])
        settle(page)
        hud_click(page, "[data-truth-switch]")
        page.wait_for_function("() => !!document.querySelector('#plant').dataset.plantAbsences", timeout=30_000)
        name = f"{PLANT_VIEWPORTS[vp][0]}x{PLANT_VIEWPORTS[vp][1]}_{lang}"
        page.add_style_tag(content=".plant-bottom{display:none}")
        fold_place_card(page)
        page.click("[data-object-key='hall:a_manual']")
        page.evaluate("document.querySelector('.plant-wrap').scrollIntoView({block: 'start'})")
        page.wait_for_timeout(2500)
        (out / "truth" / f"plant_truth_hall_{name}.png").write_bytes(settle_camera(page))
        page.focus("[data-card-sample]")
        page.keyboard.press("Enter")
        page.wait_for_selector("[data-truth-block] [data-lineage-truth]", timeout=30_000)
        page.wait_for_timeout(400)
        page.screenshot(path=str(out / "truth" / f"plant_truth_record_{name}.png"))
        problems += [f"{vp} {lang}: console: {e[:140]}" for e in errors]


def check_plant_truth(browser, url, out: Path) -> Result:
    problems: list[str] = []
    (out / "truth").mkdir(parents=True, exist_ok=True)
    with open_plant(browser, url, init_script=RECORD_PLANT_JS) as (page, errors, _):
        wait_scene(page)
        pause(page)
        messages_of = lambda: plant_messages(page)  # noqa: E731 - the messages the wrapper has recorded so far
        plan = plan_from_messages(messages_of(), 1)
        if plan is None:
            return Result("plant_truth", False, "no plan reached the page", {"problems": ["no plan"]})
        if [r["architecture"] for r in plan["records"]] != DEFAULT_HALLS:
            problems.append(f"the plan holds the halls {[r['architecture'] for r in plan['records']]}")
        before_the_switch(page, messages_of(), plan, problems)
        want = switched_on(page, messages_of, problems)
        problems += [f"console: {e[:140]}" for e in errors]
        state_end = state(page)
    try:
        locked_through_the_page(browser, url, problems)
    except Exception as e:  # a page that crashed is a finding
        problems.append(f"locked: {first_line(e)}")
    for vp in PLANT_VIEWPORTS:
        for lang in ("en", "ko"):
            try:
                shot_cell(browser, url, out, vp, lang, problems)
            except Exception as e:  # a cell that crashed is a failed cell
                problems.append(f"shots {vp} {lang}: {first_line(e)}")
    detail = (f"nothing asked or answered before the switch; with it on the rails hold {want} at the end of the run (as the plan and its cards give), every element of the overlay carries the label in both "
              f"languages, the record panel shows the truth column and the verdicts of the Worker's answer; a challenge open on the same run is locked through the page; screenshots at both viewports in both languages ({state_end['t']} s)")
    return Result("plant_truth", not problems, detail + (f" | {problems[0]}" if problems else ""), {"problems": problems})
