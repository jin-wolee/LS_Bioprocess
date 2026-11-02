#!/usr/bin/env python3
"""Headless QA for the plant (`dist/lab`): the end-to-end checks of docs/design/plant_ui.md section 10, exit 1 if any fails.

    uv run python scripts/qa_plant.py [--root dist/lab] [--out qa_out/plant] [--no-build] [--sweep]

Runs `npm run build:lab` first unless --no-build, serves --root over http.server on a free localhost port, and drives headless Chromium through Python Playwright with software WebGL (ANGLE over
SwiftShader, the launch arguments of the spike); the check `plant_fallback` launches a second Chromium with 3D off. Every browser is closed. Writes results.json, summary.md and the screenshots
(plant_1280x720_en.png, plant_1280x720_ko.png, plant_390x844_en.png, plant_390x844_ko.png, and one for each cell of the matrix under shots/; the screenshots of the motion under motion/, those of the halls under halls/, of the truth overlay under truth/ and of the panels under panels/) to --out.
This file is the CLI, the build and the report; the checks are in qa_plant_checks.py (load, size, matrix, fallback) and qa_plant_motion.py (frames, clock, shots), the constants and the pure helpers in
qa_plant_helpers.py, the browser plumbing in qa_plant_browser.py, the checks of the record halls (halls, record, hall shots) in qa_plant_halls.py, and the checks of the truth overlay and of the panels in qa_plant_truth.py and qa_plant_panels.py (their pure helpers in qa_plant_truth_helpers.py). `bash scripts/check_all.sh --plant` appends this run; the Stop hook does not run it.

Checks: plant_load, plant_frames, plant_clock, plant_shots, plant_halls, plant_record, plant_hall_shots, plant_truth, drilldown (P5c, in qa_plant_drill.py), plant_panels, plant_action (P6a, in qa_plant_action.py with the
flows of qa_plant_act.py), plant_equal and plant_prefix (P6a, in qa_plant_equal.py), size, matrix, plant_fallback. `plant_equal` compares the page with `plant_reference.json`, which this script makes first by running
engine/tests/support/plant_reference_cli.ts under the engine's Node flags into --out (the screenshots of the actions go to act/). The later batches add plant_a11y (plant_ui.md section 10).

`plant_sweep` (P6c, in qa_plant_sweep.py) opens the plant under settings other than the default run's, each spec of tests/fixtures/plant/sweep/specs.json in a page of its own. The regular run holds the two
specs marked `gate` (report in sweep_gate/); `--sweep` runs the whole list instead of the regular checks, by hand before a release and after a batch that changes the plan, the layout or the scene (report in
sweep/, the screenshots of each spec's plant beside it).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright
from qa_checks import Result
from qa_infographic import guarded, serve
from qa_plant_action import check_plant_action
from qa_plant_checks import check_matrix, check_plant_fallback, check_plant_load, check_size
from qa_plant_drill import check_drilldown
from qa_plant_equal import check_plant_equal, check_plant_prefix
from qa_plant_halls import check_plant_hall_shots, check_plant_halls, check_plant_record
from qa_plant_helpers import SOFTWARE_GL
from qa_plant_motion import check_plant_clock, check_plant_frames, check_plant_shots
from qa_plant_panels import check_plant_panels
from qa_plant_sweep import check_plant_sweep, sweep_report
from qa_plant_sweep_helpers import load_specs
from qa_plant_truth import check_plant_truth

REPO = Path(__file__).resolve().parents[1]


def report(results: list[Result], out: Path) -> str:
    rows = [(f"{i} {r.name}", "PASS" if r.ok else "FAIL", r.detail) for i, r in enumerate(results, 1)]
    width = max(len(r[0]) for r in rows)
    table = "\n".join(f"{n:<{width}}  {s}  {d}" for n, s, d in rows)
    (out / "results.json").write_text(json.dumps([r.__dict__ for r in results], indent=2, ensure_ascii=False), encoding="utf-8")
    md = "| check | result | detail |\n|---|---|---|\n" + "\n".join(f"| {n} | {s} | {d.replace('|', '/')} |" for n, s, d in rows)
    (out / "summary.md").write_text(f"# Plant QA\n\n{md}\n", encoding="utf-8")
    # one line per failed check that check_all.sh can show (its summary keeps the lines that start with FAIL)
    failures = "".join(f"\nFAIL  qa_plant {r.name}: {r.detail[:300]}" for r in results if not r.ok)
    return table + failures


def build() -> int:
    # the same local build as the lab's QA (VITE_LAB_LOCAL=1): the plant is in both the local and the public build, and the lab's QA serves the same directory
    return subprocess.run(["npm", "run", "build:lab"], cwd=REPO, env={**os.environ, "VITE_LAB_LOCAL": "1"}).returncode


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
    ap.add_argument("--sweep", action="store_true", help="run the whole settings sweep (ten specs) instead of the regular checks; the report goes to <out>/sweep/")
    args = ap.parse_args(argv)
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
                result = guarded("plant_sweep", lambda: check_plant_sweep(browser, url, args.out, reference, load_specs()))
                print(sweep_report(result, args.out / "sweep"))
                return 0 if result.ok else 1
            results = [guarded("plant_load", lambda: check_plant_load(browser, url, args.out)),
                       guarded("plant_frames", lambda: check_plant_frames(browser, url, args.out)),
                       guarded("plant_clock", lambda: check_plant_clock(browser, url, args.out)),
                       guarded("plant_shots", lambda: check_plant_shots(browser, url, args.out)),
                       guarded("plant_halls", lambda: check_plant_halls(browser, url, args.out)),
                       guarded("plant_record", lambda: check_plant_record(browser, url, args.out)),
                       guarded("plant_hall_shots", lambda: check_plant_hall_shots(browser, url, args.out)),
                       guarded("plant_truth", lambda: check_plant_truth(browser, url, args.out)),
                       guarded("plant_panels", lambda: check_plant_panels(browser, url, args.out)),
                       guarded("drilldown", lambda: check_drilldown(browser, url, args.out)),
                       guarded("plant_action", lambda: check_plant_action(browser, url, args.out)),
                       guarded("plant_equal", lambda: check_plant_equal(browser, url, args.out, reference) if why is None else Result("plant_equal", False, f"the reference could not be made: {why}")),
                       guarded("plant_prefix", lambda: check_plant_prefix(browser, url, args.out)),
                       guarded("plant_sweep", lambda: check_plant_sweep(browser, url, args.out, reference, load_specs(gate=True), "sweep_gate")),
                       guarded("size", lambda: check_size(browser, url, args.root)),
                       guarded("matrix", lambda: check_matrix(browser, url, args.out)),
                       guarded("plant_fallback", lambda: check_plant_fallback(pw, url, args.out))]
        finally:
            browser.close()
    print(report(results, args.out))
    return 0 if all(r.ok for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
