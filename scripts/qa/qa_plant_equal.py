"""The checks `plant_equal` and `plant_prefix` of the headless QA of the plant (docs/design/plant_ui.md section 10, P6a).

`plant_equal`: for every fixture of tests/fixtures/plant/ the page, opened on the fixture's spec (the small default scenario, seed 1, the three halls) with the fixture's actions entered, at least one of them
through the bar and the rest through the address, shows on the plant host the truth hash and the digest of the cells of each hall that `plant_reference.json` holds for the fixture. The reference is made in Node by
engine/tests/support/plant_reference_cli.ts from the hand-written scenarios under the engine's flags (the QA runs it into qa_out/plant/); the page runs the same engine in Chromium, so the bytes are the same
(ADR-0019). The three actions of three_together entered through the address in the opposite order show the same hashes (the order of entry never reaches the scenario).

`plant_prefix`: for each plant action of the default plant the answer's `prefix_equal` is true and the events the floor shows before `at` (the marks, the draws, the visits that ended before it, the windows that
began before it) are those of the run without it; for each lab setting `truth_equal` is true and, but for the labelling that writes the instants of the labels into the log, the truth hash is the one before.

A check takes a browser and the URL of the served build and returns a Result; it never exits or prints. Every page it opens is closed.
"""
from __future__ import annotations

import json
from pathlib import Path

from qa_checks import Result, first_line
from qa_plant_act import AT, INIT, enter, the_eight
from qa_plant_act_browser import act_state, list_items, ready_of, undo, wait_epoch
from qa_plant_act_helpers import prefix_problems, reference_problems, small_link
from qa_plant_browser import open_plant, pause, plant_messages, seek, settle, wait_scene
from qa_plant_drill import open_link
from qa_plant_helpers import PLANT_VIEWPORTS, plan_from_messages


def one_fixture(browser, url, entry: dict, engine: str, problems: list[str]) -> None:
    """A fixture: the actions but the last through the address, the last through the bar, then the hashes on the host against the reference."""
    actions = entry["actions"]
    last = actions[-1]
    with open_link(browser, url, small_link(engine, actions[:-1])) as (page, errors):
        wait_scene(page)
        pause(page)
        seek(page, last["at"])
        settle(page)
        enter(page, last, last.get("sample_id"))
        wait_epoch(page, 2)
        s = act_state(page)
        problems += reference_problems(entry, s["runHash"], s["cellsHash"])
        if s["actions"] != str(len(actions)) or len(list_items(page)) != len(actions):
            problems.append(f"{entry['name']}: the page holds {s['actions']} actions and lists {len(list_items(page))}, the fixture has {len(actions)}")
        problems += [f"{entry['name']}: console: {e[:140]}" for e in errors]


def through_the_address(browser, url, entry: dict, engine: str, problems: list[str]) -> None:
    """All the actions through the address, in the opposite order of the fixture: the same hashes."""
    with open_link(browser, url, small_link(engine, list(reversed(entry["actions"])))) as (page, errors):
        wait_scene(page)
        s = act_state(page)
        problems += [f"{p} (the actions in the address in the opposite order)" for p in reference_problems(entry, s["runHash"], s["cellsHash"])]
        problems += [f"{entry['name']}: console: {e[:140]}" for e in errors]


def check_plant_equal(browser, url, out: Path, reference: Path) -> Result:
    problems: list[str] = []
    if not reference.exists():
        return Result("plant_equal", False, f"no {reference.name}: engine/tests/support/plant_reference_cli.ts did not write it", {"problems": ["no reference"]})
    ref = json.loads(reference.read_text(encoding="utf-8"))
    for entry in ref["fixtures"]:
        try:
            one_fixture(browser, url, entry, ref["engine_version"], problems)
            if entry["name"] == "three_together":
                through_the_address(browser, url, entry, ref["engine_version"], problems)
        except Exception as e:  # a page that crashed is a finding
            problems.append(f"{entry['name']}: {first_line(e)}")
    names = ", ".join(e["name"] for e in ref["fixtures"])
    detail = (f"the page equals plant_reference.json (made in Node by the hand-written scenarios, engine {ref['engine_version']}, node {ref['node']['version']}) for {len(ref['fixtures'])} fixtures ({names}): "
              "the last action of each through the bar, the others through the address; three_together also through the address in the opposite order")
    return Result("plant_equal", not problems, detail + (f" | {problems[0]}" if problems else ""), {"problems": problems})


def check_plant_prefix(browser, url, out: Path) -> Result:
    problems: list[str] = []
    seen: list[str] = []
    try:
        with open_plant(browser, url, PLANT_VIEWPORTS["1280"], init_script=INIT) as (page, errors, _):
            wait_scene(page)
            pause(page)
            base = plan_from_messages(plant_messages(page), 1)
            base_truth = act_state(page)["runHash"]
            seek(page, AT)
            settle(page)
            epoch = 1
            for action, row in the_eight(base):
                kind = action["kind"]
                enter(page, action, row)
                wait_epoch(page, epoch + 1)
                ready = ready_of(page, epoch + 1)
                after = plan_from_messages(plant_messages(page), epoch + 1)
                if kind in ("set_flag", "set_capture_path", "set_labelling"):
                    if ready["checks"]["truth_equal"] is not True:
                        problems.append(f"{kind}: truth_equal is {ready['checks']['truth_equal']}, expected true")
                    if kind != "set_labelling" and ready["hashes"]["truth"] != base_truth:
                        problems.append(f"{kind}: the truth hash changed with a lab setting")
                else:
                    if ready["checks"]["prefix_equal"] is not True:
                        problems.append(f"{kind}: prefix_equal is {ready['checks']['prefix_equal']}, expected true")
                    problems += [f"{kind}: {p}" for p in prefix_problems(base, after, action["at"])]
                    if ready["hashes"]["truth"] == base_truth:
                        problems.append(f"{kind}: the action left the truth hash as it was, so it changed nothing")
                seen.append(kind)
                undo(page)
                wait_epoch(page, epoch + 2)
                epoch += 2
            problems += [f"console: {e[:140]}" for e in errors]
    except Exception as e:  # a page that crashed is a finding
        problems.append(first_line(e))
    detail = (f"for {', '.join(seen)}: a plant action answers prefix_equal true and the floor before its instant (marks, draws, visits that ended, windows that began, calibrations) is that of the run without it; "
              "a lab setting answers truth_equal true and leaves the truth hash as it was (the labelling writes the instants of its labels into the log)")
    return Result("plant_prefix", not problems, detail + (f" | {problems[0]}" if problems else ""), {"problems": problems})
