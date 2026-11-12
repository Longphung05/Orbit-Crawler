// The page config can name the logged-in account by a different id than Instagram's profile and
// list data use. Orbit must notice (your own profile) and fold that id into your account.
import { describe, expect, it } from 'vitest';
import { CaptureCoordinator, remapSelfIds } from '../../src/capture';
import { ViewerStore } from '../../src/db';
import { QueryService } from '../../src/query';
import * as P from '../fixtures/instagram/payloads';
import { freshDb, obs } from '../db/helpers';

/** What the page config said you are. Your profile data says P.VIEWER. */
const DETECTED = '9000000009';
const PK = P.VIEWER;
const IG_TAB = { tabId: 3, url: 'https://www.instagram.com/fake_me/', fromSelf: true };

const viewerMsg = (at: number, extra: Record<string, unknown> = {}) => ({
  type: 'orbit/viewer',
  viewerId: DETECTED,
  strategy: 'current-user-initial-data',
  at,
  ...extra,
});
const respond = (p: { url: string; body: unknown }, at: number) => ({
  type: 'orbit/response',
  ...P.response(p),
  at,
  viewerId: DETECTED,
});

async function state(db: ReturnType<typeof freshDb>, name: string) {
  const v = await new QueryService(db).profile(DETECTED, name);
  return v.status === 'ok' ? v.state : v.status;
}

describe('adoptSelfId', () => {
  it('moves the other id’s node and edges onto the viewer, once', async () => {
    const db = freshDb();
    const store = new ViewerStore(db, DETECTED);
    await store.applyExportSnapshot({ following: ['fake_alex'], followers: [], exportedAt: 1 }, 1);
    await store.upsertNodes([obs(PK, 'fake_me'), obs('2', 'fake_alex'), obs('3', 'fake_jamie')], 2);
    await store.upsertEdges(
      [
        { from: PK, to: '2', source: 'following_list' },
        { from: PK, to: '3', source: 'following_list' },
        { from: '3', to: PK, source: 'followers_list' },
      ],
      2,
    );

    expect(await store.adoptSelfId(PK, 3)).toBe(true);
    expect(await store.getNode(PK)).toBeUndefined();
    expect((await store.getNode(DETECTED))?.username).toBe('fake_me');
    expect((await store.edgesFrom(DETECTED)).map((e) => e.to).sort()).toEqual(['2', '3']);
    expect((await store.edgesTo(DETECTED)).map((e) => e.from)).toEqual(['3']);
    expect([...(await store.selfIds())]).toEqual([PK]);

    expect(await store.adoptSelfId(PK, 4)).toBe(false);
    expect(await store.adoptSelfId(DETECTED, 4)).toBe(false);
  });
});

describe('remapSelfIds', () => {
  it('rewrites alias ids in every event kind and leaves others alone', () => {
    const out = remapSelfIds(
      [
        {
          kind: 'profile',
          user: obs(PK, 'fake_me'),
          mutuals: { users: [obs(PK, 'fake_me')], usernames: [] },
        },
        { kind: 'friendship', userId: PK, friendship: {} },
        {
          kind: 'list_page',
          ownerId: PK,
          direction: 'following',
          rows: [obs(PK, 'fake_me'), obs('2', 'fake_alex')],
          isFirstPage: true,
          isLastPage: true,
          filtered: false,
        },
      ],
      new Set([PK]),
      DETECTED,
    );
    expect(JSON.stringify(out)).not.toContain(PK);
    expect(JSON.stringify(out)).toContain('"2"');
  });
});

describe('own profile under a different id, end to end', () => {
  it('heals a split graph when you open your profile, and keeps later captures together', async () => {
    const db = freshDb();
    const c = new CaptureCoordinator(db);
    await c.handle(viewerMsg(1), IG_TAB);
    // Your following list and a list containing you, both keyed by your real profile id.
    await c.handle(respond(P.followingPage1, 2), IG_TAB);
    await c.handle(respond(P.followersOfAlex, 3), IG_TAB);
    expect(await state(db, 'fake_me')).not.toBe('self'); // the bug: you look like someone else
    expect(await state(db, 'fake_alex')).not.toBe('first');

    // The "Edit profile" link names you.
    await c.handle(viewerMsg(4, { username: 'fake_me', strategy: 'own-profile-page' }), IG_TAB);
    expect(await state(db, 'fake_me')).toBe('self');
    expect(await state(db, 'fake_alex')).toBe('first');
    expect(await state(db, 'fake_jamie')).toBe('first');

    // Later captures under the old id land on you directly.
    await c.handle(respond(P.followingPage2, 5), IG_TAB);
    expect(await state(db, 'fake.casey')).toBe('first');
    expect(await new ViewerStore(db, DETECTED).getNode(PK)).toBeUndefined();

    expect(await db.diagnostics.get('viewer_alias')).toMatchObject({ ok: 1 });
    // The own-profile signal doesn't overwrite which config pattern found the id.
    expect((await db.diagnostics.get('viewer'))?.detail).toBe('current-user-initial-data');
  });

  it('merges when your profile response arrives after your @username is already known', async () => {
    const db = freshDb();
    const c = new CaptureCoordinator(db);
    await c.handle(viewerMsg(1, { username: 'fake_me', strategy: 'shared-data-viewer' }), IG_TAB);
    await c.handle(respond(P.followingPage1, 2), IG_TAB);
    await c.handle(respond(P.followersOfAlex, 3), IG_TAB); // you appear as a row, by id
    expect(await state(db, 'fake_alex')).not.toBe('first');

    // Your own profile's data, under your real id.
    const me = {
      url: `${P.IG}/api/v1/users/${PK}/info/`,
      body: { user: { pk: PK, username: 'fake_me', full_name: 'Fake Me' }, status: 'ok' },
    };
    await c.handle(respond(me, 4), IG_TAB);
    expect(await state(db, 'fake_me')).toBe('self');
    expect(await state(db, 'fake_alex')).toBe('first');
  });
});
