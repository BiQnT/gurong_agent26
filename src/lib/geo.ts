export type Coordinates = { latitude: number; longitude: number };

/** Great-circle distance between the registered site and a source observation device. */
export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = radians(b.latitude - a.latitude);
  const deltaLon = radians(b.longitude - a.longitude);
  const term =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(deltaLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(term), Math.sqrt(Math.max(0, 1 - term)));
}

export function formatDistance(distance?: number | null): string {
  if (distance == null) return '거리 미확인';
  return distance < 1000 ? `${Math.round(distance)}m` : `${(distance / 1000).toFixed(1)}km`;
}
