"""The flags board in the check `plant_action` of the headless QA of the plant (docs/design/plant_ui.md sections 3.2 and 10, P6b). Given the default plant paused: the matrix of the board (the cell buttons of the
objects list) equals the matrix computed from the plan the page received; a `set_flag` entered from a cell by the keyboard opens the form on that hall and flag with the opposite state, and once the Worker has
answered the matrix equals the halls of the new plan; a second switch from a cell of the hall that the first one derived is accepted (the form names the record the run began with, and shows the hall by its
derived id); a click in the middle of the view of the camera brought to the panel opens the form on the cell the geometry puts there. Screenshots of the panel in the scene go to `act/`. A flow takes a browser and the
URL of the served build and appends its findings to `problems`; it never exits or prints.
"""
from __future__ import annotations

from pathlib import Path

from qa_lab_browser import set_lang
from qa_plant_act import AT, INIT
from qa_plant_act_browser import RUN_TIMEOUT, apply, wait_epoch
from qa_plant_act_helpers import flag_form_problems, matrix_problems
from qa_plant_browser import open_plant, pause, plant_messages, seek, settle, settle_camera, wait_scene
from qa_plant_helpers import PLANT_VIEWPORTS, plan_from_messages

CELLS_JS = "() => Object.fromEntries([...document.querySelectorAll('[data-flag-cell]')].map((e) => [e.dataset.flagCell, e.dataset.flagState]))"
FORM_JS = ("() => { const f = document.querySelector('[data-action-form=set_flag]'); const a = f.querySelector('[name=architecture]'); "
           "return {architecture: a.value, shown: a.selectedOptions[0].textContent.trim(), flag: f.querySelector('[name=flag]').value, on: f.querySelector('[name=on]').value}; }")
FLAGS_JS = "document.getElementById('main').dataset.flags.split(',')"
# The middle of the view, with the camera brought to the panel, meets the cell of the middle hall in the sixth row (the focus point is the middle of the cell columns, the camera looks at 1.3 m, the rows start 0.44 m
# under the top of the panel at 2.95 m and are 0.22 m high: 5.5 rows down, the middle of the sixth).
CENTRE_ROW, CENTRE_COL = 5, 1


def board(page, epoch: int, problems: list[str], tag: str) -> tuple[dict, list[str]]:
    """The matrix on the page against the one computed from the plan the page received for the epoch."""
    flags = page.evaluate(FLAGS_JS)
    plan = plan_from_messages(plant_messages(page), epoch)
    if plan is None:
        problems.append(f"{tag}: no plan of the epoch {epoch}")
        return {"layout": {"architectures": []}, "records": []}, flags
    problems += [f"{tag}: {p}" for p in matrix_problems(page.evaluate(CELLS_JS), plan, flags)]
    return plan, flags


def switch(page, hall: str, flag: str, base: str, epoch: int, problems: list[str], tag: str) -> None:
    """A cell by the keyboard: focus, Enter, the form on that hall and flag with the opposite state, Apply; the answer of the Worker is the next epoch."""
    cells = page.evaluate(CELLS_JS)
    page.focus(f"[data-flag-cell='{hall}:{flag}']")
    page.keyboard.press("Enter")
    page.wait_for_selector("[data-action-form=set_flag]", timeout=15_000)
    fields = page.evaluate(FORM_JS)
    if fields["shown"] != hall:
        problems.append(f"{tag}: the form shows the hall {fields['shown']}, the cell is in {hall}")
    problems += [f"{tag}: {p}" for p in flag_form_problems(fields, cells, hall, base)]
    apply(page)
    page.wait_for_function("(e) => document.querySelector('#plant').dataset.plantEpoch === String(e) || !!document.querySelector('[data-plant-refusal]')", arg=epoch, timeout=RUN_TIMEOUT)
    refused = page.evaluate("() => { const e = document.querySelector('[data-plant-refusal]'); return e ? e.innerText : null; }")
    if refused is not None:
        return problems.append(f"{tag}: the Worker refused the switch: {refused[:160]}")
    wait_epoch(page, epoch)


def by_click(page, out: Path, problems: list[str]) -> None:
    """The objects list brings the camera to the panel (the pictures, in both languages), and a click in the middle of the view opens the flag form on the cell the geometry puts there, with the opposite state."""
    page.click("[data-object-key='flags:board']")
    page.evaluate("window.scrollTo(0, 0)")
    (out / "act" / "flags_board_1280x720_en.png").write_bytes(settle_camera(page))
    set_lang(page, "ko")
    page.wait_for_timeout(200)
    page.screenshot(path=str(out / "act" / "flags_board_1280x720_ko.png"))
    set_lang(page, "en")
    flags = page.evaluate(FLAGS_JS)
    plan = plan_from_messages(plant_messages(page), int(page.get_attribute("#plant", "data-plant-epoch") or 0))
    box = page.locator("#plant canvas").bounding_box()
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    try:
        page.wait_for_selector("[data-action-form=set_flag]", timeout=15_000)
    except Exception:  # noqa: BLE001 - no form is the finding
        return problems.append("a click in the middle of the view on the flags board opened no flag form")
    fields = page.evaluate(FORM_JS)
    want = (plan["layout"]["architectures"][CENTRE_COL], flags[CENTRE_ROW]) if plan else (None, None)
    if (fields["shown"], fields["flag"]) != want:
        problems.append(f"the click in the middle of the view opened the form on {fields['shown']} / {fields['flag']}, the geometry puts the cell {want[0]} / {want[1]} there")
    base = "c_context" if fields["shown"].startswith("c_context") else fields["shown"]
    problems += [f"by click: {p}" for p in flag_form_problems(fields, page.evaluate(CELLS_JS), fields["shown"], base)]
    page.keyboard.press("Escape")


def flags_board(browser, url, out: Path, problems: list[str]) -> None:
    with open_plant(browser, url, PLANT_VIEWPORTS["1280"], init_script=INIT) as (page, errors, _):
        wait_scene(page)
        pause(page)
        seek(page, AT)
        settle(page)
        board(page, 1, problems, "the board at the start")
        # C's audit_trail from its cell: on in C, so the form switches it off; the third hall of the layout is then the one the Worker derived
        switch(page, "c_context", "audit_trail", "c_context", 2, problems, "first switch")
        plan, _ = board(page, 2, problems, "the board after the first switch")
        derived = (plan["layout"]["architectures"] + [""])[2]
        if derived == "c_context":
            problems.append("the first switch did not derive a hall: the third hall is still c_context")
        # a second switch from a cell of the derived hall: accepted, since the form names the record the run began with
        switch(page, derived, "two_clocks", "c_context", 3, problems, "second switch on the derived hall")
        board(page, 3, problems, "the board after the second switch")
        by_click(page, out, problems)
        problems += [f"flags board: console: {e[:140]}" for e in errors]
