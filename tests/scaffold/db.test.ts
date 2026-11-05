import { afterEach, describe, expect, it } from 'vitest';
import { OrbitDB } from '../../src/db/db';
import type { UserNode } from '../../src/shared/types';

describe('OrbitDB skeleton', () => {
  let db: OrbitDB | undefined;
  afterEach(async () => {
    await db?.delete();
  });

  it('opens with empty tables', async () => {
    db = new OrbitDB('orbit-test-empty');
    await db.open();
    expect(await db.nodes.count()).toBe(0);
    expect(await db.edges.count()).toBe(0);
  });

  it('partitions records by viewerId', async () => {
    db = new OrbitDB('orbit-test-partition');
    const base: Omit<UserNode, 'viewerId' | 'id'> = {
      username: 'fake_alex',
      usernameHistory: [],
      lastSeenAt: 0,
      followingCoverage: 'none',
      followersCoverage: 'none',
    };
    await db.nodes.bulkPut([
      { ...base, viewerId: 'v1', id: '42' },
      { ...base, viewerId: 'v2', id: '42' },
    ]);
    expect(await db.nodes.count()).toBe(2);
    expect(await db.nodes.where('viewerId').equals('v1').count()).toBe(1);
  });
});
