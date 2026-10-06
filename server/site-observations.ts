import { distanceMeters } from '../src/lib/geo.ts';
import type { LiveObservation, LiveSnapshot } from '../src/lib/live.ts';
import { KMA_FALLBACK_WARNING } from './eum.ts';

const isKma = (observation: LiveObservation) => observation.device.provider === 'kma';
// E-UM 과 기상청 AWS 가 이만큼 넘게 다르면 관측기 상태를 의심하라고 알린다.
const CROSS_CHECK = { temperatureC: 5, humidityPct: 25 };

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
  // E-UM 우선. 1km 안에 최근 E-UM 값이 없을 때만 기상청 AWS 를 쓴다.
  const nearbyEum = nearby.filter((item) => !isKma(item));
  const nearbyKma = nearby.filter(isKma);
  const explicit = explicitDeviceId
    ? byDistance.find((item) => item.device.id === explicitDeviceId)
    : undefined;
  const selected =
    explicit ??
    nearbyEum[0] ??
    nearbyKma[0] ??
    byDistance.find((item) => item.status !== 'invalid' && !isKma(item)) ??
    byDistance.find((item) => item.status !== 'invalid') ??
    byDistance[0] ??
    null;
  const warnings = snapshot.warnings.filter(
    (warning) => !warning.includes('실제 덕장 좌표와 검증된') && warning !== KMA_FALLBACK_WARNING,
  );
  if (!nearby.length)
    warnings.push(
      '덕장 1km 이내에서 사용할 수 있는 최근 관측값을 찾지 못했어요. 관측 자료의 거리와 시각을 확인해 주세요.',
    );
  else if (selected && isKma(selected) && !explicit)
    warnings.push(
      `덕장 1km 안 E-UM 관측기의 최근 값이 없어 기상청 구룡포 AWS(약 ${selected.distanceM}m) 관측값을 대신 보여드려요.`,
    );
  const reference = nearbyKma[0];
  if (
    selected &&
    !isKma(selected) &&
    selected.status === 'current' &&
    reference &&
    selected.temperature !== null &&
    selected.humidity !== null &&
    reference.temperature !== null &&
    reference.humidity !== null &&
    (Math.abs(selected.temperature - reference.temperature) > CROSS_CHECK.temperatureC ||
      Math.abs(selected.humidity - reference.humidity) > CROSS_CHECK.humidityPct)
  )
    warnings.push(
      `E-UM ${selected.device.name} 값이 기상청 구룡포 AWS 와 크게 달라요 (기온 ${selected.temperature}°C / ${reference.temperature}°C, 습도 ${selected.humidity}% / ${reference.humidity}%). 관측기 상태를 확인해 주세요.`,
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
