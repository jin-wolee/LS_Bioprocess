"""The check `drilldown` of the headless QA of the plant (docs/design/plant_ui.md section 10, P5c): the drill-downs from the plant to the S3 screens and Back. Given the plant paused at an instant with the lens
on C, each row of section 7 that P5c builds opens its screen with the plant it came from and shows the same sample or architecture: the reactor, the sample and the card to Lineage (`data-sample` equals the
sample, and the `lineage` request the page sent carries the plant's seed and its actions), the card and the analyzer to Setup filled with the plant's run (and, from the analyzer, Results scrolled to the
utilisation block once a run has been made), the staff to Notes at the flag table; every bar says it came from the plant, Setup and Results say that Results carries no plant action; Back to the plant lands
on the same instant and lens, paused, on the same plan, and the Worker was sent no second `plant_run`. A plant link opened in a fresh page runs that spec and lands on its instant; with an action in it the
Lineage opened from there carries the action; a link that is wrong in four ways falls back and says which. A challenge started on the run empties the lineage view and the overlay the page held. No console
error. Screenshots of each screen reached, in English and in Korean, go to `drill/`. A check takes a browser and the URL of the served build and returns a Result; it never exits or prints.
"""
from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from urllib.parse import parse_qs

from qa_checks import Result, first_line
from qa_lab_browser import go, set_lang, start_challenge
from qa_plant_browser import RECORD_PLANT_JS, open_plant, pause, plant_messages, seek, settle, state, wait_scene
from qa_plant_drill_helpers import BAD_LINK_NOTES, back_problems, bad_link, count, lineage_problems, link_problems, newest_sample, plant_hash, read_hash
from qa_plant_helpers import BUSY_START_S, PLANT_VIEWPORTS, plan_from_messages

# An instant of the morning of day 8 with tubes on the floor and cards on the shelves, the reactor and the analyzer the check opens, and an action a reader could have made there: a feed on U10 at day 8 09:00.
BUSY_S = BUSY_START_S + 25 * 60
FEED = [{"kind": "add_feed", "at": 8 * 86400 + 9 * 3600, "unit_id": "U10"}]
LOCKED_EN = "A challenge is open on this run"
FLAG_TABLE_JS = "() => { const e = document.getElementById('flag-table'); return e ? e.getBoundingClientRect().top : null; }"
UTILISATION_JS = "() => { const e = document.getElementById('utilisation'); return e ? e.getBoundingClientRect().top : null; }"


def sent(page) -> list:
    return page.evaluate("window.__plantSent")


def left(page) -> dict:
    s = state(page)
    return {k: s[k] for k in ("t", "lens", "epoch", "playing")}


def follow(page, panel: str, name: str, screen: str, problems: list[str], tag: str, **expect) -> str:
    """Follow the link `data-drill=name` of an open panel: its address says what it must, and the click opens the screen."""
    selector = f"{panel} a[data-drill={name}]"
    href = page.get_attribute(selector, "href")
    if href is None:
        problems.append(f"{tag}: the panel has no {name} link")
        raise LookupError(tag)
    problems += [f"{tag}: {p}" for p in link_problems(href, screen, **expect)]
    page.click(selector)
    page.wait_for_selector(f"#main[data-screen={screen}]", timeout=10_000)
    return href


def open_panel(page, key: str, panel: str) -> None:
    page.focus(f"[data-object-key='{key}']")
    page.keyboard.press("Enter")
    page.wait_for_selector(f"[data-plant-panel={panel}]", timeout=10_000)


def back(page, before: dict, problems: list[str], tag: str) -> None:
    """Back to the plant: the bar's link, then the same instant and lens, paused, on the same plan, with no new plant_run."""
    runs = count(sent(page), "plant_run")
    page.click("#back-to-plant")
    page.wait_for_selector("#main[data-screen=plant]", timeout=10_000)
    wait_scene(page)
    settle(page, 3)
    problems += [f"{tag}: {p}" for p in back_problems(before, left(page), runs, count(sent(page), "plant_run"))]
    if page.query_selector("[data-plant-panel]") or page.query_selector("[data-plant-record]"):
        problems.append(f"{tag}: a panel stayed open after Back")


def checked(page) -> list[str]:
    return page.eval_on_selector_all("#architectures input[type=checkbox]:checked", "els => els.map((e) => e.id.replace('arch-', ''))")


def setup_over(page, architectures: list[str], problems: list[str], tag: str) -> None:
    """Setup filled from the link: the scenario of the plant over the given architectures (the form is filled once the screen has been drawn), and the bar says that Results carries no plant action."""
    try:
        page.wait_for_function("(want) => JSON.stringify([...document.querySelectorAll('#architectures input[type=checkbox]:checked')].map((e) => e.id.replace('arch-', ''))) === JSON.stringify(want)", arg=architectures, timeout=10_000)
    except Exception:  # noqa: BLE001 - the form as it is, is the finding
        problems.append(f"{tag}: Setup is over {checked(page)}, expected {architectures}")
    if page.input_value("#scenario") != "default":
        problems.append(f"{tag}: Setup shows the scenario {page.input_value('#scenario')}, expected default")
    if page.query_selector("[data-note=origin-results]") is None:
        problems.append(f"{tag}: Setup does not say that Results carries no plant action")


def shot(page, out: Path, name: str, top: bool = True) -> None:
    """The screen, in English and then in Korean (the language goes back to English); from the top of the page unless the screen was scrolled to the part the link names."""
    if top:
        page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(300)
    page.screenshot(path=str(out / "drill" / f"drill_{name}_1280x720_en.png"))
    set_lang(page, "ko")
    page.wait_for_timeout(300)
    page.screenshot(path=str(out / "drill" / f"drill_{name}_1280x720_ko.png"))
    set_lang(page, "en")


def lineage_of(page, sample: str, actions: int, problems: list[str], tag: str) -> None:
    # the screen first shows the view of the visit before, for one frame, until the request of this link is made; the view that counts is the one of the sample the plant offered
    try:
        page.wait_for_selector(f"#lineage-view[data-sample='{sample}']", timeout=120_000)
    except Exception:  # noqa: BLE001 - the sample on the screen is the finding
        problems.append(f"{tag}: the Lineage screen shows {page.get_attribute('#lineage-view', 'data-sample')}, the plant offered {sample}")
    problems += [f"{tag}: {p}" for p in lineage_problems(sent(page), sample, actions, 1)]
    if page.query_selector("[data-plant-origin] #back-to-plant") is None:
        problems.append(f"{tag}: the bar of a screen opened from the plant has no link back")


def rows(page, out: Path, problems: list[str]) -> str:
    """Every row P5c builds, in one page, ending with the challenge. Returns the Back link of the first drill-down (a plant link with an instant), for the fresh pages."""
    plan = plan_from_messages(plant_messages(page), 1)
    seek(page, BUSY_S)
    settle(page, 5)
    page.click("[data-lens-option=c_context]")
    page.wait_for_function("() => document.querySelector('#plant').dataset.plantLens === 'c_context'", timeout=10_000)
    t = int(state(page)["t"])
    here = left(page)

    # the reactor: Lineage on the unit's newest sample
    open_panel(page, "reactor:U10", "reactor")
    sample = newest_sample(plan, "U10", t)
    href = follow(page, "[data-plant-panel=reactor]", "lineage", "lineage", problems, "reactor", sample=sample, t=t)
    lineage_of(page, sample, 0, problems, "reactor")
    again = page.get_attribute("#back-to-plant", "href")
    engine = parse_qs(read_hash(href)[1]["plant"])["engine"][0]
    if again != plant_hash(t, engine):
        problems.append(f"reactor: Back to the plant is {again}, expected {plant_hash(t, engine)}")
    shot(page, out, "lineage")
    back(page, here, problems, "reactor")

    # the sample: Lineage on that sample
    tube = page.get_attribute("[data-tube-sample]", "data-tube-sample")
    if tube is None:
        problems.append(f"no tube is on the floor at {BUSY_S} s")
    else:
        page.focus(f"[data-tube-sample='{tube}']")
        page.keyboard.press("Enter")
        page.wait_for_selector("[data-plant-panel=sample]", timeout=10_000)
        follow(page, "[data-plant-panel=sample]", "lineage", "lineage", problems, "sample", sample=tube, t=t)
        lineage_of(page, tube, 0, problems, "sample")
        back(page, here, problems, "sample")

    # the card: Lineage on its sample, and Setup over the lens architecture
    page.focus("[data-card-sample]")
    card = page.get_attribute("[data-card-sample]", "data-card-sample")
    page.keyboard.press("Enter")
    page.wait_for_selector("[data-plant-record]", timeout=30_000)
    follow(page, "[data-plant-record]", "lineage", "lineage", problems, "card", sample=card, t=t)
    lineage_of(page, card, 0, problems, "card")
    back(page, here, problems, "card lineage")
    page.focus("[data-card-sample]")
    page.keyboard.press("Enter")
    page.wait_for_selector("[data-plant-record]", timeout=30_000)
    follow(page, "[data-plant-record]", "results", "setup", problems, "card", t=t)
    setup_over(page, ["c_context"], problems, "card")
    shot(page, out, "setup")
    back(page, here, problems, "card results")

    # the analyzer: Setup over the halls of the run; a small run; Results scrolled to the utilisation block
    open_panel(page, "analyzer:AN-1", "analyzer")
    follow(page, "[data-plant-panel=analyzer]", "results", "setup", problems, "analyzer", t=t)
    setup_over(page, ["a_manual", "b_lims_lite", "c_context"], problems, "analyzer")
    if page.query_selector("[data-note=origin-utilisation]") is None:
        problems.append("analyzer: Setup does not say where the utilisation is")
    page.fill("#seeds", "1, 2")
    page.click("#run")
    page.wait_for_selector("[data-utilisation]", timeout=180_000)
    page.wait_for_timeout(500)
    top = page.evaluate(UTILISATION_JS)
    if top is None or not -2 <= top < 400:
        problems.append(f"analyzer: the utilisation block is {top} px from the top of the window after the run, expected it scrolled to")
    if page.query_selector("[data-note=origin-results]") is None:
        problems.append("analyzer: Results does not say that it carries no plant action")
    shot(page, out, "results", top=False)
    back(page, here, problems, "analyzer")

    # the staff: Notes, at the flag table
    open_panel(page, "staff:OP-01", "staff")
    follow(page, "[data-plant-panel=staff]", "notes", "notes", problems, "staff", t=t)
    page.wait_for_timeout(500)
    top = page.evaluate(FLAG_TABLE_JS)
    if top is None or not -2 <= top < 400:
        problems.append(f"staff: the flag table is {top} px from the top of the window, expected Notes scrolled to it")
    shot(page, out, "notes", top=False)
    back(page, here, problems, "staff")
    return again


def challenge_empties(page, problems: list[str]) -> None:
    """The lineage view and the overlay the page holds go when a challenge starts on the same run (the default scenario, seed 1); a request after it is locked as before."""
    pause(page)
    page.click("[data-truth-switch]")
    page.wait_for_function("() => !!document.querySelector('#plant').dataset.plantAbsences", timeout=30_000)
    go(page, "lineage")
    if page.query_selector("#lineage-view") is None:
        problems.append("challenge: the Lineage screen holds no view before the challenge, so there is nothing to empty")
    start_challenge(page, "sample", shown="a_manual", seed=1, timeout=120_000)
    go(page, "lineage")
    if page.query_selector("#lineage-view") is not None:
        problems.append("challenge: the lineage view of the run stayed on the page when a challenge started on it")
    go(page, "plant")
    wait_scene(page)
    page.wait_for_selector("#plant[data-plant-truth=locked]", timeout=10_000)
    if page.get_attribute("#plant", "data-plant-absences") is not None:
        problems.append("challenge: the rails of the overlay stayed on the halls when a challenge started on the run")
    if LOCKED_EN not in page.inner_text("[data-truth-locked]"):
        problems.append(f"challenge: the switch says '{page.inner_text('[data-truth-locked]')[:60]}', expected the sentence that names the open challenge")


@contextmanager
def open_link(browser, url: str, href: str):
    """A fresh context (a cold load) opened on a hash, with its console errors and the recorder of the Worker's messages."""
    size = PLANT_VIEWPORTS["1280"]
    ctx = browser.new_context(viewport={"width": size[0], "height": size[1]}, locale="en-US")
    try:
        ctx.add_init_script(RECORD_PLANT_JS)
        page = ctx.new_page()
        errors: list[str] = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.goto(url.rstrip("/") + "/" + href, wait_until="load")
        page.wait_for_selector("#main[data-ready=true]", timeout=60_000)
        yield page, errors
    finally:
        ctx.close()


def fresh_links(browser, url: str, back_href: str, problems: list[str]) -> None:
    """The plant link in a fresh page: the spec runs once and the clock opens, paused, on its instant; with an action in it the Lineage opened from there carries the action; a bad link falls back and says which."""
    query = parse_qs(back_href.partition("?")[2])
    t, engine = int(query["t"][0]), query["engine"][0]
    with open_link(browser, url, back_href) as (page, errors):
        wait_scene(page)
        s = state(page)
        if (s["t"], s["playing"]) != (str(t), "false"):
            problems.append(f"link: the clock opened at {s['t']} (playing {s['playing']}), the link says {t} and paused")
        runs = [m for m in sent(page) if m["type"] == "plant_run"]
        if len(runs) != 1 or runs[0]["spec"] != {"scenario": "default", "seed": 1, "actions": 0}:
            problems.append(f"link: the page asked for {[r['spec'] for r in runs]}, expected one run of the default plant")
        if page.query_selector("[data-plant-link-notes]") is not None:
            problems.append("link: a clean link was read with changes")
        problems += [f"link: console: {e[:140]}" for e in errors]
    with open_link(browser, url, plant_hash(t, engine, FEED)) as (page, errors):
        wait_scene(page)
        plan = plan_from_messages(plant_messages(page), 1)
        runs = [m for m in sent(page) if m["type"] == "plant_run"]
        if len(runs) != 1 or runs[0]["spec"]["actions"] != 1 or state(page)["t"] != str(t):
            problems.append(f"action link: runs {[r['spec'] for r in runs]}, the clock at {state(page)['t']}; expected one run with the feed, at {t}")
        open_panel(page, "reactor:U10", "reactor")
        sample = newest_sample(plan, "U10", t)
        follow(page, "[data-plant-panel=reactor]", "lineage", "lineage", problems, "action link", sample=sample, t=t)
        lineage_of(page, sample, 1, problems, "action link")
        problems += [f"action link: console: {e[:140]}" for e in errors]
    with open_link(browser, url, bad_link("0.0.0")) as (page, errors):
        wait_scene(page)
        got = page.eval_on_selector_all("[data-link-note]", "els => els.map((e) => e.dataset.linkNote)")
        runs = [m["spec"] for m in sent(page) if m["type"] == "plant_run"]
        if got != BAD_LINK_NOTES or runs != [{"scenario": "default", "seed": 1, "actions": 0}]:
            problems.append(f"bad link: the page said {got} and asked for {runs}, expected {BAD_LINK_NOTES} and one run of the default plant")
        problems += [f"bad link: console: {e[:140]}" for e in errors]


def check_drilldown(browser, url, out: Path) -> Result:
    problems: list[str] = []
    (out / "drill").mkdir(parents=True, exist_ok=True)
    back_href = ""
    try:
        with open_plant(browser, url, PLANT_VIEWPORTS["1280"], init_script=RECORD_PLANT_JS) as (page, errors, _):
            wait_scene(page)
            pause(page)
            back_href = rows(page, out, problems)
            challenge_empties(page, problems)
            problems += [f"console: {e[:140]}" for e in errors]
    except Exception as e:  # a page that crashed is a finding
        problems.append(f"rows: {first_line(e)}")
    try:
        if back_href:
            fresh_links(browser, url, back_href, problems)
    except Exception as e:
        problems.append(f"links: {first_line(e)}")
    detail = ("the reactor, sample and card open Lineage on the same sample with the plant's actions, the card and the analyzer open Setup over the plant's run (Results scrolled to the utilisation block), the staff open Notes at "
              "the flag table; Back lands on the same instant and lens with no new plant_run; the plant link opens in a fresh page on its instant, falls back and says which when it is wrong; a challenge empties the lineage view "
              "and the overlay")
    return Result("drilldown", not problems, detail + (f" | {problems[0]}" if problems else ""), {"problems": problems})
