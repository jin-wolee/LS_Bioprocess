"""The checks of the one-seed screens for scripts/qa_lab.py: `lineage_sc3` and `challenge` (docs/design/lab_ui.md sections 4, 8, 9 and 12).

`lineage_sc3`: Given SC3, seed 1 and the rule pick, the three answers and verdicts the page draws for A, B and C equal the read-only fixture of the single-sample trace.
`challenge`: Given a started challenge, nothing the Worker sends before the guess carries the plant (nor, in the decision variant, an affected decision); after the guess the reveal holds `prevented`,
`invisible` or `detected` for A, B and C equal to the hand-typed cell of the planted type; a guess on a decision of the affected set reads `hit`; and the lineage of a run that is an unrevealed
challenge is refused with `locked` and opens after the guess; a type that the record carries on every sample is noted once on the page and never scores `background` (A: the unattributable
record, so a wrong guess there is a `miss`; the ruling of 2026-10-30, section 9). Every message of the Worker is recorded by a wrapper of the Worker class (qa_lab_browser.RECORD_JS).
"""
from __future__ import annotations

import json
from pathlib import Path

from qa_checks import Result
from qa_lab_browser import RECORD_JS, go, open_lab, show_lineage, start_challenge, wait_final
from qa_lab_helpers import lineage_answer_problems, message_problems, outcome_problems, row_shape_problems, ubiquitous_problems

REPO = Path(__file__).resolve().parents[1]
FIXTURE = REPO / "tests" / "fixtures" / "trace" / "single_sample_trace.json"

ANSWERS_JS = """() => [...document.querySelectorAll('[data-answer]')].map(a => ({architecture: a.dataset.architecture, question: a.dataset.question, verdict: a.dataset.verdict, answer: a.dataset.answer}))"""

# the cell of the shown ablation of C, typed by hand from engine/tests/support/cell_tables.ts: LABEL_CELLS and REPLAY_CELLS at C minus system_issued_id and C minus ingest_idempotency
ABLATION_CELLS = {"c_context_minus_system_issued_id": ("label_error", "invisible"), "c_context_minus_ingest_idempotency": ("duplicate_replay", "invisible")}


def check_lineage_sc3(browser, url) -> Result:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    with open_lab(browser, url) as (page, errors, _):
        wait_final(page)
        show_lineage(page)
        answers = page.evaluate(ANSWERS_JS)
        sample = page.get_attribute("#lineage-view", "data-sample")
        columns = page.evaluate("[...document.querySelectorAll('[data-lineage-column]')].map(c => c.dataset.lineageColumn)")
    problems = lineage_answer_problems(answers, fixture["architectures"])
    if sample != fixture["pick"]["sample_id"]:
        problems.append(f"the rule picked {sample}, the fixture says {fixture['pick']['sample_id']}")
    if columns != list(fixture["architectures"]):
        problems.append(f"columns {columns}, the fixture has {list(fixture['architectures'])}")
    problems += [f"console: {e[:100]}" for e in errors]
    detail = f"{len(answers)} answers of {len(columns)} columns equal the fixture (sample {sample})"
    return Result("lineage_sc3", not problems, detail + (f" | {problems[0]}" if problems else ""), {"problems": problems})


def messages(page) -> list[dict]:
    return page.evaluate("window.__labMessages")


def reveal_of(sent: list[dict]) -> dict:
    return [m for m in sent if m["type"] == "challenge_reveal"][-1]["reveal"]


def lock_problems(page, record: dict, seed: str) -> list[str]:
    """Rule 2 of section 4 on the page: while the challenge is open, the lineage of its run (same scenario, seed and settings) is refused with `locked`."""
    sample_id = record["samples"][0]["sample_id"]
    go(page, "lineage")
    page.select_option("#lineage-scenario", "default")
    page.fill("#lineage-seed", seed)
    page.check("#lineage-pick-reader")
    page.fill("#lineage-sample", sample_id)
    page.click("#lineage-show")
    try:
        page.wait_for_selector("[data-problem=locked]", timeout=30_000)
    except Exception:
        return ["the lineage of the run of an unrevealed challenge was not refused with locked"]
    return [] if page.query_selector("#lineage-view") is None else ["the lineage view is on the page next to the refusal"]


def play_sample(page, shown: str, with_lock: bool = False) -> tuple[list[str], str]:
    """One sample challenge to the reveal. Returns the problems and a short note."""
    problems: list[str] = []
    start = len(messages(page))
    seed = start_challenge(page, "sample", shown=shown)
    page.click("[data-table=samples] tr[data-row] .row-open")
    page.wait_for_selector("#challenge-opened svg", timeout=20_000)
    if page.query_selector("[data-reveal]"):
        problems.append(f"{shown}: the reveal is on the page before the guess")
    sent = messages(page)[start:]
    record = next(m["record"] for m in sent if m["type"] == "challenge_ready")
    noted = page.eval_on_selector_all("[data-note=ubiquitous] [data-ubiquitous]", "els => els.map(e => e.dataset.ubiquitous)")
    if with_lock:
        problems += lock_problems(page, record, seed)
        go(page, "challenge")
        page.wait_for_selector("#challenge-play", timeout=10_000)
    sent = messages(page)[start:]
    page.click("[data-table=samples] tr[data-row] .row-guess")
    page.wait_for_selector("[data-reveal]", timeout=60_000)
    reveal = reveal_of(messages(page))
    announced = page.get_attribute("[data-announced]", "data-announced")
    if announced != reveal["planted"]["type"]:
        problems.append(f"{shown}: announced {announced}, planted {reveal['planted']['type']}")
    problems += [f"{shown}: {p}" for p in outcome_problems(reveal) + message_problems(sent, reveal["planted"]["affected"]) + row_shape_problems(record)]
    problems += ubiquitous_problems(shown, record, noted, reveal)
    cell = ABLATION_CELLS.get(shown)
    if cell:
        got = next((p for p in reveal["per_architecture"] if p["architecture"] == shown), None)
        if got is None or (reveal["planted"]["type"], got["outcome"]) != cell:
            problems.append(f"{shown}: the shown ablation reads {got and got['outcome']} for {reveal['planted']['type']}, the typed cell says {cell}")
    if with_lock:  # the same run opens once the challenge is revealed
        go(page, "lineage")
        page.click("#lineage-show")
        try:
            page.wait_for_selector("#lineage-view", timeout=60_000)
        except Exception:
            problems.append(f"{shown}: the lineage of the run did not open after the reveal")
        go(page, "challenge")
        page.wait_for_selector("[data-reveal]", timeout=10_000)
    page.click("#challenge-new")
    page.wait_for_selector("#challenge-start", timeout=10_000)
    return problems, f"{shown}: {reveal['planted']['type']}, {reveal['score']['result']}"


def play_decision(page) -> tuple[list[str], str]:
    """The decision variant: a guess, then the same challenge again with a guess on a decision of the affected set (the plant is a function of the seed)."""
    problems: list[str] = []
    start = len(messages(page))
    start_challenge(page, "decision", shown="a_manual")
    page.wait_for_selector("[data-table=decisions] tr[data-row]", timeout=20_000)
    sent = messages(page)[start:]
    progress = [m for m in sent if m["type"] == "progress"]
    if [(m["done"], m["total"]) for m in progress] != [(1, 2), (2, 2)]:
        problems.append(f"progress between the two loops: {[(m['done'], m['total']) for m in progress]}")
    record = next(m["record"] for m in sent if m["type"] == "challenge_ready")
    page.click("[data-table=decisions] tr[data-row] .row-guess")
    page.wait_for_selector("[data-reveal]", timeout=90_000)
    reveal = reveal_of(messages(page))
    affected = reveal["decisions"]["affected"]
    problems += outcome_problems(reveal) + message_problems(sent, affected) + row_shape_problems(record)
    if [p.get("decision_same") for p in reveal["per_architecture"]] != [False, True, True]:
        problems.append(f"decision_same {[p.get('decision_same') for p in reveal['per_architecture']]}, expected the decision to change where the error arises (A) and to stay where it does not (B, C)")
    rows = reveal["decisions"]["rows"]
    if not rows:
        return problems + ["no affected decision read a row"], "decision: none"
    page.click("#challenge-new")
    page.wait_for_selector("#challenge-start", timeout=10_000)
    start_challenge(page, "decision", shown="a_manual")
    page.wait_for_selector("[data-table=decisions] tr[data-row]", timeout=20_000)
    page.click(f"[data-table=decisions] tr[data-row=\"{rows[0]['decision_id']}\"] .row-guess")
    page.wait_for_selector("[data-reveal]", timeout=90_000)
    score = reveal_of(messages(page))["score"]
    if score != {"result": "hit"}:
        problems.append(f"a guess on the affected decision {rows[0]['decision_id']} reads {score}")
    page.click("#challenge-new")
    page.wait_for_selector("#challenge-start", timeout=10_000)
    return problems, f"decision: {len(affected)} affected, {len(rows)} with a row, guess on {rows[0]['decision_id']} {score['result']}"


def check_challenge(browser, url) -> Result:
    problems: list[str] = []
    notes: list[str] = []
    with open_lab(browser, url, init_script=RECORD_JS) as (page, errors, _):
        wait_final(page)
        go(page, "challenge")
        decision = page.query_selector("#challenge-variant-decision") is not None
        # the three drawn types, each shown in a record that does not prevent it, then A (the unattributable record is on every sample and never background); the first game also checks the lock of the lineage view
        for i, shown in enumerate(["c_context_minus_system_issued_id", "b_lims_lite", "c_context_minus_ingest_idempotency", "a_manual"]):
            found, note = play_sample(page, shown, with_lock=i == 0)
            problems += found
            notes.append(note)
        if decision:
            found, note = play_decision(page)
            problems += found
            notes.append(note)
        else:
            notes.append("decision variant not listed by ready")
        problems += [f"console: {e[:100]}" for e in errors]
    return Result("challenge", not problems, "; ".join(notes) + (f" | {problems[0]}" if problems else ""), {"problems": problems})
