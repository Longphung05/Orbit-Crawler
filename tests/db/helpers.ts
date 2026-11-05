import { afterEach } from 'vitest';
import { OrbitDB, ViewerStore, type NodeObservation } from '../../src/db';

let counter = 0;
const open: OrbitDB[] = [];

/** Fresh, isolated in-memory DB per test (fake-indexeddb). */
export function freshDb(): OrbitDB {
  const db = new OrbitDB(`orbit-test-${Date.now()}-${counter++}`);
  open.push(db);
  return db;
}

export function store(viewerId = '1000', db = freshDb()): ViewerStore {
  return new ViewerStore(db, viewerId);
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((db) => db.delete()));
});

/** Invented accounts only. */
export function obs(
  id: string,
  username: string,
  extra: Partial<NodeObservation> = {},
): NodeObservation {
  return { id, username, ...extra };
}
