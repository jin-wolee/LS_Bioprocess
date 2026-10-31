#!/usr/bin/env python3
"""Headless QA for the assembled site folder (`dist/site`, written by scripts/assemble_site.py): six checks, exit 1 if any fails.

    uv run python scripts/qa_site.py [--root dist/site] [--out qa_out/site]

Copies --root under /sample-lineage-lab/ in a scratch folder and serves that over http.server: a project site on GitHub Pages lives under /<repository>/, and a root-absolute address would pass
at the root of a server and fail there. Drives headless Chromium (Playwright sync API), closes it, and writes results.json and summary.md to --out.

  folder         the files of the folder: the page, the lab, an empty .nojekyll, and nothing of site/infographic/ besides index.html
  links          the infographic opens, its link opens the lab, the browser check of the lab reads `identical`, the lab's link opens the infographic again; both link texts in English and Korean;
                 no request of the lab leaves the path of the site or the origin
  infographic_size, lab_size, lab_time    the budgets of docs/design/lab_ui.md section 12 over the assembled pages (the lab's are the checks of qa_lab.py, served from here)
  lab_public     the lab of the folder is the public build: the Break-out screen is refused while a source of it is below main-reread (the check `breakout_public` of qa_lab.py, on this folder)
"""
from __future__ import annotations

import argparse
import dataclasses
import json
import shutil
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright
from qa_checks import Result
from qa_checks import check_size as check_page_size
from qa_infographic import guarded, serve
from qa_lab_browser import open_lab, wait_final
from qa_lab_breakout import public_build_result
from qa_lab_checks import check_size as check_lab_size
from qa_lab_checks import check_time
from qa_lab_helpers import cross_origin

REPO = Path(__file__).resolve().parents[1]
SUBPATH = "sample-lineage-lab"
REQUIRED = (".nojekyll", "index.html", "lab/index.html", "lab/reference.json")
TOP = {".nojekyll", "index.html", "lab"}  # what the folder may hold at its top: the page, the lab and the marker file
LAB_TEXTS = {"en": "Open the lab", "ko": "랩 열기"}  # the link of the infographic (site/infographic/src)
BACK_TEXTS = {"en": "Explainer page", "ko": "해설 페이지"}  # the link of the lab (src/i18n)


# ---- pure helpers (tests/test_qa_site.py) -------------------------------------------------------------


def folder_problems(files: list[str], nojekyll_bytes: int) -> list[str]:
    """What is wrong with the list of files of the folder (paths relative to it)."""
    problems = [f"missing {name}" for name in REQUIRED if name not in files]
    problems += [f"{name}: not part of the site (only index.html, lab/ and .nojekyll belong at the top)" for name in files if name.split("/")[0] not in TOP]
    if ".nojekyll" in files and nojekyll_bytes != 0:
        problems.append(f".nojekyll holds {nojekyll_bytes} bytes (it must be empty)")
    return problems


def outside_base(urls: list[str], base: str) -> list[str]:
    """Requests to the origin of `base` that are not under its path: an address that only works at the root of a server."""
    b = urlsplit(base)
    return [u for u in urls if not u.startswith(("data:", "blob:")) and (urlsplit(u).scheme, urlsplit(u).netloc) == (b.scheme, b.netloc) and not u.startswith(base)]


# ---- checks -------------------------------------------------------------------------------------------


def check_folder(root: Path) -> Result:
    files = sorted(p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file())
    nojekyll = root / ".nojekyll"
    problems = folder_problems(files, nojekyll.stat().st_size if nojekyll.exists() else 0)
    detail = f"{len(files)} files, {len([f for f in files if f.startswith('lab/')])} of them in lab/"
    return Result("folder", not problems, detail + (f" | {problems[0]}" if problems else ""), {"files": files, "problems": problems})


def toggle_lang(page) -> None:
    """Press the language button of either page and wait for the other language."""
    now = (page.evaluate("document.documentElement.lang") or "en").lower()[:2]
    want = "en" if now == "ko" else "ko"
    page.click("#lang-toggle")
    page.wait_for_function("l => document.documentElement.lang.toLowerCase().startsWith(l)", arg=want, timeout=5_000)


def check_links(browser, base: str) -> Result:
    problems: list[str] = []
    with open_lab(browser, base) as (page, errors, requests):
        page.wait_for_selector("#lab-link", timeout=15_000)
        if page.get_attribute("#lab-link", "href") != "lab/":
            problems.append(f"the link of the infographic has the address {page.get_attribute('#lab-link', 'href')!r}, not 'lab/'")
        if page.text_content("#lab-link").strip() != LAB_TEXTS["en"]:
            problems.append(f"the link of the infographic reads {page.text_content('#lab-link').strip()!r} in English")
        first_lab_request = len(requests)
        page.click("#lab-link")
        page.wait_for_url(base + "lab/", timeout=15_000)
        final = wait_final(page)
        if final["state"] != "identical":
            problems.append(f"the browser check of the lab, opened from the infographic: {final['state']} (expected identical)")
        lab_requests = requests[first_lab_request:]
        problems += [f"the lab asked for {u}, outside {base}" for u in outside_base(lab_requests, base)]
        problems += [f"the lab asked another origin for {u}" for u in cross_origin(lab_requests, base)]
        if page.get_attribute("#site-link", "href") != "../":
            problems.append(f"the link of the lab has the address {page.get_attribute('#site-link', 'href')!r}, not '../'")
        if page.text_content("#site-link").strip() != BACK_TEXTS["en"]:
            problems.append(f"the link of the lab reads {page.text_content('#site-link').strip()!r} in English")
        toggle_lang(page)
        if page.text_content("#site-link").strip() != BACK_TEXTS["ko"]:
            problems.append(f"the link of the lab reads {page.text_content('#site-link').strip()!r} in Korean")
        page.click("#site-link")
        page.wait_for_url(base, timeout=15_000)
        page.wait_for_selector("#lab-link", timeout=15_000)
        toggle_lang(page)
        if page.text_content("#lab-link").strip() != LAB_TEXTS["ko"]:
            problems.append(f"the link of the infographic reads {page.text_content('#lab-link').strip()!r} in Korean")
        problems += [f"console: {e[:140]}" for e in errors]
    detail = f"infographic -> lab (check {final['state']}) -> infographic; {len(lab_requests)} requests of the lab, all under /{SUBPATH}/; link texts in English and Korean"
    return Result("links", not problems, detail + (f" | {problems[0]}" if problems else ""), {"problems": problems})


def renamed(result: Result, name: str) -> Result:
    return dataclasses.replace(result, name=name)


# ---- driver -------------------------------------------------------------------------------------------


def report(results: list[Result], out: Path) -> str:
    rows = [(f"{i} {r.name}", "PASS" if r.ok else "FAIL", r.detail) for i, r in enumerate(results, 1)]
    width = max(len(r[0]) for r in rows)
    table = "\n".join(f"{n:<{width}}  {s}  {d}" for n, s, d in rows)
    (out / "results.json").write_text(json.dumps([r.__dict__ for r in results], indent=2, ensure_ascii=False), encoding="utf-8")
    md = "| check | result | detail |\n|---|---|---|\n" + "\n".join(f"| {n} | {s} | {d.replace('|', '/')} |" for n, s, d in rows)
    (out / "summary.md").write_text(f"# Site QA\n\n{md}\n", encoding="utf-8")
    return table


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", type=Path, default=REPO / "dist" / "site", help="the assembled folder")
    ap.add_argument("--out", type=Path, default=REPO / "qa_out" / "site")
    args = ap.parse_args(argv)
    if not (args.root / "index.html").exists():
        print(f"missing {args.root / 'index.html'} (run scripts/assemble_site.py)", file=sys.stderr)
        return 1
    args.out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="qa-site-") as tmp:
        mount = Path(tmp) / SUBPATH
        shutil.copytree(args.root, mount)
        with serve(Path(tmp)) as origin, sync_playwright() as pw:
            base = f"{origin}{SUBPATH}/"
            lab = base + "lab/"
            browser = pw.chromium.launch(headless=True)
            try:
                results = [guarded("folder", lambda: check_folder(args.root)),
                           guarded("links", lambda: check_links(browser, base)),
                           guarded("infographic_size", lambda: renamed(check_page_size(args.root / "index.html"), "infographic_size")),
                           guarded("lab_size", lambda: renamed(check_lab_size(browser, lab, mount / "lab"), "lab_size")),
                           guarded("lab_time", lambda: renamed(check_time(browser, lab), "lab_time")),
                           guarded("lab_public", lambda: public_build_result(browser, lab, mount / "lab", name="lab_public"))]
            finally:
                browser.close()
    print(report(results, args.out))
    return 0 if all(r.ok for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
