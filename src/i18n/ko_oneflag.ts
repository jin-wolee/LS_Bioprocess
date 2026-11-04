import type { enOneFlag } from "./en_oneflag.ts";

// Korean texts of the card "What one stored timestamp changes" (ADR-0006: the Korean text introduces no number, claim or source that the English text lacks). Terms follow Results: 기록, 결합, 공정 상태,
// 재현율, 정밀도, 오경보율, 보관 시간 규칙; a feed is 피드 and a draw is 채취 as everywhere in the lab.
export const koOneFlag: Record<keyof typeof enOneFlag, string> = {
  "oneflag.heading": "저장한 시각 하나가 바꾸는 것",
  "oneflag.lead": "시료를 채취한 뒤 측정하기 전에 피드가 들어가는 합성 사례를, C 기록과 측정 시각만 저장하는 C 기록으로 각각 돌려 같은 질문을 던져 봅니다.",
  "oneflag.q.mismatch": "측정 결과가 잘못된 공정 상태에 결합되는 일이 얼마나 있습니까?",
  "oneflag.q.mismatch.note": "수치는 결합된 공정 상태가 채취 시점의 공정 상태와 다른 요청의 비율입니다. 측정 시각만 저장하는 기록은 그 시각으로 결합합니다.",
  "oneflag.q.detection": "어떤 검사로든 그 잘못된 결합을 볼 수 있습니까?",
  "oneflag.q.detection.note": "재현율은 항상 정밀도와 오경보율 옆에 함께 표시합니다. 수치가 없는 항목은 상태와 이유를 보여 줍니다.",
  "oneflag.q.cost": "두 번째 시계를 저장하면 무엇을 치르게 됩니까?",
  "oneflag.cost.note": "이 질문이 두 번째 시계의 비용입니다. 보관 시간 규칙은 두 시각을 모두 저장할 때만 작동하며, 이 규칙이 거절한 결과는 조회에 보이지 않으므로 그 요청은 가용하지 않습니다.",
  "oneflag.link": "이 실행의 전체 결과 보기",
};
