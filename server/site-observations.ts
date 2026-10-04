import { distanceMeters } from '../src/lib/geo.ts';
import type { LiveSnapshot } from '../src/lib/live.ts';

type SiteLocation = { id: string; name: string; latitude: number; longitude: number };

export function attachSiteContext(
  snapshot: LiveSnapshot,
  site: SiteLocation,
  explicitDeviceId?: string,
): LiveSnapshot {
  const observations = snapshot.observations.map((observation) => ({
    ...observation,
    distanceM: Math.round(distanceMeters(site, observation.device)),
  }));
  const byDistance = [...observations].sort((a, b) => a.distanceM - b.distanceM);
  const nearby = byDistance.filter((item) => item.status === 'current' && item.distanceM <= 1000);
  const selected =
    (explicitDeviceId
      ? byDistance.find((item) => item.device.id === explicitDeviceId)
      : nearby[0]) ??
    byDistance.find((item) => item.status !== 'invalid') ??
    byDistance[0] ??
    null;
  const warnings = snapshot.warnings.filter(
    (warning) => !warning.includes('실제 덕장 좌표와 검증된'),
  );
  if (!nearby.length)
    warnings.push(
      '덕장 1km 이내에서 사용할 수 있는 최근 관측값을 찾지 못했어요. 관측 자료의 거리와 시각을 확인해 주세요.',
    );
  warnings.push(
    '거리는 등록한 덕장 위치를 기준으로 계산했어요. 건조 판정 기준은 아직 검증되지 않아 적합 등급을 제공하지 않아요.',
  );
  return {
    ...snapshot,
    observations,
    selected,
    warnings,
    site: { id: site.id, name: site.name, latitude: site.latitude, longitude: site.longitude },
  };
}
