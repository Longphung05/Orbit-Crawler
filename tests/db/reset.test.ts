import { describe, expect, it } from 'vitest';
import { resetAllData, ViewerStore } from '../../src/db';
import { QueryService } from '../../src/query';
import { freshDb, obs } from './helpers';

const T = 1_700_000_000_000;

describe('resetAllData', () => {
  it('erases every table for every account but keeps who is logged in', async () => {
    const db = freshDb();
    for (const viewer of ['1000', '2000']) {
      const s = new ViewerStore(db, viewer);
      await s.touchViewer(`fake_${viewer}`, T);
      await s.upsertNodes([obs('10', 'fake_ann')], T);
      await s.upsertEdges([{ from: viewer, to: '10', source: 'export' }], T);
      await s.saveSettings({ staleAfterDays: 30 });
      await s.applyExportSnapshot({ following: ['fake_bo'], followers: [], exportedAt: T }, T);
    }
    await db.activity.add({ viewerId: '1000', at: T, kind: 'profile', text: 'x' });
    await db.diagnostics.put({ key: 'friendship_list', adapterVersion: 'v', ok: 3, failed: 0 });

    await resetAllData(db);

    expect(await db.nodes.count()).toBe(0);
    expect(await db.edges.count()).toBe(0);
    expect(await db.settings.count()).toBe(0);
    expect(await db.activity.count()).toBe(0);
    expect(await db.diagnostics.count()).toBe(0);

    // Accounts stay known (so import works without reloading Instagram) but are back to "new".
    const viewers = await db.viewers.toArray();
    expect(viewers.map((v) => v.username).sort()).toEqual(['fake_1000', 'fake_2000']);
    for (const v of viewers) {
      expect(v.importedExportAt).toBeUndefined();
      expect(v.followingCoverage).toBeUndefined();
      expect(v.followersCoverage).toBeUndefined();
    }
  });

  it('is safe on an empty database and can be repeated', async () => {
    const db = freshDb();
    await resetAllData(db);
    await resetAllData(db);
    expect(await db.nodes.count()).toBe(0);
  });

  it('the badge sees an empty graph afterwards', async () => {
    const db = freshDb();
    const s = new ViewerStore(db, '1000');
    await s.touchViewer('fake_me', T);
    await s.applyExportSnapshot({ following: ['fake_ann'], followers: [], exportedAt: T }, T);
    const service = new QueryService(db);
    expect(await service.profile('1000', 'fake_ann')).toMatchObject({ state: 'first' });

    await resetAllData(db);
    service.invalidate(); // what the background does on "graph changed"
    expect(await service.profile('1000', 'fake_ann')).toMatchObject({
      state: 'out_of_orbit',
      known: false,
      firstLayer: 'none',
    });
  });
});

describe('your own list coverage after an export import', () => {
  it('is recorded even though no node for you exists yet', async () => {
    const db = freshDb();
    const s = new ViewerStore(db, '1000');
    await s.touchViewer('fake_me', T);
    // An export without a followers file: that key is omitted, not empty.
    await s.applyExportSnapshot({ following: ['fake_ann'], exportedAt: T }, T);
    expect(await s.getNode('1000')).toBeUndefined();
    expect((await db.viewers.get('1000'))?.followingCoverage).toBe('complete');
    // followers weren't in the export, so that list is not claimed complete
    expect((await db.viewers.get('1000'))?.followersCoverage).toBeUndefined();
  });

  it('makes degrees exact: an import alone is enough to drop the "or closer" hedge', async () => {
    const db = freshDb();
    const s = new ViewerStore(db, '1000');
    await s.touchViewer('fake_me', T);
    await s.applyExportSnapshot({ following: ['fake_ann'], followers: [], exportedAt: T }, T);
    await s.upsertNodes([obs('201', 'fake_eve')], T);
    await s.upsertEdges([{ from: 'username:fake_ann', to: '201', source: 'mutuals' }], T);

    const v = await new QueryService(db).profile('1000', 'fake_eve');
    expect(v).toMatchObject({
      state: 'second',
      firstLayer: 'complete',
      degreeExact: true,
      connectorsExact: true,
    });
  });

  it('a later visit to your own profile does not erase it', async () => {
    const db = freshDb();
    const s = new ViewerStore(db, '1000');
    await s.touchViewer('fake_me', T);
    await s.applyExportSnapshot({ following: ['fake_ann'], followers: [], exportedAt: T }, T);
    await s.upsertNodes([obs('1000', 'fake_me')], T + 5); // node created now, coverage 'none'
    const v = await new QueryService(db).profile('1000', 'fake_ann');
    if (v.status !== 'ok') throw new Error('expected ok');
    expect(v.firstLayer).toBe('complete');
  });

  it('a scrolled-to-the-end Following list counts the same way', async () => {
    const db = freshDb();
    const s = new ViewerStore(db, '1000');
    await s.touchViewer('fake_me', T);
    await s.recordListPage({
      ownerId: '1000',
      direction: 'following',
      rows: [obs('10', 'fake_ann')],
      observedAt: T,
    });
    await s.completeList({
      ownerId: '1000',
      direction: 'following',
      sessionStartedAt: T,
      completedAt: T + 1,
    });
    expect((await db.viewers.get('1000'))?.followingCoverage).toBe('complete');
  });
});
