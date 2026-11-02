"""The check `plant_sweep` of the headless QA of the plant (docs/design/plant_ui.md section 10, P6c): the plant opened under settings other than the default run's.

For each spec of tests/fixtures/plant/sweep/specs.json, in a fresh page opened through the spec's link: no console error; the objects the scene built and the objects list hold the counts the helper computes from the
spec's settings by hand rules; the truth hash and the digest of each hall on the host equal the entry of the spec in `plant_reference.json` (made in Node by the lab's own path); the panels of one reactor and one
analyzer open and close by the keyboard; one `add_feed` entered through the bar is accepted, its round trip is within the budget and the hashes on the host after it equal the Worker's own messages; on the specs
that say so, the frames as `plant_frames` measures them, in a page of their own. Every time is written with the conditions of the machine (qa_lab_conditions.py). The screenshots and the report go to a folder
of the output: `sweep/` for the full list, `sweep_gate/` for the part the regular run holds. A check takes a browser and the URL of the served build and returns a Result; it never exits or prints. Every
page it opens is closed. The pure helpers are in qa_plant_sweep_helpers.py (tests/test_qa_plant_sweep.py).
"""
from __future__ import annotations

import json
import time
from pathlib import Path

from qa_checks import Result, first_line
from qa_lab_conditions import load_average, of_page, problems as conditions_problems
from qa_plant_act import INIT, enter
from qa_plant_act_browser import act_state, list_items, ready_of, wait_epoch
from qa_plant_act_helpers import reference_problems
from qa_plant_browser import FRAMES_JS, LIST_JS, pause, pixel_stats, plant_messages, seek, settle, settle_camera, wait_scene
from qa_plant_drill import open_link
from qa_plant_helpers import FRAMES_MEASURED, PLANT_VIEWPORTS, ROUND_TRIP_MEASURED, counts_problems, motion_problems, not_blank
from qa_plant_motion import play_frames
from qa_plant_panels import close_by_keyboard, open_by_keyboard
from qa_plant_sweep_helpers import CHECKS, expected_objects, report_markdown, row_ok, spec_link, sweep_detail, table, time_findings, worker_hash_problems

# The plant at N = 100 takes the Worker some seconds, and its message is large: the waits are long, and the frames of a large scene take longer to draw.
SCENE_MS = 300_000
FRAMES_MS = 600_000
PANELS = [("reactor", "reactor:U01"), ("analyzer", "analyzer:AN-1")]


def stage(row: dict, check: str, step) -> None:
    """One step of a spec. The check passes when the step adds no problem; a step that crashes (a page that does not come up) is a problem."""
    before = len(row["problems"])
    try:
        step()
    except Exception as e:  # a page that crashed is a finding
        row["problems"].append(f"{check}: {first_line(e)}")
    row["checks"][check] = len(row["problems"]) == before


def look(page, spec: dict, path: Path, problems: list[str]) -> None:
    """The plant at the instant the spec is looked at, once the camera has stopped: a screenshot that is not blank."""
    pause(page)
    seek(page, spec["look_s"])
    settle(page)
    page.bring_to_front()
    page.evaluate("document.querySelector('.plant-wrap').scrollIntoView({block: 'start'})")
    png = settle_camera(page)
    path.write_bytes(png)
    shot = pixel_stats(page, png)
    if not not_blank(shot):
        problems.append(f"the screenshot {path.name} is blank: luminance spread {shot['std']:.1f}, {shot['colours']} colours")


def the_action(page, spec: dict, entry: dict, row: dict) -> None:
    """One add_feed through the bar at the instant of the spec: accepted (one action in the list, no refusal), the round trip timed from the click to the first frame of the new plan, and the hashes on the
    host afterwards equal to the Worker's own messages and not to the run before (the feed changed the run)."""
    problems = row["problems"]
    action = spec["action"]
    seek(page, action["at"])
    settle(page)
    enter(page, action, None)
    wait_epoch(page, 2, halls=len(spec["run"]["architectures"]))
    page.wait_for_function("() => window.__rt.length >= 1", timeout=30_000)
    row["round_trip_ms"] = page.evaluate("window.__rt")[0]
    after = act_state(page)
    if after["actions"] != "1" or [i["kind"] for i in list_items(page)] != ["add_feed"] or page.query_selector("[data-plant-refusal]") is not None:
        problems.append(f"the feed was not accepted: {after['actions']} actions in the spec, {len(list_items(page))} in the list")
    problems += worker_hash_problems(after["runHash"], after["cellsHash"], plant_messages(page), 2)
    ready = ready_of(page, 2)
    if ready is not None and ready["checks"]["prefix_equal"] is not True:
        problems.append(f"the answer's prefix_equal is {ready['checks']['prefix_equal']}, expected true for a plant action")
    if after["runHash"] == entry["truth"]:
        problems.append("the feed left the truth hash as it was, so it changed nothing")


def frames_of(browser, url: str, spec: dict, link: str, row: dict) -> None:
    """The frames of the spec, as `plant_frames` measures them, in a page of its own with only the frame instrument (the page the checks used holds an action and the Worker's recorder)."""
    load = load_average()
    with open_link(browser, url, link, PLANT_VIEWPORTS["1280"], FRAMES_JS) as (page, errors):
        wait_scene(page, timeout=SCENE_MS, halls=len(spec["run"]["architectures"]))
        start, end, stats, seen = play_frames(page, spec["look_s"], overlay_timeout=SCENE_MS, timeout=FRAMES_MS)
        row["conditions"]["frames"] = of_page(browser, page, load, PLANT_VIEWPORTS["1280"], FRAMES_MEASURED)
        row["problems"] += motion_problems(int(start["t"]), int(end["t"]), end["playing"], max(seen), end["speed"])
        row["problems"] += [f"frames page: console: {e[:140]}" for e in errors]
    row["frames"] = stats


def phone_shot(browser, url: str, spec: dict, link: str, path: Path, problems: list[str]) -> None:
    with open_link(browser, url, link, PLANT_VIEWPORTS["390"], FRAMES_JS) as (page, errors):
        wait_scene(page, timeout=SCENE_MS, halls=len(spec["run"]["architectures"]))
        look(page, spec, path, problems)
        problems += [f"phone: console: {e[:140]}" for e in errors]


def panels(page, problems: list[str]) -> None:
    """The panel of one reactor and of one analyzer, each opened by the keyboard from the objects list (the focus goes into it) and closed with Escape (the focus goes back)."""
    pause(page)
    for kind, key in PANELS:
        button = f"[data-object-key='{key}']"
        if open_by_keyboard(page, button, kind, key, problems, "en"):
            close_by_keyboard(page, button, key, problems, "en")


def new_row(spec: dict, problems: list[str] | None = None) -> dict:
    """The row of a spec before anything has run: no check has passed, no number is taken. `notes` are the times of a spec that is not judged, said against each limit."""
    return {"name": spec["name"], "title": spec["title"], "checks": dict.fromkeys(CHECKS, False), "round_trip_ms": None, "frames": None, "problems": problems or [], "conditions": {},
            "judged": spec["judged"], "notes": []}


def check_spec(browser, url: str, spec: dict, entry: dict, engine: str, shots: Path) -> dict:
    """All the checks of one spec. Returns its row: the checks, the numbers, the problems, the notes and the conditions of the times."""
    row = new_row(spec)
    problems = row["problems"]
    link = spec_link(spec, engine)
    load = load_average()
    halls = len(spec["run"]["architectures"])
    console: list[list[str]] = []

    def opened() -> None:
        with open_link(browser, url, link, PLANT_VIEWPORTS["1280"], INIT) as (page, found):
            console.append(found)
            s = wait_scene(page, timeout=SCENE_MS, halls=halls)
            stage(row, "counts", lambda: problems.extend(counts_problems(json.loads(s["objects"] or "{}"), page.evaluate(LIST_JS), expected_objects(spec))))
            stage(row, "hashes", lambda: problems.extend(reference_problems(entry, s["runHash"], s["cellsHash"])))
            stage(row, "panels", lambda: panels(page, problems))
            stage(row, "screenshot", lambda: look(page, spec, shots / f"{spec['name']}_1280x720_en.png", problems))
            stage(row, "action", lambda: the_action(page, spec, entry, row))
            row["conditions"]["round_trip"] = of_page(browser, page, load, PLANT_VIEWPORTS["1280"], ROUND_TRIP_MEASURED)

    try:
        opened()
    except Exception as e:  # the page did not come up
        problems.append(f"{spec['name']}: {first_line(e)}")
    errors = list(dict.fromkeys(e for found in console for e in found))
    row["checks"]["console"] = not errors
    problems += [f"console: {e[:140]}" for e in errors]

    def times() -> None:
        if spec["frames"]:
            frames_of(browser, url, spec, link, row)
        if spec["phone"]:
            phone_shot(browser, url, spec, link, shots / f"{spec['name']}_390x844_en.png", problems)
        found, row["notes"] = time_findings(spec["judged"], row["round_trip_ms"], row["frames"] if spec["frames"] else None)
        problems.extend(found)
        problems.extend(p for c in row["conditions"].values() for p in conditions_problems(c))

    stage(row, "times", times)
    return row


def check_plant_sweep(browser, url: str, out: Path, reference: Path, specs: list[dict], folder: str = "sweep") -> Result:
    """The sweep over `specs`, the report written to `out / folder`. A reference that could not be read fails the check."""
    if not reference.exists():
        return Result("plant_sweep", False, f"no {reference.name}: engine/tests/support/plant_reference_cli.ts did not write it", {"problems": ["no reference"]})
    began = time.monotonic()
    ref = json.loads(reference.read_text(encoding="utf-8"))
    entries = {e["name"]: e for e in ref["sweep"]}
    shots = out / folder
    shots.mkdir(parents=True, exist_ok=True)
    rows = []
    for spec in specs:
        if spec["name"] not in entries:
            rows.append(new_row(spec, ["the reference has no entry for this spec"]))
            continue
        rows.append(check_spec(browser, url, spec, entries[spec["name"]], ref["engine_version"], shots))
    (shots / "summary.md").write_text(report_markdown(f"Plant settings sweep ({len(rows)} specs)", rows), encoding="utf-8")
    (shots / "results.json").write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
    bad = [r for r in rows if not row_ok(r)]
    seconds = time.monotonic() - began
    detail = sweep_detail(rows) + f"; {seconds:.0f} s" + (f" | {bad[0]['name']}: {bad[0]['problems'][0] if bad[0]['problems'] else 'a check did not pass'}" if bad else "")
    return Result("plant_sweep", not bad, detail, {"rows": rows, "table": table(rows), "notes": [f"{r['name']}: {n}" for r in rows for n in r["notes"]], "seconds": round(seconds, 1), "problems": [f"{r['name']}: {p}" for r in rows for p in r["problems"]]})


def sweep_report(result: Result, folder: Path) -> str:
    """What `qa_plant.py --sweep` prints: the table of the specs, the summary line, where the report and the screenshots are, and the line `FAIL  qa_plant plant_sweep: ...` of a failed sweep."""
    lines = [result.data.get("table", ""), "", f"plant_sweep  {'PASS' if result.ok else 'FAIL'}  {result.detail}", f"report and screenshots: {folder}"]
    lines += [f"reported, not judged: {n}" for n in result.data.get("notes", [])]
    if not result.ok:
        lines.append(f"FAIL  qa_plant plant_sweep: {result.detail[:300]}")
    return "\n".join(lines)
