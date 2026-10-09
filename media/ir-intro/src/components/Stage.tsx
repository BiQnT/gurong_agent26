import { createContext, useContext } from "react";
import type React from "react";
import { AbsoluteFill, Img, interpolate } from "remotion";
import { useFrame } from "../timeline";
import { shot } from "../shots";

/** 카메라: 세계 좌표 (x, y) 를 화면 가운데에 두고 z 배로 본다. z 는 세계 1px 이 화면 몇 px 인지. */
export type Pose = { x: number; y: number; z: number };

const ZoomContext = createContext(1);

/** 커서처럼 확대와 상관없이 같은 크기로 보여야 하는 것에 쓴다. */
export const useZoom = () => useContext(ZoomContext);

export const Stage: React.FC<{
  width: number;
  height: number;
  pose: Pose;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ width, height, pose, children, style }) => (
  <div style={{ position: "absolute", width, height, overflow: "hidden", ...style }}>
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        transformOrigin: "0 0",
        transform: `translate(${width / 2}px, ${height / 2}px) scale(${pose.z}) translate(${-pose.x}px, ${-pose.y}px)`,
      }}
    >
      <ZoomContext.Provider value={pose.z}>{children}</ZoomContext.Provider>
    </div>
  </div>
);

/** 화면 전체를 쓰는 카메라 */
export const FullStage: React.FC<{ pose: Pose; children: React.ReactNode }> = ({ pose, children }) => (
  <AbsoluteFill>
    <Stage width={1920} height={1080} pose={pose}>
      {children}
    </Stage>
  </AbsoluteFill>
);

/** [프레임, 화면 이름, 바뀌는 데 걸리는 프레임] */
export type ScreenState = readonly [number, string, number?];

/**
 * 실제 앱 화면을 상태 순서대로 보여 준다. 새 상태는 짧게(기본 4프레임) 겹쳐 바뀐다.
 * 세계 좌표 (0, 0) 에 놓이고 크기는 CSS px 그대로다.
 */
export const AppScreen: React.FC<{
  states: ReadonlyArray<ScreenState>;
  width: number;
  height: number;
  radius?: number;
  shadow?: boolean;
  children?: React.ReactNode;
}> = ({ states, width, height, radius = 14, shadow = true, children }) => {
  const frame = useFrame();
  let current = 0;
  states.forEach(([at], index) => {
    if (frame >= at) current = index;
  });
  const [at, , fade = 4] = states[current];
  const opacity = interpolate(frame, [at, at + fade], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const layers = current > 0 && opacity < 1 ? [current - 1, current] : [current];
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width,
        height,
        borderRadius: radius,
        overflow: "hidden",
        background: "#fff",
        boxShadow: shadow ? "0 40px 100px rgba(27,27,25,0.16), 0 0 0 1px rgba(27,27,25,0.08)" : undefined,
      }}
    >
      {layers.map((index) => (
        <Img
          key={states[index][1]}
          src={shot(states[index][1])}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width,
            height,
            opacity: index === current ? opacity : 1,
          }}
        />
      ))}
      {children}
    </div>
  );
};
