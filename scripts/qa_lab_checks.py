"""The checks of the page as a whole for scripts/qa_lab.py: load, size, time, check and engines (docs/design/lab_ui.md sections 7 and 12).

A check takes a browser (or the Playwright handle, for `engines`) and the URL of the served build and returns a Result; it never exits or prints. The pure helpers are in qa_lab_helpers.py, the
browser plumbing in qa_lab_browser.py.
"""
from __future__ import annotations

import json
from pathlib import Path

from qa_checks import Result
from qa_lab_browser import open_lab, wait_final
from qa_lab_helpers import PASSED_ONLY_WORDS, SIZE_LIMIT, TIME_LIMIT_MS, alter_reference, cross_origin, found_words, request_gzip_total, served_path, size_verdict, time_verdict


def check_load(browser, url) -> Result:
    with open_lab(browser, url) as (page, errors, requests):
        final = wait_final(page)
        elsewhere = cross_origin(requests, url)
    problems = [f"console: {e[:140]}" for e in errors] + [f"request to another origin: {u}" for u in elsewhere]
    detail = f"Worker answered ready, check {final['state']}, {len(set(requests))} requests, {len(errors)} console errors, {len(elsewhere)} to another origin"
    return Result("load", not problems, detail + (f" | {problems[0]}" if problems else ""), {"requests": sorted(set(requests)), "problems": problems})


def check_size(browser, url, root: Path) -> Result:
    with open_lab(browser, url) as (page, _, requests):
        wait_final(page)
    paths = [p for p in dict.fromkeys(served_path(u, url) for u in requests) if p]
    total = request_gzip_total(paths, root)
    return Result("size", size_verdict(total), f"{total / 1024:.1f} KB gzip over {len(paths)} files of a cold load (limit {SIZE_LIMIT // 1024} KB)", {"gzip_bytes": total, "files": paths})


def check_time(browser, url) -> Result:
    with open_lab(browser, url) as (page, _, _):
        runs = wait_final(page)["detail"]["runs_ms"]
    m, ok = time_verdict(runs)
    shown = "no runs" if m is None else f"median {m:.0f} ms of {len(runs)} runs ({', '.join(f'{r:.0f}' for r in runs)})"
    return Result("time", ok, f"{shown}, limit {TIME_LIMIT_MS} ms", {"runs_ms": runs})


def check_check(browser, url, root: Path) -> Result:
    problems: list[str] = []
    with open_lab(browser, url) as (page, _, _):
        real = wait_final(page)
    if real["state"] != "identical":
        problems.append(f"real reference: state {real['state']} (expected identical)")
    if "byte for byte" not in real["banner"]:
        problems.append(f"real reference: banner lacks 'byte for byte': {real['banner'][:80]}")
    altered = alter_reference((root / "reference.json").read_text(encoding="utf-8"))
    with open_lab(browser, url, reference=altered) as (page, _, _):
        bad = wait_final(page)
    if bad["state"] != "failed":
        problems.append(f"altered reference: state {bad['state']} (expected failed)")
    if "FAILED" not in bad["banner"]:
        problems.append(f"altered reference: banner does not say FAILED: {bad['banner'][:80]}")
    if bad["detail"]["truth"] and bad["detail"]["truth"][0]["equal"]:
        problems.append("altered reference: the detail does not name seed 1 as differing")
    leaked = found_words(bad["body"], PASSED_ONLY_WORDS)
    if leaked:
        problems.append(f"altered reference: the page contains {leaked}")
    with open_lab(browser, url, reference=404) as (page, _, _):
        gone = wait_final(page)
    if gone["state"] != "error":
        problems.append(f"missing reference: state {gone['state']} (expected error)")
    if found_words(gone["body"], PASSED_ONLY_WORDS):
        problems.append("missing reference: the page contains words of the passed state")
    detail = f"real: {real['state']} ('{real['banner'][:60]}'); altered: {bad['state']} ('{bad['banner'][:40]}...'); missing: {gone['state']}"
    return Result("check", not problems, detail + (f" | {problems[0]}" if problems else ""), {"problems": problems})


def check_engines(pw, url) -> Result:
    """Firefox and WebKit, headless: the check reads `identical` (ADR-0019's claim, standing). A `failed` is a finding about the engine, never tolerated."""
    seen: dict[str, str] = {}
    problems: list[str] = []
    for name in ("firefox", "webkit"):
        browser = getattr(pw, name).launch(headless=True)
        try:
            with open_lab(browser, url) as (page, errors, _):
                final = wait_final(page)
            seen[name] = final["state"]
            if final["state"] != "identical":
                problems.append(f"{name}: {final['state']} {json.dumps(final['detail'])[:160]}")
            problems += [f"{name} console: {e[:100]}" for e in errors]
        finally:
            browser.close()
    return Result("engines", not problems, ", ".join(f"{k} {v}" for k, v in seen.items()) + (f" | {problems[0]}" if problems else ""), {"states": seen, "problems": problems})
