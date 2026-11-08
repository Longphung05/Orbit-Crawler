// Remembers, per tab, which profile the badge is working on or showing, so the popup and side
// panel can say "viewing @x — calculating…" / "2nd degree". In memory only: a restarted service
// worker simply starts with nothing to show.
import type { ProfileView, ProfileViewOk, StatusView } from './schemas';

interface Entry {
  viewerId: string;
  username: string;
  at: number;
  calculating: boolean;
  view?: ProfileViewOk;
}

export class StatusTracker {
  private readonly byTab = new Map<number, Entry>();

  begin(tabId: number, viewerId: string, username: string, at: number): void {
    const prev = this.byTab.get(tabId);
    const sameProfile =
      prev?.viewerId === viewerId && prev.username.toLowerCase() === username.toLowerCase();
    // Re-asking about the same profile keeps showing the last answer while it recalculates.
    const entry: Entry = { viewerId, username, at, calculating: true };
    if (sameProfile && prev?.view) entry.view = prev.view;
    this.byTab.set(tabId, entry);
  }

  finish(tabId: number, viewerId: string, username: string, view: ProfileView, at: number): void {
    const cur = this.byTab.get(tabId);
    // A newer question about another profile superseded this one.
    if (!cur || cur.viewerId !== viewerId || cur.username.toLowerCase() !== username.toLowerCase())
      return;
    const entry: Entry = { viewerId, username, at, calculating: false };
    if (view.status === 'ok') entry.view = view;
    this.byTab.set(tabId, entry);
  }

  forgetTab(tabId: number): void {
    this.byTab.delete(tabId);
  }

  clear(): void {
    this.byTab.clear();
  }

  /** The most recently active profile across tabs. */
  snapshot(): StatusView {
    let latest: Entry | undefined;
    for (const e of this.byTab.values()) if (!latest || e.at >= latest.at) latest = e;
    if (!latest) return { status: 'ok' };
    const { view, ...rest } = latest;
    return { status: 'ok', viewing: view ? { ...rest, view } : rest };
  }
}
