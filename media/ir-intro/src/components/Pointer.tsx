import type React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { easeOut, progress, track } from "../motion";
import { useZoom } from "./Stage";

type Point = { x: number; y: number };

/** 화면 위 마우스 커서. 위치는 세계 좌표, 크기는 확대와 상관없이 같다. */
export const Cursor: React.FC<{
  start: Point;
  moves: ReadonlyArray<readonly [number, number, Point]>;
  clicks: number[];
  show: readonly [number, number];
}> = ({ start, moves, clicks, show }) => {
  const frame = useCurrentFrame();
  const zoom = useZoom();
  const { x, y } = track(frame, start, moves);
  const opacity = Math.min(progress(frame, show[0], show[0] + 8), 1 - progress(frame, show[1] - 8, show[1]));
  if (opacity <= 0) return null;
  let press = 0;
  let ring: number | null = null;
  for (const at of clicks) {
    if (frame >= at - 3 && frame <= at + 4) press = Math.max(press, 1 - Math.abs(frame - at) / 4);
    if (frame >= at && frame < at + 18) ring = (frame - at) / 18;
  }
  const size = 1 / zoom;
  return (
    <div style={{ position: "absolute", left: x, top: y, opacity, zIndex: 50 }}>
      {ring !== null && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: size * (10 + easeOut(ring) * 62),
            height: size * (10 + easeOut(ring) * 62),
            borderRadius: "50%",
            transform: "translate(-50%, -50%)",
            background: `rgba(27,27,25,${0.16 * (1 - ring)})`,
          }}
        />
      )}
      <svg
        width={30}
        height={36}
        viewBox="0 0 30 36"
        style={{
          position: "absolute",
          left: -3,
          top: -2,
          transformOrigin: "3px 2px",
          transform: `scale(${size * (1 - press * 0.16)})`,
          filter: "drop-shadow(0 3px 5px rgba(0,0,0,0.28))",
          overflow: "visible",
        }}
      >
        <path
          d="M3 2 L3 27 L9.5 21 L14 31.5 L18.5 29.5 L14 19.5 L22.5 19.5 Z"
          fill="#111"
          stroke="#fff"
          strokeWidth={2.2}
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};

/** 휴대폰 화면을 손가락으로 누른 자리 */
export const Taps: React.FC<{ taps: ReadonlyArray<{ at: number; x: number; y: number }> }> = ({ taps }) => {
  const frame = useCurrentFrame();
  const zoom = useZoom();
  return (
    <>
      {taps.map(({ at, x, y }) => {
        if (frame < at - 8 || frame > at + 20) return null;
        const appear = interpolate(frame, [at - 8, at], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const after = Math.max(0, (frame - at) / 20);
        const size = (46 - appear * 8 + after * 30) / zoom;
        return (
          <div
            key={at}
            style={{
              position: "absolute",
              left: x - size / 2,
              top: y - size / 2,
              width: size,
              height: size,
              borderRadius: "50%",
              background: `rgba(27,27,25,${0.22 * appear * (1 - after)})`,
              border: `${2 / zoom}px solid rgba(255,255,255,${0.9 * (1 - after)})`,
              boxShadow: `0 0 0 ${1 / zoom}px rgba(27,27,25,${0.25 * (1 - after)})`,
              zIndex: 50,
            }}
          />
        );
      })}
    </>
  );
};
