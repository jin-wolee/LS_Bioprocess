"""The panels and the drill-down of the check `sc12` on the plant (docs/design/plant_ui.md section 10, P7c): in a break-out case the panel of a lot, of an equipment item, of a confirming sample and of a reactor
open from the objects list by the keyboard and from a click in the scene on a crate, the numbers in them equal what the check computes from the plan the page received at the clock instant, and the link in each
lands on the Break-out screen with the case and the seed of the scene's case, asks `breakout` once with the case, the seed and the five records, and the way back lands on the same case at the same instant with
no second `plant_run`. A step takes the page and the list of problems; it never exits or prints.
"""
from __future__ import annotations

from qa_plant_browser import pause, plant_messages, settle, settle_camera, state, wait_scene
from qa_plant_drill import open_link
from qa_plant_panels import IN_PANEL_JS, close_by_keyboard, open_by_keyboard
from qa_plant_helpers import PLANT_VIEWPORTS, plan_from_messages
from qa_plant_sc12_helpers import ARCHS, SEED, back_problems, breakout_request_problems, case_href, tape_of

# The words the panel says for a tape (typed from the dictionary) and for the outcome of a test that has not been reported.
TAPE_WORDS = {None: "none", "held": "held, one band", "quarantined": "quarantined, two bands"}
CRATE_CLICK_BELOW_PX = 16


def hall_holds(plan, lens: str) -> list:
    return next((r.get("holds", []) for r in plan["records"] if r["architecture"] == lens), [])


def used_problems(page, plan, kind: str, index: int, t: int, lens: str, tag: str) -> list[str]:
    """The panel of a lot or of an equipment item: the uses so far, and the tape of the lens record, as the plan gives them at `t`."""
    entry = plan["lots" if kind == "lot" else "equipment"][index]
    problems = []
    want = sum(1 for u in entry["uses"] if u["t"] <= t)
    got = page.inner_text(f"[data-plant-panel={kind}] [data-panel-field=used]").strip()
    if got != str(want):
        problems.append(f"{tag}: the panel says {got} uses so far, the plan gives {want} at {t} s")
    tape = page.inner_text(f"[data-plant-panel={kind}] [data-panel-field=tape]").strip()
    if tape != TAPE_WORDS[tape_of(hall_holds(plan, lens), kind, index, t)]:
        problems.append(f"{tag}: the panel says the tape is '{tape}', the lens record gives '{TAPE_WORDS[tape_of(hall_holds(plan, lens), kind, index, t)]}' at {t} s")
    return problems


def confirm_problems(page, plan, sample: int, t: int, tag: str) -> list[str]:
    """The panel of a confirming sample: one row for each test, and an outcome only where the lab had reported by `t`."""
    tests = [c for c in plan.get("confirms", []) if c["sample"] == sample]
    want = [c["outcome"] if c["result_s"] <= t else "pending" for c in tests]
    got = page.eval_on_selector_all("[data-plant-panel=confirm] [data-panel-list=tests] li", "els => els.map((e) => e.dataset.testOutcome)")
    return [] if got == want else [f"{tag}: the panel lists the outcomes {got}, the plan gives {want} at {t} s"]


def breakout_link(page, panel: str, case: str, problems: list[str], tag: str) -> str | None:
    """The link of a panel to the Break-out screen: it is there, it is one of the plant, and the panel has no link to Lineage or Results (a case is not a Setup scenario)."""
    href = page.get_attribute(f"[data-plant-panel={panel}] a[data-drill=breakout]", "href")
    if href is None or not href.startswith("#/breakout?from=plant&plant="):
        problems.append(f"{tag}: the panel has no link to Break-out ({href})")
    for other in ("lineage", "results"):
        if page.query_selector(f"[data-plant-panel={panel}] a[data-drill={other}]"):
            problems.append(f"{tag}: the panel of a case has a link to {other}")
    return href


def click_crate(page, id_: str, key: str, problems: list[str], lang: str) -> None:
    """A click in the scene on a crate: the camera is brought to it by its button (and the panel closed again), the camera settles, and a click a little below its label, which stands over the crate, picks it."""
    button = f"[data-object-key='{key}']"
    page.focus(button)
    page.keyboard.press("Enter")
    page.wait_for_selector("[data-plant-panel]", timeout=10_000)
    page.wait_for_function(IN_PANEL_JS, timeout=5_000)  # the panel listens for Escape from the moment it has the focus
    page.keyboard.press("Escape")
    page.wait_for_selector("[data-plant-panel]", state="detached", timeout=5_000)
    page.wait_for_timeout(300)
    page.evaluate("document.querySelector('.plant-wrap').scrollIntoView({block: 'start'})")
    settle_camera(page)
    box = page.locator(f".plant-label-crate:text-is('{id_}')").bounding_box()
    if box is None:
        problems.append(f"{lang} {key}: the crate has no label on the screen")
        return
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] + CRATE_CLICK_BELOW_PX)
    page.wait_for_timeout(400)
    got = page.get_attribute("#plant", "data-plant-pick")
    if got != key:
        problems.append(f"{lang} {key}: a click on the crate picked {got}")
    page.keyboard.press("Escape")


def drill_to_breakout(page, case: str, plan, t: int, problems: list[str], tag: str, actions: int = 0) -> None:
    """From the panel that is open: the link lands on the Break-out screen on this case and seed, which asks `breakout` once; the bar names the case and the way back holds the instant; Back lands on the same
    case and instant with no second `plant_run`."""
    runs = len([m for m in page.evaluate("window.__plantSent") if m["type"] == "plant_run"])
    page.click("[data-plant-panel] a[data-drill=breakout]")
    page.wait_for_selector("#main[data-screen=breakout]", timeout=10_000)
    try:
        page.wait_for_selector(f"#breakout-result[data-case={case}][data-seed='{SEED}']", timeout=120_000)
    except Exception:  # noqa: BLE001 - what the screen shows instead is the finding
        problems.append(f"{tag}: the Break-out screen shows {page.get_attribute('#breakout-result', 'data-case')} at seed {page.get_attribute('#breakout-result', 'data-seed')}, expected {case} at {SEED}")
        return
    problems += [f"{tag}: {p}" for p in breakout_request_problems(page.evaluate("window.__plantSent"), case, actions)]
    if page.input_value("#breakout-case") != case or page.input_value("#breakout-seed") != str(SEED):
        problems.append(f"{tag}: the form of the screen shows {page.input_value('#breakout-case')} at {page.input_value('#breakout-seed')}")
    if case not in (page.text_content("[data-plant-origin]") or ""):
        problems.append(f"{tag}: the bar of the screen does not name the case")
    problems += [f"{tag}: {p}" for p in back_problems(page.get_attribute("#back-to-plant", "href"), case, t)]
    page.click("#back-to-plant")
    page.wait_for_selector("#main[data-screen=plant]", timeout=10_000)
    page.wait_for_selector("#plant[data-plant-scene=ready]", timeout=90_000)
    settle(page, 4)
    if page.get_attribute("#plant", "data-plant-case") != case:
        problems.append(f"{tag}: Back to the plant landed on the case {page.get_attribute('#plant', 'data-plant-case')}")
    if abs(int(state(page)["t"]) - t) > 60:
        problems.append(f"{tag}: Back to the plant landed at {state(page)['t']} s, the reader left at {t} s")
    if len([m for m in page.evaluate("window.__plantSent") if m["type"] == "plant_run"]) != runs:
        problems.append(f"{tag}: a plant_run was sent when the reader came back")


def panels_of_a_case(page, plan, case: str, lens: str, problems: list[str], lang: str = "en") -> int:
    """The four panels at the end of the run, by the keyboard, and the click on a crate; ends with the drill-down from the last one (a confirming sample). Returns the instant of the clock."""
    t = int(state(page)["t"])
    lot = next((i for i, x in enumerate(plan["lots"]) if x["uses"]), 0)
    jobs = [("lot", f"lot:{plan['lots'][lot]['id']}", lot)]
    if plan.get("equipment"):
        jobs.append(("equipment", f"equipment:{plan['equipment'][0]['id']}", 0))
    unit = next(m["unit"] for m in plan["marks"] if m["kind"] == "signal_observed")
    jobs.append(("reactor", f"reactor:{plan['units'][unit]['id']}", unit))
    sample = next(i for i, s in enumerate(plan["samples"]) if s["kind"] == "confirm" and not s["skipped"])
    jobs.append(("confirm", f"confirm:{plan['samples'][sample]['id']}", sample))
    for kind, key, index in jobs:
        button = f"[data-object-key='{key}']"
        if not open_by_keyboard(page, button, kind, key, problems, lang):
            continue
        tag = f"{lang} {key}"
        if kind in ("lot", "equipment"):
            problems += used_problems(page, plan, kind, index, t, lens, tag)
        elif kind == "confirm":
            problems += confirm_problems(page, plan, index, t, tag)
        else:
            if page.query_selector("[data-plant-panel=reactor] [data-panel-list=signals], [data-plant-panel=reactor] [data-note=signals]") is None:
                problems.append(f"{tag}: the panel of a reactor in a case does not list its signals")
        breakout_link(page, kind, case, problems, tag)
        if kind == "confirm":
            return t  # the panel stays open: the drill-down is from it
        close_by_keyboard(page, button, key, problems, lang)
    return t


# A feed on U03 at day 3 09:00, inside its culture, which a reader could have entered: a case takes the actions of the bar as any plant does (set_capture_path is not offered in a case).
FEED = [{"kind": "add_feed", "at": 3 * 86400 + 9 * 3600, "unit_id": "U03"}]


def with_an_action(browser, url: str, case: str, engine: str, init_script: str, problems: list[str]) -> None:
    """A case opened with an action in its link: the host counts it, the list says it in words, the bar offers no capture path, the answer's causality check is the Worker's (null on a first answer), and the
    Break-out screen opened from the plant asks `breakout` once with that action (the plant's run, as the Lineage screen asks for it)."""
    tag = f"{case} with a feed"
    with open_link(browser, url, case_href(case, engine, actions=FEED), PLANT_VIEWPORTS["1280"], init_script) as (page, errors):
        wait_scene(page, halls=len(ARCHS))
        pause(page)
        if page.get_attribute("#plant", "data-plant-actions") != "1" or len(page.query_selector_all("[data-act-list] li")) != 1:
            problems.append(f"{tag}: the page does not hold and list the one action of the link")
        if page.query_selector("[data-action=set_capture_path]") is not None:
            problems.append(f"{tag}: the bar offers the capture path, which the Worker refuses in a case")
        if page.query_selector("[data-link-note]") is not None:
            problems.append(f"{tag}: the link was read with changes")
        plan = plan_from_messages(plant_messages(page), int(state(page)["epoch"]))
        lot = plan["lots"][0]["id"]
        page.focus(f"[data-object-key='lot:{lot}']")
        page.keyboard.press("Enter")
        page.wait_for_selector("[data-plant-panel=lot]", timeout=10_000)
        drill_to_breakout(page, case, plan, int(state(page)["t"]), problems, tag, actions=1)
        problems += [f"{tag}: console: {e[:140]}" for e in errors]


def crate_and_drill(page, plan, case: str, lens: str, problems: list[str]) -> None:
    """The click on a crate in the scene opens the lot's panel, and the drill-down from the panel of a confirming sample lands on Break-out."""
    lot = plan["lots"][next((i for i, x in enumerate(plan["lots"]) if x["uses"]), 0)]["id"]
    click_crate(page, lot, f"lot:{lot}", problems, "en")
    t = panels_of_a_case(page, plan, case, lens, problems)
    drill_to_breakout(page, case, plan, t, problems, f"{case} drill-down")
