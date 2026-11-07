import { describe, expect, it } from 'vitest';
import { ViewerStore, type OrbitDB } from '../../src/db';
import { QueryService, type ProfileViewOk } from '../../src/query';
import { freshDb, obs } from '../db/helpers';

const V = '1000';
const T = 1_700_000_000_000;

/** Ids: 1xx = accounts you follow, 2xx = their follows, 3xx = further out. All invented. */
async function world(): Promise<{ db: OrbitDB; store: ViewerStore; service: QueryService }> {
  const db = freshDb();
  const store = new ViewerStore(db, V);
  await store.touchViewer('fake_me', T);
  await store.upsertNodes(
    [
      obs(V, 'fake_me'),
      obs('101', 'fake_ann', { followerCount: 300 }),
      obs('102', 'fake_ben', { followerCount: 120 }),
      obs('103', 'fake_cat', { followerCount: 900 }),
      obs('104', 'fake_dan', { followerCount: 50 }),
      obs('201', 'fake_eve'),
      obs('301', 'fake_far'),
    ],
    T,
  );
  await store.upsertEdges(
    [
      { from: V, to: '101', source: 'export' },
      { from: V, to: '102', source: 'export' },
      { from: V, to: '103', source: 'export' },
      { from: V, to: '104', source: 'export' },
      // 201 is followed by all four → 2nd degree via 4
      { from: '101', to: '201', source: 'following_list' },
      { from: '102', to: '201', source: 'following_list' },
      { from: '103', to: '201', source: 'following_list' },
      { from: '104', to: '201', source: 'following_list' },
      // 301 only via 201 → 3rd degree
      { from: '201', to: '301', source: 'following_list' },
    ],
    T,
  );
  return { db, store, service: new QueryService(db, () => T + 1000) };
}

async function ok(p: Promise<unknown>): Promise<ProfileViewOk> {
  const v = (await p) as ProfileViewOk;
  expect(v.status).toBe('ok');
  return v;
}

describe('QueryService.profile', () => {
  it('your own profile is "You", matched by username before any node exists', async () => {
    const { service } = await world();
    expect(await ok(service.profile(V, 'fake_me'))).toMatchObject({ state: 'self', degree: 0 });
    expect(await ok(service.profile(V, 'Fake_Me'))).toMatchObject({ state: 'self' });
  });

  it('1st degree', async () => {
    const { service } = await world();
    expect(await ok(service.profile(V, 'fake_ann'))).toMatchObject({
      state: 'first',
      degree: 1,
      connectors: [],
    });
  });

  it('2nd degree: via N, avatars are the 3 connectors with the fewest followers', async () => {
    const { service } = await world();
    const v = await ok(service.profile(V, 'fake_eve'));
    expect(v).toMatchObject({ state: 'second', degree: 2, connectorCount: 4, known: true });
    expect(v.connectors.map((c) => c.username)).toEqual(['fake_dan', 'fake_ben', 'fake_ann']);
  });

  it('3rd degree', async () => {
    const { service } = await world();
    expect(await ok(service.profile(V, 'fake_far'))).toMatchObject({
      state: 'third',
      degree: 3,
      connectorCount: 4,
    });
  });

  it('out of orbit: seen-but-unconnected and never-seen are told apart', async () => {
    const { store, service } = await world();
    await store.upsertNodes([obs('999', 'fake_loner')], T);
    expect(await ok(service.profile(V, 'fake_loner'))).toMatchObject({
      state: 'out_of_orbit',
      degree: null,
      known: true,
    });
    expect(await ok(service.profile(V, 'fake_nobody'))).toMatchObject({
      state: 'out_of_orbit',
      known: false,
    });
  });

  it('counts are lower bounds until the lists involved are complete (§5.2)', async () => {
    const { store, service } = await world();
    const partial = await ok(service.profile(V, 'fake_eve'));
    expect(partial).toMatchObject({ degreeExact: false, connectorsExact: false });

    // Eve's follower list, scrolled to the end: every connector is known, and she isn't 1st.
    await store.recordListPage({
      ownerId: '201',
      direction: 'followers',
      rows: ['101', '102', '103', '104'].map((id) => obs(id, `fake_${id}`)),
      observedAt: T,
    });
    await store.completeList({
      ownerId: '201',
      direction: 'followers',
      sessionStartedAt: T,
      completedAt: T + 1,
    });
    service.invalidate();
    expect(await ok(service.profile(V, 'fake_eve'))).toMatchObject({
      degreeExact: true,
      connectorsExact: true,
    });
  });

  it('hubs are not intermediaries; the profile says how many were hidden (§7.3)', async () => {
    const { store, service } = await world();
    await store.upsertNodes(
      [obs('400', 'fake_star', { followerCount: 5_000_000 }), obs('401', 'fake_fan')],
      T,
    );
    await store.upsertEdges(
      [
        { from: '101', to: '400', source: 'following_list' },
        { from: '400', to: '401', source: 'following_list' },
      ],
      T,
    );
    const v = await ok(service.profile(V, 'fake_fan'));
    expect(v.state).toBe('out_of_orbit');
    expect(v.hiddenHubCount).toBe(1);
    // The hub itself is still a target with its own degree.
    expect(await ok(service.profile(V, 'fake_star'))).toMatchObject({ state: 'second' });
  });

  it('private accounts keep their flag so the popover can explain the limit', async () => {
    const { store, service } = await world();
    await store.upsertNodes([obs('201', 'fake_eve', { isPrivate: true })], T + 5);
    expect((await ok(service.profile(V, 'fake_eve'))).isPrivate).toBe(true);
  });

  it('an old @name still resolves to the renamed account (§9 Identity)', async () => {
    const { store, service } = await world();
    await store.upsertNodes([obs('201', 'fake_eve_new')], T + 10);
    const v = await ok(service.profile(V, 'fake_eve'));
    expect(v).toMatchObject({ state: 'second', known: true });
    expect(v.person?.username).toBe('fake_eve_new');
  });

  it('export-only (username, no id) accounts are 1st degree straight away', async () => {
    const db = freshDb();
    const store = new ViewerStore(db, V);
    await store.touchViewer('fake_me', T);
    await store.applyExportSnapshot({ following: ['fake_zed'], followers: [], exportedAt: T }, T);
    const v = await ok(new QueryService(db).profile(V, 'fake_zed'));
    expect(v).toMatchObject({ state: 'first', known: true });
  });

  it("another account's graph never leaks in (§5.3)", async () => {
    const { db, service } = await world();
    await new ViewerStore(db, '2000').touchViewer('fake_other', T);
    expect(await ok(service.profile('2000', 'fake_eve'))).toMatchObject({
      state: 'out_of_orbit',
      known: false,
    });
  });

  it('avatar images are only handed over when the setting allows them', async () => {
    const { store, service } = await world();
    await store.upsertNodes(
      [obs('101', 'fake_ann', { profilePicUrl: 'https://cdn.example.test/ann.jpg' })],
      T + 1,
    );
    const off = await ok(service.profile(V, 'fake_eve'));
    expect(JSON.stringify(off)).not.toContain('cdn.example.test');

    await store.saveSettings({ showAvatarImages: true });
    service.invalidate();
    const on = await ok(service.profile(V, 'fake_eve'));
    expect(on.connectors.find((c) => c.username === 'fake_ann')?.profilePicUrl).toBe(
      'https://cdn.example.test/ann.jpg',
    );
  });

  it('reports graph size and freshness for the popover footer', async () => {
    const { service } = await world();
    const v = await ok(service.profile(V, 'fake_eve'));
    expect(v.knownAccounts).toBe(7);
    expect(v.updatedAt).toBe(T);
  });
});

describe('QueryService cache', () => {
  it('serves the cached graph until invalidated', async () => {
    const { store, service } = await world();
    expect((await ok(service.profile(V, 'fake_far'))).state).toBe('third');
    await store.upsertEdges([{ from: V, to: '301', source: 'profile_flag' }], T + 1);
    expect((await ok(service.profile(V, 'fake_far'))).state).toBe('third'); // cached
    service.invalidate(V);
    expect((await ok(service.profile(V, 'fake_far'))).state).toBe('first');
  });

  it('invalidating one account leaves another cached', async () => {
    const { db, store, service } = await world();
    const other = new ViewerStore(db, '2000');
    await other.touchViewer('fake_other', T);
    await service.profile('2000', 'fake_other');
    await service.profile(V, 'fake_far');
    await store.upsertEdges([{ from: V, to: '301', source: 'profile_flag' }], T + 1);
    service.invalidate('2000');
    expect((await ok(service.profile(V, 'fake_far'))).state).toBe('third'); // V still cached
  });

  it('rebuilds after the max age even without an invalidation', async () => {
    const { store, db } = await world();
    let now = T;
    const service = new QueryService(db, () => now);
    expect((await ok(service.profile(V, 'fake_far'))).state).toBe('third');
    await store.upsertEdges([{ from: V, to: '301', source: 'profile_flag' }], T + 1);
    now = T + 6 * 60_000;
    expect((await ok(service.profile(V, 'fake_far'))).state).toBe('first');
  });

  it('concurrent queries share one build', async () => {
    const { service } = await world();
    const [a, b] = await Promise.all([
      service.profile(V, 'fake_eve'),
      service.profile(V, 'fake_far'),
    ]);
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
  });

  it('a database failure is an error reply, not a crash, and is not cached', async () => {
    const { db, service } = await world();
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      db.close();
      expect(await service.profile(V, 'fake_eve')).toEqual({ status: 'error' });
      await db.open();
      expect((await service.profile(V, 'fake_eve')).status).toBe('ok');
    } finally {
      console.warn = warn;
    }
  });
});

describe('QueryService.paths', () => {
  it('lists full paths grouped by the person you follow', async () => {
    const { service } = await world();
    const res = await service.paths(V, 'fake_eve');
    if (res.status !== 'ok') throw new Error('expected ok');
    expect(res.total).toBe(4);
    expect(res.truncated).toBe(false);
    expect(res.groups).toHaveLength(4);
    // Fewest followers first (§7.2): dan(50), ben(120), ann(300), cat(900).
    expect(res.groups.map((g) => g.connector.username)).toEqual([
      'fake_dan',
      'fake_ben',
      'fake_ann',
      'fake_cat',
    ]);
    const first = res.groups[0]!.paths[0]!.map((p) => p.username);
    expect(first).toEqual(['fake_me', 'fake_dan', 'fake_eve']);
  });

  it('3rd-degree paths have four people, you through target', async () => {
    const { service } = await world();
    const res = await service.paths(V, 'fake_far');
    if (res.status !== 'ok') throw new Error('expected ok');
    expect(res.total).toBe(4);
    for (const g of res.groups) {
      const path = g.paths[0]!;
      expect(path).toHaveLength(4);
      expect(path[0]!.id).toBe(V);
      expect(path[3]!.username).toBe('fake_far');
    }
  });

  it('nothing to list for unknown or own profiles', async () => {
    const { service } = await world();
    for (const name of ['fake_nobody', 'fake_me']) {
      expect(await service.paths(V, name)).toMatchObject({ status: 'ok', groups: [], total: 0 });
    }
  });
});
