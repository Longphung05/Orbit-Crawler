// Answers "how close is this profile?" from the stored graph, in the background (service worker),
// never on the Instagram page's thread (§7.4). Reach results are cached per viewer and dropped
// whenever the graph changes.
import { loadSnapshot, ViewerStore, type OrbitDB } from '../db';
import { computeReach } from '../graph';
import type { PathsView, ProfileView } from './schemas';
import { buildPathsView, buildProfileView, type ViewContext } from './profile-view';

/** A cached graph is rebuilt after this long even without an invalidation (staleness settings). */
const MAX_AGE_MS = 5 * 60_000;

interface Cached {
  at: number;
  ctx: ViewContext;
  store: ViewerStore;
}

export class QueryService {
  private readonly cache = new Map<string, Promise<Cached>>();

  constructor(
    private readonly db: OrbitDB,
    private readonly now: () => number = Date.now,
  ) {}

  /** Drop cached results for one account, or for all. Builds already running finish uncached. */
  invalidate(viewerId?: string): void {
    if (viewerId === undefined) this.cache.clear();
    else this.cache.delete(viewerId);
  }

  async profile(viewerId: string, username: string): Promise<ProfileView> {
    try {
      const { ctx, store } = await this.snapshot(viewerId);
      return buildProfileView(ctx, username, await store.findByUsername(username));
    } catch (err) {
      console.warn('[orbit] profile query failed', err);
      return { status: 'error' };
    }
  }

  async paths(viewerId: string, username: string): Promise<PathsView> {
    try {
      const { ctx, store } = await this.snapshot(viewerId);
      return buildPathsView(ctx, await store.findByUsername(username));
    } catch (err) {
      console.warn('[orbit] paths query failed', err);
      return { status: 'error' };
    }
  }

  private snapshot(viewerId: string): Promise<Cached> {
    const hit = this.cache.get(viewerId);
    if (hit) {
      // The entry is a promise, so its age is checked once it has settled.
      return hit.then((c) => {
        if (this.now() - c.at <= MAX_AGE_MS) return c;
        if (this.cache.get(viewerId) === hit) this.cache.delete(viewerId);
        return this.snapshot(viewerId);
      });
    }
    const built = this.build(viewerId);
    this.cache.set(viewerId, built);
    // A failed build must not stick in the cache.
    built.catch(() => {
      if (this.cache.get(viewerId) === built) this.cache.delete(viewerId);
    });
    return built;
  }

  private async build(viewerId: string): Promise<Cached> {
    const store = new ViewerStore(this.db, viewerId);
    const at = this.now();
    const [snap, meta] = await Promise.all([
      loadSnapshot(store, at),
      this.db.viewers.get(viewerId),
    ]);
    const reach = computeReach(snap.graph, viewerId, {
      firstDegreeMode: snap.settings.firstDegreeMode,
      undirected: snap.settings.undirected,
      hubFollowerThreshold: snap.settings.hubFollowerThreshold,
      excludeHubsAsIntermediaries: snap.settings.excludeHubsAsIntermediaries,
    });
    const viewerUsername = meta?.username || undefined;
    return {
      at,
      store,
      ctx: {
        reach,
        nodes: snap.nodes,
        viewerId,
        viewerUsername,
        updatedAt: snap.updatedAt,
        showAvatarImages: snap.settings.showAvatarImages,
      },
    };
  }
}
