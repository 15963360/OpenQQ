import { useSyncExternalStore } from 'react';

// A minimal history router: the server serves index.html for each console route (see src/webui.mjs).
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => { listeners.delete(listener); window.removeEventListener('popstate', listener); };
}
const snapshot = () => location.pathname + location.search;

export function useLocation() {
  const value = useSyncExternalStore(subscribe, snapshot);
  const index = value.indexOf('?');
  return { pathname: index < 0 ? value : value.slice(0, index), search: index < 0 ? '' : value.slice(index) };
}

export function useSearchParam(name: string) {
  return new URLSearchParams(useLocation().search).get(name);
}

export function navigate(to: string, { replace = false }: { replace?: boolean } = {}) {
  if (to === snapshot()) return;
  const samePage = to.split('?')[0] === location.pathname;
  history[replace ? 'replaceState' : 'pushState'](null, '', to);
  for (const listener of listeners) listener();
  if (!samePage) window.scrollTo({ top: 0 });
}

export function setSearchParam(name: string, value: string | null) {
  const params = new URLSearchParams(location.search);
  if (value == null) params.delete(name); else params.set(name, value);
  const query = params.toString();
  navigate(location.pathname + (query ? '?' + query : ''), { replace: true });
}
