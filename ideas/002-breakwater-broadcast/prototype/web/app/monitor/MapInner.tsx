"use client";

import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, TileLayer, Tooltip } from "react-leaflet";
import type { Device } from "@/lib/eum";

/**
 * 지도 본체. **반드시 클라이언트에서만 로드된다** (`MapView` 가 ssr:false 로 감싼다).
 * leaflet 은 window 를 직접 만져서 서버 렌더링에서 죽는다.
 *
 * 기본 Marker 대신 CircleMarker 를 쓰는 이유: leaflet 의 기본 마커 아이콘은
 * 번들러에서 경로가 깨져 빈 이미지가 뜬다. CircleMarker 는 순수 SVG 라
 * 에셋 의존이 없다.
 */

const CENTER: [number, number] = [35.9865, 129.5585]; // 구룡포항 남·북 방파제 사이

type Props = {
  speakers: Device[];
  cctvs: Device[];
  uvSensors: Device[];
  /** 방송 대상으로 선택된 스피커 id. 강조 표시한다. */
  targetSpeakerIds: number[];
};

const STYLE = {
  speakerTarget: { color: "#dc2626", fillColor: "#ef4444", fillOpacity: 0.9, weight: 3 },
  speaker: { color: "#1d4ed8", fillColor: "#3b82f6", fillOpacity: 0.7, weight: 2 },
  cctv: { color: "#047857", fillColor: "#10b981", fillOpacity: 0.6, weight: 1 },
  uv: { color: "#b45309", fillColor: "#f59e0b", fillOpacity: 0.7, weight: 2 },
};

export default function MapInner({ speakers, cctvs, uvSensors, targetSpeakerIds }: Props) {
  return (
    <MapContainer
      center={CENTER}
      zoom={16}
      scrollWheelZoom
      style={{ height: "100%", width: "100%" }}
      className="rounded-lg"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {cctvs.map((d) => (
        <CircleMarker
          key={`cctv-${d.id}`}
          center={[Number(d.latitude), Number(d.longitude)]}
          radius={5}
          pathOptions={STYLE.cctv}
        >
          <Tooltip>
            <strong>AI CCTV</strong>
            <br />
            {d.name}
          </Tooltip>
        </CircleMarker>
      ))}

      {uvSensors.map((d) => (
        <CircleMarker
          key={`uv-${d.id}`}
          center={[Number(d.latitude), Number(d.longitude)]}
          radius={7}
          pathOptions={STYLE.uv}
        >
          <Tooltip>
            <strong>자외선 측정기</strong>
            <br />
            {d.name}
            <br />
            {d.address}
          </Tooltip>
        </CircleMarker>
      ))}

      {speakers.map((d) => {
        const isTarget = targetSpeakerIds.includes(d.id);
        return (
          <CircleMarker
            key={`spk-${d.id}`}
            center={[Number(d.latitude), Number(d.longitude)]}
            radius={isTarget ? 12 : 9}
            pathOptions={isTarget ? STYLE.speakerTarget : STYLE.speaker}
          >
            <Tooltip permanent={isTarget} direction="top">
              <strong>{isTarget ? "방송 대상 " : ""}스피커</strong>
              <br />
              {d.name}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
