import { loadFont as loadSerif } from "@remotion/google-fonts/NotoSerifKR";
import { loadFont as loadSans } from "@remotion/google-fonts/NotoSansKR";

// 해풍 IR 소개 영상의 색과 글꼴. 앱의 흰색·검정·중성 회색과 널기 등급 색을 그대로 쓴다.

const serif = loadSerif("normal", { weights: ["500", "700"] });
const sans = loadSans("normal", { weights: ["400", "500", "700"] });

export const FONT = {
  serif: serif.fontFamily,
  sans: sans.fontFamily,
};

export const COLOR = {
  paper: "#F7F5F0",
  ink: "#1B1B19",
  muted: "#6B6A65",
  line: "#E4E1D9",
  card: "#FFFFFF",
  good: "#3D8C5C",
  caution: "#D9A23F",
  bad: "#C4513B",
  sea: "#2F5D6B",
};

/** 부드럽게 멈추는 기본 움직임 */
export const EASE = [0.16, 1, 0.3, 1] as const;
