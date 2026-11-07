#!/usr/bin/env python3
"""Headless QA for the lab page (`dist/lab`): the end-to-end checks of docs/design/lab_ui.md section 12, exit 1 if any fails.

    uv run python scripts/qa/qa_lab.py [--root dist/lab] [--out qa_out/lab] [--no-build] [--timing judge|report] [--no-engines]

Runs `npm run build:lab` first unless --no-build, serves --root over http.server on a free localhost port, drives headless Chromium (Playwright sync API) for every check and, for
`engines`, headless Firefox and WebKit as well (the standing test of ADR-0019's claim: the check reads `identical` in each). Every browser is closed. Writes results.json,
summary.md and shots/*.png to --out. This file is the CLI, the build and the report; the checks live in qa_lab_checks.py (page as a whole), qa_lab_sweeps.py (screens by language and theme), qa_lab_flags.py, qa_lab_results.py, qa_lab_oneflag.py (the card of the one-flag experiment on Home: one_flag), qa_lab_one_seed.py (lineage and challenge) and qa_lab_breakout.py (Break-out: sc12 and breakout_public),
the browser plumbing in qa_lab_browser.py and the unit-tested helpers in qa_lab_helpers.py.

The Pages workflow (P9; docs/design/lab_ui.md section 13) runs `--timing report --no-engines`: the engine run of `time` is printed with its conditions and not failed on (scripts/qa/qa_timing.py), and Firefox and WebKit are not
run because only Chromium is installed there.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright
from qa_build import build_local_lab
from qa_checks import Result
from qa_infographic import guarded, serve
from qa_lab_breakout import check_breakout_public, check_sc12
from qa_lab_checks import check_check, check_engines, check_load, check_size, check_time
from qa_lab_flags import check_flags
from qa_lab_one_seed import check_challenge, check_lineage_sc3
from qa_lab_oneflag import check_one_flag
from qa_lab_results import check_results
from qa_lab_robust import check_robust
from qa_lab_sweeps import check_contrast, check_ko, check_matrix, check_numbers
from qa_report import report as write_report, verdict
from qa_timing import set_mode

REPO = Path(__file__).resolve().parents[2]


def report(results: list[Result], out: Path) -> str:
    table = write_report(results, out, "Lab QA")
    statuses = [verdict(r) for r in results]
    totals = ", ".join(f"{status} {statuses.count(status)}" for status in ("PASS", "SKIP", "FLAKY", "FAIL"))
    # one line per failed check that check_all.sh can show (its summary keeps the lines that start with FAIL)
    failures = "".join(f"\nFAIL  qa_lab {r.name}: {r.detail[:300]}" for r in results if not r.ok)
    return f"{table}\nqa_lab totals: {totals}" + failures


def build() -> int:
    # The QA serves a local build (VITE_LAB_LOCAL=1): it must show the Break-out screen, which the public build refuses while a source of it is below main-reread (lab_ui.md section 20).
    # The check `breakout_public` builds the public build itself.
    return build_local_lab()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", type=Path, default=REPO / "dist" / "lab", help="directory served; the build output")
    ap.add_argument("--out", type=Path, default=REPO / "qa_out" / "lab")
    ap.add_argument("--no-build", action="store_true", help="serve --root as it is")
    ap.add_argument("--timing", choices=("judge", "report"), default="judge", help="report: a time over its limit is printed with its conditions and does not fail (the Pages workflow; scripts/qa/qa_timing.py)")
    ap.add_argument("--no-engines", action="store_true", help="do not run the check `engines` (Firefox and WebKit): the Pages workflow installs Chromium only")
    args = ap.parse_args(argv)
    set_mode(args.timing)
    if not args.no_build and build() != 0:
        print("npm run build:lab failed", file=sys.stderr)
        return 1
    if not (args.root / "index.html").exists():
        print(f"missing {args.root / 'index.html'} (run npm run build:lab)", file=sys.stderr)
        return 1
    (args.out / "shots").mkdir(parents=True, exist_ok=True)
    with serve(args.root) as url, sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        try:
            results = [guarded("load", lambda: check_load(browser, url)),
                       guarded("size", lambda: check_size(browser, url, args.root)),
                       guarded("time", lambda: check_time(browser, url)),
                       guarded("check", lambda: check_check(browser, url, args.root)),
                       guarded("engines", lambda: Result("engines", True, "not run (--no-engines): only Chromium is installed", {"skipped": True}) if args.no_engines else check_engines(pw, url)),
                       guarded("results", lambda: check_results(browser, url)),
                       guarded("one_flag", lambda: check_one_flag(browser, url)),
                       guarded("lineage_sc3", lambda: check_lineage_sc3(browser, url)),
                       guarded("challenge", lambda: check_challenge(browser, url)),
                       guarded("sc12", lambda: check_sc12(browser, url)),
                       guarded("breakout_public", lambda: check_breakout_public(browser)),
                       guarded("numbers", lambda: check_numbers(browser, url)),
                       guarded("flags", lambda: check_flags(browser, url)),
                       guarded("ko", lambda: check_ko(browser, url)),
                       guarded("matrix", lambda: check_matrix(browser, url, args.out)),
                       guarded("contrast", lambda: check_contrast(browser, url, args.root)),
                       guarded("robust", lambda: check_robust(browser, url))]
        finally:
            browser.close()
    print(report(results, args.out))
    return 0 if all(r.ok for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
