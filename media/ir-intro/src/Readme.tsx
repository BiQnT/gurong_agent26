import type React from "react";
import { AbsoluteFill, Img } from "remotion";
import { BrandMark } from "./components/BrandMark";
import { DESK, PHONE, shot, type Rect } from "./shots";
import { COLOR, FONT } from "./theme";

// 저장소 README 에 쓰는 정지 화면. 영상과 같은 실제 앱 화면을 쓴다.
// 뽑기: node scripts/readme-images.mjs → out/readme/*.png

const SHADOW = "0 30px 80px rgba(27,27,25,0.16), 0 0 0 1px rgba(27,27,25,0.08)";

/** 실제 화면의 한 부분을 z 배로 잘라 둥근 카드처럼 보여 준다 */
const Crop: React.FC<{ name: string; region: Rect; z: number; size?: { w: number; h: number }; fade?: boolean }> = ({
  name,
  region,
  z,
  size = DESK,
  fade = false,
}) => (
  <div
    style={{
      position: "relative",
      width: region.w * z,
      height: region.h * z,
      overflow: "hidden",
      borderRadius: 18,
      background: "#fff",
      boxShadow: SHADOW,
    }}
  >
    <Img
      src={shot(name)}
      style={{
        position: "absolute",
        left: -region.x * z,
        top: -region.y * z,
        width: size.w * z,
        height: size.h * z,
      }}
    />
    {fade && (
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 180,
          background: "linear-gradient(rgba(255,255,255,0), #fff 85%)",
        }}
      />
    )}
  </div>
);

const Center: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ background: COLOR.paper, justifyContent: "center", alignItems: "center" }}>
    {children}
  </AbsoluteFill>
);

/** 1600×800: 로고와 한 줄 소개, 운영자 화면과 근로자 휴대폰 */
export const ReadmeHero: React.FC = () => (
  <AbsoluteFill style={{ background: COLOR.paper, overflow: "hidden" }}>
    <div style={{ position: "absolute", left: 110, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 26 }}>
      <BrandMark size={112} start={-100} />
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 112, color: COLOR.ink, lineHeight: 1 }}>해풍</div>
      <div style={{ fontFamily: FONT, fontWeight: 500, fontSize: 36, color: COLOR.ink }}>덕장을 위한 AI 파트너</div>
      <div style={{ fontFamily: FONT, fontSize: 26, color: COLOR.muted, lineHeight: 1.6 }}>
        구룡포 디지털 트윈 관측으로
        <br />
        오늘 널어도 되는지 판단합니다.
      </div>
    </div>
    <div
      style={{
        position: "absolute",
        left: 640,
        top: 150,
        width: DESK.w * 0.6,
        height: DESK.h * 0.6,
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: SHADOW,
        transform: "perspective(2400px) rotateY(-9deg) rotateX(3deg)",
        transformOrigin: "left center",
      }}
    >
      <Img src={shot("app-overview")} style={{ width: "100%", height: "100%" }} />
    </div>
    <div
      style={{
        position: "absolute",
        left: 1300,
        top: 196,
        width: PHONE.w * 0.66 + 16,
        height: PHONE.h * 0.66 + 16,
        padding: 8,
        borderRadius: 34,
        background: COLOR.ink,
        boxShadow: "0 30px 80px rgba(27,27,25,0.28)",
      }}
    >
      <div style={{ width: "100%", height: "100%", borderRadius: 27, overflow: "hidden", background: "#fff" }}>
        <Img src={shot("w1-received")} style={{ width: "100%", height: "100%" }} />
      </div>
    </div>
  </AbsoluteFill>
);

/** 1600×1300: 지금 널어도 될까요? 의 답 (등급, 관측값, 근거, 설명) */
export const ReadmeNow: React.FC = () => (
  <Center>
    <Crop name="now-answer" region={{ x: 462, y: 78, w: 776, h: 644 }} z={1.82} />
  </Center>
);

/** 1600×1380: 작년 12월 기간 분석 (요약과 날짜별 등급 막대, 아래는 흐리게) */
export const ReadmeHistory: React.FC = () => (
  <Center>
    <Crop name="history-answer" region={{ x: 462, y: 78, w: 776, h: 682 }} z={1.82} fade />
  </Center>
);
