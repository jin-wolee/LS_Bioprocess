"""Pure helpers of the check `plant_tour` of the headless QA of the plant (docs/design/plant_ui.md sections 3.5 and 10, P8b): the sample the lineage rule `sc3` picks and the five steps of the tour, computed
here from the plan the page received (by the rule as the design states it, not by the page's code), the instants of the single-sample trace they are held to, the cells the card table must show, and the
verdicts on what the page wrote. No browser here, so pytest runs them (tests/test_qa_plant_tour.py); the check that drives the page is in qa_plant_tour.py.
"""
from __future__ import annotations

# The sample of the single-sample trace of SC3 (docs/design/single_sample_trace.md, tests/fixtures/trace/single_sample_trace.json), seed 1: drawn at second 899,841 (day 10 09:57), a feed of its unit at
# 900,000 (day 10 10:00), its run starting at 900,887 (day 10 10:14), the result at 901,157 (day 10 10:19). Typed from the trace, so the plan and the page are both held to it.
TRACE = {"sample": "U03-D10-2", "unit": "U03", "drawn": 899841, "feed": 900000, "run": 900887, "end": 901157}
# The verdicts of the three records for the three questions of that sample, from the same trace (A and B keep no sampled_at and join the context by measured_at; C keeps both clocks).
TRACE_VERDICTS = {
    **{f"{a}:{q}": v for a in ("a_manual", "b_lims_lite") for q, v in (("unit", "correct"), ("sampled_at", "unanswerable"), ("process_context", "wrong"))},
    **{f"c_context:{q}": "correct" for q in ("unit", "sampled_at", "process_context")},
}
STEP_IDS = ["draw", "feed", "run", "records", "truth"]
# How close to the middle of the view (device coordinates, -1 to 1) the point the camera is brought to is once the camera is on it, and how far from it a camera that glides still is two frames after a step.
ON_TARGET = 0.05
# The key of `localStorage` that says the tour has been offered.
TOUR_KEY = "plant.tour"


def tour_sample(plan: dict) -> dict | None:
    """The rule `sc3` on a scene plan: the lowest sample id (plain string order) whose interval from the draw to the start of its first run (the first attempt's earliest visit) holds a feed of its own unit,
    both ends counting. A skipped draw, a sample no analyzer visited and a confirming sample have none."""
    found = []
    for index, s in enumerate(plan["samples"]):
        visits = sorted(s["visits"], key=lambda v: (v["attempt"], v["started_s"]))
        if s.get("kind", "routine") != "routine" or s.get("skipped") or s["drawn_s"] is None or not visits:
            continue
        first = visits[0]
        feeds = sorted(m["t"] for m in plan["marks"] if m["kind"] == "feed" and m["unit"] == s["unit"] and s["drawn_s"] <= m["t"] <= first["run_started_s"])
        if feeds:
            found.append({"id": s["id"], "index": index, "unit": s["unit"], "drawn": s["drawn_s"], "feeds": feeds, "run": first["run_started_s"], "end": first["ended_s"], "analyzer": first["analyzer"]})
    return min(found, key=lambda f: f["id"]) if found else None


def expected_steps(plan: dict) -> list[dict]:
    """The five steps as the design table gives them: the instant, the key of the picked object (None for none), the key the camera is brought to, the panel that opens and the state of the overlay."""
    # (the key of the picked object and the key of the camera differ at the first two steps)
    s = tour_sample(plan)
    if s is None:
        return []
    unit = f"reactor:{plan['units'][s['unit']]['id']}"
    station = f"station:{plan['units'][s['unit']]['id']}"  # the camera looks at the reactor and the aisle in front of it, where the operator stands
    tube = f"sample:{s['id']}"
    return [
        {"id": "draw", "t": s["drawn"], "pick": unit, "look": station, "panel": "reactor", "truth": "off"},
        {"id": "feed", "t": s["feeds"][0], "pick": unit, "look": station, "panel": "reactor", "truth": "off"},
        {"id": "run", "t": s["run"], "pick": tube, "look": tube, "panel": "sample", "truth": "off"},
        {"id": "records", "t": s["end"], "pick": None, "look": "halls:all", "panel": None, "truth": "off"},
        {"id": "truth", "t": s["end"], "pick": None, "look": "halls:all", "panel": "record", "truth": "on"},
    ]


def trace_problems(steps: list[dict]) -> list[str]:
    """The plan agrees with the single-sample trace: the instants of the draw, the feed, the run and the result, and the sample itself."""
    if not steps:
        return ["the plan gives no step"]
    problems = [f"the {step['id']} step is at {step['t']} s, the trace has {TRACE[key]} s" for step, key in zip(steps, ("drawn", "feed", "run", "end")) if step["t"] != TRACE[key]]
    if steps[2]["pick"] != f"sample:{TRACE['sample']}":
        problems.append(f"the tour follows {steps[2]['pick']}, the trace follows sample:{TRACE['sample']}")
    return problems


def card_cells(plan: dict, sample: int) -> dict:
    """The cells the card table must show: (hall, slot) to (stored, the time the context was joined by or None) for the sample's card in each hall of the plan."""
    cells = {}
    for record in plan["records"]:
        for c in (c for c in record["cards"] if c["sample"] == sample):
            for slot in c["slots"]:
                cells[(record["architecture"], slot["name"])] = (slot["stored"], slot.get("basis") if slot["stored"] else None)
    return cells


def step_problems(got: dict, want: dict, where: str) -> list[str]:
    """What the host says at a step against the step the plan gives: the id, the clock (at the instant and paused), the picked object, the object the camera was brought to and the overlay."""
    problems = []
    if got["tour"] != want["id"]:
        problems.append(f"{where}: data-plant-tour is {got['tour']}, expected {want['id']}")
    if got["t"] != str(want["t"]):
        problems.append(f"{where}: the clock is at {got['t']}, the step's instant is {want['t']}")
    if got["playing"] != "false":
        problems.append(f"{where}: the clock is playing; a step holds it paused")
    if got["pick"] != want["pick"]:
        problems.append(f"{where}: the picked object is {got['pick']}, expected {want['pick']}")
    if got["look"] != want["look"]:
        problems.append(f"{where}: the camera was brought to {got['look']}, expected {want['look']}")
    if got["truth"] != want["truth"]:
        problems.append(f"{where}: the overlay is {got['truth']}, expected {want['truth']}")
    return problems


def centre_problems(ndc, limit: float, where: str) -> list[str]:
    """The point the camera is brought to is within `limit` of the middle of the view in both directions."""
    if ndc is None:
        return [f"{where}: the page wrote no place for the camera's target"]
    x, y = ndc
    return [] if abs(x) <= limit and abs(y) <= limit else [f"{where}: the camera is at ({x:.2f}, {y:.2f}) from its target, not within {limit}"]


def truth_request_problems(requests: list[dict], step_id: str) -> list[str]:
    """The `plant_truth` requests the page has sent by a step: none before the step that asks for the overlay, and at that step exactly two (the halls, and the sample of the tour)."""
    if step_id != "truth":
        return [f"the overlay was asked before its step: {len(requests)} plant_truth request(s) at the step {step_id}"] if requests else []
    halls = [r for r in requests if (r.get("pick") or {}).get("halls")]
    samples = [r for r in requests if (r.get("pick") or {}).get("sample_id") == TRACE["sample"]]
    return [] if (len(requests), len(halls), len(samples)) == (2, 1, 1) else [f"the overlay's step asked for {len(requests)} plant_truth request(s): the halls and the sample were expected"]


def verdict_problems(got: dict) -> list[str]:
    """The nine verdicts the page shows (hall:question to verdict) against the ones of the trace."""
    if len(got) != len(TRACE_VERDICTS):
        return [f"the verdict table has {len(got)} cells, the trace has {len(TRACE_VERDICTS)}"]
    return [f"{key}: the page says {got.get(key)}, the trace says {want}" for key, want in TRACE_VERDICTS.items() if got.get(key) != want]


def offer_problems(first: int, key: str | None, declined_left: int, reload_offers: int, button: bool) -> list[str]:
    """The offer is made once on the first entry and the key is written; "Not now" takes it off; a second visit does not offer again but has the button."""
    problems = []
    if first != 1:
        problems.append(f"the first entry showed {first} offers, expected 1")
    if key != "seen":
        problems.append(f"the key {TOUR_KEY} is {key!r} after the offer, expected 'seen'")
    if declined_left:
        problems.append("Not now left the offer on the page")
    if reload_offers:
        problems.append("the second visit offered the tour again")
    if not button:
        problems.append("the second visit has no button to take the tour")
    return problems


def reduced_tour_problems(reduced: dict, normal: dict) -> list[str]:
    """Two frames after a step the camera is on its target under reduced motion (it cuts), and is not without the preference (it glides: the control that shows the check can tell them apart)."""
    problems = []
    x, y = reduced["ndc"]
    if abs(x) > ON_TARGET or abs(y) > ON_TARGET:
        problems.append(f"under reduced motion the camera is at ({x:.2f}, {y:.2f}) from its target two frames after a step: it glides instead of cutting")
    x, y = normal["ndc"]
    if abs(x) <= ON_TARGET and abs(y) <= ON_TARGET:
        problems.append("without the preference the camera is already on its target two frames after a step (the control of the check)")
    return problems
