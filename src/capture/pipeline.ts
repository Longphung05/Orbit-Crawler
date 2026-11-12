// Apply adapter capture events to one viewer's graph (§6.2 "What each capture tells you").
// Adapter-neutral: it only sees CaptureEvents, never raw Instagram payloads.
import type { CaptureEvent, Friendship, MutualHint } from '../adapters/instagram';
import type { EdgeInput, ViewerStore } from '../db';
import type { ListSessions } from './sessions';

export interface ApplyContext {
  store: ViewerStore;
  at: number;
  tabId: number;
  sessions: ListSessions;
}

export interface ApplySummary {
  /** Edges newly created. */
  added: number;
  /** Lists confirmed complete in this batch. */
  completed: number;
  /** Edges marked stale in this batch. */
  staled: number;
  /** Your profile turned up under another id and was merged into your account. */
  selfMerged?: boolean;
}

async function applyFriendship(
  ctx: ApplyContext,
  userId: string,
  f: Friendship,
  sum: ApplySummary,
): Promise<void> {
  const { store, at } = ctx;
  const v = store.viewerId;
  if (userId === v) return;
  const add: EdgeInput[] = [];
  // §9: a pending follow request is not a follow, so `requested` never creates V → P.
  if (f.viewerFollows === true) add.push({ from: v, to: userId, source: 'profile_flag' });
  if (f.followsViewer === true) add.push({ from: userId, to: v, source: 'profile_flag' });
  if (add.length) sum.added += await store.upsertEdges(add, at);
  if (f.viewerFollows === false && (await store.confirmNoEdge(v, userId, at))) sum.staled++;
  if (f.followsViewer === false && (await store.confirmNoEdge(userId, v, at))) sum.staled++;
}

/**
 * "Followed by a, b + N more" on P: each listed account a is someone the viewer follows
 * (V → a) who follows P (a → P). Usernames without ids resolve to known accounts or
 * placeholders. Never complete: it's a sample.
 */
async function applyMutualHint(
  ctx: ApplyContext,
  profileId: string,
  hint: MutualHint,
  sum: ApplySummary,
): Promise<void> {
  const { store, at } = ctx;
  const v = store.viewerId;
  if (hint.users.length) await store.upsertNodes(hint.users, at);
  const ids = hint.users.map((u) => u.id);
  if (hint.usernames.length) {
    for (const name of hint.usernames) {
      const known = await store.findByUsername(name);
      if (known) ids.push(known.id);
      else {
        const resolved = await store.resolveUsernames([name], at);
        const id = resolved.get(name.toLowerCase());
        if (id) ids.push(id);
      }
    }
  }
  const edges: EdgeInput[] = [];
  for (const a of ids) {
    if (a === profileId || a === v) continue;
    edges.push({ from: a, to: profileId, source: 'mutuals' });
    edges.push({ from: v, to: a, source: 'mutuals' });
  }
  if (edges.length) sum.added += await store.upsertEdges(edges, at);
}

/**
 * The "Followed by …" line on `profileId`'s header, read from the page. Same meaning as the
 * network version (`applyMutualHint`), just from the DOM: each name is someone the viewer follows.
 */
export async function applyDomMutuals(
  ctx: ApplyContext,
  profileId: string,
  usernames: readonly string[],
  others: number | undefined,
): Promise<ApplySummary> {
  const sum: ApplySummary = { added: 0, completed: 0, staled: 0 };
  const hint: MutualHint = { users: [], usernames: [...usernames] };
  if (others !== undefined) hint.count = usernames.length + others;
  await applyMutualHint(ctx, profileId, hint, sum);
  return sum;
}

/** Rewrite ids that are the viewer under another id (ViewerMeta.selfIds) to `viewerId`. */
export function remapSelfIds(
  events: readonly CaptureEvent[],
  aliases: ReadonlySet<string>,
  viewerId: string,
): CaptureEvent[] {
  if (aliases.size === 0) return [...events];
  const id = (x: string): string => (aliases.has(x) ? viewerId : x);
  const obs = <T extends { id: string }>(o: T): T =>
    aliases.has(o.id) ? { ...o, id: viewerId } : o;
  return events.map((e): CaptureEvent => {
    switch (e.kind) {
      case 'profile': {
        const out: CaptureEvent = { ...e, user: obs(e.user) };
        if (e.mutuals) out.mutuals = { ...e.mutuals, users: e.mutuals.users.map(obs) };
        return out;
      }
      case 'friendship':
        return { ...e, userId: id(e.userId) };
      case 'list_page':
        return { ...e, ownerId: id(e.ownerId), rows: e.rows.map(obs) };
      case 'profile_missing':
        return e;
    }
  });
}

/**
 * A list payload names its owner only by numeric id. When the page you had open is that owner's
 * profile (`/name/following/`, `/name/followers/mutualOnly`, ...), tie the id to `pageName`, which
 * merges any placeholder known only by username (an imported export, a "Followed by" line).
 * Skipped when the id is already a named account, or the name already belongs to another id.
 */
export async function nameListOwners(
  store: ViewerStore,
  events: readonly CaptureEvent[],
  pageName: string,
  at: number,
): Promise<void> {
  const key = pageName.toLowerCase();
  for (const e of events) {
    if (e.kind !== 'list_page' || e.ownerId === store.viewerId) continue;
    const owner = await store.getNode(e.ownerId);
    if (owner && !owner.isPlaceholder) continue;
    const holder = await store.findByUsername(pageName);
    if (holder && !holder.isPlaceholder && holder.usernameKey === key) continue;
    await store.upsertNodes([{ id: e.ownerId, username: pageName }], at);
  }
}

export async function applyEvents(
  events: readonly CaptureEvent[],
  ctx: ApplyContext,
): Promise<ApplySummary> {
  const { store, at, tabId, sessions } = ctx;
  const v = store.viewerId;
  const sum: ApplySummary = { added: 0, completed: 0, staled: 0 };

  for (const e of events) {
    switch (e.kind) {
      case 'profile': {
        // The human opened this profile: strong enough to clear an unavailable flag.
        await store.upsertNodes([e.user], at, { fromProfileView: true });
        if (e.user.id === v) {
          await store.touchViewer(e.user.username, at);
          break; // relationship flags on your own profile are meaningless
        }
        const ownName = (await store.db.viewers.get(v))?.username;
        if (ownName && ownName.toLowerCase() === e.user.username.toLowerCase()) {
          // Your own profile, under a different id than the page config named: merge them.
          if (await store.adoptSelfId(e.user.id, at)) sum.selfMerged = true;
          break;
        }
        if (e.friendship) await applyFriendship(ctx, e.user.id, e.friendship, sum);
        if (e.mutuals) await applyMutualHint(ctx, e.user.id, e.mutuals, sum);
        break;
      }

      case 'friendship':
        await applyFriendship(ctx, e.userId, e.friendship, sum);
        break;

      case 'profile_missing': {
        const node = await store.findByUsername(e.username);
        if (node && !node.isPlaceholder) await store.markUnavailable(node.id, at);
        break;
      }

      case 'list_page': {
        const key = { viewerId: v, tabId, ownerId: e.ownerId, direction: e.direction };
        if (!e.filtered && e.isFirstPage) sessions.start(key, at);
        const sessionStartedAt = e.filtered ? undefined : sessions.touch(key, at);

        const res = await store.recordListPage({
          ownerId: e.ownerId,
          direction: e.direction,
          rows: e.rows,
          observedAt: at,
        });
        sum.added += res.added;

        // Mutuals of P are, by definition, accounts the viewer follows.
        if (e.direction === 'mutuals') {
          const implied = e.rows
            .filter((r) => r.id !== v)
            .map((r): EdgeInput => ({ from: v, to: r.id, source: 'mutuals' }));
          sum.added += await store.upsertEdges(implied, at);
        }

        // Only a list scrolled from its first page to its last, in one tab, is complete.
        if (e.isLastPage && sessionStartedAt !== undefined) {
          const done = await store.completeList({
            ownerId: e.ownerId,
            direction: e.direction,
            sessionStartedAt,
            completedAt: at,
          });
          if (done.completed) sum.completed++;
          sum.staled += done.markedStale;
          sessions.end(key);
        }
        break;
      }
    }
  }
  return sum;
}
