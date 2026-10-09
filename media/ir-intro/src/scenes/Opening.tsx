import { AbsoluteFill } from "remotion";
import { Reveal } from "../components/Reveal";
import { Wave } from "../components/Wave";
import { COLOR, FONT } from "../theme";

/** 1. 여는 말: 바람이 말리는 과메기, 그리고 매일의 질문. */
export const Opening: React.FC = () => (
  <AbsoluteFill style={{ background: COLOR.paper }}>
    <Wave y={760} amplitude={20} />
    <Wave y={810} amplitude={14} speed={0.7} opacity={0.12} />
    <AbsoluteFill style={{ justifyContent: "center", padding: "0 180px", paddingBottom: 120 }}>
      <Reveal at={0.4}>
        <div style={{ fontFamily: FONT.serif, fontSize: 88, fontWeight: 500, color: COLOR.ink, letterSpacing: -2, wordBreak: "keep-all" }}>
          구룡포의 겨울, 과메기는 바람이 말립니다.
        </div>
      </Reveal>
      <Reveal at={2.6}>
        <div
          style={{
            marginTop: 36,
            fontFamily: FONT.serif,
            fontSize: 88,
            fontWeight: 700,
            color: COLOR.sea,
            wordBreak: "keep-all",
            letterSpacing: -2,
          }}
        >
          그런데, 오늘 널어도 될까요?
        </div>
      </Reveal>
    </AbsoluteFill>
  </AbsoluteFill>
);
