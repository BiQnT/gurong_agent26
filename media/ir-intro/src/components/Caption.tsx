import type React from "react";
import { COLOR, FONT } from "../theme";
import { Reveal } from "./Reveal";

/** 기능 장면의 왼쪽 설명: 작은 머리말, 큰 제목, 짧은 설명 줄들. */
export const Caption: React.FC<{
  kicker: string;
  title: React.ReactNode;
  lines?: string[];
  at?: number;
  width?: number;
}> = ({ kicker, title, lines = [], at = 0.2, width = 640 }) => (
  <div style={{ width, display: "flex", flexDirection: "column", gap: 0, wordBreak: "keep-all" }}>
    <Reveal at={at}>
      <div
        style={{
          fontFamily: FONT.sans,
          fontSize: 30,
          fontWeight: 500,
          color: COLOR.sea,
          letterSpacing: 1,
          marginBottom: 22,
        }}
      >
        {kicker}
      </div>
    </Reveal>
    <Reveal at={at + 0.25}>
      <div
        style={{
          fontFamily: FONT.serif,
          fontSize: 80,
          fontWeight: 700,
          lineHeight: 1.18,
          color: COLOR.ink,
          letterSpacing: -2,
          wordBreak: "keep-all",
        }}
      >
        {title}
      </div>
    </Reveal>
    <div style={{ marginTop: 40, display: "flex", flexDirection: "column", gap: 18 }}>
      {lines.map((line, index) => (
        <Reveal key={line} at={at + 0.9 + index * 0.45}>
          <div
            style={{
              fontFamily: FONT.sans,
              fontSize: 40,
              lineHeight: 1.45,
              color: COLOR.muted,
              display: "flex",
              gap: 16,
            }}
          >
            <span style={{ color: COLOR.ink }}>·</span>
            <span>{line}</span>
          </div>
        </Reveal>
      ))}
    </div>
  </div>
);
