import { AbsoluteFill } from "remotion";
import { BrandMark } from "../components/BrandMark";
import { Reveal } from "../components/Reveal";
import { Wave } from "../components/Wave";
import { COLOR, FONT } from "../theme";

/** 10. 맺음: 앱 첫 화면의 문구로 끝낸다. */
export const Closing: React.FC = () => (
  <AbsoluteFill style={{ background: COLOR.paper, alignItems: "center", justifyContent: "center" }}>
    <Wave y={900} amplitude={16} opacity={0.18} />
    <Reveal at={0.2} distance={14}>
      <BrandMark size={120} />
    </Reveal>
    <Reveal at={0.7}>
      <div
        style={{
          marginTop: 56,
          fontFamily: FONT.serif,
          fontSize: 104,
          fontWeight: 700,
          color: COLOR.ink,
          letterSpacing: -3,
        }}
      >
        오늘의 바람, 함께 살펴볼까요?
      </div>
    </Reveal>
    <Reveal at={1.6}>
      <div style={{ marginTop: 40, fontFamily: FONT.sans, fontSize: 38, color: COLOR.muted, textAlign: "center" }}>
        해풍 · 팀 브레멘 · 2026 디지털 트윈 구룡포 AI 해커톤
      </div>
    </Reveal>
  </AbsoluteFill>
);
