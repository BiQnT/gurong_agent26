import type React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE } from "../theme";

/** 아래에서 조금 올라오며 나타나는 글·요소. at 은 나타나기 시작하는 초. */
export const Reveal: React.FC<{
  at: number;
  children: React.ReactNode;
  distance?: number;
  duration?: number;
  style?: React.CSSProperties;
}> = ({ at, children, distance = 28, duration = 0.9, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div
      style={{
        opacity: interpolate(frame, [at * fps, (at + duration) * fps], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(...EASE),
        }),
        translate: interpolate(
          frame,
          [at * fps, (at + duration) * fps],
          [`0px ${distance}px`, "0px 0px"],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(...EASE),
          },
        ),
        ...style,
      }}
    >
      {children}
    </div>
  );
};
