"""The infographic's status line says what exists now (S3h3): the lab is built, the Break-out screen is held back (docs/design/lab_ui.md sections 6 and 20; ADR-0013).

The texts are typed by hand from that state and compared with the page's sources and with the committed page. The Korean text introduces no number, claim or source that the English lacks (ADR-0006).
The headless page QA (scripts/qa_infographic.py) reads the built page in both languages.
"""
from __future__ import annotations

import re

from helpers import REPO

INFOGRAPHIC = REPO / "site" / "infographic"

EYEBROW_EN = "Technical explainer &middot; lab built"
NOTICE_EN = (
    "Status: the lab is built and runs the synthetic plant in your browser; its Break-out screen is held back until the sources behind it are re-read. "
    "All data is synthetic, built from public sources and labelled assumptions. This page states no simulation result, and nothing on it predicts a real laboratory."
)
EYEBROW_KO = "기술 해설 · 랩 구현됨"
NOTICE_KO = (
    "현재 상태: 랩이 구현되어 있어 합성 플랜트를 브라우저에서 실행합니다. 오염 이벤트 역추적 화면은 그 근거 출처를 다시 읽을 때까지 보류 중입니다. "
    "모든 데이터는 합성 데이터이며, 공개 자료와 명시한 가정으로 만들었습니다. 이 페이지는 시뮬레이션 결과를 제시하지 않으며, 실제 실험실을 예측하지 않습니다."
)
OLD = ("Design phase", "design phase", "design-phase", "No simulation result exists yet", "설계 단계", "아직 시뮬레이션 결과는 없고")


def element(html: str, key: str, tag: str) -> str:
    m = re.search(rf'<{tag}\b[^>]*\bdata-i18n="{re.escape(key)}"[^>]*>(.*?)</{tag}>', html, re.S)
    assert m, f"{key} not found"
    return m.group(1)


def korean(js: str, key: str) -> str:
    m = re.search(rf'^"{re.escape(key)}": "(.*)",?$', js, re.M)
    assert m, f"{key} not found"
    return m.group(1)


def test_the_source_page_states_the_lab_and_the_held_back_screen_in_english():
    body = (INFOGRAPHIC / "src" / "body.html").read_text(encoding="utf-8")
    assert element(body, "p.eyebrow", "p") == EYEBROW_EN
    assert element(body, "p.notice", "p") == NOTICE_EN


def test_the_dictionary_states_the_same_in_korean():
    ko = (INFOGRAPHIC / "src" / "i18n.js").read_text(encoding="utf-8")
    assert korean(ko, "p.eyebrow") == EYEBROW_KO
    assert korean(ko, "p.notice") == NOTICE_KO


def test_the_committed_page_carries_both_texts():
    page = (INFOGRAPHIC / "index.html").read_text(encoding="utf-8")
    assert element(page, "p.eyebrow", "p") == EYEBROW_EN
    assert element(page, "p.notice", "p") == NOTICE_EN
    assert f'"p.eyebrow": "{EYEBROW_KO}"' in page
    assert f'"p.notice": "{NOTICE_KO}"' in page


def test_the_design_phase_wording_is_gone_from_the_sources_the_page_and_its_description():
    texts = {p: (INFOGRAPHIC / p).read_text(encoding="utf-8") for p in ("src/body.html", "src/i18n.js", "build.py", "index.html")}
    found = [(p, w) for p, t in texts.items() for w in OLD if w in t]
    assert found == []


def test_the_status_line_adds_no_number_and_no_ledger_id_in_either_language():
    # the page's numbers carry ledger ids (invariant 3); the status line has none, so it must hold no digit
    for text in (EYEBROW_EN, NOTICE_EN, EYEBROW_KO, NOTICE_KO):
        assert not re.search(r"\d", text.replace("&middot;", "")), text


def test_the_status_line_keeps_the_two_promises_of_the_old_notice():
    # synthetic data, and no prediction of a real laboratory (invariants 1 and 9 of .claude/CLAUDE.md)
    assert "All data is synthetic" in NOTICE_EN and "predicts a real laboratory" in NOTICE_EN
    assert "합성 데이터" in NOTICE_KO and "실제 실험실을 예측하지 않습니다" in NOTICE_KO
