import { describe, expect, it } from 'vitest';
import { obs, store } from './helpers';

describe('upsertNodes', () => {
  it('creates nodes and keeps the latest attributes, leaving unspecified ones alone', async () => {
    const s = store();
    await s.upsertNodes([obs('42', 'fake_alex', { followerCount: 10, isPrivate: true })], 100);
    await s.upsertNodes([obs('42', 'fake_alex', { followerCount: 25 })], 200);
    expect(await s.getNode('42')).toMatchObject({
      followerCount: 25,
      isPrivate: true,
      firstSeenAt: 100,
      lastSeenAt: 200,
      usernameSeenAt: 200,
    });
  });

  it('ignores attributes from an older, late-arriving observation', async () => {
    const s = store();
    await s.upsertNodes([obs('42', 'fake_alex', { followerCount: 25 })], 200);
    await s.upsertNodes([obs('42', 'fake_alex', { followerCount: 10 })], 100);
    expect(await s.getNode('42')).toMatchObject({ followerCount: 25, lastSeenAt: 200 });
  });

  it('public ↔ private changes update the flag and keep edges (§9 Privacy)', async () => {
    const s = store();
    await s.upsertNodes([obs('42', 'fake_alex', { isPrivate: false })], 1);
    await s.upsertEdges([{ from: '42', to: '43', source: 'following_list' }], 1);
    await s.upsertNodes([obs('42', 'fake_alex', { isPrivate: true })], 2);
    expect((await s.getNode('42'))?.isPrivate).toBe(true);
    expect(await s.getEdge('42', '43')).toMatchObject({ stale: false, lastConfirmedAt: 1 });
  });

  it('validates input with zod and writes nothing from a bad batch', async () => {
    const s = store();
    await expect(s.upsertNodes([obs('42', 'ok_name'), obs('abc', 'fake')], 1)).rejects.toThrow();
    await expect(s.upsertNodes([obs('username:fake', 'fake')], 1)).rejects.toThrow();
    await expect(s.upsertNodes([obs('42', 'has space')], 1)).rejects.toThrow();
    await expect(
      s.upsertNodes([obs('42', 'fake', { profilePicUrl: 'javascript:alert(1)' })], 1),
    ).rejects.toThrow();
    await expect(s.upsertNodes([obs('42', 'fake')], -5)).rejects.toThrow();
    expect(await s.counts()).toEqual({ nodes: 0, edges: 0 });
  });
});

describe('username changes (§9 Identity)', () => {
  it('a rename keeps the id, records history, and resolves old @mentions', async () => {
    const s = store();
    await s.upsertNodes([obs('42', 'fake_alex')], 1);
    await s.upsertNodes([obs('42', 'fake_alexander')], 2);
    expect(await s.getNode('42')).toMatchObject({
      username: 'fake_alexander',
      usernameHistory: ['fake_alex'],
    });
    expect((await s.findByUsername('fake_alexander'))?.id).toBe('42');
    expect((await s.findByUsername('fake_alex'))?.id).toBe('42');
  });

  it('an older observation with a former name goes to history without reverting', async () => {
    const s = store();
    await s.upsertNodes([obs('42', 'fake_new')], 10);
    await s.upsertNodes([obs('42', 'fake_old')], 5);
    expect(await s.getNode('42')).toMatchObject({
      username: 'fake_new',
      usernameHistory: ['fake_old'],
    });
  });

  it('history has no duplicates when renaming back and forth', async () => {
    const s = store();
    await s.upsertNodes([obs('42', 'fake_a')], 1);
    await s.upsertNodes([obs('42', 'fake_b')], 2);
    await s.upsertNodes([obs('42', 'fake_a')], 3);
    await s.upsertNodes([obs('42', 'fake_b')], 4);
    expect(await s.getNode('42')).toMatchObject({
      username: 'fake_b',
      usernameHistory: ['fake_a'],
    });
  });

  it('a username reassigned to a new account supersedes the old holder', async () => {
    const s = store();
    await s.upsertNodes([obs('42', 'fake_alex')], 1);
    await s.upsertNodes([obs('77', 'fake_alex')], 5);
    expect((await s.getNode('42'))?.usernameSupersededAt).toBe(5);
    expect((await s.findByUsername('fake_alex'))?.id).toBe('77');
    // When 42 shows up under its new name, the supersede flag clears.
    await s.upsertNodes([obs('42', 'fake_alex_v2')], 6);
    expect((await s.getNode('42'))?.usernameSupersededAt).toBeUndefined();
  });

  it('usernames are matched case-insensitively', async () => {
    const s = store();
    await s.upsertNodes([obs('42', 'Fake_Alex')], 1);
    expect((await s.findByUsername('fake_alex'))?.id).toBe('42');
  });
});

describe('unavailable accounts', () => {
  it('markUnavailable keeps edges; seeing the profile again clears it', async () => {
    const s = store();
    await s.upsertNodes([obs('42', 'fake_alex')], 1);
    await s.upsertEdges([{ from: s.viewerId, to: '42', source: 'following_list' }], 1);
    await s.markUnavailable('42', 5);
    expect(await s.getNode('42')).toMatchObject({ unavailable: true, unavailableAt: 5 });
    expect(await s.getEdge(s.viewerId, '42')).toBeDefined();
    await s.upsertNodes([obs('42', 'fake_alex')], 9);
    expect((await s.getNode('42'))?.unavailable).toBeUndefined();
  });

  it('markUnavailable on an unknown id is a no-op', async () => {
    const s = store();
    await s.markUnavailable('999', 1);
    expect(await s.counts()).toEqual({ nodes: 0, edges: 0 });
  });
});
