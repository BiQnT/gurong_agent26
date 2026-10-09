import type React from "react";
import { Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

/** 원본 픽셀 기준 보여 줄 영역 [x, y, 너비]. 높이는 틀 비율로 정해진다. */
export type Crop = [number, number, number];

/**
 * 스크린샷 여러 장을 차례로 겹쳐 바꾼다. 장마다 crop(시작 영역)에서 to(끝 영역)로 천천히 움직여
 * 필요한 부분만 크게 보여 준다. crop 이 없으면 너비에 맞춰 위에서부터 보여 준다.
 */
export const CrossShot: React.FC<{
  width: number;
  height: number;
  items: { file: string; width: number; height: number; from: number; crop?: Crop; to?: Crop }[];
  style?: React.CSSProperties;
}> = ({ width, height, items, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ position: "absolute", inset: 0, width, height, overflow: "hidden", ...style }}>
      {items.map((item, index) => {
        const next = items[index + 1]?.from;
        const start: Crop = item.crop ?? [0, 0, item.width];
        const end: Crop = item.to ?? start;
        const range = [(item.from + 0.4) * fps, ((next ?? item.from + 5) + 0.3) * fps];
        const move = (a: number, b: number) =>
          interpolate(frame, range, [a, b], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.inOut(Easing.cubic),
          });
        const scale = width / move(start[2], end[2]);
        const x = move(start[0], end[0]);
        const y = move(start[1], end[1]);
        return (
          <Img
            key={item.file}
            src={staticFile(`shots/${item.file}`)}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: item.width * scale,
              height: item.height * scale,
              maxWidth: "none",
              translate: `${-x * scale}px ${-y * scale}px`,
              // 앞 장이 0.25초에 빠지고 다음 장이 0.25초에 들어온다 (글자가 겹쳐 보이지 않게).
              opacity:
                interpolate(frame, [(item.from + 0.25) * fps, (item.from + 0.5) * fps], [index === 0 ? 1 : 0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }) *
                (next === undefined
                  ? 1
                  : interpolate(frame, [next * fps, (next + 0.25) * fps], [1, 0], {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                    })),
            }}
          />
        );
      })}
    </div>
  );
};
