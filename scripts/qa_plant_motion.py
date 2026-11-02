"""The checks of the plant's motion for scripts/qa_plant.py (docs/design/plant_ui.md section 10): `plant_frames` (the frame budget while the clock plays through a busy stretch, samples moving),
`plant_clock` (the controls and the keys of the clock, the page state, in both languages) and `plant_shots` (screenshots of three instants in both languages at both viewports, and one fixed
instant that two fresh runs draw pixel for pixel). A check takes a browser and the URL of the served build and returns a Result; it never exits or prints. The page ships no test global:
everything is read from the attributes of the plant host and from the DOM.
"""
from __future__ import annotations

from pathlib import Path

from qa_checks import Result, first_line
from qa_lab_browser import open_lab
from qa_lab_conditions import load_average, of_page, problems as conditions_problems, summary as conditions_summary
from qa_lab_helpers import LANGS
from qa_plant_browser import FRAMES_JS, blank_page, open_plant, pause, pixel_diff, pixel_stats, seek, settle, state, wait_scene
from qa_plant_helpers import (
    BUSY_START_S, DAY_S, DEFAULT_SPEED, DEFAULT_START_S, FIXED_INSTANT_S, FRAMES, FRAMES_DROPPED, FRAMES_MEASURED, MEDIAN_LIMIT_MS, P95_LIMIT_MS, PLANT_VIEWPORTS, SHOT_INSTANTS, SPEEDS,
    clock_reading, frame_intervals, frame_stats, frames_problems, motion_problems, not_blank, repro_problems, shot_digest, shots_problems,
)

# The Korean texts the clock's controls carry, typed from the dictionary: the label of the scrubber, the play button while playing, the HUD's "day" word.
KO_SCRUB = "실행 중의 시점"
KO_PAUSE = "일시정지"
KO_PLAY = "재생"


def clock_t(page) -> int:
    return int(state(page)["t"])


def play_frames(page, start_s: int, overlay_timeout: int = 30_000, timeout: int = 240_000):
    """The frame run of `plant_frames`, for any plant that is on screen: the clock paused and set to `start_s`, the truth overlay on (the budget is for the scene with the cards drawn, the samples moving and
    the overlay), then played at the speed it has until 300 frames after the first five have been drawn. Returns the host's attributes at the start and at the end, the statistics of the intervals and the
    number of tubes seen on the floor. The sweep (qa_plant_sweep.py) measures its plants the same way."""
    pause(page)
    seek(page, start_s)
    settle(page)
    page.click("[data-truth-switch]")
    page.wait_for_function("() => !!document.querySelector('#plant').dataset.plantAbsences", timeout=overlay_timeout)
    start = state(page)
    page.evaluate("window.__plantFrames.length = 0; window.__plantTubes.length = 0")
    page.click("[data-time=play]")
    # the polling is by time, not by frame: Playwright's default polling asks for animation frames itself, and its callbacks would be counted as frames of the scene
    page.wait_for_function(f"window.__plantFrames.length >= {FRAMES + FRAMES_DROPPED + 40}", polling=500, timeout=timeout)  # a margin: frames that share a time stamp count once
    end = state(page)
    stats = frame_stats(frame_intervals(page.evaluate("window.__plantFrames")))
    seen = [int(start["tubes"] or 0), int(end["tubes"] or 0), *page.evaluate("window.__plantTubes")]
    return start, end, stats, seen


def check_plant_frames(browser, url, out: Path) -> Result:
    """Given the clock playing at the default speed from day 8 at 08:30, through the morning's draws with samples on the floor and the truth overlay on, the frame interval over 300 frames at 1280 by 720 is within the
    budget, the clock moved on while the frames were measured, and a tube was on the floor; a screenshot is saved and is not blank, and the object counts equal those of the scenario. The conditions of the
    measurement are recorded with it (docs/design/plant_ui.md section 8)."""
    problems: list[str] = []
    load = load_average()
    with open_plant(browser, url, init_script=FRAMES_JS) as (page, errors, _):
        wait_scene(page)
        start, end, stats, seen = play_frames(page, BUSY_START_S)
        conditions = of_page(browser, page, load, PLANT_VIEWPORTS["1280"], FRAMES_MEASURED)
        problems += frames_problems(stats)
        problems += motion_problems(int(start["t"]), int(end["t"]), end["playing"], max(seen), end["speed"])
        page.bring_to_front()
        png = page.locator("#plant").screenshot(path=str(out / "plant_frames_1280x720.png"))
        shot = pixel_stats(page, png)
        if not not_blank(shot):
            problems.append(f"the screenshot is blank: luminance spread {shot['std']:.1f}, {shot['colours']} colours")
        problems += [f"console: {e[:140]}" for e in errors]
    problems += conditions_problems(conditions)
    detail = (f"{stats['n']} frames from day 8 08:30 playing at x{DEFAULT_SPEED} with the truth overlay on, median {stats['median']:.1f} ms (limit {MEDIAN_LIMIT_MS:.0f}), 95th percentile {stats['p95']:.1f} ms (limit {P95_LIMIT_MS:.0f}); "
              f"{end['calls']} draw calls, up to {max(seen)} tubes on the floor, the clock moved {int(end['t']) - int(start['t'])} s; screenshot spread {shot['std']:.0f}, {shot['colours']} colours; "
              f"{conditions_summary(conditions)}") if stats["n"] else "no frames"
    return Result("plant_frames", not problems, detail + (f" | {problems[0]}" if problems else ""), {"stats": stats, "problems": problems, "calls": end["calls"], "tubes_max": max(seen), "conditions": conditions})


def english_controls(page, problems: list[str]) -> None:
    """The keys, the buttons and the scrubber of the clock, in English, from the state the scene starts in (playing at the default speed)."""
    s = state(page)
    if (s["playing"], s["speed"]) != ("true", str(DEFAULT_SPEED)):
        problems.append(f"the clock starts playing={s['playing']} at {s['speed']}, expected playing at {DEFAULT_SPEED}")
    page.keyboard.press("Space")
    page.wait_for_function("() => document.querySelector('#plant').dataset.plantPlaying === 'false'", timeout=10_000)
    t1 = clock_t(page)
    page.wait_for_timeout(800)
    if clock_t(page) != t1:
        problems.append("the clock advanced while it was paused")
    if page.get_attribute("[data-time=play]", "aria-pressed") != "false" or page.inner_text("[data-time=play]").strip() != "Play":
        problems.append("the play button does not say Play while paused")
    page.keyboard.press("Space")
    try:
        page.wait_for_function("(t) => Number(document.querySelector('#plant').dataset.plantT) > t", arg=t1, timeout=10_000)
    except Exception:  # noqa: BLE001 - the timeout is the finding
        problems.append("the clock did not advance after Space")
    for key, speed in (("3", 600), ("1", 30), ("4", 3600), ("2", 120)):
        page.keyboard.press(key)
        if state(page)["speed"] != str(speed):
            problems.append(f"the key {key} left the speed at {state(page)['speed']}, expected {speed}")
    page.click(f"[data-speed='{SPEEDS[2]}']")
    if state(page)["speed"] != str(SPEEDS[2]) or page.get_attribute(f"[data-speed='{SPEEDS[2]}']", "aria-pressed") != "true":
        problems.append("the speed button of 600 did not set the speed and show it pressed")
    page.click(f"[data-speed='{DEFAULT_SPEED}']")
    pause(page)

    # the scrubber and the reading
    target = DAY_S + 30 * 60  # day 1 at 00:30
    seek(page, target)
    reading = page.inner_text("[data-plant-clock]")
    day, time = clock_reading(target)
    if f"day {day} {time}" not in reading:
        problems.append(f"the HUD reads '{reading}' after a seek to day {day} {time}")
    if page.get_attribute("[data-time=scrub]", "aria-valuetext") != f"day {day} {time}":
        problems.append(f"the scrubber says '{page.get_attribute('[data-time=scrub]', 'aria-valuetext')}', expected day {day} {time}")
    ticks = page.evaluate("document.querySelectorAll('.plant-tick').length")
    if ticks != 20:
        problems.append(f"the scrubber has {ticks} day ticks, expected 20 for 21 days")
    # seek by keys: an hour and a day
    for key, delta in (("]", 3600), ("[", -3600), ("}", DAY_S), ("{", -DAY_S)):
        before = clock_t(page)
        page.keyboard.press(key)
        if clock_t(page) != before + delta:
            problems.append(f"the key {key} moved the clock from {before} to {clock_t(page)}, expected {before + delta}")
    # the keyboard reaches the scrubber: an arrow key moves it by a minute
    page.focus("[data-time=scrub]")
    before = clock_t(page)
    page.keyboard.press("ArrowRight")
    if clock_t(page) != before + 60:
        problems.append(f"the arrow key on the scrubber moved the clock from {before} to {clock_t(page)}, expected {before + 60}")
    # step to the next and the previous event: each lands on a later and an earlier instant, paused
    a = clock_t(page)
    page.keyboard.press(".")
    b = clock_t(page)
    page.keyboard.press(",")
    c = clock_t(page)
    if not (b > a and c < b):
        problems.append(f"the step keys went from {a} to {b} and then to {c}: next must be later and previous earlier")
    page.click("[data-time=next]")
    if clock_t(page) <= c:
        problems.append("the next-event button did not move the clock on")
    if state(page)["playing"] != "false":
        problems.append("a step to an event left the clock playing")
    page.wait_for_timeout(500)
    if page.get_attribute("[data-plant-live]", "data-plant-live") != "event":
        problems.append("the live region did not say an event after a step")


def korean_controls(browser, url, problems: list[str]) -> None:
    with open_plant(browser, url, lang="ko") as (page, _, _):
        wait_scene(page)
        if page.get_attribute("[data-time=scrub]", "aria-label") != KO_SCRUB:
            problems.append(f"ko: the scrubber is labelled '{page.get_attribute('[data-time=scrub]', 'aria-label')}', expected '{KO_SCRUB}'")
        if page.inner_text("[data-time=play]").strip() != KO_PAUSE:
            problems.append(f"ko: the play button reads '{page.inner_text('[data-time=play]').strip()}' while playing, expected '{KO_PAUSE}'")
        page.keyboard.press("Space")
        page.wait_for_function("() => document.querySelector('#plant').dataset.plantPlaying === 'false'", timeout=10_000)
        if page.inner_text("[data-time=play]").strip() != KO_PLAY:
            problems.append(f"ko: the play button reads '{page.inner_text('[data-time=play]').strip()}' while paused, expected '{KO_PLAY}'")
        if "일째" not in page.inner_text("[data-plant-clock]"):
            problems.append("ko: the HUD clock does not read in Korean")


def reduced_motion_starts_paused(browser, url, problems: list[str]) -> None:
    """Given prefers-reduced-motion (section 9), the plant is drawn and the clock stays at the opening of the first shift until the reader plays it."""
    with open_lab(browser, url, PLANT_VIEWPORTS["1280"]) as (page, _, _):
        page.wait_for_selector("#main[data-ready=true]", timeout=60_000)
        page.emulate_media(reduced_motion="reduce")
        page.click("#enter-plant")
        s = wait_scene(page)
        page.wait_for_timeout(1000)
        again = state(page)
        if (s["playing"], again["playing"]) != ("false", "false") or again["t"] != str(DEFAULT_START_S):
            problems.append(f"reduced motion: playing={again['playing']}, t={again['t']}, expected paused at {DEFAULT_START_S}")
        page.click("[data-time=play]")
        page.wait_for_function("(t) => Number(document.querySelector('#plant').dataset.plantT) > t", arg=DEFAULT_START_S, timeout=10_000)


def check_plant_clock(browser, url, out: Path) -> Result:
    """Given the plant, the clock plays at the default speed once the scene is drawn; Space, the number keys and the buttons pause, play and set the speed; the clock does not advance while paused; the
    scrubber, the brackets and the braces seek (by an hour and by a day), the arrow keys reach the scrubber, the comma and the period and the buttons step between events; the live region says the
    event; the page state attributes agree; the same controls are labelled in Korean; under reduced motion the clock starts paused."""
    problems: list[str] = []
    with open_plant(browser, url) as (page, errors, _):
        wait_scene(page)
        english_controls(page, problems)
        problems += [f"console: {e[:140]}" for e in errors]
    korean_controls(browser, url, problems)
    reduced_motion_starts_paused(browser, url, problems)
    detail = f"keys, buttons and scrubber of the clock in English and Korean, reduced motion starts paused, {len(problems)} problems"
    return Result("plant_clock", not problems, detail + (f" | {problems[0]}" if problems else ""), {"problems": problems})


def shots_of(browser, url, out: Path, vp: str, lang: str) -> dict:
    """Open the plant at one viewport in one language and take the screenshot of each instant of SHOT_INSTANTS, the clock paused and set by the scrubber."""
    problems: list[str] = []
    digests: dict[str, str] = {}
    try:
        with open_plant(browser, url, PLANT_VIEWPORTS[vp], lang=lang) as (page, errors, _):
            wait_scene(page)
            pause(page)
            for name, t in SHOT_INSTANTS.items():
                seek(page, t)
                settle(page)
                page.bring_to_front()
                page.evaluate("document.querySelector('.plant-wrap').scrollIntoView({block: 'start'})")  # the scene fills the viewport, the controls and all
                shot = out / "motion" / f"plant_{name}_{PLANT_VIEWPORTS[vp][0]}x{PLANT_VIEWPORTS[vp][1]}_{lang}.png"
                png = page.screenshot(path=str(shot))
                digests[name] = shot_digest(png)
                stats = pixel_stats(page, png)
                if not not_blank(stats):
                    problems.append(f"{name}: the screenshot is blank (spread {stats['std']:.1f}, {stats['colours']} colours)")
            problems += shots_problems(digests)
            problems += [f"console: {e[:140]}" for e in errors]
    except Exception as e:  # a cell that crashed is a failed cell
        problems.append(first_line(e))
    return {"cell": f"{vp}_{lang}", "problems": problems}


def fixed_shot(browser, url) -> tuple[bytes, list[str]]:
    """One fresh run to the fixed instant: the check chip settled, the clock paused and set, the viewport screenshot of the scene."""
    problems: list[str] = []
    with open_plant(browser, url, PLANT_VIEWPORTS["1280"]) as (page, errors, _):
        wait_scene(page)
        page.wait_for_selector("[data-plant-hud=check] [data-check-state=identical]", timeout=60_000)
        pause(page)
        seek(page, FIXED_INSTANT_S)
        settle(page, 5)
        page.bring_to_front()
        page.evaluate("document.querySelector('.plant-wrap').scrollIntoView({block: 'start'})")
        png = page.screenshot()
        problems += [f"console: {e[:140]}" for e in errors]
    return png, problems


def check_plant_shots(browser, url, out: Path) -> Result:
    """Screenshots of three instants of the run (SHOT_INSTANTS: the morning rush, a second pass after a failed QC run, a dim night with the analyzers closed) in both languages at 1280 by 720 and at
    390 by 844: none blank, the three of one viewport and language all different; and one fixed instant that two fresh runs draw pixel for pixel."""
    (out / "motion").mkdir(parents=True, exist_ok=True)
    cells = [shots_of(browser, url, out, vp, lang) for vp in PLANT_VIEWPORTS for lang in LANGS]
    first, problems = fixed_shot(browser, url)
    second, more = fixed_shot(browser, url)
    problems += more
    (out / "motion" / "plant_fixed_1280x720.png").write_bytes(first)
    with blank_page(browser) as page:
        diff = pixel_diff(page, first, second)
    problems += repro_problems(diff["differing"], diff["total"]) if diff["differing"] >= 0 else [f"the two pictures differ in size: {diff['size']}"]
    bad = [c for c in cells if c["problems"]]
    problems += [f"{c['cell']}: {c['problems'][0]}" for c in bad]
    detail = f"{len(cells) - len(bad)}/{len(cells)} cells of three instants clean; fixed instant day {clock_reading(FIXED_INSTANT_S)[0]} {clock_reading(FIXED_INSTANT_S)[1]}: {diff['differing']} of {diff['total']} pixels differ between two runs"
    return Result("plant_shots", not problems, detail + (f" | {problems[0]}" if problems else ""), {"cells": cells, "problems": problems, "differing": diff["differing"]})
