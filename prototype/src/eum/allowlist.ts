// 에이전트에게 도구로 노출하는 E-UM API. 여기 없는 API 는 Claude 가 부를 수 없다.
//
// 근거: 본선 서비스 기획서 "디지털 트윈 API 연계" 5종.
// 파라미터는 카탈로그의 '필수' 표기가 아니라 research/api-tests/probe-summary.md 에서
// 실제로 200 을 받은 조합을 따른다. 카탈로그 표기와 실제 동작이 다른 경우가 있다.
//
// 추가할 때: probe-summary 에서 200 + 데이터 있음을 먼저 확인하고, 쓰는 파라미터만 적는다.
export const EUM_TOOL_APIS: Record<string, { params: string[]; note?: string }> = {
  INT_S01_001: { params: [], note: '측정 장비 24대의 위경도·주소·별칭. id 는 INT_S01_003/004 의 devId 와 같다.' },
  INT_S01_003: { params: [], note: '장비별 마지막 보고값. logDateTime 이 빈 장비는 결측이다.' },
  INT_S01_004: { params: ['id'], note: '장비 한 대의 마지막 보고값. id 는 INT_S01_001 의 장비 id.' },
  // 카탈로그는 id 를 필수로 적었지만 파라미터 없이 호출하면 수위계 전체가 온다.
  INT_S05_006: { params: [] },
  INT_S06_005: { params: [] },
};
