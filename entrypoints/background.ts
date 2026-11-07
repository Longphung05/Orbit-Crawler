import { CaptureCoordinator } from '../src/capture/coordinator';
import { getDb } from '../src/db/db';
import { QueryRouter } from '../src/query/router';
import { QueryService } from '../src/query/service';

/** After a capture lands, wait for the burst of responses to settle before telling tabs. */
const REFRESH_DEBOUNCE_MS = 400;

// Service worker: storage writes and message routing. It never makes network requests to
// Instagram (CLAUDE.md §2); it only processes what content scripts saw the page receive, and
// answers the badge's questions from the local graph.
export default defineBackground(() => {
  const db = getDb();
  const service = new QueryService(db);
  const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Tell instagram.com tabs to re-ask (a plain message to our own content script). */
  const refreshTabs = (viewerId?: string): void => {
    for (const tabId of coordinator.tabsForViewer(viewerId)) {
      browser.tabs.sendMessage(tabId, { type: 'orbit/refresh' }).catch(() => undefined);
    }
  };

  const coordinator: CaptureCoordinator = new CaptureCoordinator(db, ({ viewerId, outcome }) => {
    if (outcome.status !== 'ok') return;
    service.invalidate(viewerId);
    clearTimeout(refreshTimers.get(viewerId));
    refreshTimers.set(
      viewerId,
      setTimeout(() => {
        refreshTimers.delete(viewerId);
        refreshTabs(viewerId);
      }, REFRESH_DEBOUNCE_MS),
    );
  });

  const router = new QueryRouter({
    service,
    viewerForTab: (tabId) => coordinator.viewerForTab(tabId),
    refreshTabs,
  });

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const info = {
      tabId: sender.tab?.id,
      url: sender.url,
      fromSelf: sender.id === browser.runtime.id,
    };
    const reply = router.handle(msg, info);
    if (reply) {
      void reply.then(sendResponse);
      return true; // answer asynchronously
    }
    void coordinator.handle(msg, info);
    return undefined; // no reply
  });

  browser.tabs.onRemoved.addListener((tabId) => coordinator.forgetTab(tabId));
});
