// Background-side routing for badge queries and graph-change signals. Kept free of `browser.*`
// so it can be tested; the entrypoint injects the one thing it needs from the extension API.
import { isInstagramUrl } from '../adapters/instagram';
import {
  GraphChangedSchema,
  QueryRequestSchema,
  type PathsView,
  type ProfileView,
} from './schemas';
import type { QueryService } from './service';

export interface QuerySender {
  tabId?: number;
  url?: string;
  /** sender.id === our own extension id */
  fromSelf: boolean;
}

export interface RouterDeps {
  service: QueryService;
  /** The account detected in a tab by the capture coordinator, if any. */
  viewerForTab: (tabId: number) => string | undefined;
  /** Tell instagram.com tabs (all of them, or those of one account) to ask again. */
  refreshTabs: (viewerId?: string) => void;
}

export class QueryRouter {
  constructor(private readonly deps: RouterDeps) {}

  /**
   * Handle one runtime message. Returns a promise of the reply for badge queries, and undefined
   * for anything else (so the caller leaves the channel alone).
   */
  handle(raw: unknown, sender: QuerySender): Promise<ProfileView | PathsView> | undefined {
    if (!sender.fromSelf) return undefined;

    const changed = GraphChangedSchema.safeParse(raw);
    if (changed.success) {
      // Only extension pages (no tab) may say the graph was rewritten.
      if (sender.tabId === undefined) {
        this.deps.service.invalidate();
        this.deps.refreshTabs();
      }
      return undefined;
    }

    // Badge queries come from instagram.com content scripts only.
    if (sender.tabId === undefined || !sender.url || !isInstagramUrl(sender.url)) return undefined;
    const req = QueryRequestSchema.safeParse(raw);
    if (!req.success) return undefined;

    const viewerId = this.deps.viewerForTab(sender.tabId) ?? req.data.viewerId;
    if (!viewerId) return Promise.resolve({ status: 'no_viewer' });
    return req.data.type === 'orbit/profile'
      ? this.deps.service.profile(viewerId, req.data.username)
      : this.deps.service.paths(viewerId, req.data.username);
  }
}
