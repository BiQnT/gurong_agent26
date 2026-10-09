import type React from "react";
import { COLOR, FONT } from "../theme";

/** 제품 화면을 담는 브라우저 창 틀. */
export const Window: React.FC<{
  width: number;
  height: number;
  label?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ width, height, label = "haepung · 구룡포 덕장 AI 파트너", children, style }) => (
  <div
    style={{
      width,
      height,
      borderRadius: 22,
      background: COLOR.card,
      boxShadow: "0 30px 80px rgba(27,27,25,0.14), 0 2px 6px rgba(27,27,25,0.06)",
      border: `1px solid ${COLOR.line}`,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      ...style,
    }}
  >
    <div
      style={{
        height: 52,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 22px",
        borderBottom: `1px solid ${COLOR.line}`,
        background: "#FBFAF7",
      }}
    >
      {["#E4E1D9", "#E4E1D9", "#E4E1D9"].map((color, index) => (
        <span
          key={index}
          style={{ width: 13, height: 13, borderRadius: 7, background: color, display: "block" }}
        />
      ))}
      <span
        style={{
          marginLeft: 18,
          fontFamily: FONT.sans,
          fontSize: 20,
          color: COLOR.muted,
        }}
      >
        {label}
      </span>
    </div>
    <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>{children}</div>
  </div>
);

/** 근로자 휴대폰 틀. */
export const Phone: React.FC<{
  width: number;
  height: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ width, height, children, style }) => (
  <div
    style={{
      width,
      height,
      borderRadius: 54,
      background: COLOR.ink,
      padding: 14,
      boxShadow: "0 30px 80px rgba(27,27,25,0.22)",
      ...style,
    }}
  >
    <div
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 42,
        overflow: "hidden",
        position: "relative",
        background: COLOR.card,
      }}
    >
      {children}
    </div>
  </div>
);
