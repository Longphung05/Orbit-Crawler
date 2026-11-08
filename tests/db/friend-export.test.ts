import { describe, expect, it } from 'vitest';
import { ViewerStore } from '../../src/db';
import { QueryService } from '../../src/query';
import { freshDb, obs } from './helpers';

const T = 1_700_000_000_000;

async function setup() {
  const db = freshDb();
  const s = new ViewerStore(db, '1000');
  await s.touchViewer('fake_me', T);
  // You follow fake_ann (from your own export).
  await s.applyExportSnapshot({ following: ['fake_ann'], followers: [], exportedAt: T }, T);
  return { db, s };
}

describe("a friend's shared export", () => {
  it('becomes that friend’s edges, making the people they follow 2nd degree', async () => {
    const { db, s } = await setup();
    await s.applyExportSnapshot(
      { ownerUsername: 'fake_ann', following: ['fake_bo', 'fake_cy'], exportedAt: T },
      T + 1,
    );
    const service = new QueryService(db);
    expect(await service.profile('1000', 'fake_bo')).toMatchObject({
      state: 'second',
      connectorCount: 1,
    });
  });

  it('two friends’ exports give a 3rd-degree link', async () => {
    const { db, s } = await setup();
    await s.applyExportSnapshot(
      { ownerUsername: 'fake_ann', following: ['fake_bo'], exportedAt: T },
      T + 1,
    );
    // fake_bo (not followed by you) shared too: bo follows fake_zed.
    await s.applyExportSnapshot(
      { ownerUsername: 'fake_bo', following: ['fake_zed'], exportedAt: T },
      T + 2,
    );
    expect(await new QueryService(db).profile('1000', 'fake_zed')).toMatchObject({
      state: 'third',
    });
  });

  it('marks the friend’s list complete, not yours, and leaves your import date alone', async () => {
    const { db, s } = await setup();
    const before = (await db.viewers.get('1000'))?.importedExportAt;
    await s.applyExportSnapshot(
      { ownerUsername: 'fake_ann', following: ['fake_bo'], exportedAt: T + 50 },
      T + 60,
    );
    const ann = await s.findByUsername('fake_ann');
    expect(ann?.followingCoverage).toBe('complete');
    expect(ann?.followersCoverage).toBe('none'); // no followers file in this export
    expect((await db.viewers.get('1000'))?.importedExportAt).toBe(before);
    // Your own following list is untouched.
    expect((await s.edgesFrom('1000')).map((e) => e.to)).toEqual(['username:fake_ann']);
  });

  it('your name in their followers list is you, not a placeholder', async () => {
    const { db, s } = await setup();
    await s.applyExportSnapshot(
      { ownerUsername: 'fake_ann', followers: ['fake_me', 'fake_bo'], exportedAt: T },
      T + 1,
    );
    expect(await db.nodes.get(['1000', 'username:fake_me'])).toBeUndefined();
    expect(await s.getEdge('1000', 'username:fake_ann')).toBeDefined();
  });

  it('merges into the real account once browsing sees the friend’s id', async () => {
    const { s } = await setup();
    await s.applyExportSnapshot(
      { ownerUsername: 'fake_ann', following: ['fake_bo'], exportedAt: T },
      T + 1,
    );
    await s.upsertNodes([obs('77', 'fake_ann')], T + 5);
    expect((await s.getNode('77'))?.followingCoverage).toBe('complete');
    expect(await s.getEdge('77', 'username:fake_bo')).toBeDefined();
  });

  it('refuses your own username as the friend', async () => {
    const { s } = await setup();
    await expect(
      s.applyExportSnapshot({ ownerUsername: 'Fake_Me', following: ['fake_bo'], exportedAt: T }, T),
    ).rejects.toThrow();
  });
});
