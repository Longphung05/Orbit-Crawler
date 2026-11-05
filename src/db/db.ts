import Dexie, { type EntityTable } from 'dexie';
import type { Edge, UserNode, ViewerMeta } from '../shared/types';

/**
 * Phase 1 skeleton. The full DB layer (upserts, placeholder merging, stale marking,
 * migrations) is Phase 3. Primary keys are compound [viewerId+id] so accounts never mix.
 */
export class OrbitDB extends Dexie {
  nodes!: EntityTable<UserNode>;
  edges!: EntityTable<Edge>;
  viewers!: EntityTable<ViewerMeta, 'viewerId'>;

  constructor(name = 'orbit') {
    super(name);
    this.version(1).stores({
      nodes: '[viewerId+id], viewerId, [viewerId+username]',
      edges: '[viewerId+id], viewerId, [viewerId+from], [viewerId+to]',
      viewers: 'viewerId',
    });
  }
}

let instance: OrbitDB | undefined;
export function getDb(): OrbitDB {
  instance ??= new OrbitDB();
  return instance;
}
