"""Pure helpers of the check `one_flag` (scripts/qa/qa_lab_oneflag.py): the card "What one stored timestamp changes" on Home (A3, docs/design/lab_ui.md section 26).

Unit-tested in tests/test_qa_lab_oneflag.py with expected values typed by hand. This module never opens a browser. The facts it judges are what `ONE_FLAG_JS` (qa_lab_oneflag.py) reads off the page:
the card, its Run button, its answer (one result block, three questions, two records each, the figures with their status), the requests the page sent to the Worker, and the form that the link of
the card fills on Setup. Times are not judged here: no budget exists for the run (the check reports it).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from qa_lab_helpers import ordering_words

REPO = Path(__file__).resolve().parents[2]

ONE_FLAG_SCENARIO = "sc03_feed_in_gap"
ONE_FLAG_ARCHS = ["c_context", "c_context_minus_two_clocks"]
ONE_FLAG_FLAG = "two_clocks"
# the rows of each question, in the order the card shows them (the design note, section 26); `exact_reconstruction` is not among them on purpose
ONE_FLAG_QUESTIONS = {
    "mismatch": ["alignment_error.context_mismatch"],
    "detection": [f"detection.by_type.feed_in_gap.{f}" for f in ("recall", "precision", "false_alarm", "realised")],
    "cost": ["hold_limit.rejected", "availability.available"],
}
FIGURE_STATUSES = ("reported", "none_occurred", "not_evaluable", "not_modelled", "not_applicable")
# words that rank or compare records, in Korean (tests/test_readme_ko.py has the list of the README; the comparatives are added)
KOREAN_ORDERING = ["더 낫", "더 좋", "우수", "최고", "최악", "승자", "이긴", "앞선", "뛰어난", "우월", "열등", "우승", "순위", "더 높", "더 낮", "더 많", "더 적", "가장", "제일"]
COMPARATIVES = re.compile(r"\b(higher|lower|more|less|fewer|greater|larger|smaller|most|least|beats?|ahead)\b", re.I)


def one_flag_seeds() -> list[int]:
    """The first 20 seeds of the list of experiment 1, read from the file the lab bundles."""
    return json.loads((REPO / "data" / "scenarios" / "experiments" / "experiment1.json").read_text(encoding="utf-8"))["seeds"][:20]


def ordering_found(text: str, lang: str) -> list[str]:
    """Words of a text that rank the records or compare them, each once."""
    if lang == "ko":
        return [w for w in KOREAN_ORDERING if w in text]
    return list(dict.fromkeys([*ordering_words(text), *(m.group(0).lower() for m in COMPARATIVES.finditer(text))]))


def one_flag_load_problems(requests) -> list[str]:
    """Given the requests the page sent to the Worker before any click, then none of them is a run with an architecture: the card never runs on page load (Home's own request has none)."""
    runs = [r for r in requests if r.get("type") == "run" and r.get("architectures")]
    return [f"the page asked for a run with {r['architectures']} before any click" for r in runs]


def one_flag_request_problems(request) -> list[str]:
    """The `run` request of a click on the card is exactly the run of the design: the scenario, the two records in order, the first 20 seeds, no setting and no actions."""
    if request is None:
        return ["no run request was sent by the click"]
    problems = []
    if request.get("scenario") != ONE_FLAG_SCENARIO:
        problems.append(f"the card ran scenario {request.get('scenario')}, not {ONE_FLAG_SCENARIO}")
    if request.get("architectures") != ONE_FLAG_ARCHS:
        problems.append(f"the card ran {request.get('architectures')}, not {ONE_FLAG_ARCHS} in this order")
    if request.get("seeds") != one_flag_seeds():
        problems.append(f"the card ran seeds {request.get('seeds')}, not the first 20 of the list")
    if request.get("settings") != {} or request.get("has_actions"):
        problems.append(f"the card changed settings {request.get('settings')} or carried actions")
    if request.get("keys") != ["schema_version", "scenario", "settings", "architectures", "seeds"]:
        problems.append(f"the spec of the card has the keys {request.get('keys')}: no list of profiles and no capture path belongs to it")
    return problems


def one_flag_problems(found: dict, lang: str = "en") -> list[str]:
    """What is wrong with the answer of the card as a reader meets it. `found` is what ONE_FLAG_JS reads: {card, answer, results_in_card, facts, questions: [{id, title, columns: [{arch, head, figures:
    [{metric, status, value, in_block}]}], note_cost}], figures_outside, text, overflow}. One result block holds everything; the questions come in order; the two records stand in the order of the run;
    each question holds the rows of the design (the detection group whole), every figure with a status and inside the block; a figure that is reported shows a number; only the third question
    carries the note of the cost of the second clock; no word ranks or compares; nothing scrolls sideways."""
    if not found.get("card"):
        return ["Home has no card #one-flag"]
    if not found.get("answer"):
        return ["the card shows no answer"]
    problems: list[str] = []
    if found["results_in_card"] != 1:
        problems.append(f"the card holds {found['results_in_card']} result blocks, not one")
    facts = found.get("facts") or {}
    expected_facts = {"scenario": ONE_FLAG_SCENARIO, "seeds": ", ".join(str(s) for s in one_flag_seeds()), "architectures": ", ".join(ONE_FLAG_ARCHS)}
    for key, want in expected_facts.items():
        if facts.get(key) != want:
            problems.append(f"the result block says {key} '{facts.get(key)}', the run was '{want}'")
    questions = found.get("questions", [])
    if [q["id"] for q in questions] != list(ONE_FLAG_QUESTIONS):
        problems.append(f"the questions are {[q['id'] for q in questions]}, expected {list(ONE_FLAG_QUESTIONS)} in this order")
    for q in questions:
        wanted = ONE_FLAG_QUESTIONS.get(q["id"], [])
        if [c["arch"] for c in q["columns"]] != ONE_FLAG_ARCHS:
            problems.append(f"{q['id']}: the records stand in the order {[c['arch'] for c in q['columns']]}, the run's order is {ONE_FLAG_ARCHS}")
        for c in q["columns"]:
            metrics = [f["metric"] for f in c["figures"]]
            if metrics != wanted:
                problems.append(f"{q['id']} / {c['arch']}: figures {metrics}, expected {wanted}")
            for f in c["figures"]:
                if f["status"] not in FIGURE_STATUSES:
                    problems.append(f"{q['id']} / {c['arch']} / {f['metric']}: status '{f['status']}' is not one of the report's")
                if not f["in_block"]:
                    problems.append(f"{q['id']} / {c['arch']} / {f['metric']}: the figure is outside the result block")
                if f["status"] == "reported" and not re.search(r"\d", f["value"]):
                    problems.append(f"{q['id']} / {c['arch']} / {f['metric']}: reported, but the figure shows no number: '{f['value']}'")
            head = c.get("head", "")
            if c["arch"] not in head or (c["arch"] != ONE_FLAG_ARCHS[0]) != (ONE_FLAG_FLAG in head):
                problems.append(f"{q['id']} / {c['arch']}: the head of the record reads '{head}' (it names its id, and the flag for the one with a flag off)")
    if [q["id"] for q in questions if q.get("note_cost")] != ["cost"]:
        problems.append(f"the note on the cost of the second clock is in {[q['id'] for q in questions if q.get('note_cost')]}, it belongs to the question 'cost' alone")
    if found.get("figures_outside"):
        problems.append(f"{found['figures_outside']} figures of the card are outside its result block")
    words = ordering_found(found.get("text", ""), lang)
    if words:
        problems.append(f"{lang}: words that rank or compare the records: {words}")
    if found.get("overflow", 0) > 0:
        problems.append(f"horizontal overflow {found['overflow']} px with the answer open")
    return problems


def statuses(found: dict) -> list[tuple[str, str, str, str]]:
    """(question, record, metric, status) of every figure, in the order shown: what two languages, or two builds, must have in common."""
    return [(q["id"], c["arch"], f["metric"], f["status"]) for q in found.get("questions", []) for c in q["columns"] for f in c["figures"]]


def signature(found: dict) -> list[tuple[str, str, str, str, str]]:
    """The statuses with the text of each figure: what a build must give the same as another, since both run the same engine on the same seeds."""
    return [(q["id"], c["arch"], f["metric"], f["status"], f["value"]) for q in found.get("questions", []) for c in q["columns"] for f in c["figures"]]


def setup_problems(form: dict) -> list[str]:
    """The link of the card opens Setup with the settings of the run filled and starts nothing: `form` is {scenario, archs: {id: checked}, ablation, seeds, running}."""
    problems = []
    if form.get("scenario") != ONE_FLAG_SCENARIO:
        problems.append(f"Setup opened with scenario {form.get('scenario')}")
    checked = sorted(a for a, on in form.get("archs", {}).items() if on)
    if checked != ["c_context"]:
        problems.append(f"Setup opened with the presets {checked} ticked, expected c_context alone")
    if form.get("ablation") != ONE_FLAG_ARCHS[1]:
        problems.append(f"Setup opened with the ablation '{form.get('ablation')}'")
    if form.get("seeds") != ", ".join(str(s) for s in one_flag_seeds()):
        problems.append(f"Setup opened with the seeds '{form.get('seeds')}'")
    if form.get("running"):
        problems.append("Setup started a run on arrival")
    return problems
