"""Pure helpers and the constants they share with the checks of scripts/qa_lab.py: the headless QA of the lab page (docs/design/lab_ui.md section 12).

Unit-tested in tests/test_qa_lab.py: median, budgets, request log, the altered reference, words, the numbers walk, the flag lists, the label-error sentence, the order of the detection figures,
the answers of the lineage view against the fixture, and what the challenge may and may not send before the guess.
This module never opens a browser. The browser plumbing is qa_lab_browser.py; the checks are in qa_lab_checks.py (load, size, time, check, engines), qa_lab_sweeps.py (the screens by language and
theme: numbers, ko, matrix, contrast), qa_lab_flags.py and qa_lab_results.py.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import urlsplit

from qa_checks import gzip_size


SIZE_LIMIT = 300 * 1024  # first load, gzip bytes over the files of a cold load (lab_ui.md section 12)
TIME_LIMIT_MS = 1000  # median of the five timed runs of seed 1 in the Worker, headless Chromium
# the words that belong to the state `identical` alone (lab_ui.md section 7)
PASSED_ONLY_WORDS = ["reproducib", "byte for byte"]
# (label, #theme-select value, emulated prefers-color-scheme)
LAB_THEMES = [("light", "light", "light"), ("dark", "dark", "light"), ("auto-light", "auto", "light"), ("auto-dark", "auto", "dark")]
LANGS = ("en", "ko")
# Break-out joins in S3g; a build that refuses it (the public build) has no navigation link for it, so the checks take the screens the page shows (qa_lab_browser.shown_screens)
SCREENS = ["home", "setup", "results", "lineage", "challenge", "breakout", "notes"]
# the small run of the end-to-end path: the first two seeds of the list, A and C (a twenty-seed run is several seconds, and the gate does not time it)
SMALL_RUN = {"seeds": 2, "architectures": ["a_manual", "c_context"]}
# the lists of flags that exist now (lab_ui.md section 11); the legend of Results and the head of a Lineage column are one list per architecture shown
EXPECTED_FLAG_LISTS = ["setup-matrix", "setup-ablation", "results-legend", "notes-table", "lineage-column", "lineage-ablation", "challenge-ablations"]
# the lists of the Break-out screen (S3g), expected only where the page offers the screen: the ablations to choose from, and the flags of each record shown in a result
BREAKOUT_FLAG_LISTS = ["breakout-ablations", "breakout-column"]
# the label-error sentence of lab_ui.md section 10 (spec section 5, "Notes from S2g"), without the code marks
LABEL_ERROR_SENTENCE = (
    "Without system_issued_id, a label error is not detected here. A conflict of the duplicate-file check (VR-008b) cannot tell a replayed file from two analyses that a label error gave the same "
    "label, and the double-label check (VR-009) looks for two different ids, so the error appears as false alarms of the type duplicate_replay. The numbers are shown as they are."
)
ORDERING = re.compile(r"\b(rank(?:s|ed|ing)?|best|better|worse|worst|win(?:s|ner|ning)?|outperform(?:s|ed)?|superior|inferior|leaderboard)\b", re.I)


def median(values) -> float:
    ordered = sorted(values)
    if not ordered:
        raise ValueError("median of nothing")
    mid = len(ordered) // 2
    return ordered[mid] if len(ordered) % 2 else (ordered[mid - 1] + ordered[mid]) / 2


def time_verdict(runs_ms) -> tuple[float | None, bool]:
    """(median of the timed runs, within the budget). No runs is a failure."""
    if not runs_ms:
        return None, False
    m = median(runs_ms)
    return m, m <= TIME_LIMIT_MS


def size_verdict(total_bytes: int) -> bool:
    return total_bytes <= SIZE_LIMIT


def served_path(url: str, base: str) -> str | None:
    """The file of the build that a request URL of the served origin reads; None for another origin."""
    u, b = urlsplit(url), urlsplit(base)
    if (u.scheme, u.netloc) != (b.scheme, b.netloc):
        return None
    return u.path.removeprefix(b.path).lstrip("/") or "index.html"


def cross_origin(urls, base: str) -> list[str]:
    """Requests to another origin. data: and blob: URLs never leave the page."""
    return [u for u in urls if not u.startswith(("data:", "blob:")) and served_path(u, base) is None]


def request_gzip_total(paths, root: Path) -> int:
    """`gzip -c <file> | wc -c` summed over the distinct files a cold load read."""
    return sum(gzip_size(Path(root) / p) for p in dict.fromkeys(paths))


def alter_reference(text: str) -> str:
    """The reference with one hex digit of the first truth hash changed: a build whose reference is wrong by the smallest possible amount."""
    first = json.loads(text)["truth"][0]["log_hash"]
    swapped = ("1" if first[0] == "0" else "0") + first[1:]
    return text.replace(first, swapped, 1)


def found_words(text: str, words) -> list[str]:
    low = text.lower()
    return [w for w in words if w.lower() in low]


def number_offenders(nodes) -> list[dict]:
    """Text nodes that hold a digit and sit under no data-ref, data-result or data-label element (invariant 3, lab_ui.md section 6)."""
    return [{"text": n["text"], "where": n["where"]} for n in nodes if re.search(r"\d", n["text"]) and not n["marked"]]


def flag_list_problems(lists, flags) -> list[str]:
    """Lists of flags (`data-flag-list`) that lack a flag of `ready.flags`, name one that is not in it, or name one twice (lab_ui.md section 11)."""
    if not lists:
        return ["no list of flags (data-flag-list) on the screens checked"]
    problems = []
    for lst in lists:
        label = lst["name"] + (f" [{lst['arch']}]" if lst.get("arch") else "")
        named = lst["flags"]
        problems += [f"{label} lacks {f}" for f in flags if f not in named]
        problems += [f"{label} names {f}, which is not in ready.flags" for f in dict.fromkeys(named) if f not in flags]
        problems += [f"{label} lists {f} twice" for f in dict.fromkeys(named) if named.count(f) > 1]
    return problems


def missing_flag_lists(lists, breakout: bool = False) -> list[str]:
    """The lists of EXPECTED_FLAG_LISTS (and, where the page offers the Break-out screen, BREAKOUT_FLAG_LISTS) that are not on the screens checked."""
    present = {lst["name"] for lst in lists}
    return [name for name in EXPECTED_FLAG_LISTS + (BREAKOUT_FLAG_LISTS if breakout else []) if name not in present]


def label_sentence_ok(text: str) -> bool:
    """Whether a text is the label-error sentence of the design note, apart from white space and the code marks around the flag and the type."""
    return " ".join(text.replace("`", "").split()) == LABEL_ERROR_SENTENCE


def ordering_words(text: str) -> list[str]:
    """Words that rank the architectures or declare a winner (spec section 8, anti-gaming rules 3 and 6), each once, in order of appearance."""
    return list(dict.fromkeys(m.group(0).lower() for m in ORDERING.finditer(text)))


def detection_order_problems(groups) -> list[str]:
    """Each error type of a detection block shows recall, then precision, then the false-alarm rate (spec section 8, rule 3): never a precision or a false-alarm rate without its recall."""
    if not groups:
        return ["no detection block on the Results screen"]
    problems = []
    for g in groups:
        order = [f for f in g["figures"] if f in ("recall", "precision", "false_alarm")]
        if order and "recall" not in order:
            problems.append(f"{g['type']}: {' and '.join(order)} with no recall beside it")
        elif order != [f for f in ("recall", "precision", "false_alarm") if f in order]:
            problems.append(f"{g['type']}: recall must come before precision and the false-alarm rate, found {order}")
    return problems


def refs_off_their_line(refs) -> list[str]:
    """`.ref` boxes inside running text whose text before or after sits on another line (lab_ui.md section 6: an input is inline-level, so it never breaks its sentence). Each row has the
    `text` of the ref, its vertical span (`top`, `bottom`) and the span of the text next to it on each side (`before`, `after`; None when the ref has no text there)."""
    problems = []
    for r in refs:
        for side in ("before", "after"):
            near = r[side]
            if near is not None and not r["top"] <= (near["top"] + near["bottom"]) / 2 <= r["bottom"]:
                problems.append(f"{r['text']} has the text {side} it on another line")
    return problems


# ---- lineage and challenge (lab_ui.md sections 8, 9 and 12) ----------------------------------------------------------
TRACE_QUESTIONS = ("unit", "sampled_at", "process_context")


def lineage_answer_problems(answers, fixture) -> list[str]:
    """The three answers and verdicts the page draws for each architecture against the read-only fixture of the single-sample trace (`fixture` maps an architecture id to a body that has `answers`).
    `answers` has one element per architecture and question: its `verdict` and its `answer` as JSON text, so the comparison is of values and not of key order."""
    found = {(a["architecture"], a["question"]): a for a in answers}
    problems = []
    for arch, body in fixture.items():
        for question in TRACE_QUESTIONS:
            want = body["answers"][question]
            got = found.get((arch, question))
            if got is None:
                problems.append(f"{arch} {question}: not on the page")
                continue
            if got["verdict"] != want["verdict"]:
                problems.append(f"{arch} {question}: verdict {got['verdict']}, the fixture says {want['verdict']}")
            if json.loads(got["answer"]) != want["answer"]:
                problems.append(f"{arch} {question}: answer {got['answer']}, the fixture says {json.dumps(want['answer'], sort_keys=True)}")
    return problems


# The expected outcome of each drawn type in A, B and C, typed by hand from the first three columns of engine/tests/support/cell_tables.ts (LABEL_CELLS, REKEY_CELLS, REPLAY_CELLS),
# which were typed from the hypothesis matrix of spec section 5 before any run. A detected cell would carry its evidence; none of the three has one in A, B or C.
HAND_CELLS = {
    "label_error": ["invisible", "prevented", "prevented"],
    "unit_rekey": ["invisible", "invisible", "prevented"],
    "duplicate_replay": ["invisible", "prevented", "prevented"],
}
COMPARED = ["a_manual", "b_lims_lite", "c_context"]


def outcome_problems(reveal) -> list[str]:
    """The outcome of the planted error in A, B and C that the reveal holds against the typed cell of its type."""
    kind = reveal["planted"]["type"]
    cells = HAND_CELLS.get(kind)
    if cells is None:
        return [f"{kind}: no typed cell for this type"]
    by_arch = {p["architecture"]: p for p in reveal["per_architecture"]}
    problems = []
    for arch, want in zip(COMPARED, cells):
        got = by_arch.get(arch)
        if got is None:
            problems.append(f"{kind} in {arch}: not in the reveal")
        elif got["outcome"] != want or got["evidence"]:
            shown = got["outcome"] + (f" ({', '.join(got['evidence'])})" if got["evidence"] else "")
            problems.append(f"{kind} in {arch}: {shown}, the typed cell says {want}")
    return problems


# the types of message the page may receive between the start of a challenge and the guess (lab_ui.md section 4, rule 3)
ALLOWED_BEFORE_GUESS = ["ready", "check", "progress", "result", "error", "challenge_ready", "sample_record", "lineage"]
# keys that exist only in the reveal or name the plant; none may appear at any depth of a message before the guess
FORBIDDEN_KEYS = ["reveal", "planted", "affected", "plant", "materialised", "realised_errors", "score", "from_sample", "truth", "result_id", "per_architecture", "decision_same"]


def keys_deep(value) -> list[str]:
    if isinstance(value, dict):
        return [k for key, v in value.items() for k in [key, *keys_deep(v)]]
    if isinstance(value, list):
        return [k for v in value for k in keys_deep(v)]
    return []


def message_problems(messages, planted_ids) -> list[str]:
    """What the Worker sent before the guess: only types of the list, no key of the reveal or the plant, and the planted ids (known after the reveal) nowhere outside the record the reader
    searches. The record of `challenge_ready` and the drill-down of `sample_record` hold every sample or decision of the run, the planted one among them, as ordinary rows."""
    problems = []
    for m in messages:
        kind = m.get("type")
        if kind not in ALLOWED_BEFORE_GUESS:
            problems.append(f"message type {kind} is not in the list the page may receive before the guess")
        problems += [f"key {k} in a {kind} message" for k in dict.fromkeys(keys_deep(m)) if k in FORBIDDEN_KEYS]
        outside = {k: v for k, v in m.items() if k not in ("record", "sample")}
        text = json.dumps(outside)
        problems += [f"the planted id {p} is in a {kind} message outside its record" for p in planted_ids if p in text and kind != "sample_record"]
    return list(dict.fromkeys(problems))


def row_shape_problems(record) -> list[str]:
    """Every row of a table of the record has the same keys, so no row carries a mark that the others lack."""
    return [f"the rows of {name} do not all have the same keys" for name, rows in record.items()
            if isinstance(rows, list) and rows and all(isinstance(r, dict) for r in rows) and len({tuple(sorted(r)) for r in rows}) > 1]


# the types on every sample of a record, typed from the flag table: with audit_trail off (A) the operator is absent for every sample, so each carries the unattributable record
TYPED_UBIQUITOUS = {"a_manual": ["unattributable_record"]}


def ubiquitous_problems(shown, record, noted, reveal) -> list[str]:
    """The ruling of 2026-10-30 (lab_ui.md section 9): a structural type on every sample of the record is named once on the screen (`noted`, the types the page shows) and never makes a guess
    `background`; so a wrong guess in A is a miss unless the sample carries another structural error."""
    types = record.get("ubiquitous")
    if not isinstance(types, list):
        return [f"{shown}: the record has no ubiquitous list"]
    problems = []
    typed = TYPED_UBIQUITOUS.get(shown)
    if typed is not None and types != typed:
        problems.append(f"{shown}: the record names ubiquitous {types}, the typed list says {typed}")
    if noted != types:
        problems.append(f"{shown}: the page notes {noted}, the record names {types}")
    score = reveal.get("score") or {}
    if score.get("result") == "background" and score.get("background_type") in types:
        problems.append(f"{shown}: scored background for {score['background_type']}, a type on every sample of the record")
    return problems

