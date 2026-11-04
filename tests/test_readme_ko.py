"""The Korean README (R2) against the English one: ADR-0006 says English comes first and the Korean text must not introduce a number, a claim or a source that the English text lacks.

Parity here means: the same sections and subsections in the same order (the Korean headings are typed by hand below, and the table of contents links their anchors), the same pictures (the Korean file has
its own screenshots of the plant, the card table and Lineage and shares the others), the same links, the same code blocks to the byte (commands, the diagram), the same folders and flags in the tables, the
same count of list items, table rows and paragraphs, and in every section no digit, no ledger id, no ADR number and no inline code that the English section lacks. The claims that tests/test_readme.py pins
in English (the honesty wording of A2, ADR-0022, the addresses, the local build) are pinned in Korean by the phrases typed here, so a sentence that is dropped or softened in the translation fails.
Expected values are typed by hand.
"""
from __future__ import annotations

import re
from collections import Counter

from helpers import REPO
from test_readme import FLAGS, FOLDERS, README, RANKING, SITE, slug, top

KO = (REPO / "README.ko.md").read_text(encoding="utf-8")
SECTIONS_KO = ["할 수 있는 것", "동작 방식", "빠른 시작", "사용법", "무엇을 비교하는가", "읽는 방법", "구성", "작업 방식", "라이선스"]
SUBSECTIONS_KO = ["역추적 사례를 로컬에서 보기", "점검과 그림", "공장", "다른 화면", "수치"]
# words that rank the architectures, in Korean (no ranking column, no "wins": invariant 9, spec section 8)
RANKING_KO = ["더 낫", "더 좋", "우수", "최고", "최악", "승자", "이긴", "앞선", "뛰어난", "우월", "열등", "우승"]


def fenced(text: str) -> list[tuple[str, str]]:
    return re.findall(r"^```(\w*)\n(.*?)^```", text, re.S | re.M)


def without_code(text: str) -> str:
    return re.sub(r"```.*?```", "", text, flags=re.S)


def outline(text: str) -> list[tuple[int, str]]:
    return [(len(m.group(1)), m.group(2)) for m in re.finditer(r"^(#{1,3}) (.+)$", without_code(text), re.M)]


def parts(text: str) -> list[str]:
    """The top (the title down to the table of contents) and then each `## ` section with its subsections."""
    return re.split(r"^(?=## )", text, flags=re.M)


def images(text: str) -> list[str]:
    return re.findall(r"!\[[^\]]*\]\(([^)]+)\)", text)


def links(text: str) -> list[str]:
    return re.findall(r"(?<!!)\[[^\]]+\]\(([^)]+)\)", text)


def digits(text: str) -> Counter:
    return Counter(re.findall(r"\d+", text))


def ids(text: str) -> Counter:
    return Counter(re.findall(r"\b(?:[AS]\d{3}|ADR-\d{4}|VR-\d{3})\b", text))


def code_spans(text: str) -> set[str]:
    return set(re.findall(r"`([^`\n]+)`", without_code(text)))


def flat(text: str) -> str:
    return " ".join(text.split())


def between(text: str, start: str, end: str | None = None) -> str:
    """The text after the first `start` and before the next `end` (to the end of the file when there is none), whitespace folded."""
    rest = text.split(start, 1)[1]
    return flat(rest.split(end, 1)[0] if end else rest)


# ---- parity ---------------------------------------------------------------------------------------


def test_the_korean_readme_has_the_same_sections_and_subsections_in_the_same_order():
    assert [h for lvl, h in outline(KO) if lvl == 2] == SECTIONS_KO
    assert [h for lvl, h in outline(KO) if lvl == 3] == SUBSECTIONS_KO
    assert [lvl for lvl, _ in outline(KO)] == [lvl for lvl, _ in outline(README)]  # the same levels at the same places, the title first


def test_it_opens_like_the_english_one_with_the_language_row_the_other_way_round_and_the_same_tour():
    head = top(KO)
    assert len(head) == 6 and head[0] == "# ![](docs/media/mark.svg) Sample Lineage Lab"
    assert re.fullmatch(r"[^.\n]+\.", head[1]) or head[1].endswith("시뮬레이터입니다.")  # one sentence
    assert head[2] == "[English](README.md) | **한국어**"  # the current language bold and not linked, in the same order as the English row
    assert head[3].endswith("(docs/media/tour.gif)")


def test_the_table_of_contents_links_the_anchors_of_the_korean_headings():
    toc = re.findall(r"^- \[([^\]]+)\]\((#[^)]+)\)$", top(KO)[5], re.M)
    assert [name for name, _ in toc] == SECTIONS_KO
    assert [anchor for _, anchor in toc] == ["#" + slug(h) for h in SECTIONS_KO]
    assert [anchor for _, anchor in toc][2:4] == ["#빠른-시작", "#사용법"]  # Hangul stays in the anchor, spaces become hyphens
    assert len(toc) == len(re.findall(r"^- \[", top(README)[5], re.M))


def test_it_shows_the_same_pictures_in_the_same_places_with_its_own_screenshots_of_three_of_them():
    en, ko = images(README), images(KO)
    assert [p.replace("_ko.png", "_en.png") for p in ko] == en
    assert ko == ["docs/media/mark.svg", "docs/media/tour.gif", "docs/media/plant_ko.png", "docs/media/tour_table_ko.png", "docs/media/lineage_ko.png", "docs/media/results_en.png", "docs/media/action.gif",
                  "docs/media/breakout_en.png"]


def test_it_has_the_same_links_with_the_switch_pointing_at_the_other_file():
    def targets(text: str) -> list[str]:
        return [t for t in links(text) if not t.startswith("#")]  # the anchors of the table of contents are the Korean headings' own (above)

    en = [t if t != "README.ko.md" else "README.md" for t in targets(README)]
    assert targets(KO) == en
    assert en == ["README.md", SITE, SITE + "lab/", "docs/design/", "docs/adr/"]
    assert len(links(KO)) == len(links(README))


def test_it_has_the_same_code_blocks_to_the_byte_and_the_same_folders_and_flags():
    assert fenced(KO) == fenced(README)  # the commands, the paths and the diagram stay exactly as they are
    assert sorted(lang for lang, _ in fenced(KO)) == ["bash", "bash", "bash", "mermaid"]
    assert re.findall(r"^\| `([^`]+/)` \|", KO, re.M) == re.findall(r"^\| `([^`]+/)` \|", README, re.M) == [f + "/" for f in FOLDERS]
    compared = [text.split(heading, 1)[1].split(next_heading, 1)[0] for text, heading, next_heading in ((README, "## What it compares", "## How to read it"), (KO, "## 무엇을 비교하는가", "## 읽는 방법"))]
    assert [re.findall(r"^\| `(\w+)` \|", c, re.M) for c in compared] == [FLAGS, FLAGS]


def test_each_section_has_the_same_count_of_list_items_table_rows_and_paragraphs():
    en, ko = parts(README), parts(KO)
    assert len(en) == len(ko) == 10
    for i, (a, b) in enumerate(zip(en, ko)):
        assert len(re.findall(r"^- ", a, re.M)) == len(re.findall(r"^- ", b, re.M)), i
        assert len(re.findall(r"^\|", a, re.M)) == len(re.findall(r"^\|", b, re.M)), i
        assert len([p for p in a.split("\n\n") if p.strip()]) == len([p for p in b.split("\n\n") if p.strip()]), i


def test_no_section_has_a_digit_a_ledger_id_an_adr_number_or_a_code_span_that_its_english_section_lacks():
    en, ko = parts(README), parts(KO)
    for i, (a, b) in enumerate(zip(en, ko)):
        assert not digits(b) - digits(a), (i, digits(b) - digits(a))
        assert not ids(b) - ids(a), (i, ids(b) - ids(a))
        assert not code_spans(b) - code_spans(a), (i, code_spans(b) - code_spans(a))
    assert not digits(KO) - digits(README) and not ids(KO) - ids(README)


def test_it_states_no_percentage_and_no_ranking_in_korean():
    assert "%" not in KO
    for word in RANKING_KO:
        assert word not in KO, word
    assert re.findall(RANKING, KO, re.I) == []


def test_the_korean_prose_has_no_dash_and_no_bold_but_the_language_row():
    text = re.sub(r"`[^`\n]*`", "", without_code(KO))
    assert not re.search(r"[\u2014\u2013]| -- ", text)
    assert re.findall(r"\*\*[^*]+\*\*", text) == ["**한국어**"]
    assert not re.search(r"[\U0001F300-\U0001FAFF\u2600-\u27BF\u2190-\u21FF]", KO)


# ---- the claims the English tests pin, in Korean --------------------------------------------------


def test_it_says_the_site_goes_live_when_the_author_publishes_it_and_where_the_language_is_kept():
    quick = between(KO, "## 빠른 시작", "### 역추적 사례를 로컬에서 보기")
    assert "저자가 공개하면 사이트가 열립니다" in quick and "이 주소들이 응답하지 않으므로" in quick and quick.index("jin-wolee.github.io") < quick.index("```bash")
    usage = between(KO, "## 사용법", "### 공장")
    assert "영어로 열리고 한국어 전환 버튼이 있으며(ADR-0006)" in usage and "고른 언어는 다른 페이지로 넘어가도 유지됩니다" in usage and "글로 된 판" in usage
    assert f"]({SITE})" in KO and f"]({SITE}lab/)" in KO


def test_it_opens_with_the_synthetic_data_and_no_prediction_and_the_table_of_what_you_can_do_ends_the_section():
    lead = top(KO)[4]
    assert "모든 데이터는 합성이며" in lead and "실제 공장을 예측하지 않습니다(ADR-0001)" in lead
    can_do = between(KO, "## 할 수 있는 것", "## 동작 방식")
    assert "로컬 빌드에서만 있으며 공개 빌드에는 없습니다" in can_do and can_do.rstrip().endswith("|")  # the table is the section, as in the English


def test_it_says_how_it_works_as_the_english_does():
    how = between(KO, "## 동작 방식", "## 빠른 시작")
    assert "관찰 가능한 이벤트만 기록하므로" in how and "진실은 들어가지 않습니다" in how
    assert "엔진 코드를 가져오지 않고 결과를 직접 계산하지도 않으며" in how and "같은 시드는 언제나 같은 실행을 냅니다" in how


def test_it_names_the_ten_flags_and_the_three_presets_as_the_english_does():
    compared = KO.split("## 무엇을 비교하는가", 1)[1].split("## 읽는 방법", 1)[0]
    assert "플래그 열 개" in compared and "(ADR-0005, ADR-0017, ADR-0020)" in compared
    assert re.search(r"^- A, 수작업 또는 엑셀: 켜진 플래그 없음\.$", compared, re.M)
    assert re.search(r"^- B, LIMS-lite: `system_issued_id`, `ingest_idempotency`, `audit_trail`, `equipment_links`\.", compared, re.M)
    assert re.search(r"^- C, 맥락 보존: 열 개 모두\.", compared, re.M)
    assert "(예시 시각, A102)" in compared and "(A103)" in compared and "08:40" in compared and "09:00" in compared and "09:25" in compared
    assert "`docs/design/simulation_spec.md`" in compared and "`docs/design/data_model.md`" in compared


def test_it_does_not_claim_the_wrong_tube_or_who_changed_a_result():
    compared = between(KO, "## 무엇을 비교하는가", "## 읽는 방법")
    assert "올바른 바코드가 엉뚱한 튜브에 붙는 경우는 모형화하지 않습니다" in compared
    row = re.search(r"^\| `audit_trail` \| (.+) \|$", KO, re.M).group(1)
    assert "이전 값과 새 값" in row and "누가 결과를 바꾸었는지, 왜 바꾸었는지는 아님" in row


def test_it_keeps_the_wording_of_how_to_read_the_comparison():
    reading = between(KO, "## 읽는 방법", "### 수치")
    assert "정확한 복원은 구성상 영입니다" in reading and "구성적 예시" in reading
    assert "실제 스프레드시트나 실험실 시스템의 품질, 효율, 도입 효과를 재는 척도가 아닙니다" in reading
    assert "모형의 불확실성이 아닙니다" in reading and "세포주의 상수는 시드에 따라 바뀌지 않으므로" in reading
    assert "최소 시드 수(A103)는 설계상의 문턱이며, 통계적 충분성의 증명이 아닙니다" in reading
    assert "`VR-010`" in reading and "A046과 A213은 둘 다 잠정" in reading
    assert "혈액가스 취급에서 가져온 대리 기준이며, 가정으로서 모든 분석 항목에 적용합니다" in reading
    assert "실제 실험실의 정확도가 아닙니다" in reading
    assert "보류는 기록의 상태이며 배양을 멈추지 않습니다" in reading and "민감도가 아니라 포괄 범위로 판정합니다" in reading


def test_it_keeps_the_break_out_screen_back_and_says_the_pages_ship_no_result():
    numbers = between(KO, "### 수치", "## 구성")
    assert "main-reread 출처만 뒷받침합니다" in numbers and "점선 잠정 칩" in numbers and "`scripts/check_docs.py`" in numbers
    assert "보류되어 있습니다" in numbers and "공개 빌드는 그 화면을 거절하고 사례를 내놓지 않습니다" in numbers and "다시 읽을 때까지" in numbers
    assert "페이지는 결과를 싣고 있지 않습니다" in numbers and "방문할 때마다 내 브라우저 안에서" in numbers


def test_it_says_what_the_plant_is_and_what_it_leaves_to_the_local_build():
    plant = between(KO, "### 공장", "### 다른 화면")
    for phrase in ("기록 보관실", "렌즈", "진실 오버레이는 요청하기 전까지 꺼져 있습니다", "시뮬레이션 자체의 시점", "운영자 조작", "처음부터 다시 돌리고", "같은 시점으로 돌아옵니다",
                   "안내 장면", "다섯 단계", "어느 단계에서든 건너뛸 수 있습니다", "계보, 결과, 노트 화면"):
        assert phrase in plant, phrase
    assert "역추적 사례의 공장" in plant and "로컬 빌드에서만 있습니다" in plant and "공개 빌드는 역추적 화면과 그 사례를 거절합니다" in plant


def test_it_says_the_versions_the_local_build_and_the_gate_of_the_workflow():
    quick = between(KO, "## 빠른 시작", "## 사용법")
    assert "`engines`" in quick and "`requires-python`" in quick and "`.nvmrc`" not in quick  # R3
    assert "`http://127.0.0.1:8000/`" in quick and "`http://127.0.0.1:8000/lab/`" in quick and "랩은 파일 주소로는 동작하지 않습니다" in quick
    assert "공개 빌드는 역추적 화면과 공장 안의 역추적 사례를 뺍니다" in quick
    assert "점검이 하나라도 실패하면 배포가 막힙니다" in quick and "판정하지 않습니다(`--timing report`)" in quick


def test_it_says_the_sql_and_simpy_track_was_written_by_ai_and_where_its_agreement_is_measured():
    how = between(KO, "## 작업 방식", "## 라이선스")
    assert "(ADR-0002)" in how and "ADR-0022" in how and "ADR-0010" in how
    assert "AI(Claude Code)가 명세만 보고 작성했습니다(clean-room)" in how and "엔진의 소스는 읽지 않았습니다" in how and "저자는 이 파일들을 쓰지 않았습니다" in how
    assert "`tests/user_track/`" in how and "측정합니다" in how
    assert "명세를 쓴 모델 계열에서 독립적이지는 않습니다" in how
    assert "푸시와 공개는 저자만 하며" in how
    assert "저자가 직접 작성" not in how and "저자가 쓴" not in how  # the claim of ADR-0010 for these files is gone


def test_it_states_the_two_licences_and_the_files_that_hold_them_and_ends_on_the_design_notes():
    licence = between(KO, "## 라이선스")
    assert "MIT" in licence and "`LICENSE`" in licence and "CC BY 4.0" in licence and "`docs/LICENSE-docs.md`" in licence and "`docs/media/`" in licence and "(ADR-0008)" in licence
    assert KO.rstrip().endswith("더 깊이 알고 싶다면 [설계 노트](docs/design/)와 [결정 기록](docs/adr/)을 읽으세요.")
