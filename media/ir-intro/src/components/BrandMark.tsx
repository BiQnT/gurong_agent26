import { COLOR } from "../theme";

/** 앱의 해풍 로고 (src/components/BrandMark.tsx 와 같은 SVG). */
export const BrandMark: React.FC<{ size: number; color?: string; background?: string }> = ({
  size,
  color = "#FFFFFF",
  background = COLOR.ink,
}) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.28,
      background,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <svg viewBox="0 0 48 48" fill="none" width={size * 0.82} height={size * 0.82}>
      <path
        d="M9 25c5-9 10 9 15 0s10 9 15 0M9 33c5-9 10 9 15 0s10 9 15 0"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path d="M20 15a6 6 0 0 1 12 0" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  </div>
);
