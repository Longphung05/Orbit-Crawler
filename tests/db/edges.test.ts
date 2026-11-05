import { describe, expect, it } from 'vitest';
import { computeReach } from '../../src/graph';
import { loadGraph, mergeEdges, toGraphNode } from '../../src/db';
import type { Edge } from '../../src/shared/types';
import { obs, store } from './helpers';

const DAY = 86_400_000;

describe('upsertEdges', () => {
  it('creates, dedupes within a batch, ignores self-loops, and refreshes confirmations', async () => {
    const s = store();
    const added = await s.upsertEdges(
      [
        { from: 'a1', to: 'b1', source: 'following_list' },
        { from: 'a1', to: 'b1', source: 'following_list' },
        { from: 'a1', to: 'a1', source: 'following_list' },
      ],
      10,
    );
    expect(added).toBe(1);
    expect(await s.upsertEdges([{ from: 'a1', to: 'b1', source: 'followers_list' }], 20)).toBe(0);
    expect(await s.getEdge('a1', 'b1')).toMatchObject({
      id: 'a1->b1',
      firstSeenAt: 10,
      lastConfirmedAt: 20,
      source: 'followers_list',
      stale: false,
    });
  });
});

describe('recordListPage', () => {
  it('following list: owner → rows, coverage partial', async () => {
    const s = store();
    await s.upsertNodes([obs('42', 'fake_alex')], 1);
    const res = await s.recordListPage({
      ownerId: '42',
      direction: 'following',
      rows: [obs('7', 'fake_a'), obs('8', 'fake_b')],
      observedAt: 5,
    });
    expect(res).toEqual({ added: 2, droppedByCap: 0 });
    expect((await s.edgesFrom('42')).map((e) => e.to).sort()).toEqual(['7', '8']);
    expect((await s.getNode('42'))?.followingCoverage).toBe('partial');
    expect(await s.getNode('7')).toMatchObject({ username: 'fake_a' });
  });

  it('followers list: rows → owner; mutuals never change coverage', async () => {
    const s = store();
    await s.upsertNodes([obs('42', 'fake_alex')], 1);
    await s.recordListPage({
      ownerId: '42',
      direction: 'followers',
      rows: [obs('7', 'fake_a')],
      observedAt: 5,
    });
    await s.recordListPage({
      ownerId: '42',
      direction: 'mutuals',
      rows: [obs('8', 'fake_b')],
      observedAt: 6,
    });
    expect(await s.getEdge('7', '42')).toMatchObject({ source: 'followers_list' });
    expect(await s.getEdge('8', '42')).toMatchObject({ source: 'mutuals' });
    expect(await s.getNode('42')).toMatchObject({
      followersCoverage: 'partial',
      followingCoverage: 'none',
    });
  });

  it('caps stored rows for hub follower lists and marks them capped (§7.4)', async () => {
    const s = store();
    await s.saveSettings({ hubFollowerListCap: 3 });
    await s.upsertNodes([obs('42', 'fake_celeb', { followerCount: 9_000_000 })], 1);
    const page = (ids: string[]) => ids.map((id) => obs(id, `fake_${id}`));
    const r1 = await s.recordListPage({
      ownerId: '42',
      direction: 'followers',
      rows: page(['1', '2']),
      observedAt: 2,
    });
    const r2 = await s.recordListPage({
      ownerId: '42',
      direction: 'followers',
      rows: page(['2', '3', '4', '5']),
      observedAt: 3,
    });
    expect(r1).toEqual({ added: 2, droppedByCap: 0 });
    expect(r2).toEqual({ added: 1, droppedByCap: 2 });
    expect((await s.edgesTo('42')).length).toBe(3);
    expect(await s.getEdge('2', '42')).toMatchObject({ lastConfirmedAt: 3 }); // still re-confirmed
    expect((await s.getNode('42'))?.followersCapped).toBe(true);

    const done = await s.completeList({
      ownerId: '42',
      direction: 'followers',
      sessionStartedAt: 2,
      completedAt: 4,
    });
    expect(done).toEqual({ completed: false, markedStale: 0 });
    expect((await s.getNode('42'))?.followersCoverage).toBe('partial');
  });

  it('non-hub follower lists are not capped', async () => {
    const s = store();
    await s.saveSettings({ hubFollowerListCap: 1 });
    await s.upsertNodes([obs('42', 'fake_friend', { followerCount: 300 })], 1);
    const res = await s.recordListPage({
      ownerId: '42',
      direction: 'followers',
      rows: [obs('1', 'fake_1'), obs('2', 'fake_2')],
      observedAt: 2,
    });
    expect(res.droppedByCap).toBe(0);
  });
});

describe('completeList and stale marking (§9 Data freshness)', () => {
  async function seeded() {
    const s = store();
    await s.upsertNodes([obs('42', 'fake_alex')], 1);
    await s.recordListPage({
      ownerId: '42',
      direction: 'following',
      rows: [obs('7', 'fake_a'), obs('8', 'fake_b'), obs('9', 'fake_c')],
      observedAt: 10,
    });
    return s;
  }

  it('partial lists never infer removal', async () => {
    const s = await seeded();
    await s.recordListPage({
      ownerId: '42',
      direction: 'following',
      rows: [obs('7', 'fake_a')],
      observedAt: 20,
    });
    expect((await s.edgesFrom('42')).every((e) => !e.stale)).toBe(true);
  });

  it('a complete list marks edges not seen this session as stale and sets coverage', async () => {
    const s = await seeded();
    // Session starts at 20: pages contain 7 and 8; 9 is gone (unfollowed).
    await s.recordListPage({
      ownerId: '42',
      direction: 'following',
      rows: [obs('7', 'fake_a')],
      observedAt: 20,
    });
    await s.recordListPage({
      ownerId: '42',
      direction: 'following',
      rows: [obs('8', 'fake_b')],
      observedAt: 21,
    });
    const res = await s.completeList({
      ownerId: '42',
      direction: 'following',
      sessionStartedAt: 20,
      completedAt: 22,
    });
    expect(res).toEqual({ completed: true, markedStale: 1 });
    expect(await s.getEdge('42', '9')).toMatchObject({ stale: true, staleAt: 22 });
    expect(await s.getEdge('42', '7')).toMatchObject({ stale: false });
    expect(await s.getNode('42')).toMatchObject({
      followingCoverage: 'complete',
      followingCompleteAt: 22,
    });
  });

  it('a complete followers list only touches inbound edges', async () => {
    const s = await seeded();
    await s.upsertEdges([{ from: '3', to: '42', source: 'followers_list' }], 10);
    const res = await s.completeList({
      ownerId: '42',
      direction: 'followers',
      sessionStartedAt: 20,
      completedAt: 22,
    });
    expect(res.markedStale).toBe(1);
    expect(await s.getEdge('3', '42')).toMatchObject({ stale: true });
    expect(await s.getEdge('42', '7')).toMatchObject({ stale: false });
  });

  it('re-observing a stale edge revives it; a late older observation does not', async () => {
    const s = await seeded();
    await s.completeList({
      ownerId: '42',
      direction: 'following',
      sessionStartedAt: 20,
      completedAt: 22,
    });
    await s.upsertEdges([{ from: '42', to: '9', source: 'following_list' }], 15);
    expect(await s.getEdge('42', '9')).toMatchObject({ stale: true });
    await s.upsertEdges([{ from: '42', to: '9', source: 'following_list' }], 30);
    const e = await s.getEdge('42', '9');
    expect(e).toMatchObject({ stale: false, lastConfirmedAt: 30 });
    expect(e?.staleAt).toBeUndefined();
  });
});

describe('mergeEdges', () => {
  const base: Edge = {
    viewerId: 'v',
    id: 'a->b',
    from: 'a',
    to: 'b',
    source: 'export',
    firstSeenAt: 5,
    lastConfirmedAt: 5,
    stale: false,
  };
  it('is symmetric in outcome', () => {
    const other: Edge = { ...base, source: 'mutuals', firstSeenAt: 2, lastConfirmedAt: 9 };
    expect(mergeEdges(base, other)).toEqual(mergeEdges(other, base));
    expect(mergeEdges(base, other)).toMatchObject({
      firstSeenAt: 2,
      lastConfirmedAt: 9,
      source: 'mutuals',
    });
  });
});

describe('official export snapshot', () => {
  it('seeds the 1st-degree layer and marks pre-export unfollows stale', async () => {
    const s = store();
    const v = s.viewerId;
    await s.upsertNodes([obs('42', 'fake_alex'), obs('43', 'fake_gone')], 1);
    await s.upsertEdges([{ from: v, to: '43', source: 'following_list' }], 1);
    // Followed after the export was generated: must survive.
    await s.upsertEdges([{ from: v, to: '44', source: 'following_list' }], 150);

    await s.applyExportSnapshot(
      { following: ['fake_alex', 'fake_jamie'], followers: ['fake_jamie'], exportedAt: 100 },
      200,
    );

    expect(await s.getEdge(v, '42')).toMatchObject({ source: 'export', stale: false });
    expect(await s.getEdge(v, 'username:fake_jamie')).toBeDefined();
    expect(await s.getEdge('username:fake_jamie', v)).toBeDefined();
    expect(await s.getEdge(v, '43')).toMatchObject({ stale: true });
    expect(await s.getEdge(v, '44')).toMatchObject({ stale: false });
    expect((await s.db.viewers.get(v))?.importedExportAt).toBe(100);
  });
});

describe('loadGraph → engine', () => {
  it('computes degrees from stored data and skips stale/unavailable', async () => {
    const s = store();
    const v = s.viewerId;
    await s.upsertNodes([obs('42', 'fake_alex'), obs('43', 'fake_b'), obs('44', 'fake_c')], 1);
    await s.upsertEdges(
      [
        { from: v, to: '42', source: 'following_list' },
        { from: '42', to: '43', source: 'following_list' },
        { from: '42', to: '44', source: 'following_list' },
      ],
      10,
    );
    await s.completeList({
      ownerId: '42',
      direction: 'following',
      sessionStartedAt: 20,
      completedAt: 21,
    });
    await s.upsertEdges([{ from: '42', to: '43', source: 'following_list' }], 22);

    const r = computeReach(await loadGraph(s, 30), v);
    expect(r.degree('43')).toBe(2);
    expect(r.degree('44')).toBeUndefined(); // stale
    await s.markUnavailable('43', 40);
    expect(computeReach(await loadGraph(s, 50), v).degree('43')).toBeUndefined();
  });

  it('excludeStale drops edges older than staleAfterDays; capped lists read as partial', async () => {
    const s = store();
    const v = s.viewerId;
    await s.upsertEdges([{ from: v, to: '42', source: 'following_list' }], 0);
    await s.upsertEdges([{ from: v, to: '43', source: 'following_list' }], 95 * DAY);
    await s.saveSettings({ staleAfterDays: 90, excludeStale: true });
    const r = computeReach(await loadGraph(s, 100 * DAY), v);
    expect(r.degree('42')).toBeUndefined();
    expect(r.degree('43')).toBe(1);

    await s.saveSettings({ hubFollowerListCap: 1 });
    await s.upsertNodes([obs('77', 'fake_celeb', { followerCount: 1e7 })], 1);
    await s.recordListPage({
      ownerId: '77',
      direction: 'followers',
      rows: [obs('1', 'fake_1'), obs('2', 'fake_2')],
      observedAt: 2,
    });
    const node = await s.getNode('77');
    expect(node && toGraphNode({ ...node, followersCoverage: 'complete' })).toMatchObject({
      followersCoverage: 'partial',
      followerCount: 1e7,
    });
  });
});
