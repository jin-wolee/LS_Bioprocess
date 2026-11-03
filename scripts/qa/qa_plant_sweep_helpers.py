"""The pure helpers of the settings sweep of the plant (docs/design/plant_ui.md section 10, "The sweep"): the list of specs, the link of a spec, the objects a spec must show (hand rules from its
settings, never read from the page), the hashes the page shows after an action against the Worker's own messages, the judgement of a spec's times and the report. No browser here, so pytest runs
them (tests/test_qa_plant_sweep.py); the flow that drives the page is in qa_plant_sweep.py.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import qa_lab_conditions
from qa_plant_act_helpers import ROUND_TRIP_MAX_MS, ROUND_TRIP_MEDIAN_MS
from qa_plant_helpers import FRAMES, MEDIAN_LIMIT_MS, P95_LIMIT_MS, frames_problems

REPO = Path(__file__).resolve().parents[2]
SWEEP_FILE = REPO / "tests" / "fixtures" / "plant" / "sweep" / "specs.json"

# The settings a spec may leave out take the scenario's own value, which is the same in the four scenarios of the lab (typed here from data/scenarios/*.json; a test keeps them equal), and the analyzer
# profile of the scenario is the all-in-one. The stages of an analyzer profile: one instrument for each stage of its route (the split pair is a cell counter and a metabolite analyzer).
DEFAULTS = {"reactor_count": 24, "bay_size": 12, "analyzer_count": 2, "operators_per_shift": 2}
SCENARIO_ANALYZER = "allinone_atline"
STAGES = {"allinone_atline": 1, "hplc": 1, "split_cellcounter_metabolite": 2}
SHIFTS = 2  # a weekday has two shifts of the operators of a shift (the roster; the weekend's operators are the first shift's)

CHECKS = ("console", "counts", "hashes", "panels", "action", "times")


def load_specs(path: Path = SWEEP_FILE, gate: bool = False, names: list[str] | None = None) -> list[dict]:
    """The specs of the list, in the order of the file: all of them, those the gate runs, or those named (an unknown name is an error)."""
    specs = json.loads(Path(path).read_text(encoding="utf-8"))["specs"]
    unknown = [n for n in names or [] if n not in {s["name"] for s in specs}]
    if unknown:
        raise ValueError(f"no spec named {', '.join(unknown)} in {Path(path).name}")
    return [s for s in specs if (not gate or s["gate"]) and (names is None or s["name"] in names)]


def spec_link(spec: dict, engine: str) -> str:
    """The plant link of a spec, in the order the page writes its keys (src/plant/link.ts, `plantQuery`): scenario, the settings by name, the profile lists, the capture path, the halls, the seed."""
    run = spec["run"]
    pairs = [("scenario", run["scenario"])] + [(f"set.{k}", run["settings"][k]) for k in sorted(run["settings"])]
    if run.get("bay_profiles"):
        pairs.append(("bays", ",".join(run["bay_profiles"])))
    if run.get("analyzer_profiles"):
        pairs.append(("analyzers", ",".join(run["analyzer_profiles"])))
    if run.get("capture_path"):
        pairs.append(("capture", run["capture_path"]))
    pairs += [("arch", ",".join(run["architectures"])), ("seed", spec["seed"]), ("schema", 1), ("engine", engine)]
    return "#/plant?" + "&".join(f"{k}={v}" for k, v in pairs)


def expected_objects(spec: dict) -> dict[str, int]:
    """The objects the plant of a spec must hold, by kind (`data-plant-objects`), from its settings by hand rules: a reactor for each of `reactor_count`; a board for each bay (the reactors over the bay
    size, rounded up); a hall for each architecture; the flags board; two shifts of `operators_per_shift` staff; an analyzer for each stage of the listed profiles, or `analyzer_count` times the stages
    of the scenario's profile with no list."""
    run = spec["run"]
    settings = {**DEFAULTS, **run["settings"]}
    listed = run.get("analyzer_profiles")
    analyzers = sum(STAGES[p] for p in listed) if listed else settings["analyzer_count"] * STAGES[SCENARIO_ANALYZER]
    return {
        "reactor": settings["reactor_count"], "analyzer": analyzers, "staff": SHIFTS * settings["operators_per_shift"], "hall": len(run["architectures"]),
        "board": math.ceil(settings["reactor_count"] / settings["bay_size"]), "flags": 1,
    }


def worker_hashes(messages, epoch: int) -> tuple[str | None, dict[str, str]]:
    """The hashes the Worker sent for an epoch: the truth hash of its `plant_ready` and the digests of the cells of the halls of that epoch (the ready message's, then each `plant_halls`)."""
    ready = next((m["data"] for m in messages if m["data"]["type"] == "plant_ready" and m["data"]["epoch"] == epoch), None)
    if ready is None:
        return None, {}
    cells = dict(ready["hashes"]["cells"])
    for m in messages:
        if m["data"]["type"] == "plant_halls" and m["data"]["epoch"] == epoch:
            cells.update(m["data"]["cells"])
    return ready["hashes"]["truth"], cells


def worker_hash_problems(host_truth: str | None, host_cells_json: str | None, messages, epoch: int) -> list[str]:
    """The hashes on the plant host after an action against the Worker's own messages of that epoch."""
    truth, cells = worker_hashes(messages, epoch)
    if truth is None:
        return [f"the Worker sent no plant_ready for the epoch {epoch}"]
    problems = [] if host_truth == truth else [f"the truth hash on the page is {host_truth}, the Worker sent {truth}"]
    try:
        shown = json.loads(host_cells_json or "{}")
    except ValueError:
        return problems + ["the cells digests on the host are not JSON"]
    if sorted(shown) != sorted(cells):
        return problems + [f"the page shows the halls {sorted(shown)}, the Worker sent {sorted(cells)}"]
    return problems + [f"the digest of {h} on the page is {shown[h]}, the Worker sent {d}" for h, d in sorted(cells.items()) if shown[h] != d]


def time_problems(round_trip_ms: float | None, frames: dict | None) -> list[str]:
    """The times of a spec against the budgets of docs/design/plant_ui.md section 8: the round trip of its one action and, where the spec measures them, the frames. One sample shows no median, so the round
    trip is judged by the limit of the slowest (1 s); the limit of the median (600 ms) is the check `plant_action`'s, over five accepted actions."""
    if round_trip_ms is None:
        problems = ["no round trip was measured"]
    elif round_trip_ms > ROUND_TRIP_MAX_MS:
        problems = [f"the round trip is {round_trip_ms:.0f} ms, over the {ROUND_TRIP_MAX_MS} ms limit of the slowest"]
    else:
        problems = []
    return problems + (frames_problems(frames) if frames is not None else [])


def _stands(value: float, limit: float) -> str:
    """How a time stands against a limit: over it, at it (within a twentieth of a millisecond: the frame intervals are steps of the 16.7 ms refresh) or within it."""
    return "at" if abs(value - limit) < 0.05 else ("over" if value > limit else "within")


def time_findings(judged: bool, round_trip_ms: float | None, frames: dict | None, report: bool = False) -> tuple[list[str], list[str]]:
    """(problems, notes) for the times of a spec. A judged spec has `time_problems` and no notes. A spec whose times are not judged (the large plant: the author's decision of 2026-11-02, plant_ui.md section
    12, item 18) has a problem only where a time was not measured, and a note for each time that says how it stands against each limit; the notes fail nothing. `report` (the timing mode of
    qa_timing.py, P9) treats every spec as one whose times are not judged."""
    if judged and not report:
        return time_problems(round_trip_ms, frames), []
    problems = ["no round trip was measured"] if round_trip_ms is None else []
    notes = []
    if round_trip_ms is not None:
        notes.append(f"the round trip is {round_trip_ms:.0f} ms: {_stands(round_trip_ms, ROUND_TRIP_MEDIAN_MS)} the limit of {ROUND_TRIP_MEDIAN_MS} ms (median) and "
                     f"{_stands(round_trip_ms, ROUND_TRIP_MAX_MS)} the limit of {ROUND_TRIP_MAX_MS} ms (slowest)")
    if frames is not None and frames["n"] < FRAMES:
        problems.append(f"only {frames['n']} frames measured, {FRAMES} needed")
    elif frames is not None:
        notes.append(f"the frame interval is median {frames['median']:.1f} ms, {_stands(frames['median'], MEDIAN_LIMIT_MS)} the limit of {MEDIAN_LIMIT_MS:g} ms, and "
                     f"95th percentile {frames['p95']:.1f} ms, {_stands(frames['p95'], P95_LIMIT_MS)} the limit of {P95_LIMIT_MS:g} ms")
    return problems, notes


def row_ok(row: dict) -> bool:
    return all(row["checks"].get(c) for c in CHECKS) and not row["problems"]


def _mark(ok: bool) -> str:
    return "pass" if ok else "FAIL"


def table(rows: list[dict]) -> str:
    """The summary table of a sweep, one line for each spec: the checks, the numbers, the result."""
    lines = ["| spec | " + " | ".join(CHECKS) + " | round trip | frames median / 95th | result |", "|---" * (len(CHECKS) + 4) + "|"]
    for r in rows:
        trip = "not measured" if r["round_trip_ms"] is None else f"{r['round_trip_ms']:.0f} ms"
        frames = "not measured" if r["frames"] is None else f"{r['frames']['median']:.1f} / {r['frames']['p95']:.1f} ms"
        marks = ["reported" if c == "times" and not r.get("judged", True) and r["checks"].get(c) else _mark(r["checks"].get(c, False)) for c in CHECKS]
        lines.append(f"| {r['name']} | " + " | ".join(marks) + f" | {trip} | {frames} | {'PASS' if row_ok(r) else 'FAIL'} |")
    return "\n".join(lines)


def sweep_detail(rows: list[dict]) -> str:
    """The summary line of a sweep: how many specs pass and, from the first record of conditions to the last, the load, the CPUs, Chromium and the renderers (qa_lab_conditions.summary)."""
    passed = sum(1 for r in rows if row_ok(r))
    reported = sum(1 for r in rows if r.get("notes"))
    head = f"{passed}/{len(rows)} specs pass" + (f"; times of {reported} spec{'s' if reported > 1 else ''} reported, not judged (the author's to decide)" if reported else "")
    records = [c for r in rows for c in r["conditions"].values()]
    if not records:
        return f"{head}; no conditions were recorded"
    renderers = " / ".join(dict.fromkeys(str(c.get("renderer", "missing")) for c in records))
    joined = {**records[0], "load_end": records[-1].get("load_end"), "renderer": renderers}
    return f"{head}; {qa_lab_conditions.summary(joined)}"


def report_markdown(title: str, rows: list[dict]) -> str:
    """The report of a sweep as Markdown: the table, the conditions of every measurement, what each kind of time measured from where to where (once), and every problem."""
    lines = [f"# {title}", "", table(rows), "", "## Conditions", ""]
    measured: dict[str, str] = {}
    for r in rows:
        for what, c in r["conditions"].items():
            lines.append(f"- {r['name']}, {what}: {qa_lab_conditions.summary(c)}")
            measured.setdefault(what, c.get("measured", "missing"))
    lines += ["", "## What was measured", ""] + [f"- {what}: {text}" for what, text in measured.items()]
    notes = [f"- {r['name']}: {n}" for r in rows for n in r.get("notes", [])]
    if notes:
        lines += ["", "## Reported against the budgets, not judged", "",
                  "The times of these specs are measured and printed with their conditions above; whether the budgets hold for them is the author's to decide (plant_ui.md section 8: the round trip limits are the default "
                  "scenario's; section 12, item 18).", ""] + notes
    lines += ["", "## Problems", ""]
    problems = [f"- {r['name']}: {p}" for r in rows for p in r["problems"]]
    return "\n".join(lines + (problems or ["no problems"])) + "\n"
