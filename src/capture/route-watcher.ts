// SPA route detection without touching the page's history object (§6.2, §9).
// Uses the Navigation API where available, plus popstate and a cheap location poll fallback.

export interface RouteWatcherDeps {
  getHref: () => string;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
  /** window.navigation (Chrome 102+), if present. */
  navigation?: {
    addEventListener: (type: string, fn: () => void) => void;
    removeEventListener: (type: string, fn: () => void) => void;
  };
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

/** Calls `onChange(href)` whenever the URL changes. Returns a stop function. */
export function watchRoute(
  deps: RouteWatcherDeps,
  onChange: (href: string) => void,
  pollMs = 1000,
): () => void {
  let last = deps.getHref();
  const check = (): void => {
    try {
      const href = deps.getHref();
      if (href !== last) {
        last = href;
        onChange(href);
      }
    } catch {
      // never throw into the page
    }
  };
  // navigatesuccess fires after the URL has committed.
  deps.navigation?.addEventListener('navigatesuccess', check);
  deps.addEventListener('popstate', check);
  const handle = deps.setInterval(check, pollMs);
  return () => {
    deps.navigation?.removeEventListener('navigatesuccess', check);
    deps.removeEventListener('popstate', check);
    deps.clearInterval(handle);
  };
}
