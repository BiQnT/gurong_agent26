import { distanceMeters } from '../src/lib/geo.ts';
import {
  DRYING_THRESHOLDS,
  distanceLimit,
  distanceRule,
  implausibleReading,
  isKmaSource,
} from '../src/lib/drying.ts';
import type { LiveObservation, LiveSnapshot, SelectionReason } from '../src/lib/live.ts';
import { KMA_FALLBACK_WARNING } from './eum.ts';

const isAws = (observation: LiveObservation) => observation.device.provider === 'kma';
const isGrid = (observation: LiveObservation) => observation.device.provider === 'kma-grid';
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

const distanceText = (meters: number | null | undefined) =>
  typeof meters !== 'number'
    ? '거리 미확인'
    : meters < 1000
      ? `약 ${meters}m`
      : `약 ${(meters / 1000).toFixed(1)}km`;

const kstTime = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(iso))
    : '시각 미확인';

type SiteLocation = { id: string; name: string; latitude: number; longitude: number };

/**
 * 덕장 위치로 관측을 고른다 (ADR 0009, 0013). 거리 순서대로:
 * 1. 1km 안의 믿을 만한 최근 E-UM 관측 (정본)
 * 2. 5km 안의 최근 기상청 AWS
 * 3. 덕장이 속한 기상청 초단기실황 5km 격자 (`grid`, 주면)
 * 셋 다 없으면 가장 가까운 관측을 보여 주되 규칙 함수가 판정 불가로 둔다.
 */
export function attachSiteContext(
  snapshot: LiveSnapshot,
  site: SiteLocation,
  explicitDeviceId?: string,
  grid?: LiveObservation | null,
): LiveSnapshot {
  const source = grid
    ? [...snapshot.observations.filter((item) => item.device.id !== grid.device.id), grid]
    : snapshot.observations;
  const devices =
    grid && !snapshot.devices.some((device) => device.id === grid.device.id)
      ? [...snapshot.devices, grid.device]
      : snapshot.devices;
  const observations = source.map((observation) => ({
    ...observation,
    distanceM: Math.round(distanceMeters(site, observation.device)),
  }));
  const byDistance = [...observations].sort((a, b) => a.distanceM - b.distanceM);
  // 출처마다 거리 한도가 다르다: E-UM 1km, 기상청 AWS·격자 5km.
  const usable = (item: (typeof observations)[number]) =>
    item.status === 'current' &&
    item.distanceM <= distanceLimit({ provider: item.device.provider });
  const nearbyEum = byDistance.filter((item) => !isKmaSource(item.device.provider) && usable(item));
  // E-UM 장비 이상을 가리는 비교 기준은 1km 안의 기상청 AWS 만 쓴다 (먼 곳과는 원래 다를 수 있다).
  const reference = byDistance.find(
    (item) =>
      isAws(item) &&
      usable(item) &&
      item.distanceM <= DRYING_THRESHOLDS.maxDistanceM &&
      !implausibleReading(item.humidity),
  );
  // 습도 5% 미만처럼 나올 수 없는 값이거나 기상청과 크게 다르면 그 E-UM 값은 고르지 않는다.
  const anomalous = (item: LiveObservation) =>
    implausibleReading(item.humidity) || (reference ? differs(item, reference) : false);
  const trusted = nearbyEum.find((item) => !anomalous(item));
  const skipped = nearbyEum.find(anomalous);
  // 1km 안 E-UM 을 못 쓰면 5km 안 기상청 AWS, 그다음 덕장 격자 초단기실황. 기상청 값도 비정상이면 쓰지 않는다.
  const fallback =
    byDistance.find((item) => isAws(item) && usable(item) && !implausibleReading(item.humidity)) ??
    byDistance.find((item) => isGrid(item) && usable(item) && !implausibleReading(item.humidity));
  const explicit = explicitDeviceId
    ? byDistance.find((item) => item.device.id === explicitDeviceId)
    : undefined;
  let selectionReason: SelectionReason = 'eum';
  let selected: LiveObservation | null;
  // 화면이 자동으로 고른 장비를 그대로 보내도 사용자가 고른 것으로 치지 않는다 (자동 선택과 같으면 자동).
  const automatic =
    trusted ??
    fallback ??
    skipped ??
    byDistance.find((item) => item.status !== 'invalid' && !isKmaSource(item.device.provider)) ??
    byDistance.find((item) => item.status !== 'invalid') ??
    byDistance[0];
  if (explicit && explicit.device.id !== automatic?.device.id) {
    selected = explicit;
    selectionReason = 'explicit';
  } else if (trusted) {
    selected = trusted;
  } else if (fallback) {
    selected = fallback;
    selectionReason = skipped
      ? 'kma-eum-anomaly'
      : isGrid(fallback)
        ? 'kma-grid'
        : 'kma-no-recent-eum';
  } else {
    selected =
      skipped ??
      byDistance.find((item) => item.status !== 'invalid' && !isKmaSource(item.device.provider)) ??
      byDistance.find((item) => item.status !== 'invalid') ??
      byDistance[0] ??
      null;
  }
  const warnings = snapshot.warnings.filter(
    (warning) => !warning.includes('실제 덕장 좌표와 검증된') && warning !== KMA_FALLBACK_WARNING,
  );
  const values = (item: LiveObservation) => `기온 ${item.temperature}°C·습도 ${item.humidity}%`;
  const where = (item: LiveObservation) =>
    isGrid(item)
      ? `기상청 초단기실황(덕장이 속한 5km 격자, ${kstTime(item.observedAt)} 자료)`
      : `${item.device.name}(${distanceText(item.distanceM)})`;
  if (!nearbyEum.length && !fallback)
    warnings.push(
      `덕장 근처(${distanceRule()})에서 사용할 수 있는 최근 관측값을 찾지 못했어요. 관측 자료의 거리와 시각을 확인해 주세요.`,
    );
  else if (selectionReason === 'kma-no-recent-eum' && selected)
    warnings.push(
      `덕장 1km 안 E-UM 관측기의 최근 값이 없어 ${where(selected)} 관측값으로 판단해요.`,
    );
  else if (selectionReason === 'kma-grid' && selected)
    warnings.push(
      `덕장 1km 안 E-UM 과 5km 안 기상청 AWS 의 최근 값이 없어 ${where(selected)} 값으로 판단해요. 격자 값이라 덕장 현장과 다를 수 있어요.`,
    );
  else if (selectionReason === 'kma-eum-anomaly' && selected && skipped)
    warnings.push(
      `E-UM ${skipped.device.name} 값(${values(skipped)})이 ${
        reference
          ? `비정상이거나 ${reference.device.name}(${values(reference)})와 크게 달라`
          : '비정상이라'
      } ${where(selected)} 값을 기준으로 판단해요. 관측기 상태를 확인해 주세요.`,
    );
  else if (
    selectionReason === 'eum' &&
    skipped &&
    selected &&
    skipped !== selected &&
    skipped.distanceM < (selected.distanceM ?? Infinity)
  )
    warnings.push(
      `가까운 E-UM ${skipped.device.name} 값(${values(skipped)})이 비정상으로 보여 ${selected.device.name} 값을 썼어요. 관측기 상태를 확인해 주세요.`,
    );
  else if (
    selected &&
    !isKmaSource(selected.device.provider) &&
    anomalous(selected) &&
    selected.status === 'current'
  )
    warnings.push(
      `E-UM ${selected.device.name} 값(${values(selected)})이 비정상으로 보여요. 관측기 상태를 확인해 주세요.`,
    );
  warnings.push(
    '거리는 등록한 덕장 위치를 기준으로 계산했어요. 건조 등급은 현장 검증 전 가설 기준으로 규칙 함수가 정해요.',
  );
  return {
    ...snapshot,
    devices,
    observations,
    selected,
    warnings,
    selectionReason,
    site: { id: site.id, name: site.name, latitude: site.latitude, longitude: site.longitude },
  };
}
