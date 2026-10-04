import { Agent } from "../types";

export const AGENTS: Agent[] = [
  {
    id: "all",
    name: "멀티 에이전트 종합 협업 (Master Orchestrator)",
    shortName: "멀티 에이전트",
    icon: "sparkles",
    role: "오케스트레이터",
    color: "bg-teal-500 text-white",
    badgeColor: "bg-teal-500/20 text-teal-400 border-teal-500/30",
    desc: "시세, 품질, 미식, 배송 에이전트가 실시간으로 협동하여 최적의 솔루션을 제공합니다."
  },
  {
    id: "price",
    name: "어판장 & 덕장 시세 분석관 (MarketPriceAgent)",
    shortName: "시세·덕장",
    icon: "trending-up",
    role: "어판장 경매가 & 최저가 직송",
    color: "bg-blue-500 text-white",
    badgeColor: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    desc: "구룡포 수협 당일 경매가, 꽁치/청어 덕장별 직송 가격 및 가성비를 비교합니다."
  },
  {
    id: "quality",
    name: "구룡포 품질·덕장 선별사 (QualityInspectorAgent)",
    shortName: "품질·선별",
    icon: "award",
    role: "해풍 건조도 & 신선도 검증",
    color: "bg-emerald-500 text-white",
    badgeColor: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    desc: "3~5일 해풍 건조도, 유분 윤기, 쫀득함, 비린내 억제 특허 공정을 검증합니다."
  },
  {
    id: "gourmet",
    name: "구룡포 미식·레시피 셰프 (GourmetChefAgent)",
    shortName: "미식·레시피",
    icon: "utensils",
    role: "초보자 쌈조합 & 특화 요리",
    color: "bg-amber-500 text-white",
    badgeColor: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    desc: "비린내 없는 입문자 쌈조합, 백종원식 과메기 조림, 버터구이, 주류 페어링을 제안합니다."
  },
  {
    id: "logistics",
    name: "산지직송·신선 배송 추적사 (LogisticsAgent)",
    shortName: "물류·보관",
    icon: "truck",
    role: "당일 특급배송 & 신선 보관",
    color: "bg-purple-500 text-white",
    badgeColor: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    desc: "산지 당일 포장 상태, 우체국 특급 택배 배송 트래킹 및 냉장/냉동 보관법을 안내합니다."
  }
];
