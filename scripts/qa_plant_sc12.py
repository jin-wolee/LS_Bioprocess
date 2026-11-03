"""The check `sc12` on the plant of the headless QA (docs/design/plant_ui.md section 10, P7c): the five break-out cases opened through their links.

For each of the five cases, in a fresh page, opened through its link (`#/plant?case=..`, seed 9013, the five records of the Break-out form): no console error; `data-plant-case` is the case; the objects of the
host and of the objects list equal the counts of the plan the page received (lots, equipment items, confirming tubes, and the others of a case); the truth hash and the digest of each hall equal the Node
reference entry (P7b made one, for the medium-lot case) and the Worker's own messages; no message of the plan carries what only the overlay may; at four instants and under two lenses `data-plant-items` equals what the
rules of section 3.2 give for the plan; the panels of a lot, an equipment item, a reactor and a confirming sample open by the keyboard and from a click on a crate and carry the numbers of the plan, and the link in
each lands on the Break-out screen with the case and seed (qa_plant_sc12_panels.py); the overlay asks nothing before the switch, then one request for the halls and one for the event, marks the origin the scenario
names and the units the answer lists at their onsets, and every element of it carries the sentence of the label, in both languages. The frames of one case are measured with their conditions and reported; screenshots
of each case at 1280 by 720 in English and one in Korean go to `sc12/`. Against the public build (qa_plant_sc12_public.py) a case is not offered. A check takes a browser and the URL of the served build and returns a
Result; it never exits or prints.
"""
from __future__ import annotations

import json
from pathlib import Path

from qa_checks import Result, first_line
from qa_lab_browser import set_lang
from qa_lab_conditions import load_average, of_page, problems as conditions_problems, summary as conditions_summary
from qa_plant_browser import FRAMES_JS, LIST_JS, RECORD_PLANT_JS, pause, plant_messages, seek, settle, state, wait_scene
from qa_plant_drill import open_link
from qa_plant_helpers import FRAMES_MEASURED, PLANT_VIEWPORTS, plan_from_messages
from qa_plant_motion import play_frames
from qa_plant_sc12_helpers import (
    ARCHS, CASES, LABEL, ask_problems, breakout_problems, case_href, event_problems, hash_problems, hashes_of_messages, instants_of, items_problems, objects_problems, reference_entry, sent_picks,
)
from qa_plant_sc12_panels import crate_and_drill, with_an_action
from qa_plant_truth import ELEMENTS_JS, SHORT
from qa_plant_truth_helpers import label_problems, truth_leaks

INIT = RECORD_PLANT_JS + FRAMES_JS


def lens_to(page, lens: str) -> None:
    page.click(f"[data-lens-option={lens}]")
    page.wait_for_function("(l) => document.querySelector('#plant').dataset.plantLens === l", arg=lens, timeout=10_000)


def at_instants(page, plan, case: str, problems: list[str]) -> None:
    """`data-plant-items` at four instants of the case under two lenses, against the rules of section 3.2 computed from the plan."""
    for name, t in instants_of(plan).items():
        for lens in ("a_manual", "c_context"):
            lens_to(page, lens)
            seek(page, t)
            settle(page, 4)
            problems += [f"{case} {name}: {p}" for p in items_problems(page.get_attribute("#plant", "data-plant-items"), plan, int(state(page)["t"]), lens)]


def overlay(page, plan, case: str, problems: list[str], lang: str, first: bool) -> None:
    """The overlay of the event: nothing asked before the switch (on the page as it was opened: `first`); then, each time the switch is pressed, one request for the halls and one for the event; the origin and the
    units reached at their instants; every element labelled; and gone again."""
    tag = f"{case} {lang}"
    asked = sent_picks(page.evaluate("window.__plantSent"))
    if page.get_attribute("#plant", "data-plant-breakout") is not None:
        problems.append(f"{tag}: data-plant-breakout is written while the switch is off")
    if first and any(m["data"]["type"] == "plant_truth_view" for m in plant_messages(page)):
        problems.append(f"{tag}: a plant_truth_view arrived before the switch was pressed")
    page.click("[data-truth-switch]")
    page.wait_for_function("() => !!document.querySelector('#plant').dataset.plantBreakout", timeout=60_000)
    problems += [f"{tag}: {p}" for p in ask_problems(asked if first else [], sent_picks(page.evaluate("window.__plantSent"))[len(asked):])]
    view = next((m["data"]["view"] for m in plant_messages(page) if m["data"]["type"] == "plant_truth_view" and m["data"]["view"]["kind"] == "breakout"), None)
    if view is None:
        problems.append(f"{tag}: no plant_truth_view of the event arrived")
        return
    problems += [f"{tag}: {p}" for p in event_problems(case, view, plan)]
    onsets = sorted(a["onset_s"] for a in view["affected"])
    for t in (onsets[0] - 60, onsets[0], plan["horizon_s"]):
        seek(page, t)
        settle(page, 4)
        problems += [f"{tag}: {p}" for p in breakout_problems(page.get_attribute("#plant", "data-plant-breakout"), plan, view, int(state(page)["t"]))]
    problems += [f"{tag}: {p}" for p in label_problems(page.evaluate(ELEMENTS_JS), LABEL[lang], SHORT[lang])]
    page.click("[data-truth-switch]")
    page.wait_for_function("() => document.querySelector('#plant').dataset.plantBreakout === undefined", timeout=10_000)
    if page.evaluate(ELEMENTS_JS) and len(page.evaluate(ELEMENTS_JS)) != 1:
        problems.append(f"{tag}: {len(page.evaluate(ELEMENTS_JS))} elements stay marked data-overlay after the switch is off, expected the switch's own")


def shots(page, plan, case: str, out: Path, lang: str, truth: bool) -> None:
    """The case at the instant of its last result, under the lens C: the rack, the shelf with its stamps and the tape; with the overlay on, the event as well."""
    lens_to(page, "c_context")
    seek(page, instants_of(plan)["results"])
    settle(page, 4)
    if truth:
        page.click("[data-truth-switch]")
        page.wait_for_function("() => !!document.querySelector('#plant').dataset.plantBreakout", timeout=60_000)
    page.evaluate("document.querySelector('.plant-wrap').scrollIntoView({block: 'start'})")
    page.wait_for_timeout(1500)
    page.screenshot(path=str(out / f"{case}{'_truth' if truth else ''}_1280x720_{lang}.png"))
    if truth:
        page.click("[data-truth-switch]")
        page.wait_for_function("() => document.querySelector('#plant').dataset.plantBreakout === undefined", timeout=10_000)


def one_case(browser, url: str, case: str, engine: str, reference: dict, out: Path, problems: list[str], measure: bool) -> str:
    """Every step of the check on one case; returns the line the summary says of it."""
    note = ""
    with open_link(browser, url, case_href(case, engine), PLANT_VIEWPORTS["1280"], INIT) as (page, errors):
        s = wait_scene(page, halls=len(ARCHS))
        pause(page)
        epoch = int(s["epoch"])
        messages = plant_messages(page)
        plan = plan_from_messages(messages, epoch)
        if plan is None:
            problems.append(f"{case}: no plan arrived")
            return case
        if page.get_attribute("#plant", "data-plant-case") != case:
            problems.append(f"{case}: data-plant-case is {page.get_attribute('#plant', 'data-plant-case')}")
        problems += [f"{case}: {p}" for p in objects_problems(json.loads(s["objects"]), page.evaluate(LIST_JS), plan)]
        truth, cells = hashes_of_messages(messages, epoch)
        problems += [f"{case}: {p}" for p in hash_problems(s["runHash"], s["cellsHash"], truth, cells, "Worker")]
        entry = reference_entry(reference, case)
        if entry:
            problems += [f"{case}: {p}" for p in hash_problems(s["runHash"], s["cellsHash"], entry["truth"], entry["cells"], "Node reference")]
        problems += [f"{case}: a message carries what only the overlay may: {p}" for p in truth_leaks([m["data"] for m in messages])[:3]]
        at_instants(page, plan, case, problems)
        lens_to(page, "c_context")
        seek(page, instants_of(plan)["results"])
        settle(page, 4)
        crate_and_drill(page, plan, case, "c_context", problems)
        shots(page, plan, case, out, "en", False)
        overlay(page, plan, case, problems, "en", True)
        shots(page, plan, case, out, "en", True)
        if case == CASES[0]:
            set_lang(page, "ko")
            overlay(page, plan, case, problems, "ko", False)
            shots(page, plan, case, out, "ko", True)
            set_lang(page, "en")
        if measure:
            load = load_average()
            start, end, stats, seen = play_frames(page, instants_of(plan)["addition"])
            conditions = of_page(browser, page, load, PLANT_VIEWPORTS["1280"], FRAMES_MEASURED)
            problems += conditions_problems(conditions)
            if stats["n"] < 300 or int(end["t"]) <= int(start["t"]):
                problems.append(f"{case}: the frames were not measured while the clock moved: {stats['n']} frames, {start['t']} to {end['t']} s")
            note = f" [frames: {stats['n']} from the first addition, median {stats['median']:.1f} ms and 95th percentile {stats['p95']:.1f} ms against 50 and 80 of the default plant, reported and not judged; {end['calls']} draw calls; {conditions_summary(conditions)}]"
        problems += [f"{case}: console: {e[:140]}" for e in errors]
    return f"{case}{note}"


def check_sc12(browser, url: str, out: Path, reference: Path, public: list[str]) -> Result:
    """The five cases through their links, and the public build's refusal (`public` holds its problems, made by qa_plant_sc12_public.py)."""
    problems: list[str] = []
    ref = json.loads(reference.read_text(encoding="utf-8")) if reference.exists() else {}
    if "breakout" not in ref:
        problems.append("the Node reference holds no break-out entry")
    engine = ref.get("engine_version", "")
    (out / "sc12").mkdir(parents=True, exist_ok=True)
    lines = []
    for k, case in enumerate(CASES):
        try:
            lines.append(one_case(browser, url, case, engine, ref, out / "sc12", problems, measure=k == 0))
            if k == 0:
                with_an_action(browser, url, case, engine, INIT, problems)
        except Exception as e:  # noqa: BLE001 - a case that cannot be driven is a finding, and the others are still run
            problems.append(f"{case}: {first_line(e)}")
    problems += public
    detail = f"{len(CASES)} cases at seed 9013 under {len(ARCHS)} records opened through their links: " + "; ".join(lines) + ("; the public build offers no case" if not public else "")
    return Result("sc12", not problems, detail + (f" | {problems[0]}" if problems else ""), {"problems": problems})
