"""Pure helpers of the checks `plant_truth` and `plant_panels` (docs/design/plant_ui.md section 10, P5b): the walk of a Worker message for what the plan and the halls must never carry, the placeholders and
the figures of a panel that the check computes from the plan the page received, and the position of a followed tube on the screen. No browser here, so pytest runs them (tests/test_qa_plant_truth.py);
the checks that drive the page are in qa_plant_truth.py and qa_plant_panels.py.
"""
from __future__ import annotations

import re

# The hidden fields of the events (`HIDDEN_FIELDS` of engine/src/observe.ts) and the truth-only event types: a plan or a hall that carries one has leaked the simulation's own state.
HIDDEN_KEYS = {"true_value", "noise", "stability_kind", "stability_delta", "extrapolated", "true_state", "drift_before_pct"}
TRUTH_ONLY_TYPES = {"contamination_onset"}
# What only the truth overlay may carry (docs/design/plant_ui.md section 6, rule 2): a verdict, an answer, a materialised error, a hidden onset or origin, a placeholder and its reason.
OVERLAY_KEYS = {"verdict", "answers", "answer", "realised_errors", "placeholders", "why", "materialised", "onset", "origin"}
# The words of a verdict, of a reason for an absence and the types of the errors the injector materialises (engine/src/inject/types.ts): none of them is a value of a plan or of a record view.
OVERLAY_VALUES = {"unanswerable", "wrong", "not_recorded", "label_error", "feed_in_gap", "unit_rekey", "clock_offset", "duplicate_replay", "lost_rerun", "unattributable_record", "planned_vs_actual"}
# The messages the walk covers: the ones that must not carry truth. A `plant_truth_view` is the one that may.
WALKED = {"plant_ready", "plant_halls", "plant_record_view"}


def _walk(node, path: str, found: list[str]) -> None:
    if isinstance(node, dict):
        for key, value in node.items():
            if key in HIDDEN_KEYS | OVERLAY_KEYS:
                found.append(f"{path}.{key}")
            _walk(value, f"{path}.{key}", found)
    elif isinstance(node, list):
        for i, value in enumerate(node):
            _walk(value, f"{path}[{i}]", found)
    elif isinstance(node, str) and (node in TRUTH_ONLY_TYPES or node in OVERLAY_VALUES):
        found.append(f"{path} = {node}")


def truth_leaks(messages) -> list[str]:
    """For each message of a type that must carry no truth (the plan, a hall, the rows of a record), where it holds a key of the hidden fields or of the overlay, a truth-only type or a word of the overlay."""
    found: list[str] = []
    for m in messages:
        if m.get("type") in WALKED:
            _walk(m, m["type"], found)
    return found


def absences_expected(plan, t: int) -> dict:
    """For each hall of the plan, how many placeholders stand on its rail at the instant `t`: the samples the plant drew (or whose draw it skipped) by `t` that the hall holds no card for in the whole run."""
    out = {}
    for hall in plan["records"]:
        carded = {c["sample"] for c in hall["cards"]}
        out[hall["architecture"]] = sum(1 for i, s in enumerate(plan["samples"]) if s["drawn_s"] is not None and s["drawn_s"] <= t and i not in carded)
    return out


def label_problems(elements, label: str) -> list[str]:
    """Every element of the overlay (marked `data-overlay`) carries the sentence of the label as text, in the language of the page."""
    if not elements:
        return ["no element of the overlay is marked data-overlay"]
    ordinal = {1: "1st", 2: "2nd", 3: "3rd"}
    return [f"the {ordinal.get(i, f'{i}th')} element of the overlay lacks the label: '{e['text'][:60]}'" for i, e in enumerate(elements, 1) if label not in e["text"]]


def panel_numbers(plan, kind: str, index: int, t: int) -> dict:
    """The figures of the panel of a picked object that are counts of the rows of the plan up to the instant `t`, as the check computes them from the plan the page received."""
    samples = plan["samples"]
    if kind == "reactor":
        return {"drawn": sum(1 for s in samples if s["unit"] == index and not s["skipped"] and s["drawn_s"] is not None and s["drawn_s"] <= t)}
    if kind == "staff":
        return {"drawn": sum(1 for s in samples if s["operator"] == index and not s["skipped"] and s["drawn_s"] is not None and s["drawn_s"] <= t)}
    if kind == "analyzer":
        group = plan["analyzers"][index]["group"]
        visits = [v for s in samples for v in s["visits"]]
        return {
            "finished": sum(1 for v in visits if v["analyzer"] == index and v["ended_s"] <= t),
            "lane": sum(1 for v in visits if v["queued_s"] <= t < v["started_s"] and plan["analyzers"][v["analyzer"]]["group"] == group),
        }
    s = samples[index]
    return {"visits": sum(1 for v in s["visits"] if v["queued_s"] <= t), "operator": None if s["operator"] is None else plan["staff"][s["operator"]]["id"]}


_NDC = re.compile(r"^\[(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\]$")


def follow_problems(frames) -> list[str]:
    """The followed tube is on the screen in every frame read: its position in normalised device coordinates (`data-plant-follow-ndc`, written by the scene each frame) is within -1 and 1 on both axes."""
    if not frames:
        return ["no frame of the follow was read"]
    problems = []
    for i, text in enumerate(frames, 1):
        m = _NDC.match(text or "")
        if not m:
            problems.append(f"frame {i}: the tube position is not read: {text}")
        elif abs(float(m.group(1))) > 1 or abs(float(m.group(2))) > 1:
            problems.append(f"frame {i}: the tube is at {text}, outside the view")
    return problems


def sample_times(plan, index: int) -> list[int]:
    """The instants of one sample that the step goes between when it is picked: its draw, its arrival and the queue, start, run start and end of each visit, sorted, without repeats."""
    s = plan["samples"][index]
    times = [s["drawn_s"], s["arrived_s"], *[v[k] for v in s["visits"] for k in ("queued_s", "started_s", "run_started_s", "ended_s")]]
    return sorted({t for t in times if t is not None})


def quiet_instant(plan, operator: int, start: int, margin: int = 900, step: int = 300):
    """The first instant from `start`, in steps, at which the operator is on a shift and none of their draws is within `margin` seconds: they rest at their station, so a click on the figure meets nothing else."""
    shifts = plan["staff"][operator].get("on_duty", [])
    draws = [s["drawn_s"] for s in plan["samples"] if s["operator"] == operator and s["drawn_s"] is not None]
    t = start
    while t < plan["horizon_s"]:
        if any(a <= t < b for a, b in shifts) and all(abs(d - t) > margin for d in draws):
            return t
        t += step
    return None
