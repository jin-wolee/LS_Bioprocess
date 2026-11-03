"""Pure helpers and typed expectations of the Break-out checks of scripts/qa/qa_lab.py (docs/design/lab_ui.md sections 12 and 20): the report of one case and seed typed by hand, and the comparison of
the page with it. Unit-tested in tests/test_qa_lab.py. This module never opens a browser; the checks are in qa_lab_breakout.py, the other helpers in qa_lab_helpers.py.
"""
from __future__ import annotations

from qa_lab_helpers import keys_deep

BREAKOUT_CASE = "sc12_medium_lot"
BREAKOUT_SEED = 9013  # the first seed of data/scenarios/experiments/sc12.json
BREAKOUT_ARCHS = ["a_manual", "b_lims_lite", "c_context", "c_context_minus_material_lot_links", "c_context_minus_equipment_links"]  # the defaults of the form: A, B, C and C without each link flag
LINK_FLAGS = ("material_lot_links", "equipment_links")  # the flags that decide what direction 3 can read (spec 11.8.2 rule S8)
# What the walk-back of the first signal returned per direction and kind, the results re-flagged by VR-022, and the figures behind each metric, for the case and seed above: typed by hand
# from the report of that case over that seed (engine/src/experiments/assembly/lab/breakout.ts builds the page result from buildBreakoutReport; the cells stand on the hand-typed fixtures FX12a,
# FX12e and FX12m of spec 11.8.4). A cell is (count, denominator), or None where the record cannot read direction 3. They are pins of the page against the report, not an oracle of the engine.
_ROWS_D1 = {"identification.direction_1.recall": (7, 7), "identification.direction_1.precision": (7, 7), "identification.direction_1.false_alarm": (0, 12)}
_ROWS_NONE = {f"identification.direction_3.{m}": None for m in ("recall", "precision", "false_alarm")}
_ROWS_EMPTY = {"identification.direction_3.recall": (0, 2), "identification.direction_3.precision": (0, 0), "identification.direction_3.false_alarm": (0, 444)}
_ROWS_SET = {"identification.direction_3.recall": (2, 2), "identification.direction_3.precision": (2, 54), "identification.direction_3.false_alarm": (52, 444)}
_D1_SET = {"batch": 1, "result": 6}
_D3_SET = {"material_lot": 3, "batch": 3, "result": 48}
BREAKOUT_EXPECTED = {
    "a_manual": {"d1": _D1_SET, "d3": None, "reflagged": 0, "cells": {**_ROWS_D1, **_ROWS_NONE, "released_before_containment": (6, 6), "retro_flag_completeness": (0, 6)}},
    "b_lims_lite": {"d1": _D1_SET, "d3": {}, "reflagged": 0, "cells": {**_ROWS_D1, **_ROWS_EMPTY, "released_before_containment": (6, 6), "retro_flag_completeness": (0, 6)}},
    "c_context": {"d1": _D1_SET, "d3": _D3_SET, "reflagged": 90, "cells": {**_ROWS_D1, **_ROWS_SET, "released_before_containment": (6, 6), "retro_flag_completeness": (6, 6)}},
    "c_context_minus_material_lot_links": {"d1": _D1_SET, "d3": {}, "reflagged": 6, "cells": {**_ROWS_D1, **_ROWS_EMPTY, "released_before_containment": (6, 6), "retro_flag_completeness": (6, 6)}},
    "c_context_minus_equipment_links": {"d1": _D1_SET, "d3": _D3_SET, "reflagged": 90, "cells": {**_ROWS_D1, **_ROWS_SET, "released_before_containment": (6, 6), "retro_flag_completeness": (6, 6)}},
}
# the plant of that case and seed as the observed table shows it: the first signal on U01 at hour 64 (the medium lot is consumed at hour 52; the lag of the event type is 12 h), and the three
# confirming draws (U01 and U02 at the first decision, U05 at its own, rule S2 as ruled on F8)
BREAKOUT_FIRST_SIGNAL = ("64", "signal_observed", "U01 · DO low")
BREAKOUT_CONFIRM_DRAWS = ["66", "66", "76"]
# keys that name the hidden script or the answer key; none may appear at any depth of the result
BREAKOUT_FORBIDDEN_KEYS = ["contamination_onset", "true_value", "true_state", "noise", "answer_key", "quirk", "key_text"]


def breakout_problems(found, expected=BREAKOUT_EXPECTED) -> list[str]:
    """The architectures of the Break-out result on the page against the typed table. `found` has one element per architecture: `id`, `reach` (readable or not_reachable), `d1`, `d3` (the sets as counts
    by kind; None when the page says not reachable), `reflagged`, `cells` (metric -> {status, kind, num, den}) and `flags` ("name:on|off"). Also the rules that need no table: direction 3 is not
    reachable exactly when both link flags are off, and a figure that is not reachable carries no count."""
    problems = []
    if [f["id"] for f in found] != list(expected):
        return [f"architectures {[f['id'] for f in found]}, expected {list(expected)}"]
    for f in found:
        want = expected[f["id"]]
        flags = dict(x.split(":") for x in f["flags"])
        unreachable = all(flags.get(name) == "off" for name in LINK_FLAGS)
        if (f["reach"] == "not_reachable") != unreachable:
            problems.append(f"{f['id']}: reach is {f['reach']} with the link flags {[flags.get(n) for n in LINK_FLAGS]}")
        if (f["d3"] is None) != (want["d3"] is None):
            problems.append(f"{f['id']}: direction 3 is {'not reachable' if f['d3'] is None else 'a set'}, the report says {'not reachable' if want['d3'] is None else 'a set'}")
        elif f["d3"] != want["d3"]:
            problems.append(f"{f['id']}: direction 3 returned {f['d3']}, the report says {want['d3']}")
        if f["d1"] != want["d1"]:
            problems.append(f"{f['id']}: direction 1 returned {f['d1']}, the report says {want['d1']}")
        if f["reflagged"] != want["reflagged"]:
            problems.append(f"{f['id']}: {f['reflagged']} results re-flagged, the report says {want['reflagged']}")
        for metric, cell in want["cells"].items():
            got = f["cells"].get(metric)
            if got is None:
                problems.append(f"{f['id']} {metric}: not on the page")
            elif cell is None:
                if got["status"] != "not_reachable" or got["num"] is not None or got["den"] is not None:
                    problems.append(f"{f['id']} {metric}: {got}, expected not reachable with no count")
            elif got["status"] == "not_reachable" or (got["num"], got["den"]) != tuple(str(x) for x in cell):
                problems.append(f"{f['id']} {metric}: {got['status']} {got['num']} of {got['den']}, the report says {cell[0]} of {cell[1]}")
        for metric, got in f["cells"].items():
            if got["status"] == "not_reachable" and (got["num"] is not None or got["den"] is not None):
                problems.append(f"{f['id']} {metric}: a figure that is not reachable carries a count")
        for d in (1, 3):  # recall, precision and the false-alarm rate of a direction are on the page together
            seen = [m for m in ("recall", "precision", "false_alarm") if f"identification.direction_{d}.{m}" in f["cells"]]
            if len(seen) != 3:
                problems.append(f"{f['id']}: direction {d} shows only {seen}")
    return problems


def observed_problems(rows) -> list[str]:
    """The observed table (time, event type, detail per row) against the typed plant: the first row is the first signal, and the confirming draws are at the typed hours."""
    if not rows:
        return ["no observed event on the page"]
    problems = []
    if tuple(rows[0]) != BREAKOUT_FIRST_SIGNAL:
        problems.append(f"the first observed event is {tuple(rows[0])}, expected {BREAKOUT_FIRST_SIGNAL}")
    draws = [r[0] for r in rows if r[1] == "confirm_sample_drawn"]
    if draws != BREAKOUT_CONFIRM_DRAWS:
        problems.append(f"confirming draws at {draws}, expected {BREAKOUT_CONFIRM_DRAWS}")
    times = [float(r[0]) for r in rows]
    if times != sorted(times):
        problems.append("the observed events are not in time order")
    return problems


def breakout_result_problems(result) -> list[str]:
    """What the breakout_result message may not carry: a key that names the hidden script or the answer key, at any depth (spec section 3, rule 2)."""
    return [f"key {k} in the breakout_result" for k in dict.fromkeys(keys_deep(result)) if k in BREAKOUT_FORBIDDEN_KEYS]
