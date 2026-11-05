// MAIN-world observer (§6.2): runs in Instagram's page context so it can see the responses the
// page itself fetched. Read-only; never issues a request (see src/capture/main-world-observer.ts).
// Imports are deliberately minimal: no Dexie, no zod, nothing heavy in the page.
import { MAX_FORWARDED_BYTES, ORBIT_CHANNEL } from '../src/adapters/instagram/constants';
import { CONTENT_MATCHES, isCandidateUrl, wantsBody } from '../src/adapters/instagram/urls';
import { installObserver } from '../src/capture/main-world-observer';

const QUEUE_MAX = 100;

export default defineContentScript({
  matches: CONTENT_MATCHES,
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const origin = window.location.origin;
    let ready = false;
    const queue: object[] = [];

    const send = (m: object): void => {
      try {
        window.postMessage({ __orbit: ORBIT_CHANNEL, ...m }, origin);
      } catch {
        // never throw into the page
      }
    };

    // Handshake with the isolated content script; whichever loads first waits for the other.
    window.addEventListener('message', (e: MessageEvent) => {
      if (e.source !== window || ready) return;
      const d = e.data as { __orbit?: unknown; type?: unknown } | null;
      if (d?.__orbit === ORBIT_CHANNEL && d.type === 'ready') {
        ready = true;
        for (const m of queue.splice(0)) send(m);
      }
    });

    installObserver(window, {
      isCandidate: isCandidateUrl,
      wantsBody,
      maxBytes: MAX_FORWARDED_BYTES,
      post: (m) => {
        const msg = { type: 'response', ...m };
        if (ready) send(msg);
        else if (queue.length < QUEUE_MAX) queue.push(msg);
      },
    });

    send({ type: 'hello' });
  },
});
