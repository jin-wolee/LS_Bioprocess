"""The explainer's numbers carry their ledger ids (invariant 3), and the Korean carries the same numbers as the English (ADR-0006).

`check_public_numbers` (scripts/ledger_rules.py) only checks that the ids a page cites rest on re-read sources. A number added to the English prose, or a `data-src` taken off an element, failed no check
(the gap H1 found). This file closes it with a plain parser of site/infographic/src/body.html, the file the build reads:

1. Every run of digits in a text node of body.html sits in an element that has a `data-src`, or under an ancestor that has one.
2. Every id in a `data-src` is an entry of the ledgers (docs/research/sources.yaml, assumptions.yaml).
3. For every key of src/i18n.js, the Korean string holds the same digit runs as the English element of that key: none dropped, none added. A digit run the English spells out matches: an English
   number word from one to twelve ("two bays") or month name ("7 July") stands for its digits, since Korean writes a month as a numeral. The Korean may use the digit or not; it may never use a digit
   that neither a digit nor such a word of the English accounts for. No other normalisation: an idiom such as "1대당" or "1차" in the Korean fails, and the Korean is reworded ("한 대당", "일차").

What the check leaves out of 1, and why:
- text inside `<code>`, `<script>` and `<style>`, and every attribute value (coordinates, `value="565"`, class names): names and markup, not prose.
- a token made of letters and digits that starts with a capital letter, or `v` and a digit (U03, SMP-0412, B-2603-03, SC2, S2, L1, CO2, VR-010, ADR-0011, A022, v1): a name or an id the page uses for
  something, not a quantity. A token that starts with a digit (7, 4.5, 08:30, 10h, 2x) is never a name, and neither is a lowercase name such as x3.
- the version of the licence in "CC BY 4.0": the name of a licence, not a figure.
What it does not leave out: dates. The page's dates (the consultation period and the Annex 11 revision) are claims of a source, so they need their `data-src` like any number; an exemption for dates
would let a `data-src` taken off those sentences pass. Numbers written as words ("two analyzers") are not seen, and the check pairs a number with some id, not with the right one: that is the
fact-checker's work.
"""
from __future__ import annotations

import html as htmllib
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass
from html.parser import HTMLParser

import pytest

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts"))
from ledger_rules import load_ledgers  # noqa: E402

SRC = REPO / "site" / "infographic" / "src"
VOID = {"input", "br", "hr", "img", "meta", "link"}  # no end tag, so they must never stay open
SKIP = {"code", "script", "style"}
NAME = re.compile(r"(?:[A-Z][A-Za-z0-9_.-]*|v[0-9]+)")  # a token that names something (U03, SMP-0412, SC2, VR-010, A022, v1)
LICENCE = re.compile(r"\bCC BY [0-9]+(?:\.[0-9]+)*")
WORDS = {w: i for i, w in enumerate("one two three four five six seven eight nine ten eleven twelve".split(), 1)}
MONTHS = {m.lower(): i for i, m in enumerate("January February March April May June July August September October November December".split(), 1)}
SPELLED = re.compile(r"\b(?:(?i:" + "|".join(WORDS) + ")|" + "|".join(m.capitalize() for m in MONTHS) + r")\b")  # a month by its capital: "may" is a verb


@dataclass
class Node:
    line: int
    text: str
    skipped: bool  # inside code, script or style
    sourced: bool  # the element or an ancestor has a data-src with at least one id
    keys: tuple[str, ...]  # the data-i18n keys of the elements the text sits in


class Walk(HTMLParser):
    """The text nodes of an HTML fragment with what surrounds them, and the English of each data-i18n key (one text per element)."""

    def __init__(self, source: str):
        super().__init__(convert_charrefs=True)
        self.open: list[tuple[str, bool, list | None]] = []  # tag, has data-src ids, [key, text so far] when the element has a data-i18n
        self.nodes: list[Node] = []
        self.english: dict[str, list[str]] = {}
        self.feed(source)
        self.close()
        assert not self.open, f"elements left open: {[t[0] for t in self.open]}"

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if a.get("data-i18n-aria"):  # the English of this key is the aria-label
            self.english.setdefault(a["data-i18n-aria"], []).append(a.get("aria-label") or "")
        if tag not in VOID:
            self.open.append((tag, bool((a.get("data-src") or "").split()), [a["data-i18n"], ""] if a.get("data-i18n") else None))

    def handle_startendtag(self, tag, attrs):  # <path .../> opens nothing
        if dict(attrs).get("data-i18n-aria"):
            self.english.setdefault(dict(attrs)["data-i18n-aria"], []).append(dict(attrs).get("aria-label") or "")

    def handle_endtag(self, tag):
        if tag in [t[0] for t in self.open]:
            while True:
                name, _, rec = self.open.pop()
                if rec:
                    self.english.setdefault(rec[0], []).append(rec[1])
                if name == tag:
                    break

    def handle_data(self, data):
        for t in self.open:
            if t[2]:
                t[2][1] += data
        self.nodes.append(Node(
            self.getpos()[0], data,
            any(t[0] in SKIP for t in self.open), any(t[1] for t in self.open),
            tuple(t[2][0] for t in self.open if t[2])))


def quantities(text: str) -> list[str]:
    """The tokens of a text that hold a digit and are not a name (see the header)."""
    found = []
    for token in LICENCE.sub(" ", text).split():
        bare = token.strip("\"'()[],;:.?!")
        if re.search(r"[0-9]", bare) and not NAME.fullmatch(bare):
            found.append(bare)
    return found


def unsourced(source: str) -> list[tuple[Node, str]]:
    """Each number of the prose that sits under no data-src, with its text node."""
    return [(n, q) for n in Walk(source).nodes if not n.skipped and not n.sourced for q in quantities(n.text)]


def describe(found: list[tuple[Node, str]]) -> list[str]:
    return [f"line {n.line}: {q!r} in {n.text.strip()[:70]!r} ({', '.join(n.keys) or 'no data-i18n key'})" for n, q in found]


def unknown_ids(source: str, known: set[str]) -> list[str]:
    """One line per token of a data-src that is not an id of the ledgers."""
    return [f"line {source.count(chr(10), 0, m.start()) + 1}: {tok}"
            for m in re.finditer(r'data-src="([^"]*)"', source) for tok in m.group(1).split() if tok not in known]


def korean_texts(js: str) -> dict[str, str]:
    """The entries of the dictionary: one `"key": "text",` per line (a line that is not one fails here, so no entry can hide)."""
    out: dict[str, str] = {}
    for line in js.splitlines():
        if line.startswith('"'):
            m = re.fullmatch(r'("[^"]+"): (".*"),?', line)
            assert m, f"an entry of i18n.js that is not one line of key and string: {line[:60]}"
            out[json.loads(m.group(1))] = json.loads(m.group(2))
    return out


def digit_runs(text: str) -> Counter:
    return Counter(re.findall(r"[0-9]+", htmllib.unescape(text)))


def spelled(text: str) -> Counter:
    """The digits an English text spells as a number word (one to twelve) or a month name."""
    return Counter(str({**WORDS, **MONTHS}[w.lower()]) for w in SPELLED.findall(text))


def parity_failures(english: dict[str, list[str]], korean: dict[str, str]) -> list[str]:
    """One line per key whose Korean drops a digit run of an English element of the key, or adds one that no digit or spelled number of it accounts for."""
    out = []
    for key, ko in korean.items():
        for en in english.get(key) or [None]:
            if en is None:
                out.append(f"{key}: no English element carries this key")
                continue
            en_d, ko_d, words = digit_runs(en), digit_runs(ko), spelled(en)
            if en_d - ko_d or (ko_d - en_d) - words:
                out.append(f"{key}: English {dict(en_d)} and spelled {dict(words)}, Korean {dict(ko_d)} ({en.strip()[:50]!r} / {ko[:30]!r})")
                break
    return out


BODY = (SRC / "body.html").read_text(encoding="utf-8")
JS = (SRC / "i18n.js").read_text(encoding="utf-8")


# ---- the finder (the test of the test) ------------------------------------------------------------


@pytest.mark.parametrize("fragment, expected", [
    ("<p>The wait is about 7 min late.</p>", ["7"]),
    ("<p>It takes 4.5 min and 12.6&ndash;14.4 %.</p>", ["4.5", "12.6–14.4"]),
    ('<p data-src="A001">about 7 min late</p>', []),
    ('<div data-src="A001"><p>about <b>7</b> min <svg><text>08:30</text></svg></p></div>', []),
    ('<p data-src="">7 min</p>', ["7"]),  # an empty data-src names no id
    ("<p>10h and 2x and x3 and 08:30</p>", ["10h", "2x", "x3", "08:30"]),
    ("<p>on 7 July 2025 and 2026-03-12T08:40</p>", ["7", "2025", "2026-03-12T08:40"]),
    ("<p>See <code>x7 5</code>, <script>var a = 5;</script> and a <span class='a1' id='s2'>word</span>.</p>", []),
    ("<p>Sample SMP-0412 of U03, batch B-2603-03, run RUN-3318 v1, SC2 in S2, L1, CO2, A022, S001, VR-010 and ADR-0011.</p>", []),
    ("<p>Text and figures: CC BY 4.0.</p>", []),
    ("<p>Text and figures: CC BY 4.0 for 7 years.</p>", ["7"]),
])
def test_the_finder_reads_a_number_without_a_source(fragment, expected):
    assert [q for _, q in unsourced(fragment)] == expected


def test_the_finder_keeps_the_ancestor_chain_across_elements_without_an_end_tag():
    fragment = '<div data-src="A001"><input type="checkbox"> 5 min <svg><path d="M0 0H5"/><text>6 min</text></svg></div><p>7 min</p>'
    assert [q for _, q in unsourced(fragment)] == ["7"]


def test_the_finder_names_the_line_and_the_key():
    found = describe(unsourced('<p>\n<span data-i18n="c.lead">about 7 min</span></p>'))
    assert found == ["line 2: '7' in 'about 7 min' (c.lead)"]


@pytest.mark.parametrize("fragment, expected", [
    ('<p data-src="A001 S001">x</p>', []),
    ('<p data-src="A001 A999">x</p>', ["line 1: A999"]),
    ('<p>x</p>\n<p data-src="S777">x</p>', ["line 2: S777"]),
    ('<p data-src="A74">x</p>', ["line 1: A74"]),
])
def test_the_finder_reads_an_id_the_ledgers_lack(fragment, expected):
    assert unknown_ids(fragment, {"A001", "S001"}) == expected


def test_the_finder_reads_the_english_of_a_key_per_element():
    fragment = '<p data-i18n="a">x <b>3</b> y</p><ol data-i18n-aria="k" aria-label="Story 4"><li>1</li></ol><span data-i18n="a">x 3 y</span><input data-i18n-aria="i" aria-label="in 5">'
    assert Walk(fragment).english == {"a": ["x 3 y", "x 3 y"], "k": ["Story 4"], "i": ["in 5"]}


@pytest.mark.parametrize("english, korean, expected", [
    ({"k": ["Per 24 h, 4.5 min"]}, {"k": "24시간, 4.5분"}, []),
    ({"k": ["Per 24 h, 4.5 min"]}, {"k": "24시간, 4.5분, 3개"}, ["k: English {'24': 1, '4': 1, '5': 1} and spelled {}, Korean {'24': 1, '4': 1, '5': 1, '3': 1}"]),
    ({"k": ["Per 24 h, 4.5 min"]}, {"k": "24시간, 4분"}, ["k: English {'24': 1, '4': 1, '5': 1} and spelled {}, Korean {'24': 1, '4': 1}"]),
    ({"k": ["Per 24 h, 4.5 min"]}, {"k": "24시간, 4.5분, 4"}, ["k: English {'24': 1, '4': 1, '5': 1} and spelled {}, Korean {'24': 1, '4': 2, '5': 1}"]),
    ({"k": ["No number"]}, {"k": "숫자 하나 1"}, ["k: English {} and spelled {}, Korean {'1': 1}"]),
    ({"k": ["in two bays of 12"]}, {"k": "12대씩 2개 베이"}, []),  # a number word matches its digit ...
    ({"k": ["in two bays of 12"]}, {"k": "12대씩 두 개 베이"}, []),  # ... and the Korean may spell it too
    ({"k": ["in two bays of 12"]}, {"k": "12대씩 3개 베이"}, ["k: English {'12': 1} and spelled {'2': 1}, Korean {'12': 1, '3': 1}"]),
    ({"k": ["One batch, Eight 8"]}, {"k": "배치 하나, 여덟 8"}, []),  # a word the Korean does not write as a digit is no drop
    ({"k": ["from 7 July to 7 October 2025"]}, {"k": "2025년 7월 7일부터 10월 7일까지"}, []),
    ({"k": ["from 7 July to 7 October 2025"]}, {"k": "2025년 7월 7일부터 11월 7일까지"}, ["k: English {'7': 2, '2025': 1} and spelled {'7': 1, '10': 1}, Korean {'2025': 1, '7': 3, '11': 1}"]),
    ({"k": ["January 2011"]}, {"k": "2011년 1월"}, []),
    ({"k": ["arrivals may outrun it"]}, {"k": "도착이 5월을 넘을 수 있습니다"}, ["k: English {} and spelled {}, Korean {'5': 1}"]),
    ({"k": ["Eight 8", "Nine"]}, {"k": "여덟 8"}, ["k: English {} and spelled {'9': 1}, Korean {'8': 1}"]),
    ({}, {"k": "x"}, ["k: no English element carries this key"]),
])
def test_the_finder_reads_a_digit_the_korean_added_or_dropped(english, korean, expected):
    found = [re.sub(r" \(.*\)$", "", f) for f in parity_failures(english, korean)]
    assert found == expected


def test_the_finder_reads_the_dictionary_one_entry_per_line():
    assert korean_texts('window.I18N_KO = {\n"a.b": "x \\"1\\" y",\n"c": "z"\n};\n') == {"a.b": 'x "1" y', "c": "z"}
    with pytest.raises(AssertionError):
        korean_texts('{\n"a": "x\n y",\n}')


# ---- the explainer ---------------------------------------------------------------------------------


def test_every_number_of_the_english_prose_sits_under_a_data_src():
    assert any(quantities(n.text) for n in Walk(BODY).nodes), "the parser finds no number in body.html"
    assert describe(unsourced(BODY)) == []


def test_every_id_in_a_data_src_is_an_entry_of_the_ledgers():
    sources, assumptions, _ = load_ledgers(REPO)
    assert sources and assumptions, "the ledgers did not load"
    assert re.search(r'data-src="[^"]+"', BODY), "body.html carries no data-src"
    assert unknown_ids(BODY, set(sources) | set(assumptions)) == []


def test_the_korean_carries_the_same_digit_runs_as_the_english_for_every_key():
    korean, english = korean_texts(JS), Walk(BODY).english
    assert len(korean) > 100 and any(digit_runs(t) for ts in english.values() for t in ts), "the dictionary or the page was not read"
    assert parity_failures(english, korean) == []
