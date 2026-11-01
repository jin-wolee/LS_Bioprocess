"""Pure helpers of the check `drilldown` (docs/design/plant_ui.md section 10, P5c): the sample a reactor panel offers, the links the page makes and the requests it sends, and what Back to the plant must
restore. No browser here, so pytest runs them (tests/test_qa_plant_drill.py); the check that drives the page is in qa_plant_drill.py.
"""
from __future__ import annotations

import json
from urllib.parse import parse_qs, quote

# The keys of the plant link of the default plant, in the order the page writes them (docs/design/plant_ui.md section 7).
DEFAULT_PLANT_KEYS = "scenario=default&arch=a_manual,b_lims_lite,c_context&seed=1"
# A plant link that is wrong in four ways the page knows how to answer: an unknown scenario, a seed that is no number, an instant beyond the horizon of the run, and another engine version. The notes the page
# gives for it, in the order it gives them (the keys that fell back, then the instant outside the run, then the engine).
BAD_LINK_NOTES = ["scenario", "seed", "t_range", "engine"]


def newest_sample(plan, unit_id: str, t: int) -> str | None:
    """The sample the reactor panel offers first: the newest drawn on the unit by `t` (a skipped draw is no sample), the later one in the plan of two drawn at the same second. None before any draw."""
    index = next((i for i, u in enumerate(plan["units"]) if u["id"] == unit_id), None)
    drawn = [(s["drawn_s"], i, s["id"]) for i, s in enumerate(plan["samples"])
             if s["unit"] == index and not s["skipped"] and s["drawn_s"] is not None and s["drawn_s"] <= t]
    return max(drawn)[2] if drawn else None


def plant_hash(t: int | None, engine: str, actions=None) -> str:
    """The plant link of the default plant, with a list of actions (the JSON of the list, percent-encoded) and an instant of the run when given."""
    carried = f"&actions={quote(json.dumps(actions, separators=(',', ':')), safe='')}" if actions else ""
    return f"#/plant?{DEFAULT_PLANT_KEYS}{carried}{'' if t is None else f'&t={t}'}&schema=1&engine={engine}"


def bad_link(engine: str) -> str:
    return f"#/plant?scenario=nonesuch&seed=abc&t=99999999&schema=1&engine={engine}"


def read_hash(href: str) -> tuple[str, dict[str, str]]:
    """The screen a hash opens and its query with every value decoded (the `plant` value is a query of its own)."""
    path, _, query = href.removeprefix("#/").partition("?")
    return path, {k: v[0] for k, v in parse_qs(query, keep_blank_values=True).items()}


def link_problems(href: str, screen: str, sample: str | None = None, t: int | None = None) -> list[str]:
    """A drill-down link against what it must say: the screen it opens, that it came from the plant, the sample, and the instant of the plant it carries."""
    opens, query = read_hash(href)
    if opens != screen:
        return [f"the link opens {opens}, expected {screen}"]
    if query.get("from") != "plant" or "plant" not in query:
        return [f"the link does not say it came from the plant and carry it ({href[:80]})"]
    problems = []
    if sample is not None and query.get("sample") != sample:
        problems.append(f"the link names the sample {query.get('sample')}, expected {sample}")
    plant = parse_qs(query["plant"])
    if t is not None and plant.get("t", [None])[0] != str(t):
        problems.append(f"the plant in the link is at t={plant.get('t', [None])[0]}, expected {t}")
    return problems


def count(sent, kind: str) -> int:
    """How many requests of a type the page has sent (`window.__plantSent`)."""
    return sum(1 for m in sent if m["type"] == kind)


def lineage_problems(sent, sample: str, actions: int, seed: int) -> list[str]:
    """The last `lineage` request the page sent: for the sample, for the plant's seed, and carrying the plant's actions (the field is always sent from the plant, an empty list included)."""
    asked = [m for m in sent if m["type"] == "lineage"]
    if not asked:
        return ["the page sent no lineage request"]
    last = asked[-1]
    problems = []
    if (last.get("pick") or {}).get("sample_id") != sample:
        problems.append(f"the last lineage request names the sample {(last.get('pick') or {}).get('sample_id')}, expected {sample}")
    if last.get("seed") != seed:
        problems.append(f"the last lineage request is for seed {last.get('seed')}, expected {seed}")
    if last.get("actions") is None:
        problems.append("the lineage request carries no actions field: the plant's actions are always sent, an empty list included")
    elif last["actions"] != actions:
        problems.append(f"the last lineage request carries {last['actions']} actions, expected {actions}")
    return problems


def back_problems(before, after, runs_before: int, runs_after: int) -> list[str]:
    """Back to the plant: the same instant and lens as when the reader left, paused, on the same plan, and no new `plant_run` sent."""
    problems = []
    if after["t"] != before["t"]:
        problems.append(f"Back landed on t={after['t']}, the reader left at {before['t']}")
    if after["lens"] != before["lens"]:
        problems.append(f"Back landed on the lens {after['lens']}, the reader left on {before['lens']}")
    if after["playing"] != "false":
        problems.append("the clock plays after Back; it opens paused at the instant")
    if runs_after != runs_before:
        problems.append(f"Back sent a plant_run: {runs_after} in all, {runs_before} before")
    if after["epoch"] != before["epoch"]:
        problems.append(f"Back changed the epoch of the plan on screen from {before['epoch']} to {after['epoch']}")
    return problems
