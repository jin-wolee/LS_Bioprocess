"""The explainer counts the flags as the specification does (S3h4): a new flag cannot leave the page behind.

The page said "eight independent feature flags" and listed eight after ADR-0017 and ADR-0020 had made ten. The expected list is typed by hand (the flag table of spec section 5, in its order) and
compared with the table, with FLAG_NAMES in engine/src/record/architecture.ts, and with what the explainer says: every count of flags in either language, the flag list of the architectures
section, the script's list and the presets. The page counts flags by the list and never by ordinal ("a ninth flag" went stale the same way), so an ordinal in its text fails too.
"""
from __future__ import annotations

import re

import pytest
from helpers import REPO

FLAGS = [
    "system_issued_id", "two_clocks", "available_at", "instrument_state_snapshot", "append_only_versions",
    "write_time_keys", "ingest_idempotency", "audit_trail", "material_lot_links", "equipment_links",
]
PRESET_B = ["system_issued_id", "ingest_idempotency", "audit_trail", "equipment_links"]  # spec section 5, ADR-0020 (the author's choice, 2026-10-30)

SPEC = REPO / "docs" / "design" / "simulation_spec.md"
ARCHITECTURE = REPO / "engine" / "src" / "record" / "architecture.ts"
INFOGRAPHIC = REPO / "site" / "infographic"
SOURCES = {name: INFOGRAPHIC / name for name in ("src/body.html", "src/i18n.js", "src/app.js", "index.html")}

EN_COUNT = {"two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12}
KO_COUNT = {"둘": 2, "두": 2, "셋": 3, "세": 3, "넷": 4, "네": 4, "다섯": 5, "여섯": 6, "일곱": 7, "여덟": 8, "아홉": 9, "열": 10, "열한": 11, "열두": 12}
EN_ORDINAL = r"(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)"
KO_ORDINAL = r"(?:첫|두|세|네|다섯|여섯|일곱|여덟|아홉|열|열한|열두)"


def _alternation(words: dict[str, int]) -> str:
    return "|".join(sorted(words, key=len, reverse=True)) + r"|\d+"


EN_PHRASE = re.compile(rf"\b({_alternation(EN_COUNT)})\s+(?:(?:independent|feature|boolean)\s+)*flags\b", re.I)
KO_PHRASE = re.compile(rf"플래그\s*({_alternation(KO_COUNT)})\s*개|({_alternation(KO_COUNT)})\s*개의\s*(?:독립적인\s*)?(?:기능\s*)?플래그")
ORDINAL = re.compile(rf"\b{EN_ORDINAL}\s+flag\b|{KO_ORDINAL}\s*번째\s*플래그", re.I)


def counted(text: str) -> list[int]:
    """Every total the text puts in front of the word flags, in either language ("one flag" is not a total: the plural is required)."""
    found = [m.group(1) for m in EN_PHRASE.finditer(text)]
    found += [m.group(1) or m.group(2) for m in KO_PHRASE.finditer(text)]
    return [int(w) if w.isdigit() else EN_COUNT.get(w.lower(), KO_COUNT.get(w)) for w in found]


def prose(html: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html))


def spec_flags() -> list[str]:
    spec = SPEC.read_text(encoding="utf-8")
    table = spec.split("## 5. Data architecture = feature flags", 1)[1].split("Planned time is separate", 1)[0]
    return re.findall(r"^\| `(\w+)` \|", table, re.M)


def spec_preset_b() -> list[str]:
    spec = SPEC.read_text(encoding="utf-8")
    row = re.search(r"^\| B LIMS-lite \| ([^|]*) \|", spec.split("## 5. Data architecture = feature flags", 1)[1], re.M)
    assert row, "no preset row B in spec section 5"
    return re.findall(r"`(\w+)`", row.group(1))


def engine_flags() -> list[str]:
    """CORE_FLAG_NAMES plus the names FLAG_NAMES adds, in the order of the file."""
    source = ARCHITECTURE.read_text(encoding="utf-8")
    core = re.search(r"export const CORE_FLAG_NAMES = \[(.*?)\] as const", source, re.S)
    full = re.search(r"export const FLAG_NAMES = \[\.\.\.CORE_FLAG_NAMES((?:, \"\w+\")*)\] as const", source)
    assert core and full, "engine/src/record/architecture.ts no longer builds FLAG_NAMES from CORE_FLAG_NAMES and a list of strings"
    return re.findall(r'"(\w+)"', core.group(1)) + re.findall(r'"(\w+)"', full.group(1))


def page(name: str) -> str:
    return SOURCES[name].read_text(encoding="utf-8")


# ---- the finder (the test of the test) ------------------------------------------------------------


@pytest.mark.parametrize("text, expected", [
    ("The design uses eight independent feature flags instead.", [8]),
    ("A data architecture is a set of ten flags.", [10]),
    ("All 10 feature flags are on.", [10]),
    ("C is all twelve flags.", [12]),
    ("C with exactly one flag switched off.", []),
    ("The flag list and the flags column.", []),
    ("이 설계는 대신 독립적인 기능 플래그 여덟 개를 씁니다.", [8]),
    ("플래그 10개를 씁니다.", [10]),
    ("열 개의 기능 플래그를 씁니다.", [10]),
    ("C에서 플래그를 정확히 하나만 끈 상태입니다.", []),
])
def test_the_finder_reads_a_total_in_either_language(text, expected):
    assert counted(text) == expected


@pytest.mark.parametrize("text, found", [
    ("not a ninth flag", True),
    ("The Tenth Flag", True),
    ("아홉 번째 플래그가 아닌", True),
    ("the flag of the ninth ADR", False),
    ("a separate setting, not a flag", False),
])
def test_the_finder_reads_an_ordinal(text, found):
    assert bool(ORDINAL.search(text)) is found


# ---- the sources of the count ---------------------------------------------------------------------


def test_the_typed_list_is_the_flag_table_of_the_specification():
    assert spec_flags() == FLAGS


def test_the_engine_names_the_same_flags_in_the_same_order():
    assert engine_flags() == FLAGS


# ---- what the explainer says ----------------------------------------------------------------------


@pytest.mark.parametrize("name", ["src/body.html", "index.html"])
def test_every_count_of_flags_in_the_english_text_is_the_number_of_flags(name):
    found = counted(prose(page(name)))
    assert found, "the page no longer says how many flags there are"
    assert set(found) == {len(FLAGS)}, found


@pytest.mark.parametrize("name", ["src/i18n.js", "index.html"])
def test_every_count_of_flags_in_the_korean_text_is_the_number_of_flags(name):
    found = counted(page(name))
    assert found, "the Korean text no longer says how many flags there are"
    assert set(found) == {len(FLAGS)}, found


@pytest.mark.parametrize("name", ["src/body.html", "src/i18n.js", "index.html"])
def test_the_text_counts_flags_by_the_list_and_never_by_ordinal(name):
    assert ORDINAL.findall(prose(page(name))) == []


@pytest.mark.parametrize("name", ["src/body.html", "index.html"])
def test_the_flag_list_of_the_page_is_the_flag_table_in_its_order(name):
    assert re.findall(r'<input type="checkbox" id="flag-(\w+)"', page(name)) == FLAGS


@pytest.mark.parametrize("name", ["src/app.js", "index.html"])
def test_the_script_drives_the_same_flags(name):
    m = re.search(r"var FLAGS = \[([^\]]*)\];", page(name))
    assert m, "the script no longer declares var FLAGS"
    assert re.findall(r"'(\w+)'", m.group(1)) == FLAGS


@pytest.mark.parametrize("name", ["src/app.js", "index.html"])
def test_the_presets_of_the_script_are_those_of_the_specification(name):
    m = re.search(r"var PRESETS = \{ A: \[\], B: \[([^\]]*)\], C: FLAGS \};", page(name))
    assert m, "the script no longer declares PRESETS as A none, B a list and C all the flags"
    assert re.findall(r"'(\w+)'", m.group(1)) == PRESET_B == spec_preset_b()


def test_every_flag_of_the_list_has_a_korean_description():
    body, ko = page("src/body.html"), page("src/i18n.js")
    for flag in FLAGS:
        m = re.search(rf'id="flag-{flag}"[^>]*><span class="fn">{flag}</span><span class="fd" data-i18n="([\w.]+)"', body)
        assert m, f"no description of {flag} in the flag list"
        assert re.search(rf'^"{re.escape(m.group(1))}": "[^"]+"', ko, re.M), f"no Korean text {m.group(1)} for {flag}"
