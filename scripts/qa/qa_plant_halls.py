"""The checks of the record halls for scripts/qa/qa_plant.py (docs/design/plant_ui.md section 10, P5a): `plant_halls` (the halls arrive one after the other and the cards on the shelves are the ones the
plan says), `plant_record` (a card opened and closed by the keyboard and by a click on the shelves, the lens, both languages) and `plant_hall_shots` (screenshots of a hall close-up at a mid-run
instant in both languages at both viewports, and one that two fresh runs draw pixel for pixel). A check takes a browser and the URL of the served build and returns a Result; it never exits or prints.
The page ships no test global: everything is read from the attributes of the plant host, the DOM and the Worker's messages that the QA records itself.
"""
from __future__ import annotations

from pathlib import Path

from qa_checks import Result, first_line
from qa_lab_helpers import LANGS, number_offenders
from qa_plant_browser import NUMBERS_IN_JS, RECORD_PLANT_JS, blank_page, fold_place_card, hud_click, open_plant, pause, pixel_diff, pixel_stats, plant_messages, seek, settle, settle_camera, state, wait_scene
from qa_plant_helpers import (
    CLOSEUP_INSTANT_S, DEFAULT_HALLS, HALL_CARDS_END, HALL_INSTANTS, PLANT_VIEWPORTS, cards_expected, cards_problems, clock_reading, halls_arrival_problems, not_blank, plan_from_messages,
    repro_problems,
)

TABLE_JS = """() => Object.fromEntries([...document.querySelectorAll('[data-plant-table=halls] tbody tr')].map((r) => [r.dataset.objectRow.replace('hall:', ''), [...r.querySelectorAll('td')].map((c) => c.innerText.trim())]))"""
# The words that the two languages give the record panel and the card list, typed from the dictionaries.
EN = {"heading": "Record of", "open": "Open the card of"}
KO = {"heading": "기록", "open": "카드 열기"}


def check_plant_halls(browser, url, out: Path) -> Result:
    """Given the plant, `plant_ready` holds the hall of the first architecture and one `plant_halls` follows for each other, in order; at three instants of the run (a few hours in, the middle, the end) the
    map `data-plant-cards` that the scene wrote from `hallsAt` equals the counts computed here from the plan the page received, and the table of the text alternative says the same; the lens starts on
    the first hall; no console error."""
    problems: list[str] = []
    with open_plant(browser, url, init_script=RECORD_PLANT_JS) as (page, errors, _):
        wait_scene(page)
        pause(page)
        messages = plant_messages(page)
        problems += halls_arrival_problems(messages, DEFAULT_HALLS)
        plan = plan_from_messages(messages, 1)
        if plan is None:
            return Result("plant_halls", False, "no plan reached the page", {"problems": ["no plan"]})
        if state(page)["lens"] != DEFAULT_HALLS[0]:
            problems.append(f"the lens starts on {state(page)['lens']}, expected {DEFAULT_HALLS[0]}")
        seen = {}
        for name, t in HALL_INSTANTS.items():
            seek(page, t)
            settle(page)
            want = cards_expected(plan, t)
            seen[name] = want
            problems += [f"{name}: {p}" for p in cards_problems(state(page)["cards"], want)]
            page.wait_for_timeout(200)  # the text alternative follows a paused clock at once; give it a turn
            rows = page.evaluate(TABLE_JS)
            for hall, counts in want.items():
                if rows.get(hall, [None] * 4)[2:] != [str(counts["shown"]), str(counts["knowable"])]:
                    problems.append(f"{name}: the table says {hall} {rows.get(hall)}, the plan gives {counts}")
        if not (seen["early"] != seen["mid"] != seen["end"]):
            problems.append("the counts do not change across the three instants: the cards are not drawn from the clock")
        if {h: c["shown"] for h, c in seen["end"].items()} != HALL_CARDS_END:
            problems.append(f"at the end of the run the halls hold {({h: c['shown'] for h, c in seen['end'].items()})}, expected {HALL_CARDS_END}")
        if seen["mid"]["a_manual"]["knowable"] != 0 or seen["mid"]["c_context"]["knowable"] == 0:
            problems.append(f"knowable at the middle of the run: {seen['mid']}; A stores no availability and C does")
        problems += [f"console: {e[:140]}" for e in errors]
    ready = next(m for m in messages if m["data"]["type"] == "plant_ready")
    halls = [m for m in messages if m["data"]["type"] == "plant_halls"]
    detail = (f"plant_ready then {len(halls)} plant_halls ({ready['at']:.0f} ms, last {(halls[-1]['at'] if halls else ready['at']):.0f} ms after the page started); at 3 instants the cards on the shelves equal the plan "
              f"(middle: {seen['mid']})")
    return Result("plant_halls", not problems, detail + (f" | {problems[0]}" if problems else ""), {"problems": problems, "counts": seen})


def open_by_keyboard(page, problems: list[str], words: dict, label: str) -> tuple[str, str] | None:
    """From the last object of the list, Tab reaches the first card of the lens hall's list and Enter opens its record, with the focus in the panel; returns (architecture, sample)."""
    page.evaluate("() => { const b = [...document.querySelectorAll('#plant-objects button')]; b[b.length - 1].focus(); }")  # the last button of the list: since P6b the cells of the flags board
    page.keyboard.press("Tab")
    focused = page.evaluate("() => { const e = document.activeElement; return e && e.dataset && e.dataset.cardSample ? [e.dataset.cardArchitecture, e.dataset.cardSample, e.innerText] : null; }")
    if focused is None:
        problems.append(f"{label}: Tab from the objects list did not reach a card button")
        return None
    architecture, sample, text = focused
    if words["open"] not in text:
        problems.append(f"{label}: the card button reads '{text}', expected '{words['open']}'")
    page.keyboard.press("Enter")
    page.wait_for_selector("[data-plant-record=ready]", timeout=30_000)
    return architecture, sample


def panel_problems(page, architecture: str, sample: str, words: dict, label: str) -> list[str]:
    problems = []
    got = page.evaluate("() => { const p = document.querySelector('[data-plant-record]'); return {sample: p.dataset.recordSample, arch: p.dataset.recordArchitecture, heading: p.querySelector('h2').innerText, "
                        "focused: document.activeElement === p, column: !!document.querySelector('[data-lineage-column]'), answers: document.querySelectorAll('[data-verdict], .lg-answer').length}; }")
    if (got["sample"], got["arch"]) != (sample, architecture):
        problems.append(f"{label}: the panel is for {got['arch']} {got['sample']}, expected {architecture} {sample}")
    if words["heading"] not in got["heading"] or sample not in got["heading"]:
        problems.append(f"{label}: the heading reads '{got['heading']}'")
    if not got["focused"]:
        problems.append(f"{label}: the focus did not move into the panel")
    if page.query_selector(f"[data-lineage-column='{architecture}'] [data-node='sample:{sample}']") is None:
        problems.append(f"{label}: the record of {architecture} has no sample node for {sample}")
    if got["answers"]:
        problems.append(f"{label}: the panel carries {got['answers']} answers or verdicts; a record never says whether its rows are right")
    return problems


def record_figure_problems(page, label: str) -> list[str]:
    """P9 (plant_ui.md section 12, item 20): with a record panel open, every figure in it (the keys, stamps and values of the drawing, the truth block and the answers beside it when the overlay is on) sits
    inside a data-ref, data-result or data-label, as the numbers sweep of the lab reads the Lineage screen. The panel is waited for to be complete: with the overlay on, its truth block and answers have arrived."""
    page.wait_for_selector("[data-plant-record=ready] [data-lineage-column]", timeout=30_000)
    if page.get_attribute("[data-plant-record]", "data-record-truth") == "on":
        page.wait_for_selector("[data-plant-record] [data-lineage-truth]", timeout=30_000)
        page.wait_for_selector("[data-plant-record] [data-answer]", timeout=30_000)
    nodes = page.evaluate(NUMBERS_IN_JS, "[data-plant-record]")
    swept = [f"{label}: a number outside a data-ref, data-result or data-label in the record panel: '{o['text']}' in {o['where']}" for o in number_offenders(nodes)]
    return swept + ([] if len(nodes) >= 8 else [f"{label}: the record panel holds {len(nodes)} text nodes with a digit; the sweep expected a drawing with at least 8"])


def open_first_card(page) -> None:
    """Open the record of the first card of the list of the lens hall (Tab reaches it, Enter opens it), as the keyboard reader does."""
    page.focus("[data-card-sample]")
    page.keyboard.press("Enter")
    page.wait_for_selector("[data-plant-record=ready]", timeout=30_000)


def record_cell(browser, url, out: Path, lang: str, words: dict, vp: str = "1280") -> list[str]:
    """The record panel opened by the keyboard at one viewport in one language (and, at 1280 by 720, the lens and the click); its screenshot is saved."""
    problems: list[str] = []
    with open_plant(browser, url, PLANT_VIEWPORTS[vp], lang=lang) as (page, errors, _):
        wait_scene(page)
        pause(page)
        seek(page, CLOSEUP_INSTANT_S)
        settle(page)
        opened = open_by_keyboard(page, problems, words, lang)
        if opened:
            problems += panel_problems(page, *opened, words, lang) + record_figure_problems(page, lang)
            page.wait_for_timeout(400)
            page.screenshot(path=str(out / "halls" / f"plant_record_{PLANT_VIEWPORTS[vp][0]}x{PLANT_VIEWPORTS[vp][1]}_{lang}.png"))
            page.keyboard.press("Escape")
            page.wait_for_selector("[data-plant-record]", state="detached", timeout=5_000)
            page.wait_for_timeout(300)  # the panel gives the focus back when it unmounts
            back = page.evaluate("() => document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.cardSample : null")
            if back != opened[1]:
                problems.append(f"{lang}: Escape did not give the focus back to the card button ({back})")
        if vp != "1280":
            return problems + [f"{lang}: console: {e[:140]}" for e in errors]
        # the lens: the hall the record panel reads
        page.click("[data-lens-option=c_context]")
        try:
            page.wait_for_function("() => document.querySelector('#plant').dataset.plantLens === 'c_context' && document.querySelector('#plant-cards').dataset.plantCardsList === 'c_context'", timeout=5_000)
        except Exception:  # noqa: BLE001 - the timeout is the finding
            problems.append(f"{lang}: the lens chip did not move the lens and the card list to c_context")
        settle(page)
        page.focus("[data-card-sample]")
        page.keyboard.press("Enter")
        page.wait_for_selector("[data-plant-record=ready]", timeout=30_000)
        if page.query_selector("[data-lineage-column=c_context]") is None:
            problems.append(f"{lang}: the record panel does not read the lens hall c_context")
        page.click("[data-lens-option=a_manual]")  # a card open in another hall closes: the panel reads the lens only
        if page.query_selector("[data-plant-record]") is not None:
            problems.append(f"{lang}: the panel stayed open after the lens moved to another hall")
        if lang == "en":
            problems += click_pick_problems(page)
        problems += [f"{lang}: console: {e[:140]}" for e in errors]
    return problems


def click_pick_problems(page) -> list[str]:
    """A click on the shelves of the hall in view opens the record of the card it meets, and the lens goes to that hall."""
    page.click("[data-plant-hud=place] summary")
    page.click("[data-object-key='hall:c_context']")
    for _ in range(3):
        page.keyboard.press("+")
    settle_camera(page)
    page.evaluate("document.querySelector('.plant-wrap').scrollIntoView({block: 'start'})")
    for y in range(150, 420, 40):
        page.mouse.click(640, y)
        page.wait_for_timeout(250)
        if page.query_selector("[data-plant-record]") is not None:
            ok = page.get_attribute("[data-plant-record]", "data-record-architecture") == "c_context" and state(page)["lens"] == "c_context"
            return [] if ok else ["a click on the shelves of C opened the record of another hall or left the lens"]
    return ["no click on the shelves of the hall in view opened a card"]


def check_plant_record(browser, url, out: Path) -> Result:
    """Given the clock at the middle of the run, in each language: Tab from the objects list reaches a card of the lens hall, Enter opens its record (the lineage view's boxes, no answer, no verdict) with the
    focus in the panel, Escape closes it and gives the focus back (at 1280 by 720 and at 390 by 844, with a screenshot of the open panel); at 1280 by 720 the lens chip moves the lens and the list, a card open in another hall closes, and a click on the shelves opens the card it meets."""
    problems = []
    (out / "halls").mkdir(parents=True, exist_ok=True)
    for vp in PLANT_VIEWPORTS:
        for lang, words in (("en", EN), ("ko", KO)):
            try:
                problems += record_cell(browser, url, out, lang, words, vp)
            except Exception as e:  # a cell that crashed is a failed cell
                problems.append(f"{vp} {lang}: {first_line(e)}")
    return Result("plant_record", not problems, "the record panel opened by keyboard at both viewports in English and Korean, lens and click at 1280 by 720" + (f" | {problems[0]}" if problems else ""), {"problems": problems})


def closeup(page, hall: str, zoom: int = 3) -> bytes:
    """The hall in view from close to its shelves: the place card folded and the bottom bar hidden (the scene is the picture), the camera brought to the hall and zoomed in `zoom` steps, the lens on it."""
    page.add_style_tag(content=".plant-bottom{display:none}")
    fold_place_card(page)
    hud_click(page, f"[data-lens-option={hall}]")
    page.click(f"[data-object-key='hall:{hall}']")
    for _ in range(zoom):
        page.keyboard.press("+")
    page.evaluate("document.querySelector('.plant-wrap').scrollIntoView({block: 'start'})")
    page.wait_for_timeout(2500)  # the camera eases toward the hall and the labels follow it to a tenth of a pixel: wait until the remaining error is far below that
    return settle_camera(page)


def hall_shots(browser, url, out: Path, vp: str, lang: str) -> dict:
    """The close-up of the hall of C (stacks, pennants, knowable bars, a slot not stored) and the view of A from the distance the camera takes when it is brought to a hall, with the lens on it and the neighbouring halls dimmed, at the mid-run instant."""
    problems: list[str] = []
    try:
        with open_plant(browser, url, PLANT_VIEWPORTS[vp], lang=lang) as (page, errors, _):
            wait_scene(page)
            pause(page)
            seek(page, CLOSEUP_INSTANT_S)
            settle(page)
            name = f"{PLANT_VIEWPORTS[vp][0]}x{PLANT_VIEWPORTS[vp][1]}_{lang}"
            shots = {}
            for label, hall, zoom in (("closeup", "c_context", 3), ("lens", "a_manual", 0)):
                png = closeup(page, hall, zoom)
                (out / "halls").joinpath(f"plant_hall_{label}_{name}.png").write_bytes(png)
                shots[label] = png
                with blank_page(browser) as blank:
                    stats = pixel_stats(blank, png)
                if not not_blank(stats):
                    problems.append(f"{label}: the screenshot is blank (spread {stats['std']:.1f}, {stats['colours']} colours)")
            if shots["closeup"] == shots["lens"]:
                problems.append("the close-up of C and the view of A are the same picture")
            problems += [f"console: {e[:140]}" for e in errors]
    except Exception as e:  # a cell that crashed is a failed cell
        problems.append(first_line(e))
    return {"cell": f"{vp}_{lang}", "problems": problems}


def fixed_closeup(browser, url) -> tuple[bytes, list[str]]:
    """One fresh run to the fixed instant, the close-up of C once the check chip has settled and the camera has stopped. The signs over the halls are DOM text in a layer of their own, which Chromium
    rasterises a little differently from one run to the next (one run in four or five, whatever their content); the picture that two runs must agree on pixel for pixel is the scene, so the
    layer of the signs is left out of it."""
    with open_plant(browser, url, PLANT_VIEWPORTS["1280"]) as (page, errors, _):
        wait_scene(page)
        page.wait_for_selector("[data-plant-hud=check] [data-check-state=identical]", timeout=60_000)
        pause(page)
        seek(page, CLOSEUP_INSTANT_S)
        settle(page, 5)
        page.add_style_tag(content=".plant-labels{display:none}")
        return closeup(page, "c_context"), [f"console: {e[:140]}" for e in errors]


def check_plant_hall_shots(browser, url, out: Path) -> Result:
    """Screenshots of a hall close-up (C) and of A with the lens on it, at day 10 12:00, in both languages at 1280 by 720 and at 390 by 844: none blank; and the close-up at that fixed instant, which two
    fresh runs draw pixel for pixel."""
    (out / "halls").mkdir(parents=True, exist_ok=True)
    cells = [hall_shots(browser, url, out, vp, lang) for vp in PLANT_VIEWPORTS for lang in LANGS]
    first, problems = fixed_closeup(browser, url)
    second, more = fixed_closeup(browser, url)
    problems += more
    (out / "halls" / "plant_hall_fixed_1280x720.png").write_bytes(first)
    with blank_page(browser) as page:
        diff = pixel_diff(page, first, second)
    problems += repro_problems(diff["differing"], diff["total"]) if diff["differing"] >= 0 else [f"the two pictures differ in size: {diff['size']}"]
    bad = [c for c in cells if c["problems"]]
    problems += [f"{c['cell']}: {c['problems'][0]}" for c in bad]
    day, time = clock_reading(CLOSEUP_INSTANT_S)
    detail = f"{len(cells) - len(bad)}/{len(cells)} cells clean at day {day} {time}; the fixed close-up: {diff['differing']} of {diff['total']} pixels differ between two runs"
    return Result("plant_hall_shots", not problems, detail + (f" | {problems[0]}" if problems else ""), {"cells": cells, "problems": problems, "differing": diff["differing"]})
