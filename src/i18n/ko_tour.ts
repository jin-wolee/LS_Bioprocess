import type { enTour } from "./en_tour.ts";

// Korean texts of the guided scene (ADR-0006: the Korean text introduces no number, claim or source that the English text lacks). Terms follow the plant's other texts: 바이오리액터, 분석기, 시료, 시험관, 접수대,
// 기록 보관실, 공정 맥락, 피드 (the one Korean term for a feed, plant_ui.md section 12, item 15). A particle is never put after an identifier (a Latin id has no sound the dictionary can know), so a sentence
// is built to need none.
export const koTour: Record<keyof typeof enTour, string> = {
  "plant.tour.button": "안내 둘러보기",
  "plant.tour.button.hint": "시료 하나를 따라가는 짧은 안내입니다. 채취, 측정 전의 피드, 그리고 각 기록이 남긴 내용을 봅니다.",
  "plant.tour.offer.heading": "처음이신가요? 짧은 안내",
  "plant.tour.offer.text": "시료 하나를 채취 순간부터 세 기록 보관실까지 따라가며, 각 기록이 채취 시각을 남겼는지, 결과를 어떤 공정 맥락에 연결했는지 확인합니다. 몇 단계뿐이고 어느 단계에서든 건너뛸 수 있습니다.",
  "plant.tour.offer.take": "안내 둘러보기",
  "plant.tour.offer.later": "나중에",

  "plant.tour.region": "안내 둘러보기",
  "plant.tour.progress": "{total}단계 중 {n}단계",
  "plant.tour.optional": "선택",
  "plant.tour.back": "이전",
  "plant.tour.next": "다음",
  "plant.tour.finish": "마치기",
  "plant.tour.skip": "안내 건너뛰기",
  "plant.tour.keys": "화살표 키로 단계를 넘기고 Escape 키로 건너뜁니다.",
  "plant.tour.waiting": "안내에 쓸 실행을 여는 중입니다.",
  "plant.tour.scenario": "이 안내는 시나리오 {scenario}의 실행을 사용하며, 화면에 있던 실행을 그것으로 바꿉니다.",

  "plant.tour.draw.title": "채취",
  "plant.tour.draw.text": "{clock}에 바이오리액터 {unit}에서 시료 하나를 채취합니다. 그 시료는 {sample}입니다. 바이오리액터 곁에서 시험관을 손에 든 운영자를 보세요. 바닥은 채취 순간을 일어난 그대로 보여 줍니다.",
  "plant.tour.feed.title": "측정 전에 들어간 피드",
  "plant.tour.feed.text": "{clock}에 바이오리액터 {unit}에 피드가 들어갑니다. 시료 {sample}의 시험관은 아직 분석기로 가는 중입니다. 피드 스테이션에서 바이오리액터로 이어지는 선을 보세요. 시료가 측정되기 전에 바이오리액터의 공정 맥락이 바뀝니다.",
  "plant.tour.run.title": "시험관이 분석기에 닿다",
  "plant.tour.run.text": "{clock}에 시험관이 분석기 {analyzer} 안에 있고 측정이 시작됩니다. 시료 패널을 보세요. 채취, 접수대 도착, 측정 시작이 서로 다른 순간으로 나열됩니다.",
  "plant.tour.records.title": "세 기록이 남긴 것",
  "plant.tour.records.text": "{clock}에 결과가 기록되고, 각 기록 보관실에 시료 {sample}의 카드가 놓입니다. 표에서 각 기록이 채취 순간을 남겼는지, 결과를 공정 맥락에 연결할 때 어느 시각을 썼는지 읽어 보세요. 채워진 네모는 기록이 저장한 항목이고, 점선의 빈 네모는 저장하지 않은 항목입니다.",
  "plant.tour.truth.title": "시뮬레이션이 아는 것",
  "plant.tour.truth.text": "선택 단계입니다. 시료 {sample}에 대한 시뮬레이션 자체의 시점을 켭니다. 실제 바이오리액터, 실제 채취 순간, 실제 공정 맥락은 어떤 기록에도 없는 정보이며, 각 기록이 각 질문에 맞게 답했는지도 함께 보입니다.",

  "plant.tour.cards.caption": "각 기록 보관실에 있는 시료 {sample}의 카드",
  "plant.tour.cards.open": "{architecture}의 기록 열기",
  "plant.tour.slot.unit": "바이오리액터",
  "plant.tour.slot.sampled_at": "채취 순간",
  "plant.tour.slot.context": "공정 맥락",
  "plant.tour.slot.value": "결과",
  "plant.tour.slot.stored": "저장됨",
  "plant.tour.slot.missing": "저장 안 됨",
  "plant.tour.slot.basis": "연결 기준 {basis}",
  "plant.tour.verdicts.caption": "시료 {sample}에 대해 각 기록이 답한 내용",

  "plant.tour.text.heading": "안내 장면을 글로 읽기",
  "plant.tour.text.lead": "바닥의 안내와 같은 단계를 시나리오 {scenario}의 시료로 보여 줍니다. 각 단계는 실행 안의 순간을 밝힙니다.",
  "plant.tour.text.other": "화면의 공장이 안내용 실행이 아니므로 단계는 그 실행을 기다립니다.",
  "plant.tour.text.open": "안내용 실행 열기",
};
