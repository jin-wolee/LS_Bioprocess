import type { enSetup } from "./en_setup.ts";

// Korean texts of the Setup screen (ADR-0006: the Korean text introduces no number, claim or source that the English text lacks). Terms follow site/infographic/src/i18n.js.
export const koSetup: Record<keyof typeof enSetup, string> = {
  "setup.heading": "무엇을 실행할지 고르세요",
  "setup.lead": "시나리오, 공장 규모, 각 베이와 분석기의 프로파일, 기록할 데이터 아키텍처, 수집 경로, 시드를 고릅니다. 그러면 페이지가 Worker의 엔진에 실행을 요청하고, 각 기록이 무엇을 복원할 수 있는지 보여 줍니다.",
  "setup.scenario.label": "시나리오",
  "setup.scenario.description": "시나리오 파일의 설명:",

  "setup.plant.heading": "공장 규모",
  "setup.n.label": "바이오리액터 수 (N)",
  "setup.baysize.label": "베이당 바이오리액터 수",
  "setup.m.label": "분석기 수 (M)",
  "setup.range.note": "해당 id의 원장 범위를 벗어난 값도 허용되며 경고가 붙습니다. 출처가 다루는 범위 밖의 결과로 읽으세요.",
  "setup.warn.range": "{value}은(는) {id}의 원장 범위인 {low}부터 {high}까지를 벗어납니다.",
  "setup.warn.integer": "양의 정수를 입력하세요.",

  "setup.bays.heading": "각 베이의 바이오리액터 프로파일",
  "setup.bays.lead": "베이 {first}부터 시작합니다. 베이 수는 바이오리액터 수를 베이 크기로 나눈 값을 올림한 것입니다.",
  "setup.bay": "베이 {n}",
  "setup.analyzers.heading": "각 분석기의 프로파일",
  "setup.analyzers.lead": "분석기 {first}부터 시작합니다. 섞은 목록은 라우팅 규칙 B를 따릅니다. 분석 항목마다 프로파일이 정확히 하나이고, 시료는 목록에 있는 각 프로파일을 목록 순서대로 한 번씩 방문합니다.",
  "setup.analyzer": "분석기 {n}",
  "setup.lists.note": "N, 베이 크기, M이 바뀌면 두 목록이 다시 만들어집니다. 선택은 위치별로 유지되고 새 위치에는 시나리오의 기본값이 들어갑니다.",
  "setup.profile.bundle": "번들",
  "setup.profile.measures": "측정 항목",
  "setup.profile.none": "번들된 분석기 프로파일이 없습니다",

  "setup.arch.heading": "기록할 아키텍처",
  "setup.arch.lead": "선택한 아키텍처는 모두 같은 진실 실행을 시드별로 기록합니다. A, B, C는 프리셋이고, 아래 선택기는 플래그를 정확히 하나만 끈 C를 추가합니다.",
  "setup.arch.ablation": "플래그 하나를 끈 C",
  "setup.arch.ablation.none": "없음",
  "setup.arch.none": "실행하려면 아키텍처를 하나 이상 선택하세요.",

  "setup.capture.heading": "수집 경로",
  "setup.capture.label": "모든 아키텍처에 적용할 수집 경로",
  "setup.capture.default": "각 프리셋의 기본 경로 유지",
  "setup.capture.manual_transcription": "manual_transcription: 사람이 화면이나 출력물을 보고 결과를 입력",
  "setup.capture.adapter_ingest": "adapter_ingest: 원시 장치 파일을 파싱",
  "setup.capture.note": "경로를 지정하면 원시 장치 계층이 켜집니다. 진실 이벤트는 늘지 않고, 진실 실행은 그대로입니다.",
  "dialect.sentence": "공개 문서를 바탕으로 모델링한 합성 형식",

  "setup.seeds.heading": "시드",
  "setup.seeds.lead": "쉼표로 구분한 정수입니다. 기본값은 어떤 실행보다 먼저 정해 둔 개방 루프 실험의 시드 목록 앞부분입니다. 직접 정하는 시드는 중립적인 정수여야 합니다. 중복이 없어야 하고 날짜처럼 읽히면 안 됩니다.",
  "setup.seeds.label": "시드",
  "setup.seeds.count": "목록에서 사용할 시드 개수",
  "setup.seeds.parse": "정수가 아닌 시드가 있습니다.",
  "setup.seeds.below": "최소 시드 수 {min}에 못 미칩니다. 보고서가 이것을 비교가 아니라고 밝힐 것입니다.",

  "setup.flags.heading": "각 아키텍처가 보존하는 것",
  "setup.flags.lead": "각 플래그는 아키텍처마다 켜져 있거나 꺼져 있습니다. 플래그 목록은 엔진에서 오므로 페이지가 개수를 세지 않습니다.",
  "setup.flags.flag": "플래그",
  "setup.flags.labelling": "라벨링 방식",
  "setup.flags.capture": "프리셋의 수집 경로",

  "setup.inputs.heading": "시나리오의 입력",
  "setup.inputs.lead": "모든 입력에는 가정 원장에서의 항목 id와 그 항목의 등급이 붙습니다. 점선 칩은 출처를 아직 다 다시 읽지 않은 입력을 뜻합니다.",

  "setup.run.heading": "엔진 실행",
  "setup.run.button": "실행",
  "setup.run.running": "실행 중",
  "setup.run.cancel": "취소",
  "setup.run.lead": "엔진은 Worker에서 시드를 하나씩 실행합니다. 취소는 시드 사이에 확인됩니다.",
  "setup.run.progress": "완료한 시드: {total}개 중 {done}개",
  "setup.run.cancelled": "실행이 취소되었습니다.",

  "setup.link.heading": "이 설정의 링크",
  "setup.link.lead": "링크에는 설정만 들어 있고 결과는 들어 있지 않습니다. 링크를 열면 이 폼이 채워지며, 결과를 보려면 실행을 누르세요.",
  "setup.link.label": "링크",
  "setup.actions.heading": "공장에서 가져온 조작, 모든 시드에 적용",
  "setup.actions.lead": "공장에서 열 때 함께 온 운영자 조작입니다. 모두 리액터나 분석기를 가리키므로 어느 시드에서나 같은 뜻이며, 실행은 이 조작 전부를 모든 시드에 적용합니다. 각 시각은 가정 입력입니다. 기본 시나리오 그대로 실행하려면 모두 빼세요.",
  "setup.actions.drop": "이 조작 모두 빼기",
  "setup.actions.left_heading": "이 설정에서 뺀 조작",
  "setup.actions.left_lead": "공장에는 이 조작도 있었습니다. 여러 시드에 걸친 결과는 이것을 싣지 않습니다.",
  "setup.actions.why.draw": "시료 뽑기는 한 시드의 시료를 가리키므로 다른 시드에서는 뜻이 없습니다.",
  "setup.actions.why.lab_setting": "실험실 설정은 이 화면의 아래 폼에서 직접 고르는 항목입니다.",

  "setup.link.engine": "이 링크는 엔진 버전 {made}(으)로 만들어졌고, 이 페이지는 엔진 버전 {current}을(를) 실행합니다. 실행은 현재 엔진으로 진행됩니다.",
};
