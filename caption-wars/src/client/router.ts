// Hash router. Two routes only: `#/` (home) and `#/room/ABCD` (one room).
// A hash keeps the whole game on one static file, so a shared link works
// without any server-side routing.

export interface Route {
  /** Path parts, e.g. ['room', 'ABCD']. Empty for `#/`. */
  parts: string[];
  raw: string;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const path = raw.split('?')[0] ?? '';
  const parts = path
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  return { parts, raw };
}

export function currentRoute(): Route {
  return parseHash(window.location.hash);
}

export function navigate(hash: string): void {
  const next = hash.startsWith('#') ? hash : `#${hash}`;
  if (window.location.hash === next) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  window.location.hash = next;
}

/** Calls `render` now and on every hash change. */
export function startRouter(render: (route: Route) => void): void {
  const run = (): void => {
    if (!window.location.hash) {
      window.location.replace('#/');
      return;
    }
    render(currentRoute());
  };
  window.addEventListener('hashchange', run);
  run();
}
