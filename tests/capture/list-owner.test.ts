// A list payload names its owner only by numeric id. The page you had open names them by
// username, which ties the list to accounts Orbit knows only by name (exports, "Followed by").
import { describe, expect, it } from 'vitest';
import { CaptureCoordinator } from '../../src/capture';
import { ViewerStore } from '../../src/db';
import { QueryService } from '../../src/query';
import * as P from '../fixtures/instagram/payloads';
import { freshDb, obs } from '../db/helpers';

const V = P.VIEWER;
const VHG = '5000000001';
const TAB = { tabId: 4, url: 'https://www.instagram.com/', fromSelf: true };

const user = (pk: string, username: string) => ({ pk, id: pk, username, full_name: '' });
const list = (
  owner: string,
  kind: string,
  users: ReturnType<typeof user>[],
  at: number,
  pagePath?: string,
) => ({
  type: 'orbit/response',
  ...P.response({
    url: `${P.IG}/api/v1/friendships/${owner}/${kind}/?count=12`,
    body: { users, status: 'ok' },
  }),
  at,
  viewerId: V,
  ...(pagePath ? { pagePath } : {}),
});

async function setup() {
  const db = freshDb();
  const c = new CaptureCoordinator(db);
  await c.handle({ type: 'orbit/viewer', viewerId: V, strategy: 'x', at: 1 }, TAB);
  const store = new ViewerStore(db, V);
  // Your export: you follow fake_bao and fake_dt. fake_bao's shared export: they follow fake_vhg.
  await store.applyExportSnapshot(
    // fake_zed: someone you follow whose relationship to others Orbit doesn't know.
    { following: ['fake_bao', 'fake_dt', 'fake_zed'], followers: [], exportedAt: 2 },
    2,
  );
  await store.applyExportSnapshot(
    { following: ['fake_vhg'], exportedAt: 2, ownerUsername: 'fake_bao' },
    2,
  );
  return { db, c, store };
}

const profile = async (db: ReturnType<typeof freshDb>, name: string) => {
  const v = await new QueryService(db).profile(V, name);
  if (v.status !== 'ok') throw new Error('expected ok');
  return v;
};

describe('naming a list owner from the page', () => {
  it('connects a following list to the account known only by username', async () => {
    const { db, c } = await setup();
    // fake_dt follows fake_apple (so apple is 2nd). You open fake_vhg's following list.
    await new ViewerStore(db, V).applyExportSnapshot(
      { following: ['fake_apple'], exportedAt: 2, ownerUsername: 'fake_dt' },
      2,
    );
    await c.handle(
      list(VHG, 'following', [user('6000000001', 'fake_apple')], 3, '/fake_vhg/following/'),
      TAB,
    );

    expect(await db.nodes.get([V, 'username:fake_vhg'])).toBeUndefined(); // merged into the id
    expect((await db.nodes.get([V, VHG]))?.username).toBe('fake_vhg');
    expect(await profile(db, 'fake_apple')).toMatchObject({
      state: 'second',
      furtherConnectorCount: 1, // you → fake_bao → fake_vhg → fake_apple
    });
    const paths = await new QueryService(db).paths(V, 'fake_apple');
    expect(paths.status === 'ok' && paths.further.groups.map((g) => g.connector.username)).toEqual([
      'fake_bao',
    ]);
    const log = (await db.activity.toArray()).map((r) => r.text);
    expect(log.some((t) => t.startsWith("Read 1 rows of @fake_vhg's following list"))).toBe(true);
  });

  it('a "Followed by" list scrolled to the end updates the count and makes it exact', async () => {
    const { db, c } = await setup();
    // The profile header named two of the people you follow ("Followed by fake_bao, fake_dt + 3").
    await c.handle(
      {
        type: 'orbit/dom-mutuals',
        profile: 'fake_vhg',
        usernames: ['fake_bao', 'fake_dt'],
        others: 3,
        viewerId: V,
        at: 3,
      },
      TAB,
    );
    expect(await profile(db, 'fake_vhg')).toMatchObject({
      connectorCount: 2,
      connectorsExact: false, // does fake_zed follow them? Unknown.
    });

    const all = [
      user('7000000001', 'fake_bao'),
      user('7000000002', 'fake_dt'),
      user('7000000003', 'fake_c'),
      user('7000000004', 'fake_d'),
      user('7000000005', 'fake_e'),
    ];
    await c.handle(list(VHG, 'mutual_followers', all, 4, '/fake_vhg/followers/mutualOnly/'), TAB);
    expect(await profile(db, 'fake_vhg')).toMatchObject({
      connectorCount: 5,
      connectorsExact: true,
    });
  });

  it('never renames an account, or steals a name another id holds', async () => {
    const { db, c, store } = await setup();
    await store.upsertNodes([obs('8000000001', 'fake_vhg')], 3); // fake_vhg is a different id
    await c.handle(
      list(VHG, 'following', [user('6000000001', 'fake_apple')], 4, '/fake_vhg/following/'),
      TAB,
    );
    expect(await db.nodes.get([V, VHG])).toBeUndefined();

    await store.upsertNodes([obs('8000000002', 'fake_known')], 5);
    await c.handle(
      list('8000000002', 'following', [user('6000000002', 'fake_x')], 6, '/fake_other/following/'),
      TAB,
    );
    expect((await db.nodes.get([V, '8000000002']))?.username).toBe('fake_known');
  });

  it('does nothing without a profile page path', async () => {
    const { db, c } = await setup();
    await c.handle(list(VHG, 'following', [user('6000000001', 'fake_apple')], 3), TAB);
    await c.handle(list(VHG, 'following', [user('6000000001', 'fake_apple')], 4, '/explore/'), TAB);
    expect(await db.nodes.get([V, VHG])).toBeUndefined();
    expect(await db.nodes.get([V, 'username:fake_vhg'])).toBeDefined();
  });
});
