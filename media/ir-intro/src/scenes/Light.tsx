import type React from "react";
import { AbsoluteFill } from "remotion";
import { useFrame } from "../timeline";
import { Lockup } from "../components/BrandMark";
import { Spotlight } from "../components/Overlays";
import { Sfx } from "../components/Sfx";
import { AppScreen, FullStage } from "../components/Stage";
import { Words } from "../components/Words";
import { easeInOut, easeOut, progress, track } from "../motion";
import { DESK, SPOT } from "../shots";
import { COLOR } from "../theme";

/** 어둠 가운데에서 미색 원이 퍼져 나온다 */
const Dawn: React.FC = () => {
  const frame = useFrame();
  const radius = progress(frame, 0, 26, easeOut) * 1200;
  return (
    <AbsoluteFill style={{ background: COLOR.night }}>
      <AbsoluteFill style={{ background: COLOR.paper, clipPath: `circle(${radius}px at 50% 50%)` }} />
    </AbsoluteFill>
  );
};

/** 설계 14.4~24초: 로고, 그리고 앱 전체 화면. 왼쪽 메뉴의 네 기능을 박자마다 하나씩 짚는다. */
export const Intro: React.FC = () => {
  const frame = useFrame();
  const leave = progress(frame, 132, 160, easeInOut);
  const rise = progress(frame, 138, 186, easeOut);
  const pose = track(frame, { x: 720, y: 450, z: 1 }, [
    [182, 198, { x: 420, y: 330, z: 1.55 }],
    [270, 288, { x: 720, y: 450, z: 1 }],
  ]);
  const hop = track(frame, { i: 0 }, [
    [214, 220, { i: 1 }],
    [232, 238, { i: 2 }],
    [250, 256, { i: 3 }],
  ]).i;
  const a = SPOT.sidebar[Math.floor(hop)];
  const b = SPOT.sidebar[Math.min(3, Math.floor(hop) + 1)];
  const t = hop - Math.floor(hop);
  const rect = { x: a.x, y: a.y + (b.y - a.y) * t, w: a.w, h: a.h };
  return (
    <AbsoluteFill>
      <Dawn />
      {rise > 0 && (
        <FullStage pose={pose}>
          <div
            style={{
              transformOrigin: "720px 900px",
              transform: `perspective(2400px) translateY(${(1 - rise) * 760}px) rotateX(${(1 - rise) * 34}deg) scale(${0.9 + rise * 0.1})`,
              opacity: Math.min(1, rise * 3),
            }}
          >
            <AppScreen states={[[0, "app-overview"]]} width={DESK.w} height={DESK.h}>
              <Spotlight rect={rect} show={198} hide={272} radius={10} dim={0.55} />
            </AppScreen>
          </div>
        </FullStage>
      )}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          opacity: 1 - leave,
          transform: `translateY(${-leave * 160}px) scale(${1 - leave * 0.12})`,
          filter: `blur(${leave * 10}px)`,
        }}
      >
        <Lockup start={6} tagline="덕장을 위한 AI 파트너" taglineStart={48} />
      </AbsoluteFill>
      <Sfx at={140} name="whoosh" volume={0.28} />
      {[198, 216, 234, 252].map((at) => (
        <Sfx key={at} at={at} name="tap" volume={0.16} />
      ))}
    </AbsoluteFill>
  );
};

/** 설계 72~78초: 맺음 */
export const End: React.FC = () => {
  const frame = useFrame();
  const radius = progress(frame, 0, 24, easeOut) * 1200;
  return (
    <AbsoluteFill style={{ background: COLOR.night }}>
      <AbsoluteFill style={{ background: COLOR.paper, clipPath: `circle(${radius}px at 50% 50%)` }} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: 70, flexDirection: "column" }}>
        <Lockup start={4} />
        <Words text="오늘의 바람, 함께 살펴볼까요?" start={52} size={58} weight={500} color={COLOR.muted} stagger={3} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
