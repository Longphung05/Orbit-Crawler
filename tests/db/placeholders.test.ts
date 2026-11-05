import { describe, expect, it } from 'vitest';
import { placeholderId } from '../../src/db';
import { obs, store } from './helpers';

describe('export placeholders (§6.1)', () => {
  it('resolveUsernames creates placeholders, reusing known real holders', async () => {
    const s = store();
    await s.upsertNodes([obs('42', 'fake_alex')], 1);
    const ids = await s.resolveUsernames(['fake_alex', 'Fake_Jamie', 'fake_jamie'], 10);
    expect(ids.get('fake_alex')).toBe('42');
    expect(ids.get('fake_jamie')).toBe('username:fake_jamie');
    expect(await s.getNode('username:fake_jamie')).toMatchObject({
      isPlaceholder: true,
      usernameSeenAt: 10,
      followingCoverage: 'none',
    });
    expect(await s.counts()).toEqual({ nodes: 2, edges: 0 });
  });

  it('re-importing bumps the placeholder export time instead of duplicating', async () => {
    const s = store();
    await s.resolveUsernames(['fake_jamie'], 10);
    await s.resolveUsernames(['fake_jamie'], 20);
    expect((await s.getNode('username:fake_jamie'))?.usernameSeenAt).toBe(20);
    expect((await s.counts()).nodes).toBe(1);
  });

  it('merges into the real node on first id sighting and repoints edges', async () => {
    const s = store();
    const v = s.viewerId;
    const ph = placeholderId('fake_jamie');
    await s.resolveUsernames(['fake_jamie'], 10);
    await s.upsertEdges(
      [
        { from: v, to: ph, source: 'export' },
        { from: ph, to: v, source: 'export' },
      ],
      10,
    );
    await s.upsertNodes([obs('55', 'fake_jamie', { followerCount: 300 })], 20);

    expect(await s.getNode(ph)).toBeUndefined();
    expect(await s.getNode('55')).toMatchObject({ followerCount: 300, firstSeenAt: 10 });
    expect(await s.getEdge(v, '55')).toMatchObject({ source: 'export', lastConfirmedAt: 10 });
    expect(await s.getEdge('55', v)).toBeDefined();
    expect(await s.counts()).toEqual({ nodes: 1, edges: 2 });
  });

  it('merging dedupes edges that already exist on the real node', async () => {
    const s = store();
    const v = s.viewerId;
    const ph = placeholderId('fake_jamie');
    await s.resolveUsernames(['fake_jamie'], 10);
    await s.upsertEdges([{ from: v, to: ph, source: 'export' }], 10);
    // Same relationship seen by id via a different path before the merge.
    await s.upsertEdges([{ from: v, to: '55', source: 'following_list' }], 30);
    await s.upsertNodes([obs('55', 'fake_jamie')], 40);
    expect(await s.getEdge(v, '55')).toMatchObject({
      firstSeenAt: 10,
      lastConfirmedAt: 30,
      source: 'following_list',
    });
    expect((await s.counts()).edges).toBe(1);
  });

  it('drops edges that would become self-loops after merging', async () => {
    const s = store();
    const ph = placeholderId('fake_jamie');
    await s.resolveUsernames(['fake_jamie'], 10);
    await s.upsertEdges([{ from: '55', to: ph, source: 'followers_list' }], 10);
    await s.upsertNodes([obs('55', 'fake_jamie')], 20);
    expect((await s.counts()).edges).toBe(0);
  });

  it('a rename into an exported name merges only if the export could be about this id', async () => {
    const s = store();
    await s.upsertNodes([obs('55', 'fake_before')], 5); // seen as fake_before at t=5
    await s.resolveUsernames(['fake_after'], 10); // export at t=10 says fake_after
    await s.upsertNodes([obs('55', 'fake_after')], 20); // 55 renamed sometime after t=5
    expect(await s.getNode('username:fake_after')).toBeUndefined();
    expect((await s.getNode('55'))?.usernameHistory).toEqual(['fake_before']);
  });

  it('username reassignment collision: does not merge an export name that belonged to someone else', async () => {
    const s = store();
    await s.resolveUsernames(['fake_taken'], 10); // export at t=10: fake_taken = someone
    await s.upsertNodes([obs('55', 'fake_original')], 15); // 55 still had another name at t=15
    await s.upsertNodes([obs('55', 'fake_taken')], 20); // 55 claimed the name later
    expect(await s.getNode('username:fake_taken')).toMatchObject({ isPlaceholder: true });
    expect((await s.findByUsername('fake_taken'))?.id).toBe('55'); // current holder wins lookups
  });

  it('rejects invalid usernames', async () => {
    const s = store();
    await expect(s.resolveUsernames(['not valid!'], 1)).rejects.toThrow();
  });
});
