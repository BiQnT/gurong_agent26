import type React from "react";
import { useFrame } from "../timeline";
import { easeInOut, progress } from "../motion";
import { COLOR, FONT } from "../theme";

/**
 * 낱말이 하나씩 흐림에서 또렷해지며 떠오르는 큰 글씨.
 * exit 를 주면 그 프레임부터 낱말 순서대로 위로 흩어진다.
 */
export const Words: React.FC<{
  text: string;
  start: number;
  exit?: number;
  size?: number;
  color?: string;
  weight?: number;
  font?: string;
  stagger?: number;
  style?: React.CSSProperties;
}> = ({ text, start, exit, size = 92, color = COLOR.ink, weight = 700, font = FONT, stagger = 4, style }) => {
  const frame = useFrame();
  const words = text.split(" ");
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        columnGap: size * 0.28,
        fontFamily: font,
        fontSize: size,
        fontWeight: weight,
        letterSpacing: "-0.02em",
        lineHeight: 1.25,
        color,
        ...style,
      }}
    >
      {words.map((word, index) => {
        const p = progress(frame, start + index * stagger, start + index * stagger + 20);
        const q = exit === undefined ? 0 : progress(frame, exit + index * 2, exit + index * 2 + 12, easeInOut);
        return (
          <span
            key={index}
            style={{
              display: "inline-block",
              opacity: p * (1 - q),
              transform: `translateY(${(1 - p) * size * 0.45 - q * size * 0.35}px)`,
              filter: `blur(${(1 - p) * 14 + q * 10}px)`,
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};
