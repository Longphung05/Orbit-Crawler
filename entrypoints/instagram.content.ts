// Isolated-world content script (§6.2, §9 Viewer): bridges the page observer to the background,
// detects the logged-in account from data already in the page, and watches SPA navigation.
// It never modifies Instagram's DOM: the badge is a separate Shadow DOM host (src/ui).
import { CONTENT_MATCHES, detectViewer, ORBIT_CHANNEL } from '../src/adapters/instagram';
import { PageMessageSchema, type RuntimeMessage } from '../src/capture/messages';
import { watchRoute } from '../src/capture/route-watcher';
import { RefreshSchema } from '../src/query/schemas';
import { createOverlay } from '../src/ui/overlay-controller';

export default defineContentScript({
  matches: CONTENT_MATCHES,
  runAt: 'document_start',
  main(ctx) {
    const origin = window.location.origin;
    let viewerId: string | null = null;
    let reported: string | null | undefined;

    const overlay = createOverlay({
      getViewerId: () => viewerId,
      ask: (msg) => browser.runtime.sendMessage(msg),
      setInterval: (fn, ms) => ctx.setInterval(fn, ms),
      clearInterval: (h) => clearInterval(h as number),
    });

    const toBackground = (msg: RuntimeMessage): void => {
      // Fails harmlessly if the extension was reloaded under this page.
      browser.runtime.sendMessage(msg).catch(() => undefined);
    };

    const detect = (): void => {
      try {
        const scripts = Array.from(document.scripts, (s) => s.textContent ?? '');
        const d = detectViewer(scripts);
        viewerId = d.viewerId;
        overlay.sync();
        if (d.viewerId === reported && d.viewerId !== null) return;
        reported = d.viewerId;
        const msg: RuntimeMessage = {
          type: 'orbit/viewer',
          viewerId: d.viewerId,
          strategy: d.strategy,
          at: Date.now(),
        };
        if (d.username) msg.username = d.username;
        toBackground(msg);
      } catch {
        // never throw into the page
      }
    };

    const onPageMessage = (e: MessageEvent): void => {
      if (e.source !== window || e.origin !== origin) return;
      const parsed = PageMessageSchema.safeParse(e.data);
      if (!parsed.success) return;
      const m = parsed.data;
      if (m.type === 'hello') {
        window.postMessage({ __orbit: ORBIT_CHANNEL, type: 'ready' }, origin);
      } else if (m.type === 'response') {
        toBackground({
          type: 'orbit/response',
          url: m.url,
          status: m.status,
          text: m.text,
          at: Date.now(),
          viewerId,
        });
      }
    };
    window.addEventListener('message', onPageMessage);
    window.postMessage({ __orbit: ORBIT_CHANNEL, type: 'ready' }, origin);

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', detect, { once: true });
    } else {
      detect();
    }
    // Instagram sometimes injects its config late; check again shortly after load.
    ctx.setTimeout(detect, 4000);

    const nav = (window as Window & { navigation?: EventTarget }).navigation;
    const stopRoute = watchRoute(
      {
        getHref: () => window.location.href,
        addEventListener: (t, fn) => window.addEventListener(t, fn),
        removeEventListener: (t, fn) => window.removeEventListener(t, fn),
        ...(nav
          ? {
              navigation: {
                addEventListener: (t: string, fn: () => void) => nav.addEventListener(t, fn),
                removeEventListener: (t: string, fn: () => void) => nav.removeEventListener(t, fn),
              },
            }
          : {}),
        setInterval: (fn, ms) => ctx.setInterval(fn, ms),
        clearInterval: (h) => clearInterval(h as number),
      },
      () => {
        // Logins and account switches can happen without a full reload: re-check on navigation
        // (detect() also re-syncs the badge for the new URL).
        detect();
      },
    );

    // The background says the graph changed (a capture landed, or data was imported): ask again.
    const onRuntimeMessage = (msg: unknown, sender: { id?: string }): undefined => {
      if (sender.id === browser.runtime.id && RefreshSchema.safeParse(msg).success) {
        overlay.refresh();
      }
      return undefined;
    };
    browser.runtime.onMessage.addListener(onRuntimeMessage);

    ctx.onInvalidated(() => {
      window.removeEventListener('message', onPageMessage);
      browser.runtime.onMessage.removeListener(onRuntimeMessage);
      stopRoute();
      overlay.destroy();
    });
  },
});
