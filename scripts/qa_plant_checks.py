"""The checks of the plant page for scripts/qa_plant.py (docs/design/plant_ui.md section 10) that look at what loads and what is there: `plant_load`, `size`, `matrix` and `plant_fallback` (the capability
check: WebGL off, the text alternative, no request for the plant chunk). A check takes a browser (or the Playwright handle, for the fallback) and the URL of the served build and returns a Result;
it never exits or prints. The checks of the motion (the frames while the clock plays, the controls of the clock, the screenshots) are in qa_plant_motion.py; the constants and the pure helpers in
qa_plant_helpers.py and the browser plumbing in qa_plant_browser.py.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from qa_checks import Result, first_line
from qa_lab_browser import NUMBERS_JS, open_lab, wait_final
from qa_lab_helpers import LAB_THEMES, LANGS, cross_origin, number_offenders, request_gzip_total, served_path
from qa_plant_browser import LIST_JS, open_plant, wait_scene
from qa_plant_helpers import (
    DEFAULT_OBJECTS, DEFAULT_SPEED, DEFAULT_START_S, FIRST_LOAD_LIMIT, LOADER_LIMIT, PLANT_LIMIT, PLANT_VIEWPORTS,
    counts_problems, hash_problems, size_problems, split_requests, three_in,
)

# A day-0 reading of the HUD clock while the first hour of the run plays: day 0, 08:00 to 08:59 (the clock plays from the opening of the first shift once the scene is drawn).
FIRST_HOUR = re.compile(r"day 0 08:\d\d")


def check_plant_load(browser, url, out: Path) -> Result:
    """Given the built lab, Home loads without the plant chunk; entering the plant requests it; no request to another origin; no console error; the status line names the renderer; the page state is
    in the attributes of the plant host: the clock plays at the default speed from the opening of the first shift."""
    problems: list[str] = []
    with open_lab(browser, url, PLANT_VIEWPORTS["1280"]) as (page, errors, requests):
        page.wait_for_selector("#main[data-ready=true]", timeout=60_000)
        before = split_requests(served_path(u, url) for u in requests)
        if before["plant"]:
            problems.append(f"Home requested the plant chunk: {before['plant']}")
        if not before["loader"]:
            problems.append("Home did not request the loader chunk")
        entry = page.get_attribute("#enter-plant", "data-plant-entry")
        if entry != "scene":
            problems.append(f"the entry on Home is '{entry}', expected 'scene' where WebGL two is available")
        page.click("#enter-plant")
        state = wait_scene(page)
        after = split_requests(served_path(u, url) for u in requests)
        if len(after["plant"]) != 1:
            problems.append(f"entering the plant requested {len(after['plant'])} plant chunks, expected 1")
        status = page.inner_text("#plant-status")
        renderer = re.search(r"Renderer:\s*(\S.*)", status)
        if not renderer:
            problems.append(f"the status line does not name the renderer: '{status[:80]}'")
        if page.get_attribute("#plant-status", "data-plant-status") != "ready":
            problems.append("the status line does not say the scene is ready")
        if state["epoch"] != "1":
            problems.append(f"data-plant-epoch is {state['epoch']}, expected 1 (the first plan asked for)")
        if not (state["t"] or "").lstrip("-").isdigit() or not DEFAULT_START_S <= int(state["t"]) < DEFAULT_START_S + 3600:
            problems.append(f"data-plant-t is {state['t']}, expected the first hour of the run from {DEFAULT_START_S}")
        if state["playing"] != "true" or state["speed"] != str(DEFAULT_SPEED):
            problems.append(f"the clock is playing={state['playing']} at speed {state['speed']}, expected playing at {DEFAULT_SPEED}")
        problems += hash_problems(state["runHash"], state["cellsHash"])
        clock = page.inner_text("[data-plant-clock]")
        if not FIRST_HOUR.search(clock):
            problems.append(f"the HUD clock reads '{clock}', expected 08:00 to 08:59 of day 0")
        elsewhere = cross_origin(requests, url)
        problems += [f"request to another origin: {u}" for u in elsewhere]
        problems += [f"console: {e[:140]}" for e in errors]
    detail = (f"Home without the plant chunk, entering it requested {after['plant'][0] if after['plant'] else 'nothing'}; renderer '{(renderer.group(1) if renderer else '')[:60]}'; "
              f"epoch {state['epoch']}, t {state['t']}, playing {state['playing']}, {len(errors)} console errors")
    return Result("plant_load", not problems, detail + (f" | {problems[0]}" if problems else ""), {"problems": problems, "requests": sorted(set(after["plant"] + after["loader"]))})


def check_size(browser, url, root: Path) -> Result:
    """The first load of Home (every file of a cold load but the plant chunk, which it must not request), the loader chunk inside it, and the plant chunk that entering the plant requests."""
    with open_lab(browser, url, PLANT_VIEWPORTS["1280"]) as (page, _, requests):
        wait_final(page)
        home = split_requests(served_path(u, url) for u in requests)
        page.click("#enter-plant")
        wait_scene(page)
        entered = split_requests(served_path(u, url) for u in requests)
    first = request_gzip_total(home["first"], root)
    loader = request_gzip_total(home["loader"], root) if home["loader"] else None
    plant = request_gzip_total(entered["plant"], root) if entered["plant"] else None
    problems = size_problems(first, loader, plant)
    problems += [f"{p} holds three.js: it must be in the plant chunk only" for p in three_in(home["first"], root)]
    if home["plant"]:
        problems.append(f"a cold load of Home requested the plant chunk: {home['plant']}")
    detail = f"first load {first / 1024:.1f} KB gzip over {len(home['first'])} files (limit {FIRST_LOAD_LIMIT // 1024} KB); loader {loader} B (limit {LOADER_LIMIT // 1024} KB); plant chunk {(plant or 0) / 1024:.1f} KB (limit {PLANT_LIMIT // 1024} KB)"
    return Result("size", not problems, detail + (f" | {problems[0]}" if problems else ""), {"first": first, "loader": loader, "plant": plant, "problems": problems})


def matrix_cell(browser, url, out: Path, vp: str, label: str, theme: str, scheme: str, lang: str) -> dict:
    name = f"{vp}_{label}_{lang}"
    problems: list[str] = []
    try:
        with open_plant(browser, url, PLANT_VIEWPORTS[vp], scheme, theme, lang) as (page, errors, _):
            wait_scene(page)
            page.wait_for_timeout(300)
            m = page.evaluate("({sw: document.documentElement.scrollWidth, iw: window.innerWidth, lang: document.documentElement.lang})")
            if m["sw"] > m["iw"]:
                problems.append(f"horizontal scroll: scrollWidth {m['sw']} > innerWidth {m['iw']}")
            if m["lang"] != lang:
                problems.append(f"the page language is {m['lang']}, expected {lang}")
            for selector in ("#plant", "[data-plant-hud=place]", "[data-plant-hud=check]", ".plant-hint", "[data-plant-time]", "[data-time=scrub]", "[data-plant-bar=actions]", "[data-plant-hud=lens]", "#plant-objects", "#plant-cards", "#plant-text", "#plant-live"):
                if page.query_selector(selector) is None:
                    problems.append(f"missing {selector}")
            problems += counts_problems(json.loads(page.get_attribute("#plant", "data-plant-objects") or "{}"), page.evaluate(LIST_JS))
            bar = page.evaluate("[...document.querySelectorAll('[data-plant-bar=actions] [data-action]')].map(b => b.dataset.action + (b.disabled ? ':disabled' : ''))")
            if bar != ["add_feed", "move_draw", "analyzer_down", "set_flag", "set_capture_path", "more"]:
                problems.append(f"the bottom bar holds {bar}, expected the five core actions and the overflow, all enabled")
            nodes = page.evaluate(NUMBERS_JS)
            problems += [f"a number outside a data-ref, data-result or data-label: '{o['text']}' in {o['where']}" for o in number_offenders(nodes)]
            page.bring_to_front()
            page.evaluate("document.querySelector('.plant-wrap').scrollIntoView({block: 'start'})")  # the scene fills the viewport, bottom bar and all
            page.screenshot(path=str(out / "shots" / f"{name}.png"))
            # P5b: the panel of a reactor and the truth switch pressed are in the sweep of the numbers too (a figure of a panel is a label)
            page.click("[data-object-key='reactor:U10']")
            page.wait_for_selector("[data-plant-panel=reactor]", timeout=10_000)
            page.click("[data-truth-switch]")
            page.wait_for_function("() => !!document.querySelector('#plant').dataset.plantAbsences", timeout=30_000)
            page.wait_for_timeout(200)
            problems += [f"a number outside a data-ref, data-result or data-label with the panel open: '{o['text']}' in {o['where']}" for o in number_offenders(page.evaluate(NUMBERS_JS))]
            if page.query_selector("[data-overlay]") is None:
                problems.append("the truth switch pressed left no element of the overlay")
            problems += [f"console: {e[:140]}" for e in errors]
    except Exception as e:  # a cell that crashed is a failed cell
        problems.append(first_line(e))
    return {"cell": name, "problems": problems}


def check_matrix(browser, url, out: Path) -> Result:
    """The plant's DOM at the two viewports, in both themes (and `auto` in both system schemes), in both languages: the parts are there, nothing scrolls sideways, every number is marked, no console error.
    The screenshots at 1280 by 720 and 390 by 844, one per language, are also copied to the top of the output directory."""
    cells = [matrix_cell(browser, url, out, vp, label, theme, scheme, lang) for vp in PLANT_VIEWPORTS for label, theme, scheme in LAB_THEMES for lang in LANGS]
    for vp, size in PLANT_VIEWPORTS.items():
        for lang in LANGS:
            shot = out / "shots" / f"{vp}_light_{lang}.png"
            if shot.exists():
                (out / f"plant_{size[0]}x{size[1]}_{lang}.png").write_bytes(shot.read_bytes())
    bad = [c for c in cells if c["problems"]]
    shown = "; ".join(f"{c['cell']}: {c['problems'][0]}" for c in bad[:4])
    return Result("matrix", not bad, f"{len(cells) - len(bad)}/{len(cells)} cells clean" + (f" | {shown}" if bad else ""), {"cells": cells})


def check_plant_fallback(pw, url, out: Path) -> Result:
    """Given WebGL off (`--disable-3d-apis`), Home offers the plant as text, the plant route shows the text alternative and the objects list, and the plant chunk is never requested."""
    problems: list[str] = []
    browser = pw.chromium.launch(headless=True, args=["--disable-3d-apis"])
    try:
        with open_lab(browser, url, PLANT_VIEWPORTS["1280"]) as (page, errors, requests):
            page.wait_for_selector("#main[data-ready=true]", timeout=60_000)
            entry = page.get_attribute("#enter-plant", "data-plant-entry")
            if entry != "text":
                problems.append(f"the entry on Home is '{entry}', expected 'text' without WebGL")
            page.click("#enter-plant")
            page.wait_for_selector("#main[data-screen=plant]", timeout=10_000)
            page.wait_for_selector("#plant-text", timeout=60_000)
            # the halls come after the first answer (plant_halls): the table of the halls is complete when the last of them has arrived
            page.wait_for_function("(n) => document.querySelectorAll('[data-plant-table=halls] tbody tr').length >= n", arg=DEFAULT_OBJECTS["hall"], timeout=60_000)
            if page.query_selector("[data-plant-fallback]") is None:
                problems.append("the notice of the fallback is missing")
            if page.query_selector("#plant") is not None:
                problems.append("the plant host exists without WebGL")
            rows = page.evaluate("Object.fromEntries([...document.querySelectorAll('[data-plant-table]')].map(t => [t.dataset.plantTable, t.querySelectorAll('tbody tr').length]))")
            # the sampling boards list the samples planned for the day of the clock, and nothing is planned on day 0 (the first draws are the day after an inoculation): the table is there with no row;
            # the flags board (P6b) has a row for each flag of the build
            flags = page.evaluate("document.getElementById('main').dataset.flags.split(',').length")
            if rows != {"reactors": DEFAULT_OBJECTS["reactor"], "analyzers": DEFAULT_OBJECTS["analyzer"], "halls": DEFAULT_OBJECTS["hall"], "boards": 0, "flags": flags}:
                problems.append(f"the text alternative holds the rows {rows}")
            listed = page.evaluate(LIST_JS)
            if listed != DEFAULT_OBJECTS:
                problems.append(f"the objects list holds {listed}")
            if page.query_selector("#plant-objects button") is not None:
                problems.append("the objects list has buttons that bring a camera that is not there")
            asked = split_requests(served_path(u, url) for u in requests)
            if asked["plant"]:
                problems.append(f"the plant chunk was requested without WebGL: {asked['plant']}")
            page.screenshot(path=str(out / "plant_fallback_1280x720.png"))
            problems += [f"console: {e[:140]}" for e in errors]
    finally:
        browser.close()
    detail = f"entry '{entry}', text alternative rows {rows}, objects {listed}, plant chunk requests: {len(asked['plant'])}"
    return Result("plant_fallback", not problems, detail + (f" | {problems[0]}" if problems else ""), {"problems": problems})
