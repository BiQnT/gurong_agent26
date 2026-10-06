import { distanceMeters } from '../src/lib/geo.ts';
import { implausibleReading } from '../src/lib/drying.ts';
import type { LiveObservation, LiveSnapshot, SelectionReason } from '../src/lib/live.ts';
import { KMA_FALLBACK_WARNING } from './eum.ts';

const isKma = (observation: LiveObservation) => observation.device.provider === 'kma';
// E-UM 과 기상청 AWS 가 이만큼 넘게 다르면 E-UM 장비 이상으로 보고 기상청 값을 쓴다.
// 장비 고장을 거르는 값이며 건조 기준이 아니다.
const CROSS_CHECK = { temperatureC: 5, humidityPct: 25 };
const differs = (item: LiveObservation, reference: LiveObservation) =>
  item.temperature !== null &&
  item.humidity !== null &&
  reference.temperature !== null &&
  reference.humidity !== null &&
  (Math.abs(item.temperature - reference.temperature) > CROSS_CHECK.temperatureC ||
    Math.abs(item.humidity - reference.humidity) > CROSS_CHECK.humidityPct);

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
  // E-UM 우선. 1km 안에 믿을 만한 최근 E-UM 값이 없을 때만 기상청 AWS 를 쓴다 (ADR 0009).
  const nearbyEum = nearby.filter((item) => !isKma(item));
  const reference = nearby.find(isKma);
  // 습도 5% 미만처럼 나올 수 없는 값이거나 기상청과 크게 다르면 그 E-UM 값은 고르지 않는다.
  const anomalous = (item: LiveObservation) =>
    implausibleReading(item.humidity) || (reference ? differs(item, reference) : false);
  const trusted = nearbyEum.find((item) => !anomalous(item));
  const skipped = nearbyEum.find(anomalous);
  const explicit = explicitDeviceId
    ? byDistance.find((item) => item.device.id === explicitDeviceId)
    : undefined;
  let selectionReason: SelectionReason = 'eum';
  let selected: LiveObservation | null;
  if (explicit) {
    selected = explicit;
    selectionReason = 'explicit';
  } else if (trusted) {
    selected = trusted;
  } else if (reference) {
    selected = reference;
    selectionReason = skipped ? 'kma-eum-anomaly' : 'kma-no-recent-eum';
  } else {
    selected =
      skipped ??
      byDistance.find((item) => item.status !== 'invalid' && !isKma(item)) ??
      byDistance.find((item) => item.status !== 'invalid') ??
      byDistance[0] ??
      null;
  }
  const warnings = snapshot.warnings.filter(
    (warning) => !warning.includes('실제 덕장 좌표와 검증된') && warning !== KMA_FALLBACK_WARNING,
  );
  const values = (item: LiveObservation) => `기온 ${item.temperature}°C·습도 ${item.humidity}%`;
  if (!nearby.length)
    warnings.push(
      '덕장 1km 이내에서 사용할 수 있는 최근 관측값을 찾지 못했어요. 관측 자료의 거리와 시각을 확인해 주세요.',
    );
  else if (selectionReason === 'kma-no-recent-eum' && selected)
    warnings.push(
      `덕장 1km 안 E-UM 관측기의 최근 값이 없어 기상청 구룡포 AWS(약 ${selected.distanceM}m) 관측값을 대신 보여드려요.`,
    );
  else if (selectionReason === 'kma-eum-anomaly' && selected && skipped)
    warnings.push(
      `E-UM ${skipped.device.name} 값(${values(skipped)})이 비정상이거나 기상청 구룡포 AWS(${values(selected)})와 크게 달라 기상청 AWS(약 ${selected.distanceM}m) 값을 기준으로 판단해요. 관측기 상태를 확인해 주세요.`,
    );
  else if (selectionReason === 'eum' && skipped && selected && skipped !== selected)
    warnings.push(
      `가까운 E-UM ${skipped.device.name} 값(${values(skipped)})이 비정상으로 보여 ${selected.device.name} 값을 썼어요. 관측기 상태를 확인해 주세요.`,
    );
  else if (selected && !isKma(selected) && anomalous(selected) && selected.status === 'current')
    warnings.push(
      `E-UM ${selected.device.name} 값(${values(selected)})이 비정상으로 보여요. 관측기 상태를 확인해 주세요.`,
    );
  warnings.push(
    '거리는 등록한 덕장 위치를 기준으로 계산했어요. 건조 등급은 현장 검증 전 가설 기준으로 규칙 함수가 정해요.',
  );
  return {
    ...snapshot,
    observations,
    selected,
    warnings,
    selectionReason,
    site: { id: site.id, name: site.name, latitude: site.latitude, longitude: site.longitude },
  };
}
