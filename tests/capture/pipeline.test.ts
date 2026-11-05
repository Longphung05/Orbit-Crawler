import { describe, expect, it } from 'vitest';
import { interpretResponse, type CaptureEvent } from '../../src/adapters/instagram';
import { applyEvents, ListSessions } from '../../src/capture';
import { computeReach } from '../../src/graph';
import { loadGraph } from '../../src/db';
import * as P from '../fixtures/instagram/payloads';
import { obs, store } from '../db/helpers';

function events(p: { url: string; body: unknown; status?: number }): CaptureEvent[] {
  const out = interpretResponse(P.response(p));
  if (out.status !== 'ok') throw new Error(JSON.stringify(out));
  return out.events;
}

function ctx(s = store(P.VIEWER), at = 100, tabId = 1, sessions = new ListSessions()) {
  return { store: s, at, tabId, sessions };
}

describe('list capture sessions', () => {
  it('scrolling your own following list to the end completes it and stales unfollows', async () => {
    const s = store(P.VIEWER);
    await s.upsertEdges([{ from: P.VIEWER, to: '2999999999', source: 'export' }], 10);
    const sessions = new ListSessions();
    await applyEvents(events(P.followingPage1), ctx(s, 100, 1, sessions));
    const sum = await applyEvents(events(P.followingPage2), ctx(s, 110, 1, sessions));
    expect(sum).toMatchObject({ completed: 1, staled: 1 });
    expect(await s.getEdge(P.VIEWER, '2999999999')).toMatchObject({ stale: true });
    expect(await s.getEdge(P.VIEWER, '2000000003')).toMatchObject({ stale: false });
    expect((await s.getNode(P.VIEWER))?.followingCoverage ?? 'n/a').toBe('n/a'); // no viewer node yet
    expect(sessions.size).toBe(0);
  });

  it('a list joined mid-way (no first page) never completes', async () => {
    const s = store(P.VIEWER);
    await s.upsertEdges([{ from: P.VIEWER, to: '2999999999', source: 'export' }], 10);
    const sum = await applyEvents(events(P.followingPage2), ctx(s));
    expect(sum.completed).toBe(0);
    expect(await s.getEdge(P.VIEWER, '2999999999')).toMatchObject({ stale: false });
  });

  it('first page in one tab and last page in another tab is not a complete scroll', async () => {
    const s = store(P.VIEWER);
    const sessions = new ListSessions();
    await applyEvents(events(P.followingPage1), ctx(s, 100, 1, sessions));
    const sum = await applyEvents(events(P.followingPage2), ctx(s, 110, 2, sessions));
    expect(sum.completed).toBe(0);
  });

  it('a single-page list (first and last) completes immediately', async () => {
    const s = store(P.VIEWER);
    await s.upsertNodes([obs('2000000001', 'fake_alex')], 1);
    const sum = await applyEvents(events(P.followersOfAlex), ctx(s));
    expect(sum.completed).toBe(1);
    expect(await s.getEdge('3000000001', '2000000001')).toBeDefined();
    // The viewer appears in fake_alex's followers, so the viewer follows fake_alex.
    expect(await s.getEdge(P.VIEWER, '2000000001')).toMatchObject({ source: 'followers_list' });
    expect((await s.getNode('2000000001'))?.followersCoverage).toBe('complete');
  });

  it('search results inside a list are stored but never complete it', async () => {
    const s = store(P.VIEWER);
    const sum = await applyEvents(events(P.followingSearch), ctx(s));
    expect(sum).toMatchObject({ added: 1, completed: 0 });
    expect(await s.getEdge('2000000001', '3000000002')).toBeDefined();
  });

  it('a mutuals list implies the viewer follows each listed account', async () => {
    const s = store(P.VIEWER);
    await applyEvents(events(P.mutualsOfTarget), ctx(s));
    expect(await s.getEdge('2000000001', '4000000001')).toMatchObject({ source: 'mutuals' });
    expect(await s.getEdge(P.VIEWER, '2000000001')).toMatchObject({ source: 'mutuals' });
  });
});

describe('profile capture', () => {
  it('private profile you do not follow: 2nd degree via "Followed by", pending request is not a follow', async () => {
    const s = store(P.VIEWER);
    await s.upsertNodes([obs('2000000001', 'fake_alex')], 1);
    await applyEvents(events(P.webProfilePrivate), ctx(s));

    expect(await s.getNode('4000000001')).toMatchObject({ isPrivate: true, followerCount: 812 });
    expect(await s.getEdge(P.VIEWER, '4000000001')).toBeUndefined(); // requested ≠ following
    expect(await s.getEdge('2000000001', '4000000001')).toMatchObject({ source: 'mutuals' });
    expect(await s.getEdge('username:fake_unknown_mutual', '4000000001')).toBeDefined();

    const reach = computeReach(await loadGraph(s, 200), P.VIEWER);
    expect(reach.degree('4000000001')).toBe(2);
    expect(reach.connectors('4000000001')).toContain('2000000001');
  });

  it('friendship flags add edges, and "not following" stales an older follow', async () => {
    const s = store(P.VIEWER);
    await applyEvents(events(P.userInfoAlex), ctx(s, 100));
    expect(await s.getEdge(P.VIEWER, '2000000001')).toMatchObject({ source: 'profile_flag' });
    expect(await s.getEdge('2000000001', P.VIEWER)).toBeDefined();
    expect(await s.getEdge('2000000002', '2000000001')).toBeDefined(); // facepile

    await s.upsertEdges([{ from: P.VIEWER, to: '2000000002', source: 'export' }], 50);
    const sum = await applyEvents(events(P.friendshipShow), ctx(s, 120));
    expect(sum.staled).toBe(1);
    expect(await s.getEdge(P.VIEWER, '2000000002')).toMatchObject({ stale: true });
    expect(await s.getEdge('2000000002', P.VIEWER)).toMatchObject({ source: 'profile_flag' });
  });

  it('opening your own profile records your username, not a self-edge', async () => {
    const s = store(P.VIEWER);
    const own = {
      url: `${P.IG}/api/v1/users/${P.VIEWER}/info/`,
      body: {
        user: {
          pk: P.VIEWER,
          username: 'fake_me',
          follower_count: 3,
          friendship_status: { following: false, followed_by: false },
        },
      },
    };
    await applyEvents(events(own), ctx(s));
    expect((await s.db.viewers.get(P.VIEWER))?.username).toBe('fake_me');
    expect(await s.counts()).toEqual({ nodes: 1, edges: 0 });
  });

  it('a missing profile marks a known account unavailable; viewing it again clears that', async () => {
    const s = store(P.VIEWER);
    await s.upsertNodes([obs('6000000001', 'fake_gone')], 1);
    await applyEvents(events(P.webProfileMissing), ctx(s, 100));
    expect((await s.getNode('6000000001'))?.unavailable).toBe(true);

    const back = {
      url: `${P.IG}/api/v1/users/6000000001/info/`,
      body: { user: { pk: '6000000001', username: 'fake_gone' } },
    };
    await applyEvents(events(back), ctx(s, 200));
    expect((await s.getNode('6000000001'))?.unavailable).toBeUndefined();
  });

  it('missing profile for an unknown username changes nothing', async () => {
    const s = store(P.VIEWER);
    await applyEvents(events(P.webProfileMissing), ctx(s));
    expect(await s.counts()).toEqual({ nodes: 0, edges: 0 });
  });
});
