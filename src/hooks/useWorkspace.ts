import { useCallback, useEffect, useRef, useState } from 'react';
import { workspaceApi, type Site, type WorkspaceSession } from '../lib/workspace';

const emptySession: WorkspaceSession = { user: null, sites: [] };
const selectionKey = (userId: string) => `haepung.site.v1:${userId}`;
function savedSite(userId: string) {
  try {
    return localStorage.getItem(selectionKey(userId)) || '';
  } catch {
    return '';
  }
}

export function useWorkspace() {
  const [session, setSession] = useState<WorkspaceSession>(emptySession);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const userIdRef = useRef<string | null>(null);
  const logoutRef = useRef<Promise<void> | null>(null);

  const applySession = useCallback((next: WorkspaceSession) => {
    requestRef.current?.abort();
    const previousUserId = userIdRef.current;
    setSession(next);
    setSelectedId((current) => {
      const candidate =
        next.user && previousUserId === next.user.id
          ? current
          : next.user
            ? savedSite(next.user.id)
            : '';
      return next.sites.some((site) => site.id === candidate) ? candidate : next.sites[0]?.id || '';
    });
    userIdRef.current = next.user?.id ?? null;
    setLoading(false);
    setError('');
  }, []);

  const refresh = useCallback(async () => {
    if (logoutRef.current) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const next = await workspaceApi.session(controller.signal);
      if (!controller.signal.aborted) applySession(next);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : '계정 정보를 확인할 수 없어요.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [applySession]);

  useEffect(() => {
    void refresh();
    const onFocus = () => {
      void refresh();
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30000);
    window.addEventListener('focus', onFocus);
    return () => {
      requestRef.current?.abort();
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  function selectSite(id: string) {
    if (
      !session.user ||
      userIdRef.current !== session.user.id ||
      !session.sites.some((site) => site.id === id)
    )
      return;
    setSelectedId(id);
    try {
      localStorage.setItem(selectionKey(session.user.id), id);
    } catch {
      /* Selection remains usable in memory. */
    }
  }
  function applySite(site: Site): boolean {
    // An old creation/acceptance response must not attach data to a newly signed-in account.
    const userId = session.user?.id;
    if (!userId || userIdRef.current !== userId || logoutRef.current) return false;
    requestRef.current?.abort();
    setSession((current) =>
      current.user?.id !== userId
        ? current
        : {
            ...current,
            sites: current.sites.some((item) => item.id === site.id)
              ? current.sites.map((item) => (item.id === site.id ? site : item))
              : [...current.sites, site],
          },
    );
    setSelectedId(site.id);
    try {
      localStorage.setItem(selectionKey(userId), site.id);
    } catch {
      /* Memory remains available. */
    }
    return true;
  }
  function logout(): Promise<void> {
    if (logoutRef.current) return logoutRef.current;
    requestRef.current?.abort();
    setLoading(true);
    const pending = (async () => {
      try {
        await workspaceApi.logout();
        applySession(emptySession);
      } finally {
        logoutRef.current = null;
        setLoading(false);
      }
    })();
    logoutRef.current = pending;
    return pending;
  }
  return {
    ...session,
    site: session.sites.find((site) => site.id === selectedId) ?? session.sites[0] ?? null,
    loading,
    error,
    applySession,
    selectSite,
    applySite,
    logout,
    refresh,
  };
}
