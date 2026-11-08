// Reads the "Followed by …" line from the profile header the human is looking at, a few times
// as Instagram renders it, and forwards what it finds (§6.2 DOM fallback). Read-only: it never
// clicks, scrolls, or opens anything. Pure scheduling logic; the DOM access is injected.
import type { DomMutuals } from '../adapters/instagram';
import type { RuntimeMessage } from './messages';

export interface DomScanDeps {
  /** The profile the current URL shows, or undefined off profile pages. */
  profileUsername: () => string | undefined;
  viewerId: () => string | null;
  read: () => DomMutuals | undefined;
  send: (msg: RuntimeMessage) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  now: () => number;
}

/** Instagram renders its header a moment after navigation; look a few times, then stop. */
export const SCAN_DELAYS_MS = [700, 2000, 5000];
/** The same line is not re-sent more often than this. */
const RESEND_MS = 5 * 60_000;

export interface DomScanner {
  /** The page or account may have changed: look again (a few times) for the line. */
  schedule(): void;
  destroy(): void;
}

export function createDomScanner(deps: DomScanDeps): DomScanner {
  let timers: unknown[] = [];
  let lastKey = '';
  let lastAt = 0;

  const cancel = (): void => {
    for (const t of timers) deps.clearTimeout(t);
    timers = [];
  };

  const attempt = (profile: string): void => {
    try {
      // Navigated away since this scan was scheduled: drop it.
      if (deps.profileUsername()?.toLowerCase() !== profile.toLowerCase()) return;
      const found = deps.read();
      if (!found) return;
      const usernames = found.usernames.filter((u) => u.toLowerCase() !== profile.toLowerCase());
      if (usernames.length === 0) return;
      const key = `${profile.toLowerCase()}|${usernames.join(',').toLowerCase()}|${found.others ?? ''}`;
      const now = deps.now();
      if (key === lastKey && now - lastAt < RESEND_MS) {
        cancel();
        return;
      }
      lastKey = key;
      lastAt = now;
      const msg: RuntimeMessage = {
        type: 'orbit/dom-mutuals',
        profile,
        usernames,
        viewerId: deps.viewerId(),
        at: now,
      };
      if (found.others !== undefined) msg.others = found.others;
      deps.send(msg);
      cancel(); // found: no need to keep looking
    } catch {
      // never throw into the page
    }
  };

  return {
    schedule() {
      cancel();
      const profile = deps.profileUsername();
      if (!profile || !deps.viewerId()) return;
      timers = SCAN_DELAYS_MS.map((ms) => deps.setTimeout(() => attempt(profile), ms));
    },
    destroy: cancel,
  };
}
