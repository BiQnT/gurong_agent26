import type React from "react";
import { AbsoluteFill } from "remotion";
import { useFrame } from "../timeline";
import { easeInOut, progress } from "../motion";
import { Sfx } from "./Sfx";
import { Words } from "./Words";

/**
 * 장(章)의 첫머리: 앱 화면이 흐려지며 큰 제목이 떠올랐다가, 제목이 흩어지면 화면이 다시 또렷해진다.
 * 제목은 out 프레임부터 사라지고, 그 뒤로는 화면만 남는다.
 */
export const Chapter: React.FC<{
  title: string;
  out: number;
  children: React.ReactNode;
  enterBlur?: boolean;
}> = ({ title, out, children, enterBlur = true }) => {
  const frame = useFrame();
  const blurIn = enterBlur ? progress(frame, 0, 10, easeInOut) : 1;
  const blurOut = progress(frame, out - 2, out + 14, easeInOut);
  const amount = blurIn * (1 - blurOut);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ filter: amount > 0.01 ? `blur(${amount * 18}px)` : undefined }}>{children}</AbsoluteFill>
      <AbsoluteFill style={{ background: `rgba(247,245,240,${0.62 * amount})` }} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <Words text={title} start={4} exit={out - 4} size={104} />
      </AbsoluteFill>
      <Sfx at={0} name="whoosh" volume={0.22} />
    </AbsoluteFill>
  );
};
