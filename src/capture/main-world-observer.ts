// Read-only observer for fetch/XHR responses the page itself requested (§2.1, §2.2, §6.2).
//
// Rules this file must keep (each has a test):
//  - Never issues a request. It only wraps the page's own calls and returns their exact result.
//  - Never alters a request or response. Bodies are read from a clone (fetch) or after load (XHR).
//  - Never throws into the page. Every observer step is wrapped; failures are swallowed.
// This is the only file allowed to reference fetch/XMLHttpRequest (see constraints.test.ts).

export interface ObservedMessage {
  url: string;
  status: number;
  text: string;
}

export interface ObserverDeps {
  /** Cheap URL pre-filter: only matching responses are cloned at all. */
  isCandidate: (url: string) => boolean;
  /** Body filter after reading (e.g. drop GraphQL that isn't a profile). */
  wantsBody: (url: string, text: string) => boolean;
  post: (msg: ObservedMessage) => void;
  /** Skip bodies larger than this. */
  maxBytes: number;
}

/** The parts of `window` the observer touches; tests pass a fake. */
export interface ObservableWindow {
  fetch: typeof fetch;
  XMLHttpRequest: typeof XMLHttpRequest;
  location: { href: string };
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function resolveUrl(input: unknown, base: string): string | undefined {
  return safe(() => {
    if (typeof input === 'string') return new URL(input, base).href;
    if (input instanceof URL) return input.href;
    if (input && typeof input === 'object' && 'url' in input && typeof input.url === 'string') {
      return new URL(input.url, base).href;
    }
    return undefined;
  }, undefined);
}

/** Install the observer. Returns an uninstaller that restores the originals exactly. */
export function installObserver(win: ObservableWindow, deps: ObserverDeps): () => void {
  const originalFetch = win.fetch;
  const proto = win.XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;
  const xhrUrls = new WeakMap<XMLHttpRequest, string>();

  const deliver = (url: string, status: number, text: string): void => {
    safe(() => {
      if (text.length > deps.maxBytes) return;
      if (!deps.wantsBody(url, text)) return;
      deps.post({ url, status, text });
    }, undefined);
  };

  const readClone = async (url: string, res: Response): Promise<void> => {
    try {
      if (res.type === 'opaque' || res.type === 'opaqueredirect') return;
      const declared = Number(res.headers.get('content-length') ?? '0');
      if (declared > deps.maxBytes) return;
      deliver(url, res.status, await res.text());
    } catch {
      // Swallow: the page's own copy of the response is unaffected.
    }
  };

  const observedFetch = function (
    this: unknown,
    ...args: Parameters<typeof fetch>
  ): ReturnType<typeof fetch> {
    // The page's request goes out exactly as made; nothing below can change or delay it.
    const result = originalFetch.apply(win, args);
    const url = resolveUrl(args[0], win.location.href);
    if (url && safe(() => deps.isCandidate(url), false)) {
      result.then(
        (res) => {
          const clone = safe(() => res.clone(), undefined);
          if (clone) void readClone(url, clone);
        },
        () => undefined,
      );
    }
    return result;
  };
  win.fetch = observedFetch as typeof fetch;

  proto.open = function (this: XMLHttpRequest, ...args: unknown[]) {
    safe(() => {
      const url = resolveUrl(args[1], win.location.href);
      if (url) xhrUrls.set(this, url);
    }, undefined);
    return (originalOpen as (...a: unknown[]) => void).apply(this, args);
  } as typeof proto.open;

  proto.send = function (this: XMLHttpRequest, ...args: unknown[]) {
    safe(() => {
      const url = xhrUrls.get(this);
      if (!url || !deps.isCandidate(url)) return;
      this.addEventListener('load', () => {
        safe(() => {
          let text: string | undefined;
          if (this.responseType === '' || this.responseType === 'text') text = this.responseText;
          else if (this.responseType === 'json') text = JSON.stringify(this.response);
          if (text !== undefined) deliver(url, this.status, text);
        }, undefined);
      });
    }, undefined);
    return (originalSend as (...a: unknown[]) => void).apply(this, args);
  } as typeof proto.send;

  return () => {
    win.fetch = originalFetch;
    proto.open = originalOpen;
    proto.send = originalSend;
  };
}
