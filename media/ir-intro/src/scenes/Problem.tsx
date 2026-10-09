import { AbsoluteFill } from "remotion";
import { Reveal } from "../components/Reveal";
import { COLOR, FONT } from "../theme";

const ROWS = [
  ["날씨 앱은 동네 값을 줍니다.", "덕장 바로 옆의 바람과 습도는 다를 수 있어요."],
  ["판단은 여전히 사람 몫입니다.", "숫자를 보고도 널지 말지는 직접 정해야 해요."],
  ["근로자에게 전하기도 어렵습니다.", "외국인 근로자와 말이 달라 작업 안내가 엇갈려요."],
];

/** 3. 문제: 덕장 운영자가 매일 겪는 세 가지. */
export const Problem: React.FC = () => (
  <AbsoluteFill style={{ background: COLOR.paper, padding: "150px 180px" }}>
    <Reveal at={0.2}>
      <div style={{ fontFamily: FONT.sans, fontSize: 30, fontWeight: 500, color: COLOR.sea, letterSpacing: 1 }}>
        매일 아침의 고민
      </div>
    </Reveal>
    <div style={{ marginTop: 60, display: "flex", flexDirection: "column", gap: 54 }}>
      {ROWS.map(([title, body], index) => (
        <Reveal key={title} at={0.7 + index * 1.4}>
          <div style={{ display: "flex", gap: 44, alignItems: "baseline" }}>
            <span style={{ fontFamily: FONT.serif, fontSize: 64, fontWeight: 700, color: COLOR.line, width: 70 }}>
              {index + 1}
            </span>
            <div>
              <div style={{ fontFamily: FONT.serif, fontSize: 72, fontWeight: 700, color: COLOR.ink, letterSpacing: -1.5 }}>
                {title}
              </div>
              <div style={{ marginTop: 14, fontFamily: FONT.sans, fontSize: 40, color: COLOR.muted }}>{body}</div>
            </div>
          </div>
        </Reveal>
      ))}
    </div>
  </AbsoluteFill>
);
