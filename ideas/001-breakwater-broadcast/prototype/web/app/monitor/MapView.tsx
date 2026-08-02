"use client";

import dynamic from "next/dynamic";
import type { Device } from "@/lib/eum";

/**
 * leaflet 은 window 에 의존해서 서버 렌더링에서 죽는다. `ssr: false` 동적 임포트는
 * 클라이언트 컴포넌트 안에서만 쓸 수 있으므로 이 얇은 래퍼를 둔다.
 */
const MapInner = dynamic(() => import("./MapInner"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-500 dark:bg-slate-800 dark:text-slate-400">
      지도를 불러오는 중…
    </div>
  ),
});

export default function MapView(props: {
  speakers: Device[];
  cctvs: Device[];
  uvSensors: Device[];
  targetSpeakerIds: number[];
}) {
  return <MapInner {...props} />;
}
