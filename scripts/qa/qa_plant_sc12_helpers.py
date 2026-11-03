"""Pure helpers and typed expectations of the check `sc12` on the plant (docs/design/plant_ui.md section 10, P7c): the five cases, what the scene must show of a case at an instant by the rules of
section 3.2 (computed here from the plan the page received, never read from the page), the objects of a case, the origin and the units reached that each scenario names (typed by hand from the scenario
files and the break-out tests of the engine), and the comparison of the hashes on the host. No browser here, so pytest runs them (tests/test_qa_plant_sc12.py); the checks that drive the page are in
qa_plant_sc12.py and qa_plant_sc12_public.py.
"""
from __future__ import annotations

import json
import re
from urllib.parse import quote

# The five bundled break-out cases, the first seed of the SC12 config and the five records of the Break-out form: A, B, C and C without each link flag (the order of the form).
CASES = ["sc12_medium_lot", "sc12_seed_lot", "sc12_sampling", "sc12_equipment", "sc12_mycoplasma"]
SEED = 9013
ARCHS = ["a_manual", "b_lims_lite", "c_context", "c_context_minus_material_lot_links", "c_context_minus_equipment_links"]
HALLS_ARG = ",".join(ARCHS)
# How long a link stands after its addition or use: the view constant LOOK.link_s of src/plant/scene_look.ts (a stretch of simulated seconds, not a domain number).
LINK_S = 1200
# The scene's label of the truth overlay, in both languages (typed from the dictionaries).
LABEL = {"en": "Simulation's own view, not available to any record", "ko": "시뮬레이션 자체의 시점이며 어떤 기록에도 없는 정보"}
# What each scenario names as the origin of the event and which units it reached by the end of the run, typed by hand from data/scenarios/sc12_*.json and engine/tests/lab/worker_case.test.ts: the id the overlay
# marks (a lot, an equipment item, or the vessel of a sampling origin) and the units reached.
EXPECTED_EVENT = {
    "sc12_medium_lot": {"origin": "ML-3", "reached": ["U01", "U05"]},
    "sc12_seed_lot": {"origin": "SL-A", "reached": ["U01", "U02", "U03"]},
    "sc12_sampling": {"origin": "U01", "reached": ["U01"]},
    "sc12_equipment": {"origin": "TL-1", "reached": ["U01", "U02"]},
    "sc12_mycoplasma": {"origin": "ML-3", "reached": ["U01", "U05"]},
}


def case_href(case: str, engine: str | None = None, t: int | None = None, actions: list | None = None) -> str:
    """The plant link of a case as the Break-out screen makes it: the key order of plant_ui.md section 7 (`actions` is the JSON of the list, percent-encoded)."""
    carried = f"&actions={quote(json.dumps(actions, separators=(',', ':')), safe='')}" if actions else ""
    return f"#/plant?case={case}&arch={HALLS_ARG}&seed={SEED}" + carried + (f"&t={t}" if t is not None else "") + "&schema=1" + (f"&engine={engine}" if engine else "")


# ---- what the plan holds --------------------------------------------------------------------------------------------


def confirm_slots(plan) -> dict[int, int]:
    """The slot of each confirming sample that has a tube (section 3.2): its rank among the confirming samples that were not skipped, in the order of the plan, while the shelf has a slot (two for each vessel)."""
    room = 2 * len(plan["units"])
    slots: dict[int, int] = {}
    for i, s in enumerate(plan["samples"]):
        if s["kind"] == "confirm" and not s["skipped"] and s["drawn_s"] is not None and len(slots) < room:
            slots[i] = len(slots)
    return slots


def expected_objects(plan) -> dict:
    """The objects a case must show, by kind: the reactors, analyzers, staff, halls, boards and flags board that any plan has, and the lots, the equipment items and the confirming tubes of a case."""
    return {"reactor": len(plan["units"]), "analyzer": len(plan["analyzers"]), "staff": len(plan["staff"]), "hall": len(plan["layout"]["architectures"]), "board": len(plan["layout"]["bays"]), "flags": 1,
            "lot": len(plan.get("lots", [])), "equipment": len(plan.get("equipment", [])), "confirm": len(confirm_slots(plan))}


def tape_of(holds, on: str, target: int, t: int):
    """The tape the holds put on a thing at `t` (section 3.2): a placed hold is held, a quarantine makes it quarantined, a release takes it off; nothing else is tape."""
    state = None
    for h in holds:
        if h["t"] > t:
            break
        if h["on"] != on or h["target"] != target:
            continue
        state = {"hold_placed": "held", "hold_quarantined": "quarantined", "hold_released": None}.get(h["event"], state)
    return state


def items_expected(plan, t: int, lens: str) -> dict:
    """What `data-plant-items` must say at `t` for the hall the lens reads, by the rules of section 3.2: the links standing, the confirming tubes on the shelf, the stamps, and the tapes by state and kind."""
    uses = [u for x in [*plan.get("lots", []), *plan.get("equipment", [])] for u in x["uses"]]
    slots = confirm_slots(plan)
    shown = {i for i in slots if plan["samples"][i]["drawn_s"] <= t}
    holds = next((r.get("holds", []) for r in plan["records"] if r["architecture"] == lens), [])
    out = {"links": sum(1 for u in uses if 0 <= t - u["t"] < LINK_S), "shelf": len(shown), "stamps": sum(1 for c in plan.get("confirms", []) if c["sample"] in shown and c["result_s"] <= t),
           "held": {}, "quarantined": {}}
    for kind, plural, count in (("lot", "lots", len(plan.get("lots", []))), ("equipment", "equipment", len(plan.get("equipment", []))), ("unit", "units", len(plan["units"]))):
        states = [tape_of(holds, kind, i, t) for i in range(count)]
        out["held"][kind] = states.count("held")
        out["quarantined"][kind] = states.count("quarantined")
    return out


def items_problems(attr, plan, t: int, lens: str) -> list[str]:
    """`data-plant-items`, which the scene wrote from `itemsAt`, against what the rules of section 3.2 give for the plan the page received."""
    try:
        got = json.loads(attr)
    except (TypeError, ValueError):
        return [f"data-plant-items is not JSON: {str(attr)[:40]}"]
    want = items_expected(plan, t, lens)
    return [] if got == want else [f"lens {lens} at {t} s: data-plant-items says {got}, the plan gives {want}"]


def instants_of(plan) -> dict[str, int]:
    """Four instants of a case: just before its first use of anything, the first addition of a lot to a vessel (links stand), the first signal, and the last reported result (every stamp is there)."""
    uses = sorted(u["t"] for x in [*plan.get("lots", []), *plan.get("equipment", [])] for u in x["uses"])
    additions = sorted(m["t"] for m in plan["marks"] if m["kind"] == "medium_addition")
    signals = sorted(m["t"] for m in plan["marks"] if m["kind"] == "signal_observed")
    results = sorted(c["result_s"] for c in plan.get("confirms", []))
    return {"before": uses[0] - 1, "addition": additions[0], "signal": signals[0], "results": results[-1]}


# ---- the host and the Worker's answer ---------------------------------------------------------------------------------


def objects_problems(built, listed, plan) -> list[str]:
    """The objects the scene built (`data-plant-objects`) and the objects the list holds, by kind, against the plan: lots, equipment items and confirming tubes for a case, the others as for any plan."""
    want = expected_objects(plan)
    problems = []
    for kind, n in want.items():
        if built.get(kind) != n:
            problems.append(f"the scene built {built.get(kind)} {kind} objects, the plan has {n}")
        if (listed.get(kind) or 0) != n:
            problems.append(f"the objects list holds {listed.get(kind) or 0} {kind} entries, the plan has {n}")
    problems += [f"the scene built {kind} objects, which the plan does not have" for kind in built if kind not in want]
    return problems


def hashes_of_messages(messages, epoch: int) -> tuple[str | None, dict[str, str]]:
    """The truth hash and the digest of each hall as the Worker sent them for an epoch: the `plant_ready` and the `plant_halls` messages as the wrapper recorded them."""
    ready = next((m["data"] for m in messages if m["data"]["type"] == "plant_ready" and m["data"]["epoch"] == epoch), None)
    if ready is None:
        return None, {}
    cells = dict(ready["hashes"]["cells"])
    for m in messages:
        if m["data"]["type"] == "plant_halls" and m["data"]["epoch"] == epoch:
            cells.update(m["data"]["cells"])
    return ready["hashes"]["truth"], cells


def hash_problems(run_hash, cells_hash, truth: str | None, cells: dict[str, str], source: str) -> list[str]:
    """The truth hash and the digest of each hall on the host against the ones the `source` holds (the Node reference, or the Worker's own messages)."""
    problems = []
    if run_hash != truth:
        problems.append(f"data-run-hash {str(run_hash)[:12]} is not the {source}'s {str(truth)[:12]}")
    try:
        got = json.loads(cells_hash)
    except (TypeError, ValueError):
        return problems + ["data-cells-hash is not JSON"]
    if got != cells:
        problems += [f"digest of {h}: {str(got.get(h))[:12]}, the {source} has {str(cells.get(h))[:12]}" for h in sorted({*got, *cells}) if got.get(h) != cells.get(h)]
    return problems


def reference_entry(reference: dict, case: str):
    """The entry of the Node reference for a case at the first seed under the five records, or None (P7b made one, the medium-lot case)."""
    return next((e for e in reference.get("breakout", []) if e["case"] == case and e["seed"] == SEED and e["architectures"] == ARCHS), None)


# ---- the overlay -------------------------------------------------------------------------------------------------------


def breakout_expected(plan, view, t: int) -> dict:
    """What `data-plant-breakout` must say at `t` from the answer of `{ breakout: true }`: the origin (a lot, an equipment item, or the vessel of the draw a sampling origin names) once it became contaminated, and
    the units reached by then. Hours are seconds over 3600; a sampling origin has no instant of its own and is marked from the draw."""
    event = view["event"]
    origin_id, kind = event["origin_id"], event["origin_kind"]
    marked, since = None, 0
    if kind in ("seed_lot", "medium_lot") and any(x["id"] == origin_id for x in plan["lots"]) or kind == "shared_equipment" and any(x["id"] == origin_id for x in plan["equipment"]):
        marked, since = origin_id, event["contaminated_at"]["value"] * 3600
    elif kind == "unit_equipment" and any(u["id"] == origin_id for u in plan["units"]):
        marked, since = origin_id, event["contaminated_at"]["value"] * 3600
    elif kind == "sampling":
        s = next((x for x in plan["samples"] if x["id"] == origin_id), None)
        if s is not None and s["drawn_s"] is not None:
            marked, since = plan["units"][s["unit"]]["id"], s["drawn_s"]
    return {"origin": marked if marked is not None and since <= t else None, "reached": [plan["units"][a["unit"]]["id"] for a in view["affected"] if a["onset_s"] <= t]}


def breakout_problems(attr, plan, view, t: int) -> list[str]:
    try:
        got = json.loads(attr)
    except (TypeError, ValueError):
        return [f"data-plant-breakout is not JSON: {str(attr)[:40]}"]
    want = breakout_expected(plan, view, t)
    return [] if got == want else [f"at {t} s: data-plant-breakout says {got}, the answer gives {want}"]


def event_problems(case: str, view, plan) -> list[str]:
    """The answer of `{ breakout: true }` against what the scenario names (typed above): the origin item, and the units reached by the end of the run."""
    want = EXPECTED_EVENT[case]
    got = breakout_expected(plan, view, plan["horizon_s"])
    return [] if got == want else [f"{case}: the overlay marks {got}, the scenario names {want}"]


def sent_picks(sent, epoch: int | None = None) -> list[dict]:
    """The picks of the `plant_truth` requests the page sent, in order."""
    return [m["pick"] for m in sent if m["type"] == "plant_truth" and (epoch is None or m["epoch"] == epoch)]


def ask_problems(before, after) -> list[str]:
    """Nothing is asked before the switch; after it, one request for the placeholders of the halls and one for the event, each once."""
    problems = []
    if before:
        problems.append(f"{len(before)} plant_truth requests were sent before the switch was pressed")
    halls = [p for p in after if p == {"halls": True}]
    events = [p for p in after if p == {"breakout": True}]
    if len(halls) != 1 or len(events) != 1 or len(after) != 2:
        problems.append(f"after the switch the page asked {after}, expected one {{halls}} and one {{breakout}}")
    return problems


def breakout_request_problems(sent, case: str, actions: int = 0) -> list[str]:
    """The `breakout` request the Break-out screen sent when it was opened from the plant: the case, the seed and the five records, with the plant's actions (an empty list when it had none)."""
    asked = [m for m in sent if m["type"] == "breakout"]
    if len(asked) != 1:
        return [f"{len(asked)} breakout requests were sent, expected one"]
    m = asked[0]
    problems = []
    if m.get("case") != case or m.get("seed") != SEED:
        problems.append(f"the breakout request is for {m.get('case')} at seed {m.get('seed')}, expected {case} at {SEED}")
    if m.get("halls") != ARCHS:
        problems.append(f"the breakout request has the records {m.get('halls')}, expected {ARCHS}")
    if m.get("actions") != actions:
        problems.append(f"the breakout request carries {m.get('actions')} actions, expected {actions}")
    return problems


def back_problems(href: str | None, case: str, t: int) -> list[str]:
    """The way back to the plant from the Break-out screen: the same case, and the instant the reader left at."""
    if href is None or not href.startswith("#/plant?"):
        return [f"the way back is {href}"]
    q = dict(p.split("=", 1) for p in href.split("?", 1)[1].split("&") if "=" in p)
    problems = []
    if q.get("case") != case:
        problems.append(f"the way back names the case {q.get('case')}, expected {case}")
    if not re.fullmatch(r"\d+", q.get("t", "")) or abs(int(q["t"]) - t) > 60:
        problems.append(f"the way back holds the instant {q.get('t')}, the reader left at {t}")
    return problems
