import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOR } from "../theme";

/** 화면을 가로지르는 옅은 물결선. 구룡포 해풍을 가리키는 장식 하나만 쓴다. */
export const Wave: React.FC<{ y: number; opacity?: number; amplitude?: number; speed?: number }> = ({
  y,
  opacity = 0.22,
  amplitude = 18,
  speed = 1,
}) => {
  const frame = useCurrentFrame();
  const { width, fps } = useVideoConfig();
  const phase = (frame / fps) * speed * 1.4;
  const points = Array.from({ length: 97 }, (_, i) => {
    const x = (i / 96) * width;
    const wave =
      Math.sin(x / 140 + phase) * amplitude + Math.sin(x / 63 - phase * 1.7) * amplitude * 0.35;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${(y + wave).toFixed(1)}`;
  }).join(" ");
  return (
    <svg
      width={width}
      height={y + amplitude * 3}
      style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
    >
      <path
        d={points}
        stroke={COLOR.sea}
        strokeWidth={2.5}
        fill="none"
        strokeLinecap="round"
        style={{
          opacity: interpolate(frame, [0, fps], [0, opacity], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />
    </svg>
  );
};
