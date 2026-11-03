"""The plant on the assembled public site, for scripts/qa_site.py (docs/design/plant_ui.md sections 10 and 11, P9; docs/design/lab_ui.md section 13).

`plant_route`: Given the lab of `dist/site` served under /LS_Bioprocess/lab/ (the public build), Home asks for no plant chunk, entering the plant asks for it once, the scene is drawn (headless Chromium
with software WebGL), every request stays on the origin and under the path of the site, and the page offers no case link and no way to the Break-out screen: no link to it, no `case=` in any address, no
drill-down to it, no way in from it, and the plant of a link that names a case falls back on the default plant and says so. The size of the first load and of the plant chunk is `size` of qa_plant_checks.py
and the text alternative is `plant_fallback`, both run on the same folder by qa_site.py. A check takes a browser and the address of the site and returns a Result; it never exits or prints. The pure rules
(`chunk_problems`, `offer_problems`) are unit-tested in tests/test_qa_site.py.
"""
from __future__ import annotations

import re
from urllib.parse import unquote

from qa_checks import Result, first_line
from qa_lab_browser import open_lab
from qa_lab_helpers import cross_origin, outside_base, served_path
from qa_plant_browser import wait_scene
from qa_plant_drill import open_link
from qa_plant_helpers import PLANT_VIEWPORTS, split_requests
from qa_plant_sc12_helpers import case_href

CASE = "sc12_medium_lot"
CASE_IN_ADDRESS = re.compile(r"[?&]case=")
BREAKOUT_ADDRESS = re.compile(r"#/breakout\b")
OFFER_JS = """() => ({nav_breakout: !!document.querySelector('#nav-breakout'), hrefs: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
  drill_breakout: document.querySelectorAll('a[data-drill=breakout]').length, open_plant: !!document.querySelector('#breakout-open-plant'),
  host_case: (document.querySelector('#plant') || {dataset: {}}).dataset.plantCase ?? null})"""


def chunk_problems(home: dict, entered: dict) -> list[str]:
    """`split_requests` of a cold load of Home and of the same page after entering the plant: Home asks for the loader and not for the plant chunk, entering asks for the plant chunk once."""
    problems = []
    if home["plant"]:
        problems.append(f"Home requested the plant chunk: {home['plant']}")
    if not home["loader"]:
        problems.append("Home did not request the loader chunk")
    if len(entered["plant"]) != 1:
        problems.append(f"entering the plant requested {len(entered['plant'])} plant chunks, expected 1")
    return problems


def offer_problems(facts: dict, where: str = "") -> list[str]:
    """What the public build must not offer (the Break-out screen is refused while a source of it is below main-reread, lab_ui.md sections 6 and 20): `facts` is what OFFER_JS reads from the page, `where`
    (Home, the plant) is put before each problem."""
    problems = []
    if facts["nav_breakout"]:
        problems.append("the page has a link to the Break-out screen in its navigation")
    for href in facts["hrefs"]:
        flat = unquote(href)
        if CASE_IN_ADDRESS.search(flat):
            problems.append(f"the page links to a case: {href}")
        if BREAKOUT_ADDRESS.search(flat):
            problems.append(f"the page links to the Break-out screen: {href}")
    if facts["drill_breakout"]:
        problems.append(f"the page has {facts['drill_breakout']} drill-down to the Break-out screen")
    if facts["open_plant"]:
        problems.append("the page has a way in from the Break-out screen to the plant")
    if facts["host_case"] is not None:
        problems.append(f"the plant host is a case ({facts['host_case']})")
    return [f"{where}: {p}" if where else p for p in problems]


def check_plant_route(browser, base: str) -> Result:
    """The plant of the assembled site, entered from Home as a reader does and from a link that names a case."""
    lab = base + "lab/"
    problems: list[str] = []
    try:
        with open_lab(browser, lab, PLANT_VIEWPORTS["1280"]) as (page, errors, requests):
            page.wait_for_selector("#main[data-ready=true]", timeout=60_000)
            home = split_requests(served_path(u, lab) for u in requests)
            problems += offer_problems(page.evaluate(OFFER_JS), "on Home")
            entry = page.get_attribute("#enter-plant", "data-plant-entry")
            if entry != "scene":
                problems.append(f"the entry on Home is '{entry}', expected 'scene' where WebGL two is available")
            page.click("#enter-plant")
            wait_scene(page)
            entered = split_requests(served_path(u, lab) for u in requests)
            problems += chunk_problems(home, entered)
            if page.get_attribute("#plant-status", "data-plant-status") != "ready":
                problems.append("the status line does not say the scene is ready")
            problems += offer_problems(page.evaluate(OFFER_JS), "in the plant")
            problems += [f"asked for {u}, outside {base}" for u in outside_base(requests, base)]
            problems += [f"asked another origin for {u}" for u in cross_origin(requests, lab)]
            problems += [f"console: {e[:140]}" for e in errors]
        with open_link(browser, lab, case_href(CASE), PLANT_VIEWPORTS["1280"]) as (page, errors):
            wait_scene(page)
            if page.get_attribute("#plant", "data-plant-case") is not None:
                problems.append("a link that names a case opened a case")
            if page.query_selector("[data-link-note=case]") is None:
                problems.append("the page does not say that the case of the link fell back")
            sent = [m for m in page.evaluate("window.__plantSent") if m["type"] == "plant_run"]
            if not sent or any(m.get("case") for m in sent):
                problems.append(f"the page sent plant_run {[m.get('case') or m.get('spec') for m in sent]}, expected the default plant and no case")
            problems += offer_problems(page.evaluate(OFFER_JS), "in the plant of a link with a case")
            problems += [f"link with a case, console: {e[:140]}" for e in errors]
    except Exception as e:  # a crashed route is a failed check
        problems.append(first_line(e))
    detail = (f"Home without the plant chunk, entering it requested {entered['plant'][0] if entered['plant'] else 'nothing'}, scene ready, all requests under /{base.rstrip('/').rsplit('/', 1)[-1]}/; "
              f"no case link, no Break-out screen; a link with a case falls back on the default plant") if not problems else ""
    return Result("plant_route", not problems, detail or problems[0], {"problems": problems})
