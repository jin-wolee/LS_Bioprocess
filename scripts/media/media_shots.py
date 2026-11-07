"""The screenshots of the README media (R2), each at most 1280 by 720 in the light theme (a plant is cut to its own box), one page of a headless Chromium (software WebGL) for each: the plant floor with its record halls, the card table of the
guided scene, the Lineage view of one sample, Results with the hold-time share, and the plant of a Break-out case (a local build only). The first three are made in English and in Korean; the page is driven
by the controls a reader uses, and every figure on a screenshot is the lab's own on that visit (this file states no result).

The instants and the run are fixed: the default scenario, seed 1, 09:40 of day 8 for the plant; the scenario of the tour (the sample its lineage rule picks) for the table; the scenario `sc03_feed_in_gap`
with seed 1 and the rule's sample for Lineage, the records A and C; the default scenario with its 20 seeds for Results; the case `sc12_medium_lot` with seed 9013, the record C, at the instant of its last confirming result.
"""
from __future__ import annotations

from pathlib import Path

from media_clips import ACTION_AT
from qa_lab_browser import apply_state, go, open_lab, wait_run
from qa_plant_browser import pause, plant_messages, seek, settle, settle_camera, state, wait_scene, open_plant
from qa_plant_drill import open_link
from qa_plant_helpers import PLANT_VIEWPORTS, plan_from_messages
from qa_plant_sc12_helpers import case_href, instants_of
from qa_plant_tour_flow import landed_on, settle_on_target
from qa_plant_tour_helpers import STEP_IDS

SIZE = PLANT_VIEWPORTS["1280"]
CASE = "sc12_medium_lot"
LOT = "lot:ML-3"


def scroll_plant(page) -> None:
    """The scene fills the window, as a reader has it: the plant's box at the top of the page."""
    page.evaluate("document.querySelector('.plant-wrap').scrollIntoView({block: 'start'})")


def save(page, path: Path, plant: bool = False) -> None:
    """The picture of the window; of a plant, only its own box (the page goes on under it with the text of the screen, which is not part of the picture)."""
    if plant:
        box = page.locator(".plant-wrap").bounding_box()
        page.screenshot(path=str(path), clip={"x": 0, "y": box["y"], "width": SIZE[0], "height": min(box["height"], SIZE[1])})
    else:
        page.screenshot(path=str(path))


def plant_shot(browser, url: str, path: Path, lang: str) -> None:
    """The plant floor in the middle of a working day: the reactors running, the staff and tubes on the floor, the three record halls with cards on their shelves, the place card that names the floor as the
    simulation's own view."""
    with open_plant(browser, url, SIZE, "light", "light", lang, seen=True) as (page, errors, _):
        wait_scene(page)
        pause(page)
        seek(page, ACTION_AT)
        scroll_plant(page)
        page.evaluate("document.activeElement.blur()")
        for key in ("-", "-", "t"):  # a little further back and tilted down, so the halls and the floor are both in the picture
            page.keyboard.press(key)
            page.wait_for_timeout(120)
        settle(page, 3)
        page.wait_for_timeout(2200)
        settle_camera(page)
        save(page, path, plant=True)
        assert not errors, errors[:3]


def tour_table_shot(browser, url: str, path: Path, lang: str) -> None:
    """The fourth step of the guided scene: the three halls side by side and, in the box, the card of the sample in each of them, a slot stored or not and the time the context was joined by."""
    with open_plant(browser, url, SIZE, "light", "light", lang, seen=True) as (page, errors, _):
        wait_scene(page)
        page.click("[data-tour-start]")
        page.wait_for_selector("#plant[data-plant-tour]", timeout=90_000)
        for step_id in STEP_IDS[:4]:
            landed_on(page, step_id)
            if step_id != "records":
                page.click("[data-tour-next]")
        settle_on_target(page)
        page.wait_for_selector("[data-tour-table=cards] [data-tour-slot]", timeout=30_000)
        scroll_plant(page)
        page.wait_for_timeout(1500)
        settle_camera(page)
        save(page, path, plant=True)
        assert not errors, errors[:3]


def lineage_shot(browser, url: str, path: Path, lang: str) -> None:
    """The Lineage view of the sample the rule picks, for the records A and C side by side (the form's other choices are its defaults): the rows each record keeps for it and, under them, the three questions
    answered from the record and judged against the truth. The view is scrolled so that the answers of both records end the picture."""
    with open_lab(browser, url, SIZE, "light") as (page, errors, _):
        page.wait_for_selector("#main[data-ready=true]", timeout=60_000)
        apply_state(page, "light", lang)
        go(page, "lineage")
        page.wait_for_selector("#lineage-show:not([disabled])", timeout=30_000)
        page.set_checked("#lineage-arch-b_lims_lite", False)
        page.click("#lineage-show")
        page.wait_for_selector("#lineage-view", timeout=60_000)
        page.evaluate("() => { const a = document.querySelectorAll('#lineage-view .lg-answer'); const last = a[a.length - 1]; window.scrollTo(0, last.getBoundingClientRect().bottom + window.scrollY - 720 + 80); }")
        page.wait_for_timeout(400)
        save(page, path)
        assert not errors, errors[:3]


def results_shot(browser, url: str, path: Path) -> None:
    """Results of the default run of Setup (the default scenario, its 20 seeds, A, B and C), scrolled to the block of the record C where the hold-time rule's share of the result starts."""
    with open_lab(browser, url, SIZE, "light") as (page, errors, _):
        page.wait_for_selector("#main[data-ready=true]", timeout=60_000)
        apply_state(page, "light", "en")
        go(page, "setup")
        page.wait_for_selector("#run:not([disabled])", timeout=30_000)
        page.click("#run")
        wait_run(page)
        page.wait_for_selector("[data-result][data-report]", timeout=10_000)
        page.evaluate("() => { const h = document.querySelector('section.arch[data-architecture=c_context] [data-hold-limit]'); window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 100); }")
        page.wait_for_timeout(400)
        save(page, path)
        assert not errors, errors[:3]


def breakout_shot(browser, url: str, path: Path) -> None:
    """The plant of a Break-out case (the lot rack, the crates, the tape of the record C on the lot that was quarantined) at the instant of its last confirming result, the camera on the crate of ML-3 with its
    panel open. The truth overlay is off, as it is on every entry."""
    with open_link(browser, url, case_href(CASE), color_scheme="light") as (page, errors):
        wait_scene(page, halls=5)
        plan = plan_from_messages(plant_messages(page), int(state(page)["epoch"]))
        pause(page)
        page.click("[data-lens-option=c_context]")
        seek(page, instants_of(plan)["results"])
        scroll_plant(page)
        page.click(f"#plant-objects [data-object-key='{LOT}']")
        page.wait_for_selector("[data-plant-panel]", timeout=10_000)
        scroll_plant(page)
        page.wait_for_timeout(2500)
        settle_camera(page)
        save(page, path, plant=True)
        assert not errors, errors[:3]
