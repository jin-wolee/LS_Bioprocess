# ADR-0021: The lab centres on an interactive 3D virtual plant
- **Status:** Proposed
- **Date:** 2026-10-31
## Context

After S3 the author looked at the lab and set the end goal of the project: a virtual laboratory and manufacturing plant that a person understands by looking at it, not pages of tables. The S3 screens (Setup, Results, Lineage, Challenge, Break-out) show the comparison of data architectures as forms, tables and small SVG drawings; the author judged that a person cannot read them at a glance.

The engine already produces what a living plant view needs. A run is a deterministic event log of the truth world (reactors, sampling, logistics, analyzer queues, runs, results, process events, break-out events) and of what each architecture records, and the same seed gives the same bytes in Node and in every browser (ADR-0019). The lab runs the engine in a Web Worker (ADR-0003, ADR-0018) within a first-load budget of 300 KB gzip (`prompts/00_master_build.md` section 4).

The author chose, in chat on 2026-10-31: a 3D plant; game-like operation (the reader acts on the plant during a run, for example moves a sampling time or switches a flag, and sees the consequence); built before the S4 features.

## Options

1. **2D animated floor plan, watch and inspect.** SVG or Canvas, a time scrubber, click to inspect.
   - Pro: light, inside the current budget, easy to test headless, readable on a phone.
   - Con: less of a "plant" to walk around; the author asked for more.
2. **3D plant, watch and inspect.** A WebGL scene replays the event log; the reader changes settings between runs.
   - Pro: the plant is visible as a place; the engine stays as it is.
   - Con: a 3D library and assets; a larger download; WebGL testing.
3. **3D plant, operated like a game.** As 2, and the reader acts during a run; each action becomes a scripted operator event, and the run is recomputed deterministically from its start with the actions applied, then replayed from the moment of the action.
   - Pro: what the author asked for; the consequences of a choice show in place; determinism holds because an action is data in the scenario, keyed like every other event.
   - Con: the largest build; recomputing a run on each action must stay fast (the default scenario's engine run is about 120 ms in the Worker today); the set of allowed actions must be designed so that none lets the reader see the truth a record could not.

## Decision

Proposed: option 3 (the author's choice).

- The plant view becomes the lab's main screen; the S3 screens stay as drill-downs reached from objects of the plant (a reactor, a sample, a record).
- The 3D library is pinned to an exact version at least two weeks old (the rule of ADR-0018), loaded only when the plant view opens, so the first load of the lab keeps its 300 KB budget; the plant view gets a budget of its own, set from a measured spike and written into `prompts/00_master_build.md` section 4 once the author accepts it.
- An operator action is plain data: it enters the scenario as a scripted event with the canonical key of invariant 2, the Worker recomputes the run from its start, and the view resumes at the action's instant. The page never computes a result itself.
- The truth stays separate (invariant 1): the plant shows the truth world as the simulation's own view, labelled as such; every record view shows only what that architecture stored; no action reveals a hidden field of a record.
- The headless QA renders the scene in Chromium (software WebGL), checks frame time, the action round trip and that a recomputed run equals a run of the same scenario with the actions written in by hand.
- A design note (`docs/design/plant_ui.md`) and a throwaway spike come first; the author's reference ("like SANSA") informs the look and feel, and nothing is copied from another product.

## Consequences

- Positive: the comparison of architectures becomes visible in a place a person can look at; the S3 work is reused as drill-downs; determinism and the truth boundary carry over.
- Negative: a large new build before S4; a new dependency and its updates; WebGL tests are slower and coarser than DOM tests; a phone may need a lighter mode.
- Open: the plant view's size budget (from the spike); the list of operator actions; a 2D fallback where WebGL is missing; whether the public flip waits for the plant view (the author's call).

## Evidence

- Decisions it builds on: ADR-0003 and ADR-0018 (engine in a Web Worker, Preact page), ADR-0019 (the same bytes in every browser), ADR-0005 (architectures as flags), ADR-0013 (break-out events).
- Budgets: `prompts/00_master_build.md` section 4. The engine run time: `docs/progress.md`, the S3 close.
- No `S###` or `A###` applies: this is a product and tooling decision.

## Author statement (verbatim, if any)

> "결국 최종 목표는 산사(SANSA)와 같이 가상 실험실/제조공정공장을 만드는 것에 있어. 염두해. 이렇게 그냥 장표로 있는게 목표가 아니야. 이러면 사람이 직관적으로 못보잖아." (chat, 2026-10-31)

> Chose "3D", "게임처럼 직접 운영" and "S4 전에 먼저 (Recommended)" (chat, 2026-10-31)

## Decider's note
_(author only — Claude never writes here)_
