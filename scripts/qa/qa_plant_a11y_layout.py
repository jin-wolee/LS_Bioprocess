"""The parts of the check `plant_a11y` that concern the room the chrome of the plant leaves (docs/design/plant_ui.md sections 3 and 9, P8a): at 1280 by 720 no panel, form or list covers the bars or is cut
by its box and the five lens chips of a case do not run under the truth switch; at 390 by 844 the plant keeps at least half of its box, the lens and the switch are a sheet behind a button, and a panel is a
sheet that covers no bar; and no text of the plant's DOM is below AA in either theme or language. Each function takes a browser and the URL of the served build and returns the list of problems it found;
none exits or prints. The screenshots go to `a11y/` under the output directory.
"""
from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import quote

from qa_checks import fmt_ratio
from qa_infographic import CONTRAST_JS, contrast_rows
from qa_lab_browser import apply_state
from qa_lab_helpers import LANGS
from qa_plant_a11y_helpers import contrast_problems, cover_problems, cut_problems, inside, share_problems
from qa_plant_browser import settle, wait_scene
from qa_plant_drill import open_link
from qa_plant_helpers import BUSY_START_S, PLANT_VIEWPORTS
from qa_plant_sc12_helpers import case_href

RECT_JS = """(sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? {x: r.x, y: r.y, w: r.width, h: r.height} : null; }"""
ITEMS_JS = """(sel) => [...document.querySelectorAll(sel)].map((e) => { const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height}; })"""
# A grid of points over the part of the plant's box that is in the view: for each, whether a card, a panel or a bar of the plant is on top of it (the layer of the cards lets everything else through).
COVERED_JS = """() => {
  const b = document.querySelector('.plant-wrap').getBoundingClientRect();
  const x0 = Math.max(b.left, 0), x1 = Math.min(b.right, innerWidth), y0 = Math.max(b.top, 0), y1 = Math.min(b.bottom, innerHeight), n = 24, out = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = x0 + (i + 0.5) * (x1 - x0) / n, y = y0 + (j + 0.5) * (y1 - y0) / n;
    out.push(document.elementsFromPoint(x, y).some((e) => e.closest('.plant-hud, .plant-side > *, .plant-bottom > *')));
  }
  return out;
}"""
SCROLL_JS = "document.querySelector('.plant-wrap').scrollIntoView({block: 'start'})"
THEMES = [("light", "light", "light"), ("dark", "dark", "light"), ("auto-dark", "auto", "dark")]
# Three actions the reader entered on the busy morning (a unit, an analyzer, a unit): the list of them is the box that was cut.
ACTIONS = [{"kind": "add_feed", "at": BUSY_START_S + 25 * 60, "unit_id": "U10"}, {"kind": "analyzer_down", "at": BUSY_START_S + 25 * 60, "analyzer": "AN-1", "from": BUSY_START_S + 3 * 3600, "length_min": 120},
           {"kind": "raise_alarm", "at": BUSY_START_S + 25 * 60, "unit_id": "U11"}]
BARS = {"time": "[data-plant-time]", "bar": "[data-plant-bar=actions]"}


def _rects(page, names: dict[str, str]) -> dict:
    return {name: page.evaluate(RECT_JS, selector) for name, selector in names.items()}


def layout_problems(browser, url: str, out: Path, busy_link: str) -> list[str]:
    """1280 by 720: with three actions in the list, a reactor panel open and then the form of an action open, nothing covers a bar or another box and no item of the list is cut; and the lens chips of the
    five records of a case, with the truth switch, run into none of them."""
    problems: list[str] = []
    shots = out / "a11y"
    shots.mkdir(parents=True, exist_ok=True)
    link = f"{busy_link}&actions={quote(json.dumps(ACTIONS, separators=(',', ':')), safe='')}"
    with open_link(browser, url, link) as (page, errors):
        wait_scene(page)
        page.evaluate(SCROLL_JS)
        settle(page, 3)
        card = {"actions": "[data-plant-hud=actions]", "place": "[data-plant-hud=place]", **BARS}
        r = _rects(page, card)
        problems += cover_problems(r, [("actions", "time"), ("actions", "bar"), ("place", "time"), ("place", "bar")], "1280x720 at rest")
        problems += cut_problems(page.evaluate(ITEMS_JS, "[data-act-list] li"), r["actions"], "the list of three actions")
        page.focus("[data-object-key='reactor:U10']")
        page.keyboard.press("Enter")
        page.wait_for_selector("[data-plant-panel=reactor]", timeout=10_000)
        page.click("[data-action=add_feed]")
        page.wait_for_selector(".plant-act", timeout=10_000)
        settle(page, 3)
        r = _rects(page, {"panel": "[data-plant-panel]", "form": ".plant-act", "chips": ".plant-hud-chips", "actions": "[data-plant-hud=actions]", **BARS})
        problems += cover_problems(r, [("panel", "time"), ("panel", "bar"), ("panel", "form"), ("form", "time"), ("form", "bar"), ("chips", "panel"), ("actions", "form")], "1280x720 with a panel and a form open")
        page.screenshot(path=str(shots / "a11y_panel_form_1280x720.png"))
        problems += [f"console: {e[:140]}" for e in errors]
    with open_link(browser, url, case_href("sc12_medium_lot", t=17 * 86400 + 10 * 3600)) as (page, _):
        wait_scene(page, halls=5)
        page.evaluate(SCROLL_JS)
        page.click("[data-truth-switch]")
        settle(page, 3)
        r = _rects(page, {"check": "[data-plant-hud=check]", "lens": "[data-plant-hud=lens]", "truth": "[data-plant-hud=truth]"})
        problems += cover_problems(r, [("check", "lens"), ("lens", "truth"), ("check", "truth")], "1280x720 with five halls")
        page.screenshot(path=str(shots / "a11y_five_halls_1280x720.png"))
    return problems


def phone_problems(browser, url: str, out: Path, link: str) -> list[str]:
    """390 by 844: the plant keeps at least half of its box (the HUD is one line and a button, the bar a row); the lens and the truth switch are behind the button, which the keyboard presses; a panel is a
    sheet above the bars and inside the width of the screen."""
    problems: list[str] = []
    shots = out / "a11y"
    shots.mkdir(parents=True, exist_ok=True)
    width = PLANT_VIEWPORTS["390"][0]
    with open_link(browser, url, link, PLANT_VIEWPORTS["390"]) as (page, errors):
        wait_scene(page)
        page.evaluate(SCROLL_JS)
        settle(page, 3)
        problems += share_problems(page.evaluate(COVERED_JS))
        page.screenshot(path=str(shots / "a11y_default_390x844.png"))
        if page.query_selector("[data-sheet-toggle]") is None:
            return problems + ["the compact HUD has no button for its sheet"]
        if page.is_visible("[data-plant-hud=lens]") or page.is_visible("[data-truth-switch]"):
            problems.append("the lens and the truth switch are on the screen with the sheet closed")
        page.focus("[data-sheet-toggle]")
        page.keyboard.press("Enter")
        page.wait_for_selector("[data-sheet-toggle][aria-expanded=true]", timeout=5_000)
        shown = _rects(page, {"lens": "[data-plant-hud=lens]", "truth": "[data-plant-hud=truth]", "sheet": "#plant-sheet"})
        problems += [f"the {name} is not on the screen with the sheet open" for name in ("lens", "truth") if shown[name] is None or not (0 <= shown[name]["x"] and shown[name]["x"] + shown[name]["w"] <= width + 1)]
        problems += cover_problems({"lens": shown["lens"], "truth": shown["truth"]}, [("lens", "truth")], "390x844 sheet")
        page.screenshot(path=str(shots / "a11y_sheet_390x844.png"))
        page.keyboard.press("Enter")
        page.focus("[data-object-key='reactor:U10']")
        page.keyboard.press("Enter")
        page.wait_for_selector("[data-plant-panel=reactor]", timeout=10_000)
        settle(page, 3)
        r = _rects(page, {"panel": "[data-plant-panel]", **BARS})
        problems += cover_problems(r, [("panel", "time"), ("panel", "bar")], "390x844 with a panel open")
        if r["panel"] is not None and not inside(r["panel"], {"x": 0, "y": -2000, "w": width, "h": 4000}):
            problems.append("the panel runs past the width of the screen")
        page.screenshot(path=str(shots / "a11y_panel_390x844.png"))
        problems += [f"console: {e[:140]}" for e in errors]
    return problems


def contrast_problems_of(browser, url: str, link: str) -> list[str]:
    """The text of the plant's DOM (the cards, the chips, the bars, a panel, the form, the sheet) in light, dark and the system's dark, in both languages, at both viewports: no colour below AA."""
    cells: list[dict] = []
    for vp, size in PLANT_VIEWPORTS.items():
        for lang in LANGS:
            with open_link(browser, url, link, size) as (page, _):
                wait_scene(page)
                if vp == "390":
                    page.focus("[data-sheet-toggle]")
                    page.keyboard.press("Enter")
                else:
                    page.focus("[data-object-key='reactor:U10']")
                    page.keyboard.press("Enter")
                    page.wait_for_selector("[data-plant-panel=reactor]", timeout=10_000)
                    page.click("[data-action=add_feed]")
                    page.wait_for_selector(".plant-act", timeout=10_000)
                for label, theme, scheme in THEMES:
                    page.emulate_media(color_scheme=scheme)
                    apply_state(page, theme, lang)
                    settle(page, 2)
                    _, _, rows = contrast_rows(page.evaluate(CONTRAST_JS))
                    low = sorted((r for r in rows if r["ratio"] < r["need"]), key=lambda r: r["ratio"])
                    cells.append({"cell": f"{vp}/{lang}/{label}", "low": [f"{fmt_ratio(r['ratio'])} {r['sel']} '{r['text']}'" for r in low]})
    return contrast_problems(cells)
