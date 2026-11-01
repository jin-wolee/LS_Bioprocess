"""The constants and the pure helpers of the plant QA (docs/design/plant_ui.md section 10): the budgets, the frame statistics, the classification of requests, the object counts, the hashes, the
verdicts on screenshots and on a clock that moves. No browser here; tests/test_qa_plant.py tests every function with hand arithmetic. The checks are in qa_plant_checks.py (the load, the size,
the matrix, the fallback) and qa_plant_motion.py (the frames while the run plays, the controls of the clock, the screenshots of the motion); the browser plumbing is in qa_plant_browser.py.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from pathlib import Path

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
# The plan opens on day 0, 08:00 (28800 s), when the first shift starts and the first reactor is inoculated; the clock plays from there once the scene is drawn.
DEFAULT_START_S = 28800
DEFAULT_HALLS = ["a_manual", "b_lims_lite", "c_context"]
DAY_S = 86400

# The busy stretch of the default run (seed 1), read from its scene plan: from day 8 at 08:30 the morning's draws are on their way, with up to ten tubes on the floor at once (carriers on the
# aisles, tubes in the lane and in the analyzers). The frames are measured while the clock plays at the default speed from there.
BUSY_START_S = 8 * DAY_S + 8 * 3600 + 30 * 60
# The instants of the screenshots of the motion, chosen from the same plan, each with what it shows:
#   rush   day 8 at 08:40: the morning rush, ten tubes on the floor, the staff walking to the vessels, both analyzers running;
#   rerun  day 6 at 08:35: the second pass of a sample whose first run failed QC, its tube back in the lane with a ring, the QC lamp showing failed;
#   night  day 6 at 23:00: the floor dim and nobody on duty, the analyzers closed, two tubes waiting in front of them.
SHOT_INSTANTS = {"rush": 8 * DAY_S + 8 * 3600 + 40 * 60, "rerun": 6 * DAY_S + 8 * 3600 + 35 * 60, "night": 6 * DAY_S + 23 * 3600}
# The fixed instant of the reproducibility check: the rush, which two fresh runs must draw pixel for pixel.
FIXED_INSTANT_S = SHOT_INSTANTS["rush"]
SPEEDS = [30, 120, 600, 3600]
DEFAULT_SPEED = 120


# ---- frame statistics ---------------------------------------------------------------------------------------------


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


# ---- the files of a cold load -------------------------------------------------------------------------------------


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


# ---- what the page shows ------------------------------------------------------------------------------------------


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
    """A screenshot that is not blank has a spread of brightness (the standard deviation of the luminance, 0 to 255) and more than a handful of colours. No reference image to compare with: software
    rendering is deterministic on one build and not across builds (section 10)."""
    return stats["std"] >= 8 and stats["colours"] >= 12


# ---- the clock and the motion -------------------------------------------------------------------------------------


def clock_reading(t: int) -> tuple[int, str]:
    """The day of the run (day 0 is a Monday) and the time of day of an instant, as the HUD reads them."""
    day, rest = divmod(int(t), DAY_S)
    return day, f"{rest // 3600:02d}:{rest % 3600 // 60:02d}"


def motion_problems(start_t: int, end_t: int, playing: str | None, tubes_seen: int, speed: str | None = str(DEFAULT_SPEED)) -> list[str]:
    """What the frames of the budget must have shown: the clock played (its instant moved on), at the speed asked for, with samples on the floor while it did."""
    problems = []
    if playing != "true":
        problems.append(f"data-plant-playing is {playing}, the clock should be playing")
    if end_t <= start_t:
        problems.append(f"the clock did not advance: {start_t} s before, {end_t} s after")
    if speed != str(DEFAULT_SPEED):
        problems.append(f"data-plant-speed is {speed}, expected {DEFAULT_SPEED}")
    if tubes_seen < 1:
        problems.append("no tube was on the floor while the frames were measured, so no sample moved")
    return problems


def shot_digest(png: bytes) -> str:
    return hashlib.sha256(png).hexdigest()


def shots_problems(digests: dict[str, str]) -> list[str]:
    """The screenshots of different instants of one viewport and language must differ from each other: a scene that does not change with the clock shows the same picture each time."""
    names = sorted(digests)
    return [f"the pictures of {a} and {b} are identical: the scene did not change with the clock" for i, a in enumerate(names) for b in names[i + 1:] if digests[a] == digests[b]]


def repro_problems(differing_pixels: int, total: int) -> list[str]:
    """Two fresh runs at one fixed instant must give the same picture, pixel for pixel."""
    if differing_pixels == 0:
        return []
    return [f"two runs at the fixed instant differ in {differing_pixels} of {total} pixels"]


# ---- the record halls (P5a) ---------------------------------------------------------------------------------------

# The instants of the check `plant_halls`, in whole minutes of the run: day 0 at 12:00 (a few hours into the run, the first cards are on the shelves), day 10 at 12:00 (the middle of the 21 days), and
# the horizon (every card is on its shelf).
HALL_INSTANTS = {"early": 12 * 3600, "mid": 10 * DAY_S + 12 * 3600, "end": 21 * DAY_S}
# The mid-run instant of the screenshots of a hall close-up: day 10 at 12:00 (907200 s), 288 cards on the shelves of A, 291 of B and of C.
CLOSEUP_INSTANT_S = HALL_INSTANTS["mid"]
# The cards of each hall in the whole default run (seed 1), as the Worker's plan holds them: B and C a card for each of the 394 planned samples, A none for three of them (its record holds no row).
HALL_CARDS_END = {"a_manual": 391, "b_lims_lite": 394, "c_context": 394}


def plan_from_messages(messages, epoch: int):
    """The plan the page received for an epoch: the plan of `plant_ready` with the records of the `plant_halls` messages of that epoch added in the order they arrived. None without a plant_ready."""
    ready = next((m["data"] for m in messages if m["data"]["type"] == "plant_ready" and m["data"]["epoch"] == epoch), None)
    if ready is None:
        return None
    halls = [r for m in messages if m["data"]["type"] == "plant_halls" and m["data"]["epoch"] == epoch for r in m["data"]["records"]]
    return {**ready["plan"], "records": [*ready["plan"]["records"], *halls]}


def cards_expected(plan, t: int) -> dict:
    """For each hall of a plan, the cards on its shelves at the instant `t` (a card from its shown_s) and how many of them are knowable (an availability that is stored and not later than `t`)."""
    return {r["architecture"]: {"shown": sum(1 for c in r["cards"] if c["shown_s"] <= t),
                                "knowable": sum(1 for c in r["cards"] if c["shown_s"] <= t and c["available_s"] is not None and c["available_s"] <= t)} for r in plan["records"]}


def cards_problems(attr, expected) -> list[str]:
    """`data-plant-cards`, a map by architecture of the shown and knowable counts that the scene wrote from `hallsAt`, against the counts computed here from the plan the page received."""
    try:
        got = json.loads(attr)
    except (TypeError, ValueError):
        return [f"data-plant-cards is not JSON: {str(attr)[:40]}"]
    if got == expected:
        return []
    return [f"data-plant-cards says {got}, the plan the page received gives {expected}"]


def halls_arrival_problems(messages, architectures) -> list[str]:
    """The halls arrive progressively (section 5.5): `plant_ready` carries the hall of the first architecture only, then one `plant_halls` for each other architecture, in the order of the spec and later in
    time than the one before; the plan the page assembles holds every hall and the digests are those of the halls."""
    ready = next((m for m in messages if m["data"]["type"] == "plant_ready"), None)
    if ready is None:
        return ["no plant_ready arrived"]
    epoch = ready["data"]["epoch"]
    halls = [m for m in messages if m["data"]["type"] == "plant_halls" and m["data"]["epoch"] == epoch]
    problems = []
    if [r["architecture"] for r in ready["data"]["plan"]["records"]] != architectures[:1]:
        problems.append(f"plant_ready holds the halls {[r['architecture'] for r in ready['data']['plan']['records']]}, expected only {architectures[:1]}")
    if [r["architecture"] for m in halls for r in m["data"]["records"]] != architectures[1:]:
        problems.append(f"the plant_halls messages hold {[r['architecture'] for m in halls for r in m['data']['records']]}, expected {architectures[1:]} in the order of the spec")
    stamps = [ready["at"], *[m["at"] for m in halls]]
    if stamps != sorted(stamps) or len(set(stamps)) != len(stamps):
        problems.append(f"the messages did not arrive one after the other: {stamps}")
    digests = {**ready["data"]["hashes"]["cells"], **{k: v for m in halls for k, v in m["data"]["cells"].items()}}
    if sorted(digests) != sorted(architectures):
        problems.append(f"the digests are for {sorted(digests)}, expected {sorted(architectures)}")
    return problems
