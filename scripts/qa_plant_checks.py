"""The checks of the plant page for scripts/qa_plant.py (docs/design/plant_ui.md section 10), the pure helpers they stand on, and the browser plumbing.

Checks of P3: `plant_load`, `plant_frames`, `size`, `matrix` and `plant_fallback` (the capability check: WebGL off, the text alternative, no request for the plant chunk). A check takes a browser (or
the Playwright handle, for the fallback) and the URL of the served build and returns a Result; it never exits or prints. The page ships no test global: the state is read from the attributes of the
plant host (`data-plant-*`, `data-run-hash`, `data-cells-hash`) and the only instrument is a requestAnimationFrame wrapper that this script injects into its own browser context.
The pure helpers (frame statistics, the budgets as verdicts, the classification of requests, the object counts, the blank-screenshot verdict) are unit-tested in tests/test_qa_plant.py.
"""
from __future__ import annotations

import json
import math
import re
from base64 import b64encode
from contextlib import contextmanager
from pathlib import Path

from qa_checks import Result, first_line
from qa_lab_browser import NUMBERS_JS, apply_state, open_lab, wait_final
from qa_lab_helpers import LAB_THEMES, LANGS, cross_origin, number_offenders, request_gzip_total, served_path

# Software WebGL (ANGLE over SwiftShader), the launch arguments of the spike of docs/design/plant_ui.md section 8.
SOFTWARE_GL = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
# The viewports of the plant: the one of the frame budget and the screenshots, and a phone.
PLANT_VIEWPORTS = {"1280": (1280, 720), "390": (390, 844)}

# Budgets (docs/design/plant_ui.md section 8 and section 12, item 3, set by the author): the first load of the lab, the loader chunk inside it, the plant chunk fetched on entering.
FIRST_LOAD_LIMIT = 300 * 1024
LOADER_LIMIT = 4 * 1024
PLANT_LIMIT = 200 * 1024
# Frame interval in software WebGL at 1280 by 720: median and 95th percentile, over at least 300 frames after the first five are dropped (section 8).
FRAMES = 300
FRAMES_DROPPED = 5
MEDIAN_LIMIT_MS = 50.0
P95_LIMIT_MS = 80.0
# What the default scenario's plant holds, typed from the scenario file: 24 reactors in two bays, two analyzers, and one hall for each of the three presets A, B and C.
DEFAULT_OBJECTS = {"reactor": 24, "analyzer": 2, "hall": 3}
# The plan opens on day 0, 08:00 (28800 s), when the first shift starts and the first reactor is inoculated.
DEFAULT_START_S = 28800
DEFAULT_HALLS = ["a_manual", "b_lims_lite", "c_context"]


# ---- pure helpers (unit-tested) ---------------------------------------------------------------------------------


def percentile(values, p: float) -> float:
    """The nearest-rank percentile: the smallest value that at least p percent of the values are not above."""
    ordered = sorted(values)
    if not ordered:
        raise ValueError("percentile of nothing")
    return ordered[max(0, math.ceil(p / 100 * len(ordered)) - 1)]


def frame_intervals(stamps, frames: int = FRAMES, dropped: int = FRAMES_DROPPED) -> list[float]:
    """The intervals between successive animation frames, the first `dropped` of them left out (the scene is still settling), the next `frames` kept. Fewer than `frames` is a short list. A time
    stamp that repeats is one frame: more than one callback can ask for the same frame (Playwright's own polling does)."""
    frames_at = list(dict.fromkeys(stamps))
    return [b - a for a, b in zip(frames_at, frames_at[1:])][dropped:dropped + frames]


def frame_stats(intervals) -> dict:
    return {"n": len(intervals), "median": percentile(intervals, 50), "p95": percentile(intervals, 95)} if intervals else {"n": 0, "median": None, "p95": None}


def frames_problems(stats, frames: int = FRAMES) -> list[str]:
    """The budget of section 8: at least `frames` frames, median at most 50 ms, 95th percentile at most 80 ms."""
    if stats["n"] < frames:
        return [f"only {stats['n']} frames measured, {frames} needed"]
    problems = []
    if stats["median"] > MEDIAN_LIMIT_MS:
        problems.append(f"median {stats['median']:.1f} ms is over {MEDIAN_LIMIT_MS:.0f} ms")
    if stats["p95"] > P95_LIMIT_MS:
        problems.append(f"95th percentile {stats['p95']:.1f} ms is over {P95_LIMIT_MS:.0f} ms")
    return problems


def is_plant_chunk(path: str) -> bool:
    """The chunk of the scene and three.js: the one dynamic import of the page (vite names it after its module, plant_scene)."""
    return re.match(r"^assets/plant_scene-[\w-]+\.js$", path) is not None


def is_loader_chunk(path: str) -> bool:
    return re.match(r"^assets/plant-loader-[\w-]+\.js$", path) is not None


def split_requests(paths) -> dict:
    """The files of a cold load by role: the plant chunk, the loader chunk, and everything else (the first load)."""
    unique = list(dict.fromkeys(p for p in paths if p))
    return {"plant": [p for p in unique if is_plant_chunk(p)], "loader": [p for p in unique if is_loader_chunk(p)], "first": [p for p in unique if not is_plant_chunk(p)]}


def holds_three(text: str) -> bool:
    """Whether a file holds three.js: every build of it carries the prefix of its own messages. The first load must hold none (the page imports `three` only under src/plant/gl/)."""
    return "THREE." in text


def three_in(paths, root: Path) -> list[str]:
    """The JavaScript files among `paths` (under `root`) that hold three.js."""
    return [p for p in paths if p.endswith(".js") and holds_three((Path(root) / p).read_text(encoding="utf-8", errors="replace"))]


def size_problems(first: int, loader: int | None, plant: int | None) -> list[str]:
    """The three budgets in bytes of gzip. `plant` is None when the plant chunk was not asked for (then it cannot be measured, and that is a problem of the check)."""
    problems = []
    if first > FIRST_LOAD_LIMIT:
        problems.append(f"first load {first / 1024:.1f} KB gzip is over {FIRST_LOAD_LIMIT // 1024} KB")
    if loader is None:
        problems.append("the loader chunk was not requested")
    elif loader > LOADER_LIMIT:
        problems.append(f"loader chunk {loader} B gzip is over {LOADER_LIMIT // 1024} KB")
    if plant is None:
        problems.append("entering the plant did not request the plant chunk")
    elif plant > PLANT_LIMIT:
        problems.append(f"plant chunk {plant / 1024:.1f} KB gzip is over {PLANT_LIMIT // 1024} KB")
    return problems


def counts_problems(built, listed, expected=DEFAULT_OBJECTS) -> list[str]:
    """The objects the scene built (`data-plant-objects`), the objects of the list (the DOM) and the objects the scenario has must all be the same count for each kind."""
    problems = []
    for kind, want in expected.items():
        if built.get(kind) != want:
            problems.append(f"the scene built {built.get(kind)} {kind} objects, the scenario has {want}")
        if listed.get(kind) != want:
            problems.append(f"the objects list holds {listed.get(kind)} {kind} entries, the scenario has {want}")
    problems += [f"the scene built {kind} objects, which the scenario does not have" for kind in built if kind not in expected]
    return problems


def hash_problems(run_hash, cells_hash, halls=DEFAULT_HALLS) -> list[str]:
    """The truth hash is a 64-digit hex string and there is one digest of the same shape for each hall (the page shows what the Worker proved; nothing is compared to a reference before P6)."""
    problems = []
    if not isinstance(run_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", run_hash):
        problems.append(f"data-run-hash is not a 64-digit hash: {str(run_hash)[:20]}")
    try:
        cells = json.loads(cells_hash)
    except (TypeError, ValueError):
        return problems + ["data-cells-hash is not JSON"]
    if sorted(cells) != sorted(halls):
        problems.append(f"data-cells-hash names {sorted(cells)}, the halls are {sorted(halls)}")
    problems += [f"digest of {h} is not a 64-digit hash" for h, v in cells.items() if not (isinstance(v, str) and re.fullmatch(r"[0-9a-f]{64}", v))]
    return problems


def not_blank(stats) -> bool:
    """A screenshot that is not blank has a spread of brightness (the standard deviation of the luminance, 0 to 255) and more than a handful of colours. No reference image to compare with: software rendering is
    deterministic on one build and not across builds (section 10)."""
    return stats["std"] >= 8 and stats["colours"] >= 12


# ---- browser plumbing -------------------------------------------------------------------------------------------

# Records the time of every animation frame (window.__plantFrames); wraps requestAnimationFrame before any page code runs. The page ships none of it.
FRAMES_JS = """(() => {
  window.__plantFrames = [];
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { window.__plantFrames.push(t); cb(t); });
})();"""

# The luminance spread and the number of distinct colours (of 4096) in a PNG, computed in the page so that no image library is needed.
PIXELS_JS = """async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bytes], {type: 'image/png'}));
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let n = 0, s = 0, s2 = 0; const seen = new Set();
  for (let i = 0; i < d.length; i += 16) {
    const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    n++; s += y; s2 += y * y; seen.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4));
  }
  const mean = s / n;
  return {width: c.width, height: c.height, mean, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)), colours: seen.size};
}"""

STATE_JS = """() => { const h = document.querySelector('#plant');
  return h ? {scene: h.dataset.plantScene, tier: h.dataset.plantTier, t: h.dataset.plantT, epoch: h.dataset.plantEpoch, calls: h.dataset.plantCalls, objects: h.dataset.plantObjects,
              runHash: h.dataset.runHash, cellsHash: h.dataset.cellsHash} : null; }"""
LIST_JS = """() => { const out = {}; for (const e of document.querySelectorAll('#plant-objects [data-object-kind]')) out[e.dataset.objectKind] = (out[e.dataset.objectKind] || 0) + 1; return out; }"""


@contextmanager
def open_plant(browser, url, size=PLANT_VIEWPORTS["1280"], scheme="light", theme="auto", lang="en", init_script=None):
    """A cold load of Home with the lab ready, the language and theme chosen, then the plant entered through its entry on Home, as a reader does. Yields (page, errors, requests)."""
    with open_lab(browser, url, size, scheme, init_script=init_script) as (page, errors, requests):
        page.wait_for_selector("#main[data-ready=true]", timeout=60_000)
        apply_state(page, theme, lang)
        page.click("#enter-plant")
        page.wait_for_selector("#main[data-screen=plant]", timeout=10_000)
        yield page, errors, requests


def wait_scene(page, timeout=90_000) -> dict:
    """Wait until the Worker has answered with the plan and the scene has drawn its first frames; return the attributes of the plant host."""
    page.wait_for_selector("#plant[data-plant-scene=ready]", timeout=timeout)
    page.wait_for_function("() => !!document.querySelector('#plant').dataset.plantCalls", timeout=timeout)
    return page.evaluate(STATE_JS)


def pixel_stats(page, png: bytes) -> dict:
    return page.evaluate(PIXELS_JS, b64encode(png).decode())


# ---- checks -----------------------------------------------------------------------------------------------------


def check_plant_load(browser, url, out: Path) -> Result:
    """Given the built lab, Home loads without the plant chunk; entering the plant requests it; no request to another origin; no console error; the status line names the renderer; the page state is
    in the attributes of the plant host."""
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
        if state["t"] != str(DEFAULT_START_S):
            problems.append(f"data-plant-t is {state['t']}, expected {DEFAULT_START_S}")
        problems += hash_problems(state["runHash"], state["cellsHash"])
        clock = page.inner_text("[data-plant-clock]")
        if "08:00" not in clock:
            problems.append(f"the HUD clock reads '{clock}', expected 08:00 of day 0")
        elsewhere = cross_origin(requests, url)
        problems += [f"request to another origin: {u}" for u in elsewhere]
        problems += [f"console: {e[:140]}" for e in errors]
    detail = (f"Home without the plant chunk, entering it requested {after['plant'][0] if after['plant'] else 'nothing'}; renderer '{(renderer.group(1) if renderer else '')[:60]}'; "
              f"epoch {state['epoch']}, t {state['t']}, {len(errors)} console errors")
    return Result("plant_load", not problems, detail + (f" | {problems[0]}" if problems else ""), {"problems": problems, "requests": sorted(set(after["plant"] + after["loader"]))})


def check_plant_frames(browser, url, out: Path) -> Result:
    """Given the static scene with the plan loaded, the frame interval over 300 frames at 1280 by 720 is within the budget; a screenshot is saved and is not blank; the objects built equal the
    objects of the scenario and of the list."""
    problems: list[str] = []
    with open_plant(browser, url, init_script=FRAMES_JS) as (page, errors, _):
        state = wait_scene(page)
        page.wait_for_timeout(1500)  # the scene settles: first frames, the fonts and the textures
        page.evaluate("window.__plantFrames.length = 0")
        # the polling is by time, not by frame: Playwright's default polling asks for animation frames itself, and its callbacks would be counted as frames of the scene
        page.wait_for_function(f"window.__plantFrames.length >= {FRAMES + FRAMES_DROPPED + 1}", polling=500, timeout=180_000)
        stats = frame_stats(frame_intervals(page.evaluate("window.__plantFrames")))
        problems += frames_problems(stats)
        built = json.loads(state["objects"] or "{}")
        problems += counts_problems(built, page.evaluate(LIST_JS))
        page.bring_to_front()
        png = page.locator("#plant").screenshot(path=str(out / "plant_frames_1280x720.png"))
        shot = pixel_stats(page, png)
        if not not_blank(shot):
            problems.append(f"the screenshot is blank: luminance spread {shot['std']:.1f}, {shot['colours']} colours")
        problems += [f"console: {e[:140]}" for e in errors]
    detail = (f"{stats['n']} frames, median {stats['median']:.1f} ms (limit {MEDIAN_LIMIT_MS:.0f}), 95th percentile {stats['p95']:.1f} ms (limit {P95_LIMIT_MS:.0f}); "
              f"{state['calls']} draw calls; objects {built}; screenshot spread {shot['std']:.0f}, {shot['colours']} colours") if stats["n"] else "no frames"
    return Result("plant_frames", not problems, detail + (f" | {problems[0]}" if problems else ""), {"stats": stats, "problems": problems, "objects": built})


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
            for selector in ("#plant", "[data-plant-hud=place]", "[data-plant-hud=check]", ".plant-hint", "[data-plant-bar=shell]", "#plant-objects", "#plant-text", "#plant-live"):
                if page.query_selector(selector) is None:
                    problems.append(f"missing {selector}")
            problems += counts_problems(json.loads(page.get_attribute("#plant", "data-plant-objects") or "{}"), page.evaluate(LIST_JS))
            bar = page.evaluate("[...document.querySelectorAll('[data-plant-bar=shell] button')].map(b => b.disabled)")
            if not bar or not all(bar):
                problems.append("the bottom bar is not a disabled shell")
            nodes = page.evaluate(NUMBERS_JS)
            problems += [f"a number outside a data-ref, data-result or data-label: '{o['text']}' in {o['where']}" for o in number_offenders(nodes)]
            page.bring_to_front()
            page.evaluate("document.querySelector('.plant-wrap').scrollIntoView({block: 'start'})")  # the scene fills the viewport, bottom bar and all
            page.screenshot(path=str(out / "shots" / f"{name}.png"))
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
            if page.query_selector("[data-plant-fallback]") is None:
                problems.append("the notice of the fallback is missing")
            if page.query_selector("#plant") is not None:
                problems.append("the plant host exists without WebGL")
            rows = page.evaluate("Object.fromEntries([...document.querySelectorAll('[data-plant-table]')].map(t => [t.dataset.plantTable, t.querySelectorAll('tbody tr').length]))")
            if rows != {"reactors": DEFAULT_OBJECTS["reactor"], "analyzers": DEFAULT_OBJECTS["analyzer"], "halls": DEFAULT_OBJECTS["hall"]}:
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
