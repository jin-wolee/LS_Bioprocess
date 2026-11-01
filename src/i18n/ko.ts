import type { Key, enBase } from "./en.ts";
import { koBreakout } from "./ko_breakout.ts";
import { koChallenge } from "./ko_challenge.ts";
import { koLineage } from "./ko_lineage.ts";
import { koNotes } from "./ko_notes.ts";
import { koPlant } from "./ko_plant.ts";
import { koResults } from "./ko_results.ts";
import { koSetup } from "./ko_setup.ts";

// Korean texts (ADR-0006: English first, Korean on a toggle). Typed Record<Key, string>, so a missing key is a type error. The Korean text introduces no number, claim or source that the
// English text lacks (engine/tests/lab/i18n.test.ts). Terms follow site/infographic/src/i18n.js where one exists there (the grades, the provisional chip).
const koBase: Record<keyof typeof enBase, string> = {
  "app.title": "샘플 계보 랩",
  "app.footer": "합성 데이터입니다. 표시된 입력 아래의 시뮬레이션 결과이며 실제 공장에 대한 예측이 아닙니다.",
  "app.loading": "Worker에서 엔진을 시작하는 중입니다.",

  "nav.label": "화면",
  "nav.home": "홈",
  "nav.setup": "설정",
  "nav.results": "결과",
  "nav.lineage": "계보",
  "nav.challenge": "챌린지",
  "nav.breakout": "역추적",
  "nav.notes": "노트",

  "controls.site": "해설 페이지",
  "controls.lang.label": "언어",
  "controls.lang.switch": "English",
  "controls.theme.label": "테마",
  "controls.theme.auto": "시스템 설정 따르기",
  "controls.theme.light": "라이트",
  "controls.theme.dark": "다크",

  "home.heading": "브라우저에서 돌리는 합성 공장",
  "home.lead": "바이오리액터들이 at-line 분석기를 나눠 쓰고, 분석기에 도착한 모든 시료는 계보로 추적됩니다. 이 랩은 같은 합성 실행을 여러 데이터 아키텍처로 기록하고, 각 기록이 나중에 무엇을 복원할 수 있는지 비교합니다.",
  "home.notice": "여기 있는 모든 것은 합성입니다. 이 페이지는 아래에 나열된 입력으로 시뮬레이션을 돌릴 뿐이며, 실제 공장을 설명하지도 예측하지도 않습니다.",
  "home.versions.heading": "버전",
  "home.versions.engine": "엔진 버전",
  "home.versions.schema": "스키마 버전",
  "home.run.heading": "기본 시나리오 한 번 실행",
  "home.run.lead": "시드 하나로, 이 방문에서, 이 브라우저 안에서 시뮬레이션된 공장이 만든 이벤트의 개수입니다. 표시된 입력 아래의 시뮬레이션 결과이며 실제 공장에 대한 사실이 아닙니다.",
  "home.run.pending": "실행을 기다리는 중입니다.",
  "home.inputs.heading": "기본 시나리오의 입력",
  "home.inputs.lead": "모든 입력에는 가정 원장에서의 항목 id와 그 항목의 등급이 붙습니다. 점선 칩은 출처를 아직 다 다시 읽지 않은 입력을 뜻합니다.",

  "result.label": "시뮬레이션 결과",
  "result.scenario": "시나리오",
  "result.seeds": "시드",
  "result.engine": "엔진 버전",
  "result.architectures": "아키텍처",
  "result.architectures.none": "없음: 이 실행은 아무것도 기록하지 않습니다",
  "result.check": "브라우저 검사",
  "result.check.pending": "미검사",
  "result.check.identical": "통과",
  "result.check.failed": "검증되지 않음",
  "result.check.error": "미검사",
  "result.events.type": "이벤트 유형",
  "result.events.count": "이벤트",
  "result.events.total": "전체 이벤트",

  "check.label": "브라우저 검사",
  "check.chip.pending": "실행 중",
  "check.chip.identical": "통과",
  "check.chip.failed": "실패",
  "check.chip.error": "실행 불가",
  "check.banner.pending": "브라우저 검사를 실행하는 중입니다. 지금 보이는 결과는 아직 검사되지 않았습니다.",
  "check.banner.identical": "브라우저 검사 통과: 이 브라우저는 기준 실행을 바이트 단위까지 똑같이 재현합니다.",
  "check.banner.failed": "브라우저 검사 실패: 이 브라우저가 기준과 다른 결과를 냈습니다. 아래 결과는 검증되지 않았습니다. 컴파일러 결함인지 다른 엔진의 차이인지는 이 페이지가 구분할 수 없습니다.",
  "check.banner.error": "브라우저 검사를 실행하지 못했습니다. 결과는 검사되지 않았습니다. 이유:",
  "check.detail.heading": "비교한 항목",
  "check.part.truth": "기본 시나리오의 실제 로그 해시를 기준과 비교",
  "check.part.repeats": "같은 시드의 반복 실행끼리 일치",
  "check.part.cells": "한 시드의 지표 셀을 기준과 비교",
  "check.part.equal": "일치",
  "check.part.differs": "다름",

  "error.heading": "엔진이 문제를 보고했습니다",
  "error.invalid_spec": "실행 요청이 거부되었습니다:",
  "error.engine_error": "엔진이 다음 메시지와 함께 멈췄습니다:",
  "error.worker": "Worker를 시작하지 못했거나 멈췄습니다:",
  "error.cancelled": "실행이 시드 사이에서 중단되었습니다:",
  "error.locked": "이 실행이 열린 챌린지라서 요청이 거절되었습니다:",
  "error.heading.cancelled": "실행이 취소되었습니다",

  "grade.S": "출처 확인",
  "grade.P": "대리지표",
  "grade.D": "유도",
  "grade.A": "가정",
  "grade.provisional": "잠정",
};

export const ko: Record<Key, string> = { ...koBase, ...koSetup, ...koResults, ...koNotes, ...koLineage, ...koChallenge, ...koBreakout, ...koPlant };
