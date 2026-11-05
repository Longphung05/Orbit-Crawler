import { describe, expect, it } from 'vitest';
import { CaptureCoordinator, computeHealth, diagnosticsReport, isFailing } from '../../src/capture';
import { ViewerStore } from '../../src/db';
import * as P from '../fixtures/instagram/payloads';
import { freshDb } from '../db/helpers';

const IG_TAB = { tabId: 7, url: 'https://www.instagram.com/fake_alex/', fromSelf: true };

const viewerMsg = (viewerId: string | null, at = 1, extra = {}) => ({
  type: 'orbit/viewer',
  viewerId,
  strategy: viewerId ? 'current-user-initial-data' : 'none',
  at,
  ...extra,
});
const responseMsg = (
  p: { url: string; body: unknown; status?: number },
  at = 2,
  viewerId: string | null = null,
) => ({
  type: 'orbit/response',
  ...P.response(p),
  at,
  viewerId,
});

describe('CaptureCoordinator', () => {
  it('attributes captures to the detected account and records health', async () => {
    const db = freshDb();
    const c = new CaptureCoordinator(db);
    await c.handle(viewerMsg(P.VIEWER), IG_TAB);
    await c.handle(responseMsg(P.followingPage1), IG_TAB);
    const s = new ViewerStore(db, P.VIEWER);
    expect(await s.counts()).toMatchObject({ edges: 2 });
    expect(await db.diagnostics.get('friendship_list')).toMatchObject({ ok: 1, failed: 0 });
    expect(await db.viewers.get(P.VIEWER)).toMatchObject({ viewerId: P.VIEWER, username: '' });
    expect(computeHealth(await db.diagnostics.toArray())).toBe('ok');
  });

  it('buffers captures that arrive before the account is detected', async () => {
    const db = freshDb();
    const c = new CaptureCoordinator(db);
    await c.handle(responseMsg(P.followingPage1, 2), IG_TAB);
    expect(await db.edges.count()).toBe(0);
    await c.handle(viewerMsg(P.VIEWER, 3), IG_TAB);
    expect(await new ViewerStore(db, P.VIEWER).counts()).toMatchObject({ edges: 2 });
  });

  it('recovers the account from the message after a service-worker restart', async () => {
    const db = freshDb();
    const fresh = new CaptureCoordinator(db); // no viewer message ever seen
    await fresh.handle(responseMsg(P.followingPage1, 2, P.VIEWER), IG_TAB);
    expect(await new ViewerStore(db, P.VIEWER).counts()).toMatchObject({ edges: 2 });
  });

  it('logged out → nothing captured, buffer dropped (§9)', async () => {
    const db = freshDb();
    const c = new CaptureCoordinator(db);
    await c.handle(responseMsg(P.followingPage1), IG_TAB);
    await c.handle(viewerMsg(null), IG_TAB);
    await c.handle(responseMsg(P.followingPage2), IG_TAB);
    expect(await db.edges.count()).toBe(0);
    expect(await db.diagnostics.get('viewer')).toMatchObject({ detail: 'none', failed: 1 });
  });

  it('keeps two accounts apart and drops list sessions on account switch', async () => {
    const db = freshDb();
    const c = new CaptureCoordinator(db);
    await c.handle(viewerMsg('1000000001'), IG_TAB);
    await c.handle(responseMsg(P.followingPage1), IG_TAB);
    expect(c.sessions.size).toBe(1);
    await c.handle(viewerMsg('1000000009', 5), IG_TAB);
    expect(c.sessions.size).toBe(0);
    await c.handle(responseMsg(P.followersOfAlex, 6), IG_TAB);
    expect(await new ViewerStore(db, '1000000009').counts()).toMatchObject({ edges: 2 });
    expect(await new ViewerStore(db, '1000000001').counts()).toMatchObject({ edges: 2 });
  });

  it('rejects messages from other extensions, non-Instagram pages, or malformed payloads', async () => {
    const db = freshDb();
    const c = new CaptureCoordinator(db);
    await c.handle(viewerMsg(P.VIEWER), { ...IG_TAB, fromSelf: false });
    await c.handle(viewerMsg(P.VIEWER), { ...IG_TAB, url: 'https://evil.example/' });
    await c.handle(viewerMsg(P.VIEWER), { ...IG_TAB, tabId: undefined });
    await c.handle({ type: 'orbit/viewer', viewerId: 'not-digits', strategy: 'x', at: 1 }, IG_TAB);
    await c.handle({ type: 'orbit/delete-everything' }, IG_TAB);
    expect(await db.viewers.count()).toBe(0);
  });

  it('schema drift turns health red with a value-free shape; nothing is written', async () => {
    const db = freshDb();
    const c = new CaptureCoordinator(db);
    await c.handle(viewerMsg(P.VIEWER), IG_TAB);
    await c.handle(responseMsg(P.followingPage1), IG_TAB);
    await c.handle(responseMsg(P.driftedList, 3), IG_TAB);
    const rec = await db.diagnostics.get('friendship_list');
    expect(rec && isFailing(rec)).toBe(true);
    expect(computeHealth(await db.diagnostics.toArray())).toBe('broken');
    const report = diagnosticsReport(await db.diagnostics.toArray());
    expect(report).toContain('items_v2');
    expect(report).not.toMatch(/fake_|2000000001|1000000001/);
  });

  it('one working and one drifting payload type → degraded', async () => {
    const db = freshDb();
    const c = new CaptureCoordinator(db);
    await c.handle(viewerMsg(P.VIEWER), IG_TAB);
    await c.handle(responseMsg(P.userInfoAlex), IG_TAB);
    await c.handle(responseMsg(P.driftedList, 3), IG_TAB);
    expect(computeHealth(await db.diagnostics.toArray())).toBe('degraded');
  });

  it('forgetTab clears per-tab state', async () => {
    const db = freshDb();
    const c = new CaptureCoordinator(db);
    await c.handle(viewerMsg(P.VIEWER), IG_TAB);
    c.forgetTab(IG_TAB.tabId);
    expect(c.viewerForTab(IG_TAB.tabId)).toBeUndefined();
  });

  it('a failing task does not wedge the queue', async () => {
    const db = freshDb();
    const c = new CaptureCoordinator(db);
    await c.handle(viewerMsg(P.VIEWER), IG_TAB);
    db.close(); // every DB call now fails
    await c.handle(responseMsg(P.followingPage1), IG_TAB);
    await db.open();
    await c.handle(responseMsg(P.followingPage1, 9), IG_TAB);
    expect(await new ViewerStore(db, P.VIEWER).counts()).toMatchObject({ edges: 2 });
  });
});
