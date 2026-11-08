import { describe, expect, it } from 'vitest';
import type { CaptureEvent } from '../../src/adapters/instagram';
import {
  ACTIVITY_KEEP,
  CaptureCoordinator,
  computeHealth,
  describeEvents,
  recordActivity,
} from '../../src/capture';
import { ViewerStore } from '../../src/db';
import { QueryService, type ProfileViewOk } from '../../src/query';
import * as P from '../fixtures/instagram/payloads';
import { freshDb, obs } from '../db/helpers';

const IG_TAB = { tabId: 7, url: 'https://www.instagram.com/fake_target/', fromSelf: true };
const V = P.VIEWER;

const viewerMsg = (username?: string) => ({
  type: 'orbit/viewer',
  viewerId: V,
  strategy: 'current-user-initial-data',
  at: 1,
  ...(username ? { username } : {}),
});
const domMsg = (over: Record<string, unknown> = {}) => ({
  type: 'orbit/dom-mutuals',
  profile: 'fake_target',
  usernames: ['fake_ann', 'fake_ben'],
  others: 3,
  viewerId: null,
  at: 5,
  ...over,
});

describe('describeEvents', () => {
  async function seeded() {
    const db = freshDb();
    const store = new ViewerStore(db, V);
    await store.upsertNodes([obs(V, 'fake_me'), obs('2', 'fake_ann')], 1);
    return store;
  }

  it('words list pages, profiles, follow status and missing accounts', async () => {
    const store = await seeded();
    const rows = [obs('3', 'fake_x'), obs('4', 'fake_y')];
    const events: CaptureEvent[] = [
      {
        kind: 'list_page',
        ownerId: V,
        direction: 'following',
        rows,
        isFirstPage: true,
        isLastPage: true,
        filtered: false,
      },
      {
        kind: 'list_page',
        ownerId: '2',
        direction: 'followers',
        rows: [obs('3', 'fake_x')],
        isFirstPage: false,
        isLastPage: false,
        filtered: false,
      },
      {
        kind: 'list_page',
        ownerId: '2',
        direction: 'following',
        rows,
        isFirstPage: true,
        isLastPage: false,
        filtered: true,
      },
      {
        kind: 'profile',
        user: obs('9', 'fake_target'),
        friendship: { viewerFollows: false, followsViewer: true },
        mutuals: { users: [obs('2', 'fake_ann')], usernames: ['fake_ben'], count: 5 },
      },
      { kind: 'profile', user: obs(V, 'fake_me') },
      { kind: 'friendship', userId: '2', friendship: { viewerFollows: true } },
      { kind: 'profile_missing', username: 'fake_gone' },
    ];
    expect((await describeEvents(events, store)).map((i) => i.text)).toEqual([
      'Read 2 rows of your following list (reached the end)',
      "Read 1 rows of @fake_ann's followers list",
      "Read 2 search results in @fake_ann's following list",
      "Saw @fake_target's profile — you don't follow them; they follow you; Instagram named 2 people you follow who follow them",
      'Saw your own profile',
      'Follow status for @fake_ann',
      '@fake_gone looks unavailable',
    ]);
  });

  it('says so when Instagram named no mutual followers', async () => {
    const store = await seeded();
    const [item] = await describeEvents(
      [{ kind: 'profile', user: obs('9', 'fake_target'), mutuals: { users: [], usernames: [] } }],
      store,
    );
    expect(item?.text).toContain('named no mutual followers');
  });
});

describe('recordActivity', () => {
  it('keeps only the newest lines per account', async () => {
    const db = freshDb();
    for (let i = 1; i <= ACTIVITY_KEEP + 60; i++) {
      await recordActivity(db, V, i, [{ kind: 'profile', text: `line ${i}` }]);
    }
    await recordActivity(db, '2000', 1, [{ kind: 'profile', text: 'other account' }]);
    const mine = await db.activity.where('viewerId').equals(V).toArray();
    expect(mine.length).toBeLessThanOrEqual(ACTIVITY_KEEP + 50);
    expect(mine.length).toBeGreaterThanOrEqual(ACTIVITY_KEEP);
    expect(mine.some((r) => r.text === `line ${ACTIVITY_KEEP + 60}`)).toBe(true);
    expect(mine.some((r) => r.text === 'line 1')).toBe(false);
    expect(await db.activity.where('viewerId').equals('2000').count()).toBe(1);
  });
});

describe('capture log through the coordinator', () => {
  it('network captures leave a readable trail', async () => {
    const db = freshDb();
    const c = new CaptureCoordinator(db);
    await c.handle(viewerMsg('fake_me'), IG_TAB);
    await c.handle(
      { type: 'orbit/response', ...P.response(P.followingPage1), at: 3, viewerId: null },
      IG_TAB,
    );
    const rows = await db.activity.where('viewerId').equals(V).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('list');
    expect(rows[0]?.text).toMatch(/^Read \d+ rows of your following list/);
  });
});

describe('page-text "Followed by" fallback', () => {
  async function run() {
    const db = freshDb();
    const processed: { changed: boolean }[] = [];
    const c = new CaptureCoordinator(db, (r) => processed.push({ changed: r.changed }));
    await c.handle(viewerMsg('fake_me'), IG_TAB);
    return { db, c, processed };
  }

  async function profileOf(db: ReturnType<typeof freshDb>, name: string): Promise<ProfileViewOk> {
    const v = await new QueryService(db).profile(V, name);
    if (v.status !== 'ok') throw new Error('expected ok');
    return v;
  }

  it('makes a public profile you do not follow 2nd degree (the reported bug)', async () => {
    const { db, c, processed } = await run();
    // You follow ann and ben (e.g. from an export, known only by username).
    await new ViewerStore(db, V).applyExportSnapshot(
      { following: ['fake_ann', 'fake_ben'], followers: [], exportedAt: 2 },
      2,
    );
    expect(await profileOf(db, 'fake_target')).toMatchObject({ state: 'out_of_orbit' });

    await c.handle(domMsg(), IG_TAB);

    expect(await profileOf(db, 'fake_target')).toMatchObject({
      state: 'second',
      connectorCount: 2,
      connectorsExact: true, // the export made your following list complete
    });
    expect(processed.at(-1)).toEqual({ changed: true });
  });

  it('is logged, counted in diagnostics, and does not distort adapter health', async () => {
    const { db, c } = await run();
    await c.handle(domMsg(), IG_TAB);
    const row = await db.activity.where('viewerId').equals(V).first();
    expect(row).toMatchObject({ kind: 'dom' });
    expect(row?.text).toContain('@fake_target');
    expect(row?.text).toContain('2 named and 3 others');
    expect(await db.diagnostics.get('dom_mutuals')).toMatchObject({ ok: 1, failed: 0 });
    expect(computeHealth(await db.diagnostics.toArray())).toBe('unknown');
  });

  it('ignores your own profile, by username or id', async () => {
    const { db, c } = await run();
    await c.handle(domMsg({ profile: 'Fake_Me' }), IG_TAB);
    expect(await db.edges.count()).toBe(0);
  });

  it('works for a profile Orbit already knows by id', async () => {
    const { db, c } = await run();
    await new ViewerStore(db, V).upsertNodes([obs('9', 'fake_target')], 2);
    await c.handle(domMsg(), IG_TAB);
    expect(await profileOf(db, 'fake_target')).toMatchObject({ state: 'second', known: true });
    expect(await db.nodes.get([V, 'username:fake_target'])).toBeUndefined(); // no duplicate placeholder
  });

  it('needs a known account, a real Instagram tab, and a valid message', async () => {
    const db = freshDb();
    const c = new CaptureCoordinator(db);
    await c.handle(domMsg(), IG_TAB); // account never detected for this tab
    await c.handle(domMsg({ viewerId: V }), { ...IG_TAB, url: 'https://evil.example/' });
    await c.handle(domMsg({ viewerId: V, usernames: [] }), IG_TAB);
    await c.handle(domMsg({ viewerId: V, usernames: ['not a name'] }), IG_TAB);
    await c.handle(domMsg({ viewerId: V, usernames: Array(26).fill('fake_ann') }), IG_TAB);
    expect(await db.edges.count()).toBe(0);
    // A restarted worker recovers the account from the message.
    await c.handle(domMsg({ viewerId: V }), IG_TAB);
    expect(await db.edges.count()).toBeGreaterThan(0);
  });

  it('re-reading the same line adds no duplicate connections', async () => {
    const { db, c } = await run();
    await c.handle(domMsg(), IG_TAB);
    const first = await db.edges.count();
    await c.handle(domMsg({ at: 9 }), IG_TAB);
    expect(await db.edges.count()).toBe(first);
  });
});
