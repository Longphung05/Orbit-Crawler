import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { OrbitDB, SCHEMA_VERSION, ViewerStore } from '../../src/db';
import { SCHEMA_V1 } from '../../src/db/db';
import { obs, store } from './helpers';

describe('migrations', () => {
  it('upgrades a Phase 1 (v1) database to the current schema', async () => {
    const name = `orbit-migrate-${Date.now()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores(SCHEMA_V1);
    await v1.open();
    await v1.table('nodes').bulkPut([
      {
        viewerId: '1000',
        id: '42',
        username: 'Fake_Alex',
        usernameHistory: ['old_alex'],
        lastSeenAt: 500,
        followingCoverage: 'partial',
        followersCoverage: 'none',
      },
      { viewerId: '1000', id: 'username:ghost', username: 'ghost', lastSeenAt: 100 },
    ]);
    await v1.table('edges').put({
      viewerId: '1000',
      id: '1000->42',
      from: '1000',
      to: '42',
      source: 'export',
      firstSeenAt: 1,
      lastConfirmedAt: 2,
      stale: false,
    });
    v1.close();

    const db = new OrbitDB(name);
    await db.open();
    expect(db.verno).toBe(SCHEMA_VERSION);
    const s = new ViewerStore(db, '1000');

    const alex = await s.getNode('42');
    expect(alex).toMatchObject({
      usernameKey: 'fake_alex',
      usernameSeenAt: 500,
      firstSeenAt: 500,
      historyKeys: ['1000|old_alex'],
      followingCoverage: 'partial',
    });
    expect((await s.findByUsername('FAKE_ALEX'))?.id).toBe('42');
    expect((await s.findByUsername('old_alex'))?.id).toBe('42');
    expect(await s.getNode('username:ghost')).toMatchObject({
      isPlaceholder: true,
      followersCoverage: 'none',
      usernameHistory: [],
    });
    expect(await s.getEdge('1000', '42')).toMatchObject({ source: 'export' });
    await db.delete();
  });
});

describe('per-viewer partitioning (§5.3)', () => {
  it('two accounts in one browser never see each other', async () => {
    const a = store('1000');
    const b = new ViewerStore(a.db, '2000');
    await a.upsertNodes([obs('42', 'fake_alex')], 1);
    await a.upsertEdges([{ from: '1000', to: '42', source: 'following_list' }], 1);
    await b.upsertNodes([obs('42', 'fake_alex_renamed')], 1);

    expect(await a.counts()).toEqual({ nodes: 1, edges: 1 });
    expect(await b.counts()).toEqual({ nodes: 1, edges: 0 });
    expect((await a.getNode('42'))?.username).toBe('fake_alex');
    expect((await b.findByUsername('fake_alex'))?.id).toBeUndefined();
  });

  it('wipe deletes only that viewer', async () => {
    const a = store('1000');
    const b = new ViewerStore(a.db, '2000');
    for (const s of [a, b]) {
      await s.touchViewer('fake_me', 1);
      await s.saveSettings({ hubFollowerThreshold: 10 });
      await s.upsertNodes([obs('42', 'fake_alex')], 1);
      await s.upsertEdges([{ from: s.viewerId, to: '42', source: 'following_list' }], 1);
    }
    await a.wipe();
    expect(await a.counts()).toEqual({ nodes: 0, edges: 0 });
    expect(await a.db.viewers.get('1000')).toBeUndefined();
    expect((await a.getSettings()).hubFollowerThreshold).toBe(50_000);
    expect(await b.counts()).toEqual({ nodes: 1, edges: 1 });
    expect((await b.getSettings()).hubFollowerThreshold).toBe(10);
  });

  it('rejects an empty viewerId', () => {
    expect(() => store('')).toThrow();
  });
});

describe('settings', () => {
  it('returns defaults, persists valid patches, rejects invalid ones', async () => {
    const s = store();
    expect((await s.getSettings()).firstDegreeMode).toBe('following');
    await s.saveSettings({ firstDegreeMode: 'mutual', staleAfterDays: 30 });
    expect(await s.getSettings()).toMatchObject({ firstDegreeMode: 'mutual', staleAfterDays: 30 });
    await expect(s.saveSettings({ staleAfterDays: -1 })).rejects.toThrow();
    await expect(s.saveSettings({ firstDegreeMode: 'bogus' as 'mutual' })).rejects.toThrow();
  });

  it('falls back to defaults if stored settings are corrupt', async () => {
    const s = store();
    await s.db.settings.put({ viewerId: s.viewerId, staleAfterDays: 'soon' as unknown as number });
    expect((await s.getSettings()).staleAfterDays).toBe(90);
  });
});

describe('viewer meta', () => {
  it('touchViewer records username and activity without losing import time', async () => {
    const s = store();
    await s.db.viewers.put({ viewerId: s.viewerId, username: 'x', importedExportAt: 7 });
    expect(await s.touchViewer('fake_me', 99)).toEqual({
      viewerId: s.viewerId,
      username: 'fake_me',
      lastActiveAt: 99,
      importedExportAt: 7,
    });
  });

  it('touchViewer without a username keeps the known one; activity never goes backwards', async () => {
    const s = store();
    await s.touchViewer('fake_me', 50);
    expect(await s.touchViewer(undefined, 40)).toMatchObject({
      username: 'fake_me',
      lastActiveAt: 50,
    });
    expect((await store('2000').touchViewer(undefined, 1)).username).toBe('');
    await expect(s.touchViewer('bad name!', 60)).rejects.toThrow();
  });
});
