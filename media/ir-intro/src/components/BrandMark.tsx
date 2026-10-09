import type React from "react";
import { useFrame } from "../timeline";
import { easeInOut, progress } from "../motion";
import { COLOR, FONT } from "../theme";

const WAVES = "M9 25c5-9 10 9 15 0s10 9 15 0M9 33c5-9 10 9 15 0s10 9 15 0";
const SUN = "M20 15a6 6 0 0 1 12 0";

/** 앱의 해풍 로고 (앱 src/components/BrandMark.tsx 와 같은 SVG). start 부터 선이 그려진다. */
export const BrandMark: React.FC<{ size: number; start: number }> = ({ size, start }) => {
  const frame = useFrame();
  const box = progress(frame, start, start + 16);
  const waves = progress(frame, start + 6, start + 30, easeInOut);
  const sun = progress(frame, start + 18, start + 34, easeInOut);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: COLOR.ink,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transform: `scale(${0.6 + box * 0.4})`,
        opacity: box,
      }}
    >
      <svg viewBox="0 0 48 48" fill="none" width={size * 0.82} height={size * 0.82}>
        <path
          d={WAVES}
          stroke="#fff"
          strokeWidth="2.5"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1 1"
          strokeDashoffset={1 - waves}
        />
        <path
          d={SUN}
          stroke="#fff"
          strokeWidth="2.5"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1 1"
          strokeDashoffset={1 - sun}
        />
      </svg>
    </div>
  );
};

/** 로고와 이름 */
export const Lockup: React.FC<{ start: number; tagline?: string; taglineStart?: number }> = ({
  start,
  tagline,
  taglineStart = start + 40,
}) => {
  const frame = useFrame();
  const name = progress(frame, start + 14, start + 36);
  const line = tagline ? progress(frame, taglineStart, taglineStart + 22) : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 34 }}>
      <BrandMark size={150} start={start} />
      <div
        style={{
          fontFamily: FONT.serif,
          fontWeight: 700,
          fontSize: 132,
          letterSpacing: "0.02em",
          color: COLOR.ink,
          lineHeight: 1,
          opacity: name,
          transform: `translateY(${(1 - name) * 30}px)`,
          filter: `blur(${(1 - name) * 12}px)`,
        }}
      >
        해풍
      </div>
      {tagline && (
        <div
          style={{
            fontFamily: FONT.sans,
            fontWeight: 500,
            fontSize: 40,
            color: COLOR.muted,
            opacity: line,
            transform: `translateY(${(1 - line) * 20}px)`,
            filter: `blur(${(1 - line) * 8}px)`,
          }}
        >
          {tagline}
        </div>
      )}
    </div>
  );
};
