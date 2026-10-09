import type React from "react";
import { AbsoluteFill } from "remotion";
import { useFrame } from "../timeline";
import { Words } from "../components/Words";
import { Wind } from "../components/Wind";
import { progress } from "../motion";
import { COLOR } from "../theme";

// 어두운 장면 셋: 여는 말, 문제, 한 줄 정리. 바람 줄기 위에 큰 글씨만 둔다.

const Night: React.FC<{ children: React.ReactNode; fadeFrom?: string }> = ({ children, fadeFrom }) => {
  const frame = useFrame();
  const cover = fadeFrom ? 1 - progress(frame, 0, 14) : 0;
  return (
    <AbsoluteFill style={{ background: COLOR.night }}>
      <Wind />
      {children}
      {cover > 0 && <AbsoluteFill style={{ background: fadeFrom, opacity: cover }} />}
    </AbsoluteFill>
  );
};

const Center: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 18 }}>
    {children}
  </AbsoluteFill>
);

/** 설계 0~8초: 구룡포의 겨울, 그리고 질문 하나 */
export const ColdOpen: React.FC = () => (
  <Night fadeFrom="#000">
    <Center>
      <Words text="구룡포의 겨울," start={16} exit={108} size={76} weight={500} color={COLOR.moon} />
      <Words text="과메기는 바람이 말립니다." start={34} exit={110} size={76} weight={500} color={COLOR.moon} />
    </Center>
    <Center>
      <Words text="그런데 오늘," start={132} exit={222} size={76} weight={500} color={COLOR.moon} />
      <Words text="널어도 될까요?" start={150} exit={224} size={124} color={COLOR.moon} stagger={6} />
    </Center>
  </Night>
);

const PROBLEMS = ["날씨 앱은 동네 날씨만 알려 주고,", "널지 말지는 여전히 감에 맡기고,", "외국인 근로자에겐 말이 닿지 않습니다."];

/** 설계 8~14.4초: 지금의 문제 세 가지 */
export const Problem: React.FC = () => (
  <Night>
    {PROBLEMS.map((line, index) => (
      <Center key={line}>
        <Words text={line} start={index * 64 + 2} exit={index * 64 + 54} size={84} color={COLOR.moon} stagger={3} />
      </Center>
    ))}
  </Night>
);

/** 설계 67.2~72초: 한 줄 정리 */
export const Statement: React.FC = () => (
  <Night fadeFrom={COLOR.paper}>
    <Center>
      <Words text="숫자는 데이터가," start={12} exit={128} size={108} color={COLOR.moon} />
      <Words text="설명은 AI가." start={40} exit={130} size={108} color={COLOR.moon} />
    </Center>
  </Night>
);
