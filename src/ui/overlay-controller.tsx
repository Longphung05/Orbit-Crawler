// Owns the badge's place on the page: when it shows, where it sits, and what it asks the
// background (§8.1). Strictly read-only toward Instagram (§2.6): it appends one Shadow DOM host
// to <body> and positions it over the username with absolute coordinates, so Instagram's own
// elements are never changed, moved, hidden or reflowed. Missing anchor → a floating corner pill.
import { render } from 'preact';
import { findUsernameAnchor, profileUsernameFromPath } from '../adapters/instagram';
import {
  ProfileViewSchema,
  PathsViewSchema,
  type PathsView,
  type ProfileViewOk,
  type QueryRequest,
} from '../query/schemas';
import overlayCss from './overlay.css?inline';
import { Overlay } from './Overlay';

export interface OverlayDeps {
  getViewerId: () => string | null;
  /** Send a query to the background and resolve with its (unvalidated) reply. */
  ask: (msg: QueryRequest) => Promise<unknown>;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

export interface OverlayController {
  /** The URL or account may have changed: show, update or hide the badge. */
  sync(): void;
  /** The graph changed: ask again for the current profile. */
  refresh(): void;
  destroy(): void;
}

const REPOSITION_MS = 1000;
/** How long to wait for Instagram to render the profile header before using the corner pill. */
const ANCHOR_GRACE_MS = 2500;
const Z_INDEX = '2147483000';

/** Light or dark, judged from the page's actual background (Instagram's theme is its own). */
function pageTheme(): 'light' | 'dark' {
  try {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(
      getComputedStyle(document.body).backgroundColor,
    );
    if (!m) return 'light';
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.4 ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function createOverlay(deps: OverlayDeps): OverlayController {
  let host: HTMLElement | undefined;
  let container: HTMLElement | undefined;
  let timer: unknown;
  let destroyed = false;

  let username: string | undefined;
  let view: ProfileViewOk | undefined;
  let placement: 'inline' | 'floating' = 'floating';
  let shownAt = 0;
  let anchor: Element | null = null;
  let seq = 0;
  let loader: { key: string; fn: () => Promise<PathsView> } | undefined;

  const ensureHost = (): HTMLElement | undefined => {
    if (host) return host;
    if (!document.body) return undefined;
    host = document.createElement('orbit-badge-host');
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `:host{all:initial}\n${overlayCss}`;
    container = document.createElement('div');
    shadow.append(style, container);
    document.body.append(host);
    return host;
  };

  const loaderFor = (v: ProfileViewOk): (() => Promise<PathsView>) => {
    const key = `${v.username}:${v.updatedAt ?? 0}:${v.connectorCount}`;
    if (loader?.key === key) return loader.fn;
    const fn = async (): Promise<PathsView> => {
      const viewerId = deps.getViewerId();
      if (!viewerId) return { status: 'no_viewer' };
      try {
        const parsed = PathsViewSchema.safeParse(
          await deps.ask({ type: 'orbit/paths', username: v.username, viewerId }),
        );
        return parsed.success ? parsed.data : { status: 'error' };
      } catch {
        return { status: 'error' };
      }
    };
    loader = { key, fn };
    return fn;
  };

  const draw = (): void => {
    if (!view || !container) return;
    render(
      <Overlay
        view={view}
        placement={placement}
        theme={pageTheme()}
        loadPaths={loaderFor(view)}
        now={Date.now}
      />,
      container,
    );
  };

  const hide = (): void => {
    seq++; // drop any reply still in flight
    view = undefined;
    username = undefined;
    anchor = null;
    if (container) render(null, container);
    if (host) host.style.display = 'none';
    if (timer !== undefined) deps.clearInterval(timer);
    timer = undefined;
  };

  /** Put the host over the username, or in the corner when the username can't be found. */
  const reposition = (): void => {
    try {
      if (!host || !username || !view) return;
      if (!anchor?.isConnected) anchor = findUsernameAnchor(document, username);
      let rect: DOMRect | undefined;
      if (anchor) {
        const range = document.createRange();
        range.selectNodeContents(anchor);
        const r = range.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) rect = r;
      }
      const next: 'inline' | 'floating' = rect ? 'inline' : 'floating';
      if (!rect && Date.now() - shownAt < ANCHOR_GRACE_MS) {
        host.style.display = 'none'; // give Instagram a moment to render its header
        return;
      }
      host.style.cssText = rect
        ? `position:absolute;left:${Math.round(rect.right + window.scrollX + 8)}px;top:${Math.round(rect.top + window.scrollY + rect.height / 2)}px;transform:translateY(-50%);z-index:${Z_INDEX}`
        : `position:fixed;right:16px;bottom:16px;z-index:${Z_INDEX}`;
      if (next !== placement) {
        placement = next;
        draw();
      }
    } catch {
      // never throw into the page
    }
  };

  const query = async (name: string, viewerId: string): Promise<void> => {
    const mine = ++seq;
    let reply: unknown;
    try {
      reply = await deps.ask({ type: 'orbit/profile', username: name, viewerId });
    } catch {
      return; // extension reloaded under this page, or the worker is waking up
    }
    if (destroyed || mine !== seq) return;
    const parsed = ProfileViewSchema.safeParse(reply);
    if (!parsed.success || parsed.data.status !== 'ok') {
      if (container) render(null, container);
      view = undefined;
      return;
    }
    const first = view === undefined;
    view = parsed.data;
    if (!ensureHost()) return;
    if (first) shownAt = Date.now();
    if (host) host.style.display = '';
    draw();
    reposition();
    timer ??= deps.setInterval(reposition, REPOSITION_MS);
  };

  const onResize = (): void => reposition();
  window.addEventListener('resize', onResize, { passive: true });

  return {
    sync() {
      if (destroyed) return;
      const name = profileUsernameFromPath(window.location.pathname);
      const viewerId = deps.getViewerId();
      if (!name || !viewerId) return hide();
      if (name !== username) {
        // A different profile: start clean so the previous person's badge never lingers.
        hide();
        username = name;
        placement = 'floating';
      }
      void query(name, viewerId);
    },
    refresh() {
      if (destroyed || !username) return;
      const viewerId = deps.getViewerId();
      if (viewerId) void query(username, viewerId);
    },
    destroy() {
      destroyed = true;
      window.removeEventListener('resize', onResize);
      hide();
      host?.remove();
      host = undefined;
    },
  };
}
