import type React from "react";
import { Img, interpolate } from "remotion";
import { useFrame } from "../timeline";
import { easeInOut, progress } from "../motion";
import { shot, type Field, type Rect } from "../shots";
import { useZoom } from "./Stage";

/**
 * 입력칸에 글자가 한 자씩 들어가는 모습. 다 쓴 상태의 실제 화면에서 글자 부분만 잘라
 * 왼쪽부터 한 글자 폭씩 드러낸다 (글꼴·위치가 실제 화면과 똑같다).
 * show 부터 자리 표시 글자를 가리고 커서를 깜박이며, until 에 바탕 화면이 다 쓴 상태로 바뀌면 사라진다.
 */
export const Typing: React.FC<{
  field: Field;
  typed: string;
  imageSize: { w: number; h: number };
  chars: number;
  show: number;
  start: number;
  end: number;
  until: number;
}> = ({ field, typed, imageSize, chars, show, start, end, until }) => {
  const frame = useFrame();
  const zoom = useZoom();
  if (frame < show || frame >= until) return null;
  const count = Math.floor(
    interpolate(frame, [start, end], [0, chars], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
  );
  const { cover, text } = field;
  const revealed = (text.w * count) / chars;
  const typing = frame >= start && frame < end;
  const caretOn = typing || Math.floor((frame - show) / 8) % 2 === 0;
  return (
    <div
      style={{
        position: "absolute",
        left: cover.x,
        top: cover.y,
        width: cover.w,
        height: cover.h,
        background: field.background,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: text.x - cover.x,
          top: text.y - cover.y,
          width: revealed,
          height: text.h,
          overflow: "hidden",
        }}
      >
        <Img
          src={shot(typed)}
          style={{ position: "absolute", left: -text.x, top: -text.y, width: imageSize.w, height: imageSize.h }}
        />
      </div>
      {caretOn && (
        <div
          style={{
            position: "absolute",
            left: text.x - cover.x + revealed + 1,
            top: Math.max(0, text.y - cover.y + 1),
            width: Math.max(1.2, 1.6 / zoom),
            height: Math.min(cover.h - 2, 18),
            background: "#262626",
          }}
        />
      )}
    </div>
  );
};

/** 한 곳만 밝게 두고 나머지를 옅게 덮는다 */
export const Spotlight: React.FC<{
  rect: Rect;
  show: number;
  hide: number;
  radius?: number;
  dim?: number;
}> = ({ rect, show, hide, radius = 14, dim = 0.5 }) => {
  const frame = useFrame();
  const zoom = useZoom();
  const on = Math.min(progress(frame, show, show + 12), 1 - progress(frame, hide - 10, hide));
  if (on <= 0) return null;
  const grow = 1 + (1 - on) * 0.03;
  return (
    <div
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        borderRadius: radius,
        transform: `scale(${grow})`,
        boxShadow: `0 0 0 ${2.5 / zoom}px rgba(27,27,25,${0.75 * on}), 0 0 0 9999px rgba(247,245,240,${dim * on})`,
        zIndex: 40,
      }}
    />
  );
};

/** 막대가 왼쪽부터 자라 보이도록, start 에 영역을 덮고 end 까지 오른쪽으로 걷어 낸다 (start 는 막대가 든 화면이 뜨는 때) */
export const Wipe: React.FC<{ rect: Rect; start: number; end: number; background?: string }> = ({
  rect,
  start,
  end,
  background = "#ffffff",
}) => {
  const frame = useFrame();
  if (frame < start || frame >= end) return null;
  const p = progress(frame, start, end, easeInOut);
  return (
    <div
      style={{
        position: "absolute",
        left: rect.x + rect.w * p,
        top: rect.y,
        width: rect.w * (1 - p),
        height: rect.h,
        background,
      }}
    />
  );
};

/** 다른 상태 화면의 한 부분을 잠깐 덧댄다 (글자를 쓰는 동안 보내기 버튼이 켜지는 것처럼) */
export const Patch: React.FC<{
  rect: Rect;
  from: string;
  imageSize: { w: number; h: number };
  show: number;
  until: number;
}> = ({ rect, from, imageSize, show, until }) => {
  const frame = useFrame();
  if (frame < show || frame >= until) return null;
  return (
    <div style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h, overflow: "hidden" }}>
      <Img src={shot(from)} style={{ position: "absolute", left: -rect.x, top: -rect.y, width: imageSize.w, height: imageSize.h }} />
    </div>
  );
};
