import { AbsoluteFill } from "remotion";
import { Reveal } from "../components/Reveal";
import { COLOR, FONT } from "../theme";

const ROWS = [
  "숫자는 코드가 계산하고, AI는 설명만 합니다.",
  "자료에 없는 숫자나 다른 등급은 내보내지 않습니다.",
  "관측기 거리·측정 시각·자료 출처를 함께 보여 줍니다.",
];

/** 9. 신뢰: 판단은 규칙, 설명은 AI, 근거는 실제 자료. */
export const Trust: React.FC = () => (
  <AbsoluteFill style={{ background: COLOR.ink, padding: "150px 180px", color: COLOR.paper }}>
    <Reveal at={0.2}>
      <div style={{ fontFamily: FONT.sans, fontSize: 30, fontWeight: 500, color: "#9CC3CC", letterSpacing: 1 }}>
        믿을 수 있게
      </div>
    </Reveal>
    <div style={{ marginTop: 60, display: "flex", flexDirection: "column", gap: 46 }}>
      {ROWS.map((row, index) => (
        <Reveal key={row} at={0.7 + index * 1.1}>
          <div style={{ display: "flex", gap: 34, alignItems: "center" }}>
            <svg width="54" height="54" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="11" stroke="#9CC3CC" strokeWidth="1.5" />
              <path d="M7 12.5l3.2 3.2L17 9" stroke="#9CC3CC" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div style={{ fontFamily: FONT.serif, fontSize: 60, fontWeight: 500, letterSpacing: -1 }}>{row}</div>
          </div>
        </Reveal>
      ))}
    </div>
    <Reveal at={4.4} style={{ position: "absolute", left: 180, bottom: 140 }}>
      <div style={{ fontFamily: FONT.sans, fontSize: 34, color: "#B5B3AC" }}>
        자료 · 포항 E-UM 디지털 트윈 · 기상청 API허브 · 한국천문연구원
      </div>
    </Reveal>
  </AbsoluteFill>
);
