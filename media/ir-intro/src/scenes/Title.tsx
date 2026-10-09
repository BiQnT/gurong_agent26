import { AbsoluteFill } from "remotion";
import { BrandMark } from "../components/BrandMark";
import { Reveal } from "../components/Reveal";
import { COLOR, FONT } from "../theme";

/** 2. 제품 이름. */
export const Title: React.FC = () => (
  <AbsoluteFill style={{ background: COLOR.paper, alignItems: "center", justifyContent: "center" }}>
    <Reveal at={0.2} distance={16}>
      <div style={{ display: "flex", alignItems: "center", gap: 48 }}>
        <BrandMark size={176} />
        <div>
          <div style={{ fontFamily: FONT.serif, fontSize: 168, fontWeight: 700, color: COLOR.ink, lineHeight: 1 }}>
            해풍
          </div>
          <div
            style={{
              fontFamily: FONT.sans,
              fontSize: 34,
              fontWeight: 700,
              letterSpacing: 14,
              color: COLOR.muted,
              marginTop: 18,
            }}
          >
            HAEPUNG
          </div>
        </div>
      </div>
    </Reveal>
    <Reveal at={1.3}>
      <div style={{ marginTop: 80, textAlign: "center" }}>
        <div style={{ fontFamily: FONT.serif, fontSize: 64, fontWeight: 500, color: COLOR.ink }}>
          덕장을 위한 AI 파트너
        </div>
        <div style={{ marginTop: 22, fontFamily: FONT.sans, fontSize: 40, color: COLOR.muted }}>
          구룡포 디지털 트윈 데이터로 판단합니다
        </div>
      </div>
    </Reveal>
  </AbsoluteFill>
);
