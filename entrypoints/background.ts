import { CaptureCoordinator } from '../src/capture/coordinator';
import { getDb } from '../src/db/db';

// Service worker: storage writes and message routing. It never makes network requests to
// Instagram (CLAUDE.md §2); it only processes what content scripts saw the page receive.
export default defineBackground(() => {
  const coordinator = new CaptureCoordinator(getDb());

  browser.runtime.onMessage.addListener((msg, sender) => {
    void coordinator.handle(msg, {
      tabId: sender.tab?.id,
      url: sender.url,
      fromSelf: sender.id === browser.runtime.id,
    });
    return undefined; // no reply
  });

  browser.tabs.onRemoved.addListener((tabId) => coordinator.forgetTab(tabId));
});
