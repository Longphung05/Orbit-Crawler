// A plain-language log of what each capture taught Orbit, so the live counters are explainable:
// every line is something Instagram's own page loaded because you opened it. Local only; it
// holds usernames, so it is shown in Orbit's own UI and never included in "Copy diagnostics".
import type { CaptureEvent } from '../adapters/instagram';
import type { ActivityKind, ActivityRecord, OrbitDB, ViewerStore } from '../db';

/** Lines kept per account; older ones are dropped. */
export const ACTIVITY_KEEP = 200;
const TRIM_AT = ACTIVITY_KEEP + 50;

export type ActivityItem = Pick<ActivityRecord, 'kind' | 'text'>;

export async function recordActivity(
  db: OrbitDB,
  viewerId: string,
  at: number,
  items: readonly ActivityItem[],
): Promise<void> {
  if (items.length === 0) return;
  await db.transaction('rw', db.activity, async () => {
    await db.activity.bulkAdd(items.map((i) => ({ viewerId, at, kind: i.kind, text: i.text })));
    const count = await db.activity.where('viewerId').equals(viewerId).count();
    if (count > TRIM_AT) {
      const old = await db.activity
        .where('[viewerId+at]')
        .between([viewerId, 0], [viewerId, Number.MAX_SAFE_INTEGER])
        .limit(count - ACTIVITY_KEEP)
        .primaryKeys();
      await db.activity.bulkDelete(old);
    }
  });
}

const DIRECTION_TEXT = {
  following: 'following list',
  followers: 'followers list',
  mutuals: '"followed by" list',
} as const;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Describe capture events in words. Names come from the store; unknown ids read as "an account". */
export async function describeEvents(
  events: readonly CaptureEvent[],
  store: ViewerStore,
): Promise<ActivityItem[]> {
  const nameOf = async (id: string): Promise<string> => {
    if (id === store.viewerId) return 'you';
    const n = await store.getNode(id);
    return n ? `@${n.username}` : 'an account';
  };
  const out: ActivityItem[] = [];
  const add = (kind: ActivityKind, text: string): void => {
    out.push({ kind, text });
  };
  const ownName = (await store.db.viewers.get(store.viewerId))?.username.toLowerCase() || undefined;

  for (const e of events) {
    switch (e.kind) {
      case 'profile': {
        if (e.user.id === store.viewerId || e.user.username.toLowerCase() === ownName) {
          add('profile', `Saw your own profile (@${e.user.username})`);
          break;
        }
        const parts: string[] = [];
        if (e.friendship?.viewerFollows === true) parts.push('you follow them');
        else if (e.friendship?.viewerFollows === false) parts.push("you don't follow them");
        if (e.friendship?.followsViewer === true) parts.push('they follow you');
        if (e.mutuals) {
          const n = e.mutuals.users.length + e.mutuals.usernames.length;
          parts.push(
            n > 0
              ? `Instagram named ${plural(n, 'person', 'people')} you follow who follow them`
              : 'Instagram named no mutual followers',
          );
        }
        add(
          'profile',
          `Saw @${e.user.username}'s profile${parts.length ? ` — ${parts.join('; ')}` : ''}`,
        );
        break;
      }
      case 'friendship':
        add('status', `Follow status for ${await nameOf(e.userId)}`);
        break;
      case 'profile_missing':
        add('missing', `@${e.username} looks unavailable`);
        break;
      case 'list_page': {
        const owner = await nameOf(e.ownerId);
        const whose = owner === 'you' ? 'your' : `${owner}'s`;
        const what = e.filtered ? 'search results in' : 'rows of';
        add(
          'list',
          `Read ${e.rows.length} ${what} ${whose} ${DIRECTION_TEXT[e.direction]}${e.isLastPage && !e.filtered ? ' (reached the end)' : ''}`,
        );
        break;
      }
    }
  }
  return out;
}
