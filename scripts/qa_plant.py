#!/usr/bin/env python3
"""Headless QA for the plant (`dist/lab`): the end-to-end checks of docs/design/plant_ui.md section 10, exit 1 if any fails.

    uv run python scripts/qa_plant.py [--root dist/lab] [--out qa_out/plant] [--no-build]

Runs `npm run build:lab` first unless --no-build, serves --root over http.server on a free localhost port, and drives headless Chromium through Python Playwright with software WebGL (ANGLE over
SwiftShader, the launch arguments of the spike); the check `plant_fallback` launches a second Chromium with 3D off. Every browser is closed. Writes results.json, summary.md and the screenshots
(plant_1280x720_en.png, plant_1280x720_ko.png, plant_390x844_en.png, plant_390x844_ko.png, and one for each cell of the matrix under shots/; the screenshots of the motion under motion/) to --out.
This file is the CLI, the build and the report; the checks are in qa_plant_checks.py (load, size, matrix, fallback) and qa_plant_motion.py (frames, clock, shots), the constants and the pure helpers in
qa_plant_helpers.py, the browser plumbing in qa_plant_browser.py. `bash scripts/check_all.sh --plant` appends this run; the Stop hook does not run it.

Checks: plant_load, plant_frames, plant_clock, plant_shots, size, matrix, plant_fallback. The later batches add plant_action, plant_equal, plant_prefix, plant_truth, plant_a11y and drilldown (plant_ui.md section 10).
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
from qa_plant_checks import check_matrix, check_plant_fallback, check_plant_load, check_size
from qa_plant_helpers import SOFTWARE_GL
from qa_plant_motion import check_plant_clock, check_plant_frames, check_plant_shots

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


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", type=Path, default=REPO / "dist" / "lab", help="directory served; the build output")
    ap.add_argument("--out", type=Path, default=REPO / "qa_out" / "plant")
    ap.add_argument("--no-build", action="store_true", help="serve --root as it is")
    args = ap.parse_args(argv)
    if not args.no_build and build() != 0:
        print("npm run build:lab failed", file=sys.stderr)
        return 1
    if not (args.root / "index.html").exists():
        print(f"missing {args.root / 'index.html'} (run npm run build:lab)", file=sys.stderr)
        return 1
    (args.out / "shots").mkdir(parents=True, exist_ok=True)
    with serve(args.root) as url, sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=SOFTWARE_GL)
        try:
            results = [guarded("plant_load", lambda: check_plant_load(browser, url, args.out)),
                       guarded("plant_frames", lambda: check_plant_frames(browser, url, args.out)),
                       guarded("plant_clock", lambda: check_plant_clock(browser, url, args.out)),
                       guarded("plant_shots", lambda: check_plant_shots(browser, url, args.out)),
                       guarded("size", lambda: check_size(browser, url, args.root)),
                       guarded("matrix", lambda: check_matrix(browser, url, args.out)),
                       guarded("plant_fallback", lambda: check_plant_fallback(pw, url, args.out))]
        finally:
            browser.close()
    print(report(results, args.out))
    return 0 if all(r.ok for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
