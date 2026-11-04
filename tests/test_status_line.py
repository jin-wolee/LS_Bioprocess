"""The infographic's status line says what holds now (S3h3, reworded in P10): all data is synthetic, the page states no simulation result and predicts no real laboratory, and the Break-out screen is held
back in the public build (docs/design/lab_ui.md sections 6 and 20; ADR-0013).

P10 moved the line from a large notice that opened the page to a quiet note under the lede and the picture of the plant, and cut it to those promises: what the lab is and what it runs is said by the
lede, the call to action and the picture (tests/test_explainer_first_screen.py). The texts are typed by hand from that state and compared with the page's sources and with the committed page. The Korean
text introduces no number, claim or source that the English lacks (ADR-0006). The headless page QA (scripts/qa/qa_infographic.py) reads the built page in both languages.
"""
from __future__ import annotations

import re

from helpers import REPO

INFOGRAPHIC = REPO / "site" / "infographic"

EYEBROW_EN = "Interactive explainer"
NOTICE_EN = (
    "All data is synthetic, and nothing on this page predicts a real laboratory or states a simulation result. "
    "The Break-out screen and the plant's Break-out cases are held back in the public build until the sources behind them are re-read."
)
EYEBROW_KO = "인터랙티브 해설"
NOTICE_KO = (
    "모든 데이터는 합성 데이터이고, 이 페이지는 시뮬레이션 결과를 제시하지 않으며 실제 실험실을 예측하지 않습니다. "
    "오염 이벤트 역추적 화면과 플랜트 안의 이탈 사례는 그 근거 출처를 다시 읽을 때까지 공개 빌드에서 보류 중입니다."
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


def test_the_status_line_still_says_no_simulation_result_and_that_the_break_out_screen_is_held_back_in_both_languages():
    # the old notice said both; P10 cut it to two sentences and kept them
    assert "states a simulation result" in NOTICE_EN and "시뮬레이션 결과를 제시하지 않으며" in NOTICE_KO
    assert "The Break-out screen" in NOTICE_EN and "held back in the public build until the sources behind them are re-read" in NOTICE_EN
    assert "오염 이벤트 역추적 화면" in NOTICE_KO and "그 근거 출처를 다시 읽을 때까지 공개 빌드에서 보류 중입니다" in NOTICE_KO


def test_the_status_line_is_one_or_two_short_sentences_and_the_eyebrow_names_no_build_state():
    assert len(re.findall(r"[.] |[.]$", NOTICE_EN)) == 2 and len(re.findall(r"[.] |[.]$", NOTICE_KO)) == 2
    for text in (EYEBROW_EN, EYEBROW_KO):
        assert "built" not in text.lower() and "구현" not in text, text


# ---- what exists, said in the footer of the explainer (P9, 2026-11-03) ----------------------------------------------------------

PLANT_EN = (
    "The plant in the lab is a scene you can walk through. The clock plays, pauses, speeds up and moves to any instant of the run. Each data architecture has a record hall whose shelves hold a card for each "
    "sample that record keeps. On request a view shows what the simulation knows and no record can hold, marked as the simulation's own view. Operator actions, such as adding a feed or taking an analyzer down, "
    "rerun the plant, and a card or a reactor links to the Lineage and Results screens. A short guided scene follows one sample that was drawn before a feed and measured after it. "
    "The Break-out cases in the plant exist in the local build only."
)
PLANT_KO = (
    "랩의 플랜트는 걸어 다니며 볼 수 있는 장면입니다. 시계는 재생하고, 멈추고, 빠르게 돌리고, 실행의 어느 시점으로든 옮길 수 있습니다. 데이터 아키텍처마다 기록 보관실이 하나씩 있고, "
    "그 선반에는 그 기록이 보관한 시료마다 카드가 하나씩 놓입니다. 요청하면 시뮬레이션은 알지만 어떤 기록에도 담길 수 없는 것을 시뮬레이션 자체의 시점으로 표시해 보여 줍니다. "
    "피드 추가나 분석기 중단 같은 운영자 조작은 플랜트를 다시 계산하고, 카드나 리액터에서 계보 화면과 결과 화면으로 이어집니다. 짧은 안내 장면은 피드 전에 채취하고 피드 후에 측정한 시료 하나를 따라갑니다. "
    "플랜트 안의 이탈 사례는 로컬 빌드에서만 있습니다."
)
SQL_EN = (
    "The database schema, three SQL queries and a SimPy core loop were written by AI from the specification, without reading the engine's source. The author did not write them. "
    "Tests measure how far they agree with the TypeScript engine; they are a second implementation that does not copy the engine's code, and they are not independent of the model family that wrote the specification."
)
SQL_KO = (
    "데이터베이스 스키마, SQL 쿼리 세 개, SimPy 핵심 루프는 엔진 소스를 읽지 않고 명세만 보고 AI가 작성했습니다. 저자가 쓴 것이 아닙니다. "
    "테스트가 TypeScript 엔진과의 일치를 측정합니다. 엔진의 코드를 베끼지 않은 두 번째 구현이지만, 명세를 쓴 모델 계열로부터 독립적인 것은 아닙니다."
)
ROAD_EN = "lab UI in the browser with a walkable plant, break-out events with the investigation walk-back"
ROAD_KO = "걸어 다닐 수 있는 플랜트가 있는 브라우저 실험실 UI, 이탈 이벤트와 조사 역추적"
EXT_HELD_EN = "The lab's Break-out screen and the Break-out cases in the plant are held back in the public build until the sources behind them are re-read"
EXT_HELD_KO = "랩의 오염 이벤트 역추적 화면과 플랜트 안의 이탈 사례는 그 근거 출처를 다시 읽을 때까지 공개 빌드에서 보류 중입니다"


def test_the_footer_of_the_source_page_says_what_the_plant_is_and_who_wrote_the_sql_and_simpy_files():
    body = (INFOGRAPHIC / "src" / "body.html").read_text(encoding="utf-8")
    assert element(body, "m.plant", "p") == PLANT_EN
    assert element(body, "m.sql", "p") == SQL_EN
    assert element(body, "m.r3", "span") == ROAD_EN
    assert EXT_HELD_EN in element(body, "m.ext", "p")


def test_the_dictionary_says_the_same_in_korean():
    ko = (INFOGRAPHIC / "src" / "i18n.js").read_text(encoding="utf-8")
    assert korean(ko, "m.plant") == PLANT_KO
    assert korean(ko, "m.sql") == SQL_KO
    assert korean(ko, "m.r3") == ROAD_KO
    assert EXT_HELD_KO in korean(ko, "m.ext")


def test_the_committed_page_carries_the_footer_in_both_languages():
    page = (INFOGRAPHIC / "index.html").read_text(encoding="utf-8")
    assert element(page, "m.plant", "p") == PLANT_EN and element(page, "m.sql", "p") == SQL_EN
    assert f'"m.plant": "{PLANT_KO}"' in page and f'"m.sql": "{SQL_KO}"' in page


def test_the_footer_names_the_plant_and_the_ai_authorship_without_a_number_a_result_or_a_ranking():
    # invariants 3 and 9: no digit (a figure would need its ledger id), no result, nothing that ranks; ADR-0022 requires the AI authorship to be said wherever the files are described
    for text in (PLANT_EN, PLANT_KO, SQL_EN, SQL_KO, ROAD_EN, ROAD_KO):
        assert not re.search(r"\d", text), text
    for word in ("walk", "clock", "record hall", "On request", "Operator actions", "links to the Lineage and Results", "guided scene", "local build only"):
        assert word in PLANT_EN, word
    assert "written by AI from the specification" in SQL_EN and "The author did not write them" in SQL_EN and "not independent of the model family" in SQL_EN
    assert "AI가 작성했습니다" in SQL_KO and "저자가 쓴 것이 아닙니다" in SQL_KO
    assert not re.search(r"\b(better|best|worse|worst|wins?|winner|outperforms?|beats?)\b", PLANT_EN + SQL_EN, re.I)


# ---- the status lines of the design notes (A2, 2026-11-02) --------------------------------------------

DESIGN = REPO / "docs" / "design"
STALE = ("no simulation result exists yet", "No simulation result of the lab exists yet", "No simulation result of the plant exists yet", "are not built before S2")


def adr_status(number: str) -> str:
    path = next((REPO / "docs" / "adr").glob(f"{number}-*.md"))
    m = re.search(r"^- \*\*Status:\*\* (\w+)", path.read_text(encoding="utf-8"), re.M)
    assert m, path
    return m.group(1)


def test_no_design_note_says_that_no_result_exists_or_that_a_built_part_is_not_built():
    found = [(p.name, w) for p in sorted(DESIGN.glob("*.md")) for w in STALE if w in p.read_text(encoding="utf-8")]
    assert found == []


def test_each_design_note_still_states_no_simulation_result_and_what_exists():
    for name in ("simulation_spec", "lab_ui", "plant_ui"):
        status = next(line for line in (DESIGN / f"{name}.md").read_text(encoding="utf-8").splitlines() if line.startswith("Status:"))
        assert "states no simulation result" in status, name
    assert "are built" in next(line for line in (DESIGN / "data_model.md").read_text(encoding="utf-8").splitlines() if line.startswith("Status:"))


def test_an_adr_named_with_a_status_in_the_design_notes_has_that_status():
    # "ADR-0014 (Proposed)" and "(ADR-0019, Proposed)" were true when written and stale after the author accepted them: the status a note gives is the status of the ADR file
    wrong = []
    for p in sorted(DESIGN.glob("*.md")):
        for m in re.finditer(r"ADR-(\d{4})(?: \(|, )(Proposed|Accepted)\b", p.read_text(encoding="utf-8")):
            if adr_status(m.group(1)) != m.group(2):
                wrong.append((p.name, f"ADR-{m.group(1)}", m.group(2), adr_status(m.group(1))))
    assert wrong == []
