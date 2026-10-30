#!/usr/bin/env python3
"""Headless QA for the lab page (`dist/lab`): the end-to-end checks of docs/design/lab_ui.md section 12, exit 1 if any fails.

    uv run python scripts/qa_lab.py [--root dist/lab] [--out qa_out/lab] [--no-build]

Runs `npm run build:lab` first unless --no-build, serves --root over http.server on a free localhost port, drives headless Chromium (Playwright sync API) for every check and, for
`engines`, headless Firefox and WebKit as well (the standing test of ADR-0019's claim: the check reads `identical` in each). Every browser is closed. Writes results.json,
summary.md and shots/*.png to --out. This file is the CLI, the build and the report; the checks and the unit-tested helpers live in qa_lab_checks.py.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright
from qa_checks import Result
from qa_infographic import guarded, serve
from qa_lab_checks import check_check, check_contrast, check_engines, check_flags, check_ko, check_load, check_matrix, check_numbers, check_results, check_size, check_time

REPO = Path(__file__).resolve().parents[1]


def report(results: list[Result], out: Path) -> str:
    rows = [(f"{i} {r.name}", "PASS" if r.ok else "FAIL", r.detail) for i, r in enumerate(results, 1)]
    width = max(len(r[0]) for r in rows)
    table = "\n".join(f"{n:<{width}}  {s}  {d}" for n, s, d in rows)
    (out / "results.json").write_text(json.dumps([r.__dict__ for r in results], indent=2, ensure_ascii=False), encoding="utf-8")
    md = "| check | result | detail |\n|---|---|---|\n" + "\n".join(f"| {n} | {s} | {d.replace('|', '/')} |" for n, s, d in rows)
    (out / "summary.md").write_text(f"# Lab QA\n\n{md}\n", encoding="utf-8")
    # one line per failed check that check_all.sh can show (its summary keeps the lines that start with FAIL)
    failures = "".join(f"\nFAIL  qa_lab {r.name}: {r.detail[:300]}" for r in results if not r.ok)
    return table + failures


def build() -> int:
    return subprocess.run(["npm", "run", "build:lab"], cwd=REPO).returncode


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", type=Path, default=REPO / "dist" / "lab", help="directory served; the build output")
    ap.add_argument("--out", type=Path, default=REPO / "qa_out" / "lab")
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
        browser = pw.chromium.launch(headless=True)
        try:
            results = [guarded("load", lambda: check_load(browser, url)),
                       guarded("size", lambda: check_size(browser, url, args.root)),
                       guarded("time", lambda: check_time(browser, url)),
                       guarded("check", lambda: check_check(browser, url, args.root)),
                       guarded("engines", lambda: check_engines(pw, url)),
                       guarded("results", lambda: check_results(browser, url)),
                       guarded("numbers", lambda: check_numbers(browser, url)),
                       guarded("flags", lambda: check_flags(browser, url)),
                       guarded("ko", lambda: check_ko(browser, url)),
                       guarded("matrix", lambda: check_matrix(browser, url, args.out)),
                       guarded("contrast", lambda: check_contrast(browser, url, args.root))]
        finally:
            browser.close()
    print(report(results, args.out))
    return 0 if all(r.ok for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
