import type { enDrill } from "./en_drill.ts";

// 공장에서 다른 화면으로 내려가는 링크와 공장 링크의 한국어 텍스트 (docs/design/plant_ui.md 7절, "As built in P5c"). 영어 사전이 원본이고, 숫자는 {자리표시자}로만 들어옵니다.
export const koDrill: Record<keyof typeof enDrill, string> = {
  "plant.drill.heading": "다른 화면",
  "plant.drill.lineage": "{sample} 시료를 계보 화면에서 따라가기",
  "plant.drill.lineage.none": "이 바이오리액터에서는 아직 채취한 시료가 없어 따라갈 시료가 없습니다.",
  "plant.drill.results": "이 아키텍처를 여러 시드에 걸쳐 결과 화면에서 보기",
  "plant.drill.utilisation": "분석기가 여러 시드에서 얼마나 바빴는지 결과 화면에서 보기",
  "plant.drill.notes": "기록의 자격 확인이 무엇인지 노트에서 읽기",

  "plant.origin.label": "공장에서 열었습니다",
  "plant.origin.run": "공장에서 가져온 실행: 시나리오 {scenario}, 시드 {seed}, 운영자 조작 {actions}개, {clock}에 떠남.",
  "plant.origin.run_open": "공장에서 가져온 실행: 시나리오 {scenario}, 시드 {seed}, 운영자 조작 {actions}개.",
  "plant.origin.back": "공장으로 돌아가기",
  "plant.origin.results": "여러 시드에 걸친 결과는 공장의 운영자 조작 가운데 리액터나 분석기를 가리키는 것(피드 추가, 경보, 분석기 중지 구간, 시약 로트 교체)을 싣습니다. 이 공장의 조작 {actions}개 중 {carried}개입니다. 이 조작은 모든 시드에 적용됩니다. 시료 뽑기는 한 시드의 시료를 가리키므로 싣지 않고, 실험실 설정은 설정 화면의 자체 항목입니다.",
  "plant.origin.utilisation": "실행을 누르세요. 분석기 가동률은 결과 화면의 맨 끝에 있습니다.",

  "plant.link.heading": "링크를 고쳐서 읽었습니다",
  "plant.link.scenario": "시나리오 {given}은(는) 이 빌드에 없어 기본 시나리오로 실행합니다.",
  "plant.link.settings": "설정 {given}은(는) 숫자가 아니어서 뺐습니다.",
  "plant.link.capture": "수집 경로 {given}은(는) 이 빌드의 두 경로가 아니어서 뺐습니다.",
  "plant.link.arch": "기록 아키텍처 {given}은(는) 이 빌드에 없어 뺐습니다.",
  "plant.link.seed": "시드 {given}은(는) 음이 아닌 정수가 아니어서 기본 시드 {fallback}로 실행합니다.",
  "plant.link.actions": "조작 {given}은(는) 목록이 아니어서 뺐습니다.",
  "plant.link.t": "시점 {given}은(는) 정수 초가 아니어서 시계는 실행의 처음에서 시작합니다.",
  "plant.link.t_range": "시점 {given}은(는) {horizon}초에 끝나는 실행 밖에 있어 시계는 실행의 처음에서 시작합니다.",
  "plant.link.schema": "링크는 스키마 {given}로 만들어졌고 이 빌드의 스키마로 읽었습니다.",
  "plant.link.engine": "링크는 엔진 {made}로 만들어졌고 엔진 {current}로 실행합니다.",
};
