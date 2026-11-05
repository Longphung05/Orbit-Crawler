// Tracks scroll sessions through follower/following lists, per tab (§9 Data freshness).
// A session starts when the first page (no cursor) of a list arrives in a tab, and is complete
// only if that same tab later reaches the last page. Anything else stays partial.

export interface SessionKey {
  viewerId: string;
  tabId: number;
  ownerId: string;
  direction: string;
}

/** Abandon sessions idle for longer than this (the human closed the modal and wandered off). */
const IDLE_MS = 30 * 60_000;

export class ListSessions {
  private readonly sessions = new Map<string, { startedAt: number; lastAt: number }>();

  private key(k: SessionKey): string {
    return `${k.viewerId}|${k.tabId}|${k.ownerId}|${k.direction}`;
  }

  start(k: SessionKey, at: number): void {
    this.sessions.set(this.key(k), { startedAt: at, lastAt: at });
  }

  /** Records activity; returns the session start if one is open and not idle-expired. */
  touch(k: SessionKey, at: number): number | undefined {
    const key = this.key(k);
    const s = this.sessions.get(key);
    if (!s) return undefined;
    if (at - s.lastAt > IDLE_MS) {
      this.sessions.delete(key);
      return undefined;
    }
    s.lastAt = at;
    return s.startedAt;
  }

  end(k: SessionKey): void {
    this.sessions.delete(this.key(k));
  }

  forgetTab(tabId: number): void {
    for (const key of [...this.sessions.keys()]) {
      if (key.split('|')[1] === String(tabId)) this.sessions.delete(key);
    }
  }

  get size(): number {
    return this.sessions.size;
  }
}
