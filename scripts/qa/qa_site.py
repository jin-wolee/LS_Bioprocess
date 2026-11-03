#!/usr/bin/env python3
"""Headless QA for the assembled site folder (`dist/site`, written by scripts/assemble_site.py): eleven checks, exit 1 if any fails.

    uv run python scripts/qa/qa_site.py [--root dist/site] [--out qa_out/site] [--timing judge|report]

Copies --root under /LS_Bioprocess/ in a scratch folder and serves that over http.server: a project site on GitHub Pages lives under /<repository>/, and a root-absolute address would pass
at the root of a server and fail there. Drives headless Chromium (Playwright sync API), closes it, and writes results.json and summary.md to --out.

  folder         the files of the folder: the page, the fonts it names with their two licences (fonts/), the lab, an empty .nojekyll, and nothing of site/infographic/ besides index.html and fonts/
  infographic_origin   a cold load of the page asks no other origin for anything and nothing outside /LS_Bioprocess/, and Archivo and IBM Plex Mono load from the folder's own fonts/
  links          the infographic opens, its link opens the lab, the browser check of the lab reads `identical`, the lab's link opens the infographic again; both link texts in English and Korean;
                 no request of the lab leaves the path of the site or the origin
  language       nothing chosen: both pages open in English (ADR-0006); Korean chosen on the infographic is the language of the lab after the click, and a choice made in the lab (English, then
                 Korean) is the language of the infographic after the click back: the pages are one origin and share one localStorage key, `sll.lang`
  infographic_size, lab_size, lab_time    the budgets of docs/design/lab_ui.md section 12 over the assembled pages (the lab's are the checks of qa_lab.py, served from here)
  lab_public     the lab of the folder is the public build: the Break-out screen is refused while a source of it is below main-reread (the check `breakout_public` of qa_lab.py, on this folder)
  plant_route, plant_size, plant_text   the plant on the folder under /LS_Bioprocess/lab/ (P9; docs/design/plant_ui.md section 11): Home asks for no plant chunk and entering asks for it once, the scene is drawn,
                 every request stays under the path of the site, and the page offers no case link and no Break-out screen (`plant_route`, in qa_site_plant.py); the first load and the plant chunk against their
                 limits (`size` of qa_plant_checks.py); and, with WebGL off, the text alternative with no request for the plant chunk (`plant_fallback` of qa_plant_checks.py)
"""
from __future__ import annotations

import argparse
import dataclasses
import json
import re
import shutil
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright
from qa_checks import Result
from qa_checks import check_size as check_page_size
from qa_infographic import cold_load, guarded, origin_problems, serve
from qa_lab_browser import open_lab, wait_final
from qa_lab_breakout import public_build_result
from qa_lab_checks import check_size as check_lab_size
from qa_lab_checks import check_time
from qa_lab_helpers import cross_origin, outside_base
from qa_plant_checks import check_plant_fallback
from qa_plant_checks import check_size as check_plant_size
from qa_plant_helpers import SOFTWARE_GL
from qa_site_plant import check_plant_route
from qa_timing import set_mode

REPO = Path(__file__).resolve().parents[2]
SUBPATH = "LS_Bioprocess"
REQUIRED = (".nojekyll", "index.html", "lab/index.html", "lab/reference.json", "fonts/OFL-Archivo.txt", "fonts/OFL-IBM-Plex-Mono.txt")  # the OFL asks for the licence texts beside the fonts
TOP = {".nojekyll", "index.html", "lab", "fonts"}  # what the folder may hold at its top: the page, its fonts, the lab and the marker file
LAB_TEXTS = {"en": "Open the lab", "ko": "랩 열기"}  # the link of the infographic (site/infographic/src)
BACK_TEXTS = {"en": "Explainer page", "ko": "해설 페이지"}  # the link of the lab (src/i18n)


# ---- pure helpers (tests/test_qa_site.py) -------------------------------------------------------------


def folder_problems(files: list[str], nojekyll_bytes: int) -> list[str]:
    """What is wrong with the list of files of the folder (paths relative to it)."""
    problems = [f"missing {name}" for name in REQUIRED if name not in files]
    problems += [f"{name}: not part of the site (only index.html, fonts/, lab/ and .nojekyll belong at the top)" for name in files if name.split("/")[0] not in TOP]
    if ".nojekyll" in files and nojekyll_bytes != 0:
        problems.append(f".nojekyll holds {nojekyll_bytes} bytes (it must be empty)")
    return problems


def font_urls(page_html: str) -> list[str]:
    """The addresses in the `src` of the page's @font-face rules, in order."""
    return [u for body in re.findall(r"@font-face\s*\{(.*?)\}", page_html, re.S) for u in re.findall(r"url\(\s*[\"']?([^)\"']+)", body)]


def font_problems(files: list[str], page_html: str) -> list[str]:
    """The fonts the page names that the folder does not hold (addresses are relative to the page, which sits at the top of the folder)."""
    return [f"the page names {u}, which the folder does not hold" for u in font_urls(page_html) if u not in files]


# ---- checks -------------------------------------------------------------------------------------------


def check_folder(root: Path) -> Result:
    files = sorted(p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file())
    nojekyll = root / ".nojekyll"
    problems = folder_problems(files, nojekyll.stat().st_size if nojekyll.exists() else 0)
    if "index.html" in files:
        problems += font_problems(files, (root / "index.html").read_text(encoding="utf-8"))
    detail = f"{len(files)} files, {len([f for f in files if f.startswith('lab/')])} of them in lab/"
    return Result("folder", not problems, detail + (f" | {problems[0]}" if problems else ""), {"files": files, "problems": problems})


def check_infographic_origin(browser, base: str) -> Result:
    """A cold load of the page under /<repository>/: no other origin, no address outside the path of the site (a root-absolute font address), and both families loaded."""
    requests, loaded = cold_load(browser, base)
    problems = origin_problems(requests, loaded, base) + [f"asked for {u}, outside {base}" for u in outside_base(requests, base)]
    detail = f"{len(requests)} requests, all under /{SUBPATH}/; loaded from the folder's fonts/: {', '.join(loaded) or 'none'}"
    return Result("infographic_origin", not problems, detail if not problems else "; ".join(problems[:3]), {"requests": requests, "loaded": loaded, "problems": problems})


def lang_of(page) -> str:
    return (page.evaluate("document.documentElement.lang") or "en").lower()[:2]


def wait_lang(page, want: str) -> None:
    page.wait_for_function("l => document.documentElement.lang.toLowerCase().startsWith(l)", arg=want, timeout=5_000)


def toggle_lang(page) -> None:
    """Press the language button of either page and wait for the other language."""
    want = "en" if lang_of(page) == "ko" else "ko"
    page.click("#lang-toggle")
    wait_lang(page, want)


def show_lang(page, want: str) -> None:
    """Make the page read `want`: press the button only when it does not already (the link may have carried the language over)."""
    if lang_of(page) != want:
        toggle_lang(page)


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
        show_lang(page, "ko")
        if page.text_content("#lab-link").strip() != LAB_TEXTS["ko"]:
            problems.append(f"the link of the infographic reads {page.text_content('#lab-link').strip()!r} in Korean")
        problems += [f"console: {e[:140]}" for e in errors]
    detail = f"infographic -> lab (check {final['state']}) -> infographic; {len(lab_requests)} requests of the lab, all under /{SUBPATH}/; link texts in English and Korean"
    return Result("links", not problems, detail + (f" | {problems[0]}" if problems else ""), {"problems": problems})


def to_lab(page, base: str) -> None:
    page.click("#lab-link")
    page.wait_for_url(base + "lab/", timeout=15_000)
    page.wait_for_selector("#site-link", timeout=15_000)


def to_infographic(page, base: str) -> None:
    page.click("#site-link")
    page.wait_for_url(base, timeout=15_000)
    page.wait_for_selector("#lab-link", timeout=15_000)


def check_language(browser, base: str) -> Result:
    """The links carry the language: a fresh context (empty localStorage) stays on the one origin; with nothing chosen both pages read English (ADR-0006)."""
    problems: list[str] = []

    def expect(page, where: str, want: str) -> None:
        try:
            wait_lang(page, want)
        except Exception:
            problems.append(f"{where}: reads {lang_of(page)!r}, expected {want!r}")

    def link_text(page, selector: str, where: str, want: str) -> None:
        got = page.text_content(selector).strip()
        if got != want:
            problems.append(f"{where}: the link reads {got!r}, expected {want!r}")

    with open_lab(browser, base) as (page, errors, _):
        page.wait_for_selector("#lab-link", timeout=15_000)
        expect(page, "the infographic with nothing chosen", "en")
        to_lab(page, base)
        expect(page, "the lab with nothing chosen", "en")
        to_infographic(page, base)
        toggle_lang(page)  # Korean on the infographic
        to_lab(page, base)
        expect(page, "the lab after Korean on the infographic", "ko")
        link_text(page, "#site-link", "the lab after Korean on the infographic", BACK_TEXTS["ko"])
        toggle_lang(page)  # English in the lab
        to_infographic(page, base)
        expect(page, "the infographic after English in the lab", "en")
        link_text(page, "#lab-link", "the infographic after English in the lab", LAB_TEXTS["en"])
        to_lab(page, base)
        toggle_lang(page)  # Korean in the lab
        to_infographic(page, base)
        expect(page, "the infographic after Korean in the lab", "ko")
        link_text(page, "#lab-link", "the infographic after Korean in the lab", LAB_TEXTS["ko"])
        problems += [f"console: {e[:140]}" for e in errors]
    detail = "nothing chosen: English on both pages; Korean carried infographic to lab, English and Korean carried lab to infographic (one key, sll.lang)"
    return Result("language", not problems, detail + (f" | {problems[0]}" if problems else ""), {"problems": problems})


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
    ap.add_argument("--timing", choices=("judge", "report"), default="judge", help="report: a time over its limit is printed with its conditions and does not fail (the Pages workflow; scripts/qa/qa_timing.py)")
    args = ap.parse_args(argv)
    set_mode(args.timing)
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
            gl = pw.chromium.launch(headless=True, args=SOFTWARE_GL)  # the plant draws with WebGL two: software rendering, as the plant QA does
            try:
                results = [guarded("folder", lambda: check_folder(args.root)),
                           guarded("infographic_origin", lambda: check_infographic_origin(browser, base)),
                           guarded("links", lambda: check_links(browser, base)),
                           guarded("language", lambda: check_language(browser, base)),
                           guarded("infographic_size", lambda: renamed(check_page_size(args.root / "index.html"), "infographic_size")),
                           guarded("lab_size", lambda: renamed(check_lab_size(browser, lab, mount / "lab"), "lab_size")),
                           guarded("lab_time", lambda: renamed(check_time(browser, lab), "lab_time")),
                           guarded("lab_public", lambda: public_build_result(browser, lab, mount / "lab", name="lab_public")),
                           guarded("plant_route", lambda: check_plant_route(gl, base)),
                           guarded("plant_size", lambda: renamed(check_plant_size(gl, lab, mount / "lab"), "plant_size")),
                           guarded("plant_text", lambda: renamed(check_plant_fallback(pw, lab, args.out), "plant_text"))]
            finally:
                gl.close()
                browser.close()
    print(report(results, args.out))
    return 0 if all(r.ok for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
