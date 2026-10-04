import { useCallback, useEffect, useRef, useState } from 'react';
import { readLiveSnapshot, type LiveSnapshot } from '../lib/live';

const deviceKey = (siteId?: string) => `haepung.selected-device.v2:${siteId || 'public'}`;
function savedDevice(siteId?: string) {
  try {
    return localStorage.getItem(deviceKey(siteId)) ?? '';
  } catch {
    return '';
  }
}

/** Keeps source timestamps intact; browser refresh time never becomes observation time. */
export function useLiveObservations(siteId?: string, siteRevision = '') {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [deviceId, setDeviceId] = useState(() => savedDevice(siteId));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    try {
      const base = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
      const query = siteId ? `?siteId=${encodeURIComponent(siteId)}` : '';
      const response = await fetch(`${base}/api/observations${query}`, {
        signal: controller.signal,
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`관측 정보를 가져오지 못했습니다. (${response.status})`);
      const next = readLiveSnapshot(await response.json());
      if (request.current !== controller) return;
      setSnapshot(next);
      if (next.status === 'error') setError(next.error || '관측 정보를 확인할 수 없습니다.');
    } catch (cause) {
      if (!controller.signal.aborted && request.current === controller) {
        setError(cause instanceof Error ? cause.message : '관측 서버에 연결할 수 없습니다.');
        // Do not keep an earlier success badge when the latest refresh failed.
        setSnapshot(null);
      }
    } finally {
      if (request.current === controller) {
        setLoading(false);
        request.current = null;
      }
    }
  }, [siteId, siteRevision]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 300000);
    return () => {
      request.current?.abort();
      clearInterval(interval);
    };
  }, [refresh]);
  // Never show or record distances computed for a location that has just been edited.
  const currentSnapshot =
    snapshot &&
    (!siteRevision || `${snapshot.site?.latitude},${snapshot.site?.longitude}` === siteRevision)
      ? snapshot
      : null;
  const selected =
    currentSnapshot?.observations.find((item) => item.device.id === deviceId) ??
    currentSnapshot?.selected ??
    null;
  function selectDevice(id: string) {
    if (id && !snapshot?.devices.some((device) => device.id === id)) return;
    setDeviceId(id);
    try {
      localStorage.setItem(deviceKey(siteId), id);
    } catch {
      /* In-memory selection still works. */
    }
  }
  return {
    snapshot: currentSnapshot,
    selected,
    preferredDeviceId: deviceId,
    deviceId: selected?.device.id ?? '',
    selectDevice,
    loading,
    error,
    refresh,
  };
}
