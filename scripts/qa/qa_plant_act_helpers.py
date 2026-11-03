"""Pure helpers of the checks `plant_action`, `plant_equal` and `plant_prefix` of the headless QA of the plant (docs/design/plant_ui.md section 10, P6a): the fields a form is filled with for an action,
the link of the small default scenario, the judgement of the round trip, the floor before an instant, an entry of `plant_reference.json` against the host, and a refusal block against its reason and its
language. No browser here, so pytest runs them (tests/test_qa_plant_act.py); the checks that drive the page are in qa_plant_act.py.
"""
from __future__ import annotations

import json
import statistics
from urllib.parse import quote

DAY_S = 86400
# The small default scenario the hand fixtures are written over (tests/fixtures/plant/): six reactors in one bay for eight days, seed 1, under the three presets. In the order the page writes the settings.
SMALL_SETTINGS = {"bay_size": 6, "cohort_size": 6, "horizon_days": 8, "production_days": 6, "reactor_count": 6}
HALLS = "a_manual,b_lims_lite,c_context"
# The action round trip (docs/design/plant_ui.md section 8 and section 12, item 3): median and slowest of five at most these, in milliseconds.
ROUND_TRIP_MEDIAN_MS = 600
ROUND_TRIP_MAX_MS = 1000

# One sentence of each refusal, in each language, as a part of the text that the dictionary gives (src/i18n/en_act.ts and ko_act.ts); typed here by hand.
SENTENCES = {
    "en": {
        "past": "The past is not rewritten", "unknown_target": "no such unit", "outside_window": "outside the window the rule allows", "closed_loop": "would close the loop",
        "limit": "A limit of the run", "locked": "A challenge is open on this run", "other": "did not accept the action",
    },
    "ko": {
        "past": "과거는 고쳐 쓰지 않습니다", "unknown_target": "없는 대상을 가리킵니다", "outside_window": "규칙이 허용하는 구간 밖", "closed_loop": "루프를 닫습니다",
        "limit": "실행의 한도입니다", "locked": "이 실행에 챌린지가 열려 있어서", "other": "받아들이지 않았습니다",
    },
}


def time_of(t: int) -> str:
    """The time of day of an instant of the run, `HH:MM`."""
    s = t % DAY_S
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}"


def clock_text(t: int) -> str:
    """The clock reading of the HUD: `day 8 09:00`."""
    return f"day {t // DAY_S} {time_of(t)}"


def fields_of(action: dict) -> dict[str, str]:
    """What the form of an action is filled with, by the `name` of its controls. A move picks its row by the sample (a button of the board) and sets the time of day."""
    kind = action["kind"]
    if kind in ("add_feed", "raise_alarm"):
        return {"unit": action["unit_id"]}
    if kind == "move_draw":
        return {"time": time_of(action["to"])}
    if kind == "analyzer_down":
        return {"analyzer": action["analyzer"], "day": str(action["from"] // DAY_S), "time": time_of(action["from"]), "length": str(action["length_min"])}
    if kind == "change_lot":
        return {"analyzer": action["analyzer"], "day": str(action["effective"] // DAY_S), "time": time_of(action["effective"])}
    if kind == "set_flag":
        return {"architecture": action["architecture"], "flag": action["flag"], "on": "true" if action["on"] else "false"}
    if kind == "set_capture_path":
        return {"path": action["path"]}
    if kind == "set_labelling":
        return {"method": action["method"]}
    raise ValueError(f"no form for {kind}")


def small_link(engine: str, actions) -> str:
    """The plant link of the small default scenario with a list of actions (the JSON of the list, percent-encoded), as the page writes it."""
    settings = "&".join(f"set.{name}={value}" for name, value in sorted(SMALL_SETTINGS.items()))
    carried = f"&actions={quote(json.dumps(actions, separators=(',', ':')), safe='')}" if actions else ""
    return f"#/plant?scenario=default&{settings}&arch={HALLS}&seed=1{carried}&schema=1&engine={engine}"


def round_trip_missing(samples_ms) -> list[str]:
    """No round trip was timed: a defect of the run, not a time (it fails in every timing mode)."""
    return [] if samples_ms else ["no round trip was measured"]


def round_trip_over(samples_ms) -> list[str]:
    """The round trips of five accepted actions against the budget: the median at most 600 ms and the slowest (the 95th percentile of five) at most 1 s."""
    if not samples_ms:
        return []
    problems = []
    median = statistics.median(samples_ms)
    if median > ROUND_TRIP_MEDIAN_MS:
        problems.append(f"the median round trip is {median:.0f} ms, over the {ROUND_TRIP_MEDIAN_MS} ms limit")
    if max(samples_ms) > ROUND_TRIP_MAX_MS:
        problems.append(f"the slowest round trip is {max(samples_ms):.0f} ms, over the {ROUND_TRIP_MAX_MS} ms limit")
    return problems


def round_trip_problems(samples_ms) -> list[str]:
    return round_trip_missing(samples_ms) or round_trip_over(samples_ms)


def prefix_problems(before: dict, after: dict, at: int) -> list[str]:
    """What the floor shows before the instant of an action, in the plan before it and in the plan after it: the marks, the draws, the visits that ended before it, the windows that began before it and the
    calibrations before it must be the same (the causality rule of section 5.3; a plant action changes the future of `at` only)."""
    draw_keys = ("id", "unit", "operator", "planned_s", "drawn_s", "arrived_s", "skipped", "label")

    def marks(p):
        return [m for m in p["marks"] if m["t"] < at]

    def draws(p):
        return [{k: s.get(k) for k in draw_keys} for s in p["samples"] if s["drawn_s"] is not None and s["drawn_s"] < at]

    def visits(p):
        return [(s["id"], v) for s in p["samples"] for v in s["visits"] if v["ended_s"] < at]

    def windows(p):
        return [w for w in p["windows"] if w["from_s"] < at]

    def calibrations(p):
        return [c for c in p["calibrations"] if c["t"] < at]

    problems = []
    for what, part in (("marks before", marks), ("draws before", draws), ("visits that ended before", visits), ("windows that began before", windows), ("calibrations before", calibrations)):
        if part(before) != part(after):
            problems.append(f"the {what} {at} s differ")
    return problems


def reference_problems(entry: dict, run_hash: str | None, cells_json: str | None) -> list[str]:
    """The hashes on the plant host against an entry of plant_reference.json: the truth hash, and the digest of the cells of each hall (the halls are the ones the entry names)."""
    name = entry["name"]
    if not run_hash:
        return [f"{name}: the host shows no truth hash"]
    problems = []
    if run_hash != entry["truth"]:
        problems.append(f"{name}: the truth hash on the page is {run_hash}, the reference has {entry['truth']}")
    try:
        cells = json.loads(cells_json or "{}")
    except ValueError:
        return problems + [f"{name}: the cells digests on the host are not JSON"]
    if sorted(cells) != sorted(entry["cells"]):
        return problems + [f"{name}: the page shows the halls {sorted(cells)}, the reference has {sorted(entry['cells'])}"]
    problems += [f"{name}: the cells digest of {hall} on the page is {cells[hall]}, the reference has {digest}" for hall, digest in sorted(entry["cells"].items()) if cells[hall] != digest]
    return problems


def refusal_problems(block: dict, reason: str, lang: str) -> list[str]:
    """A refusal block of the page (`data-plant-refusal` and its text and the Worker's message) against the reason it must name and the sentence the dictionary gives in the language of the page."""
    problems = []
    if block["reason"] != reason:
        return [f"the refusal says {block['reason']}, expected {reason}"]
    expected = SENTENCES[lang][reason]
    if expected not in block["text"]:
        problems.append(f"the refusal has no sentence of the reason {reason} in {lang} (expected '{expected}')")
    if not block["message"]:
        problems.append("the refusal shows no message of the Worker")
    return problems


# ---- the flags board (P6b, docs/design/plant_ui.md section 3.2) -----------------------------------------------------------------------------------------------------------------------------------


def expected_matrix(plan: dict, flags: list[str]) -> dict[str, str]:
    """The state of every cell of the flags board, from the plan alone: for each hall of the layout (a derived hall by its derived id) and each flag, `on` or `off` as that hall's own record has it, and
    `pending` while the record of the hall has not arrived. Keyed `<hall>:<flag>`, as the cell buttons of the objects list are."""
    states = {}
    for hall in plan["layout"]["architectures"]:
        record = next((r for r in plan["records"] if r["architecture"] == hall), None)
        for flag in flags:
            states[f"{hall}:{flag}"] = "pending" if record is None else ("on" if flag in record["flags_on"] else "off")
    return states


def matrix_problems(cells: dict[str, str], plan: dict, flags: list[str]) -> list[str]:
    """The cells the page shows (`data-flag-cell` and `data-flag-state`) against the matrix of the plan it received: no cell missing, none extra, every state the same."""
    want = expected_matrix(plan, flags)
    problems = [f"the board has no cell {k}" for k in sorted(set(want) - set(cells))]
    problems += [f"the board has a cell {k} that the plan's halls do not have" for k in sorted(set(cells) - set(want))]
    problems += [f"the cell {k} reads {cells[k]}, the plan's hall has it {want[k]}" for k in sorted(set(want) & set(cells)) if cells[k] != want[k]]
    return problems


def flag_form_problems(fields: dict, cells: dict[str, str], shown: str, base: str) -> list[str]:
    """The flag form a cell opened: it names the record the run began with (`base`, not the derived id the hall is shown by), the flag of the cell, and the opposite of the state the cell reads."""
    key = f"{shown}:{fields['flag']}"
    if key not in cells:
        return [f"the board has no cell {key} for the form to be opened from"]
    problems = []
    if fields["architecture"] != base:
        problems.append(f"the form names the hall {fields['architecture']}, expected the record the run began with: {base}")
    opposite = "false" if cells[key] == "on" else "true"
    if fields["on"] != opposite:
        problems.append(f"the form switches {fields['flag']} in {shown} to {fields['on']}, the cell is {cells[key]} so the opposite is {opposite}")
    return problems
