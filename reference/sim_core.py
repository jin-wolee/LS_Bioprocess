"""Trace-driven core loop of L3 on SimPy 4.1.2 (prompts/60_user_track.md, Card C).

Written by AI under ADR-0022, clean-room from the specification (schemas/trace.schema.json and trace_result.schema.json, the hand
fixtures F1 to F7, docs/design/simulation_spec.md and data_model.md); the author did not write it, and no engine source was read.
Parity with the TypeScript engine is measured by tests/user_track/test_sim_core_parity.py.

    python reference/sim_core.py TRACE.json OUT.json

Decisions that are not obvious, and what was rejected:
- Priority at one instant. SimPy orders its queue by (time, priority, insertion counter), but a Timeout always has the normal
  priority, so a process that waits with `yield env.timeout()` cannot say "I come first". The loop therefore schedules plain
  callback events (Tick) with an explicit level: RUN_END < ARRIVAL < DISPATCH. A run that ends at t frees its analyzer (and
  queues its rerun) before any arrival at t is queued, and dispatch is last, so it sees every change of that instant. Rejected:
  generator processes with timeouts (the order would depend on who was scheduled first), and PriorityResource (it models
  contention, not the no-backfill rule or the whole-occupancy pre-check). Because the queue is read through a sort key, the
  order of events inside one level changes no start time, so three levels are enough: no fixture or parity trace needed more.
- The queue is a list read through a key, not an insertion-ordered store. fifo: (queued_s, seq). edf: (deadline_s, queued_s, seq),
  a missing deadline is last. The queued_s step before seq is not decoration: the parity traces fail without it.
- seq. A request keeps its own seq for every visit. A rerun gets a new seq above every request seq (F3), counted in the order
  the reruns are made. No fixture tells a next visit's own seq from a new one; the request's own was kept because nothing in the
  specification says a visit gets a new identity.
- Dispatch. The head of a group's queue takes the lowest-index idle analyzer for which [t, t + setup + service) touches no window
  (windows are half-open, so touching at the end second is clear). If none does, the head waits and nothing behind it overtakes
  (no backfill). Dispatch runs once per instant, after any arrival, run end or window end; the window ends are scheduled at the
  start, so an analyzer that idled because of a window is tried again when the window closes.
- Setup. Applied only when the analyzer has a method, the visit names one and they differ; the pair must be in `setup`, and a
  missing pair raises KeyError, because a silent 0 would hide a wrong trace. A visit without method_id leaves the loaded method
  as it was. start_s is the run start after the setup, end_s is start_s + service_s, setup_s is reported.
- Outcomes. A forced outcome is looked up by (request_id, attempt, visit); the default is qc_passed. qc_failed and over_range
  re-enqueue the same visit with attempt + 1 at the run end. qc_passed and over_range_unresolved (terminal, no rerun) are followed
  by the next visit, if any, after its transfer_s, with attempt 1 (simulation_spec section 2.3).
- No random numbers: every draw is in the trace. The output lists runs sorted by (start_s, analyzer, request_id, attempt).
"""
import json
import sys

import simpy

RUN_END, ARRIVAL, DISPATCH = 0, 1, 2
INF = float("inf")


class Tick(simpy.Event):
    """Calls fn at the absolute second t. SimPy's queue is ordered by (time, priority, insertion counter), so `level` decides
    the order of events at one instant. Timeout can only use the normal priority, hence this event (it sets what Timeout sets)."""

    def __init__(self, env: simpy.Environment, t: int, level: int, fn) -> None:
        super().__init__(env)
        self._ok, self._value = True, None
        self.callbacks.append(lambda _event: fn())
        env.schedule(self, level, t - env.now)


def simulate(trace: dict) -> dict:
    env = simpy.Environment()
    loaded = {a["id"]: a["initial_method"] for a in trace["analyzers"]}
    busy = {a["id"]: False for a in trace["analyzers"]}
    in_group: dict[str, list[str]] = {}
    for a in trace["analyzers"]:
        in_group.setdefault(a["group"], []).append(a["id"])
    windows = {a: [(w["start_s"], w["end_s"]) for w in trace["windows"] if w["analyzer"] == a] for a in busy}
    setup = {(s["from_method"], s["to_method"]): s["seconds"] for s in trace["setup"]}
    forced = {(f["request_id"], f["attempt"], f["visit"]): f["outcome"] for f in trace["forced_outcomes"]}
    requests = {r["request_id"]: r for r in trace["requests"]}
    queue: dict[str, list[dict]] = {g: [] for g in in_group}
    runs: list[dict] = []
    counter = [max((r["seq"] for r in trace["requests"]), default=0)]
    dispatch_at: set[int] = set()

    def key(e: dict) -> tuple:
        deadline = requests[e["request_id"]].get("deadline_s", INF)
        return (deadline, e["queued_s"], e["seq"]) if trace["policy"] == "edf" else (e["queued_s"], e["seq"])

    def want_dispatch(t: int) -> None:
        if t not in dispatch_at:
            dispatch_at.add(t)
            Tick(env, t, DISPATCH, dispatch)

    def enqueue(request_id: str, visit: int, attempt: int, seq: int) -> None:
        group = requests[request_id]["visits"][visit - 1]["group"]
        queue[group].append({"request_id": request_id, "visit": visit, "attempt": attempt, "seq": seq, "queued_s": env.now})
        want_dispatch(env.now)

    def setup_s(a: str, method: str | None) -> int:
        return 0 if method is None or loaded[a] is None or loaded[a] == method else setup[(loaded[a], method)]

    def clear_of_windows(a: str, t: int, length: int) -> bool:
        return not any(t < end and start < t + length for start, end in windows[a])

    def dispatch() -> None:
        for group, waiting in queue.items():
            while waiting:
                head = min(waiting, key=key)
                visit = requests[head["request_id"]]["visits"][head["visit"] - 1]
                for a in in_group[group]:
                    lead = setup_s(a, visit.get("method_id"))
                    if not busy[a] and clear_of_windows(a, env.now, lead + visit["service_s"]):
                        break
                else:
                    break  # no backfill: the head waits and nothing behind it overtakes
                waiting.remove(head)
                start_run(a, head, visit, lead)

    def start_run(a: str, e: dict, visit: dict, lead: int) -> None:
        start, end = env.now + lead, env.now + lead + visit["service_s"]
        outcome = forced.get((e["request_id"], e["attempt"], e["visit"]), "qc_passed")
        busy[a] = True
        loaded[a] = visit.get("method_id", loaded[a])
        runs.append({"request_id": e["request_id"], "attempt": e["attempt"], "visit": e["visit"], "analyzer": a,
                     "setup_s": lead, "start_s": start, "end_s": end, "outcome": outcome})
        Tick(env, end, RUN_END, lambda: finish(a, e, outcome))

    def finish(a: str, e: dict, outcome: str) -> None:
        busy[a] = False
        request = requests[e["request_id"]]
        if outcome in ("qc_failed", "over_range"):
            counter[0] += 1
            enqueue(e["request_id"], e["visit"], e["attempt"] + 1, counter[0])
        elif e["visit"] < len(request["visits"]):
            nxt = request["visits"][e["visit"]]
            Tick(env, env.now + nxt.get("transfer_s", 0), ARRIVAL, lambda: enqueue(e["request_id"], e["visit"] + 1, 1, request["seq"]))
        want_dispatch(env.now)

    for r in trace["requests"]:
        Tick(env, r["arrive_s"], ARRIVAL, lambda r=r: enqueue(r["request_id"], 1, 1, r["seq"]))
    for spans in windows.values():
        for _start, end in spans:
            want_dispatch(end)
    env.run()
    runs.sort(key=lambda r: (r["start_s"], r["analyzer"], r["request_id"], r["attempt"]))
    return {"schema_version": "1", "engine_version": trace["engine_version"], "seed": trace["seed"], "runs": runs}


if __name__ == "__main__":
    with open(sys.argv[1]) as f:
        result = simulate(json.load(f))
    with open(sys.argv[2], "w") as f:
        json.dump(result, f, indent=2)
