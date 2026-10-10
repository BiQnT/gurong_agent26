import type React from "react";
import { AbsoluteFill } from "remotion";
import { useFrame } from "../timeline";
import { easeInOut, easeOut, progress } from "../motion";
import { COLOR, FONT } from "../theme";

type Point = { x: number; y: number };

const ICON: Record<"guide" | "question" | "answer", string> = {
  // 작업 안내: 문서, 질문: 말풍선, 답변: 되돌아가는 화살표
  guide: "M7 4h7l4 4v12H7zM14 4v4h4M10 12h5M10 16h5",
  question: "M5 6h14v9H10l-4 3v-3H5z",
  answer: "M10 8 5 12l5 4M5 12h9a5 5 0 0 1 5 5",
};

/**
 * 한 화면에서 다른 화면으로 날아가는 알림 칩. 출발점·도착점은 화면 좌표이고,
 * labelTo 가 있으면 가는 도중에 글이 바뀐다 (한국어 안내가 베트남어로 바뀌는 모습).
 */
export const Packet: React.FC<{
  start: number;
  end: number;
  from: Point;
  to: Point;
  label: string;
  labelTo?: string;
  icon: keyof typeof ICON;
  arc?: number;
}> = ({ start, end, from, to, label, labelTo, icon, arc = 180 }) => {
  const frame = useFrame();
  if (frame < start || frame > end + 18) return null;
  const t = progress(frame, start, end, easeInOut);
  const control = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - arc };
  const at = (u: number) => ({
    x: (1 - u) ** 2 * from.x + 2 * (1 - u) * u * control.x + u ** 2 * to.x,
    y: (1 - u) ** 2 * from.y + 2 * (1 - u) * u * control.y + u ** 2 * to.y,
  });
  const here = at(t);
  const trail = Array.from({ length: 41 }, (_, i) => at((t * i) / 40));
  const tail = Array.from({ length: 41 }, (_, i) => at(t + ((1 - t) * i) / 40));
  const appear = progress(frame, start, start + 8);
  const arrive = progress(frame, end - 5, end + 3, easeInOut);
  const burst = frame >= end ? (frame - end) / 18 : null;
  const swap = labelTo ? progress(frame, start + (end - start) * 0.4, start + (end - start) * 0.62, easeInOut) : 0;
  const line = (points: Point[]) => points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  return (
    <AbsoluteFill style={{ pointerEvents: "none", zIndex: 80 }}>
      <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0 }}>
        <path
          d={line(tail)}
          stroke={COLOR.ink}
          strokeOpacity={0.12 * (1 - arrive)}
          strokeWidth={2}
          strokeDasharray="2 9"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d={line(trail)}
          stroke={COLOR.ink}
          strokeOpacity={0.45 * (1 - arrive)}
          strokeWidth={3}
          strokeLinecap="round"
          fill="none"
        />
        <circle cx={from.x} cy={from.y} r={6} fill={COLOR.ink} opacity={appear * (1 - arrive)} />
      </svg>
      {burst !== null && burst < 1 && (
        <div
          style={{
            position: "absolute",
            left: to.x,
            top: to.y,
            width: 40 + easeOut(burst) * 200,
            height: 40 + easeOut(burst) * 200,
            borderRadius: "50%",
            transform: "translate(-50%, -50%)",
            border: `3px solid rgba(27,27,25,${0.4 * (1 - burst)})`,
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          left: here.x,
          top: here.y,
          transform: `translate(-50%, -50%) scale(${(0.7 + appear * 0.3) * (1 - arrive * 0.5)})`,
          opacity: appear * (1 - arrive),
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "14px 26px 14px 14px",
          borderRadius: 999,
          background: "#fff",
          boxShadow: "0 18px 50px rgba(27,27,25,0.22), 0 0 0 1px rgba(27,27,25,0.08)",
          fontFamily: FONT,
          fontSize: 28,
          fontWeight: 500,
          color: COLOR.ink,
          whiteSpace: "nowrap",
        }}
      >
        <span
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            background: COLOR.ink,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none">
            <path d={ICON[icon]} stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span style={{ display: "grid" }}>
          <span style={{ gridArea: "1 / 1", opacity: 1 - swap, filter: `blur(${swap * 6}px)` }}>{label}</span>
          {labelTo && (
            <span style={{ gridArea: "1 / 1", opacity: swap, filter: `blur(${(1 - swap) * 6}px)` }}>{labelTo}</span>
          )}
        </span>
      </div>
    </AbsoluteFill>
  );
};
