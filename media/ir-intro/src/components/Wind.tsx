import type React from "react";
import { AbsoluteFill, random, useCurrentFrame } from "remotion";

/** 어두운 장면에 흐르는 가는 바람 줄기 */
export const Wind: React.FC<{ count?: number; opacity?: number; color?: string }> = ({
  count = 46,
  opacity = 1,
  color = "255,255,255",
}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ opacity }}>
      {Array.from({ length: count }, (_, i) => {
        const y = 80 + random(`y${i}`) * 920;
        const width = 160 + random(`w${i}`) * 420;
        const speed = 7 + random(`s${i}`) * 16;
        const alpha = 0.04 + random(`a${i}`) * 0.14;
        const span = 1920 + width;
        const x = ((random(`o${i}`) * span + frame * speed) % span) - width;
        const drift = Math.sin(frame / 40 + i) * 6;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y + drift,
              width,
              height: random(`h${i}`) > 0.8 ? 2 : 1,
              background: `linear-gradient(90deg, rgba(${color},0), rgba(${color},${alpha}), rgba(${color},0))`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
