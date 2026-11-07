#!/usr/bin/env python3
"""Headless QA for the plant (`dist/lab`): the end-to-end checks of docs/design/plant_ui.md section 10, exit 1 if any fails.

    uv run python scripts/qa/qa_plant.py [--root dist/lab] [--out qa_out/plant] [--no-build] [--sweep] [--timing judge|report]

Runs `npm run build:lab` first unless --no-build, serves --root over http.server on a free localhost port, and drives headless Chromium through Python Playwright with software WebGL (ANGLE over
SwiftShader, the launch arguments of the spike); the check `plant_fallback` launches a second Chromium with 3D off. Every browser is closed. Writes results.json, summary.md and the screenshots
(plant_1280x720_en.png, plant_1280x720_ko.png, plant_390x844_en.png, plant_390x844_ko.png, and one for each cell of the matrix under shots/; the screenshots of the motion under motion/, those of the halls under halls/, of the truth overlay under truth/ and of the panels under panels/) to --out.
This file is the CLI, the build and the report; the checks are in qa_plant_checks.py (load, size, matrix, fallback) and qa_plant_motion.py (frames, clock, shots), the constants and the pure helpers in
qa_plant_helpers.py, the browser plumbing in qa_plant_browser.py, the checks of the record halls (halls, record, hall shots) in qa_plant_halls.py, and the checks of the truth overlay and of the panels in qa_plant_truth.py and qa_plant_panels.py (their pure helpers in qa_plant_truth_helpers.py). `bash scripts/check_all.sh --plant` appends this run; the Stop hook does not run it.

Checks: plant_load, plant_frames, plant_clock, plant_shots, plant_halls, plant_record, plant_hall_shots, plant_truth, drilldown (P5c, in qa_plant_drill.py), plant_panels, plant_action (P6a, in qa_plant_action.py with the
flows of qa_plant_act.py), plant_equal and plant_prefix (P6a, in qa_plant_equal.py), sc12 (P7c, in qa_plant_sc12.py: the five break-out cases, and the public build's refusal in qa_plant_sc12_public.py), size, matrix, plant_fallback, plant_a11y (P8a, in qa_plant_a11y.py: the keyboard, reduced motion, the
hum, the room the chrome leaves, the phone, contrast and WebGL off), plant_tour (P8b, in qa_plant_tour.py: the guided scene, from a fresh page). `plant_equal` compares the page with `plant_reference.json`, which this script makes first by running
engine/tests/support/plant_reference_cli.ts under the engine's Node flags into --out (the screenshots of the actions go to act/).

`--timing report` (P9, scripts/qa/qa_timing.py; the Pages workflow runs it so) prints the checks that measure time (`plant_frames`, the round trip of `plant_action`, the times of a spec of the sweep) with their conditions and does not
fail them on a limit: a CI runner is not the machine of the budgets. A time that was not measured, too few frames and every other check still fail.

`plant_sweep` (P6c, in qa_plant_sweep.py) opens the plant under settings other than the default run's, each spec of tests/fixtures/plant/sweep/specs.json in a page of its own. The regular run holds the two
specs marked `gate` (report in sweep_gate/); `--sweep` runs the whole list instead of the regular checks, by hand before a release and after a batch that changes the plan, the layout or the scene (report in
sweep/, the screenshots of each spec's plant beside it).
"""
from __future__ import annotations
from qa_report import report as write_report
from qa_build import build_local_lab

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright
from qa_checks import Result
from qa_infographic import guarded, serve
from qa_plant_a11y import check_plant_a11y
from qa_plant_action import check_plant_action
from qa_plant_checks import check_matrix, check_plant_fallback, check_plant_load, check_size
from qa_plant_drill import check_drilldown
from qa_plant_equal import check_plant_equal, check_plant_prefix
from qa_plant_halls import check_plant_hall_shots, check_plant_halls, check_plant_record
from qa_plant_helpers import SOFTWARE_GL
from qa_plant_sc12 import check_sc12
from qa_plant_sc12_public import public_problems
from qa_plant_motion import check_plant_clock, check_plant_frames, check_plant_shots
from qa_plant_panels import check_plant_panels
from qa_plant_sweep import check_plant_sweep, sweep_report
from qa_plant_sweep_helpers import load_specs
from qa_plant_tour import check_plant_tour
from qa_plant_truth import check_plant_truth
from qa_timing import set_mode

REPO = Path(__file__).resolve().parents[2]


def report(results: list[Result], out: Path) -> str:
    table = write_report(results, out, 'Plant QA')
    failures = "".join(f"\nFAIL  qa_plant {r.name}: {r.detail[:300]}" for r in results if not r.ok)
    return table + failures


def timed(name: str, fn) -> Result:
    """`guarded`, and one line on stderr as the check ends (its name, its verdict, its seconds), flushed: a CI log shows where the time goes even if the job is cut off before the report."""
    start = time.monotonic()
    result = guarded(name, fn)
    print(f"qa_plant: {name} {'PASS' if result.ok else 'FAIL'} in {time.monotonic() - start:.0f} s", file=sys.stderr, flush=True)
    return result


def run_checks(checks, retries: int = 0) -> list[Result]:
    """Run each (name, fn) of `checks` once, in order. With `retries` 1, each check that failed runs once more after all of them, and its second verdict is kept with the first failure written
    beside it. C3: on a shared CI runner a wait now and then runs out in a different check each time; a check that fails twice still fails, and the local gate keeps `retries` 0."""
    results = [timed(name, fn) for name, fn in checks]
    for i, (name, fn) in enumerate(checks):
        if results[i].ok or retries < 1:
            continue
        first = results[i]
        again = timed(name, fn)
        note = "passed on the second try" if again.ok else "failed twice"
        results[i] = Result(name, again.ok, f"{again.detail} [{note}; the first try: {first.detail[:400]}]", again.data)
    return results


def build() -> int:
    return build_local_lab()


def make_reference(out: Path) -> tuple[Path, str | None]:
    """The reference of the check `plant_equal`: the hand fixtures run in Node under the engine's flags (ADR-0016), written into --out. Returns its path and the reason it could not be made, if any."""
    path = out / "plant_reference.json"
    path.unlink(missing_ok=True)
    done = subprocess.run(["node", "--no-maglev-escape-analysis", "engine/tests/support/plant_reference_cli.ts", str(path)], cwd=REPO, capture_output=True, text=True)
    return path, None if done.returncode == 0 else (done.stderr.strip().splitlines() or ["the reference CLI failed"])[-1]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", type=Path, default=REPO / "dist" / "lab", help="directory served; the build output")
    ap.add_argument("--out", type=Path, default=REPO / "qa_out" / "plant")
    ap.add_argument("--no-build", action="store_true", help="serve --root as it is")
    ap.add_argument("--timing", choices=("judge", "report"), default="judge", help="report: a time over its limit is printed with its conditions and does not fail (the Pages workflow; scripts/qa/qa_timing.py)")
    ap.add_argument("--retry-failed", type=int, choices=(0, 1), default=0, help="1: run each failed check once more after the others; the Pages workflow only (C3)")
    ap.add_argument("--sweep", action="store_true", help="run the whole settings sweep (ten specs) instead of the regular checks; the report goes to <out>/sweep/")
    args = ap.parse_args(argv)
    set_mode(args.timing)
    if not args.no_build and build() != 0:
        print("npm run build:lab failed", file=sys.stderr)
        return 1
    if not (args.root / "index.html").exists():
        print(f"missing {args.root / 'index.html'} (run npm run build:lab)", file=sys.stderr)
        return 1
    (args.out / "shots").mkdir(parents=True, exist_ok=True)
    reference, why = make_reference(args.out)
    with serve(args.root) as url, sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=SOFTWARE_GL)
        try:
            if args.sweep:
                result = timed("plant_sweep", lambda: check_plant_sweep(browser, url, args.out, reference, load_specs()))
                print(sweep_report(result, args.out / "sweep"))
                return 0 if result.ok else 1
            checks = [("plant_load", lambda: check_plant_load(browser, url, args.out)),
                       ("plant_frames", lambda: check_plant_frames(browser, url, args.out)),
                       ("plant_clock", lambda: check_plant_clock(browser, url, args.out)),
                       ("plant_shots", lambda: check_plant_shots(browser, url, args.out)),
                       ("plant_halls", lambda: check_plant_halls(browser, url, args.out)),
                       ("plant_record", lambda: check_plant_record(browser, url, args.out)),
                       ("plant_hall_shots", lambda: check_plant_hall_shots(browser, url, args.out)),
                       ("plant_truth", lambda: check_plant_truth(browser, url, args.out)),
                       ("plant_panels", lambda: check_plant_panels(browser, url, args.out)),
                       ("drilldown", lambda: check_drilldown(browser, url, args.out)),
                       ("plant_action", lambda: check_plant_action(browser, url, args.out)),
                       ("plant_equal", lambda: check_plant_equal(browser, url, args.out, reference) if why is None else Result("plant_equal", False, f"the reference could not be made: {why}")),
                       ("plant_prefix", lambda: check_plant_prefix(browser, url, args.out)),
                       ("plant_sweep", lambda: check_plant_sweep(browser, url, args.out, reference, load_specs(gate=True), "sweep_gate")),
                       ("sc12", lambda: check_sc12(browser, url, args.out, reference, public_problems(browser))),
                       ("size", lambda: check_size(browser, url, args.root)),
                       ("matrix", lambda: check_matrix(browser, url, args.out)),
                       ("plant_fallback", lambda: check_plant_fallback(pw, url, args.out)),
                       ("plant_a11y", lambda: check_plant_a11y(pw, browser, url, args.out)),
                       ("plant_tour", lambda: check_plant_tour(pw, browser, url, args.out))]
            results = run_checks(checks, args.retry_failed)
        finally:
            browser.close()
    print(report(results, args.out))
    return 0 if all(r.ok for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
