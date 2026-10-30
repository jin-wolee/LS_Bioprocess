"""Pure helpers and the constants they share with the checks of scripts/qa_lab.py: the headless QA of the lab page (docs/design/lab_ui.md section 12).

Unit-tested in tests/test_qa_lab.py: median, budgets, request log, the altered reference, words, the numbers walk, the flag lists, the label-error sentence, the order of the detection figures.
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
SCREENS = ["home", "setup", "results", "notes"]
# the small run of the end-to-end path: the first two seeds of the list, A and C (a twenty-seed run is several seconds, and the gate does not time it)
SMALL_RUN = {"seeds": 2, "architectures": ["a_manual", "c_context"]}
# the lists of flags that exist now (lab_ui.md section 11); the legend of Results is one list per architecture shown
EXPECTED_FLAG_LISTS = ["setup-matrix", "setup-ablation", "results-legend", "notes-table"]
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


def missing_flag_lists(lists) -> list[str]:
    """The lists of EXPECTED_FLAG_LISTS that are not on the screens checked."""
    present = {lst["name"] for lst in lists}
    return [name for name in EXPECTED_FLAG_LISTS if name not in present]


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
