import Dexie, { type Table } from 'dexie';
import type { OrbitSettings } from '../shared/settings';
import { PLACEHOLDER_PREFIX, type Edge, type UserNode, type ViewerMeta } from '../shared/types';

export type SettingsRecord = { viewerId: string } & Partial<OrbitSettings>;

/** Node shape as written by schema v1 (Phase 1 skeleton). Used only by the v2 upgrade. */
interface NodeV1 {
  viewerId: string;
  id: string;
  username: string;
  usernameHistory?: string[];
  lastSeenAt?: number;
  followingCoverage?: UserNode['followingCoverage'];
  followersCoverage?: UserNode['followersCoverage'];
}

export const SCHEMA_VERSION = 3;

/**
 * Schema history. Never edit a shipped version: add a new one with an upgrade().
 * Every primary key is compound [viewerId+…] so accounts never mix (§5.3).
 */
export const SCHEMA_V1 = {
  nodes: '[viewerId+id], viewerId, [viewerId+username]',
  edges: '[viewerId+id], viewerId, [viewerId+from], [viewerId+to]',
  viewers: 'viewerId',
} as const;

export const SCHEMA_V2 = {
  nodes: '[viewerId+id], viewerId, [viewerId+usernameKey], *historyKeys',
  settings: 'viewerId',
} as const;

/** v3: adapter health / diagnostics (global, not per viewer: it describes Instagram, not you). */
export const SCHEMA_V3 = {
  diagnostics: 'key',
} as const;

/**
 * Per payload type (or 'viewer', or 'unmatched:<endpoint>') capture health. Contains endpoint
 * templates and value-free shapes only, never user data.
 */
export interface DiagnosticRecord {
  key: string;
  adapterVersion: string;
  ok: number;
  failed: number;
  lastOkAt?: number;
  lastFailAt?: number;
  lastError?: string;
  endpoint?: string;
  /** Value-free structure of the last payload that failed validation. */
  lastShape?: unknown;
  /** For 'viewer': which detection strategy last matched. */
  detail?: string;
}

export function historyKey(viewerId: string, usernameKey: string): string {
  return `${viewerId}|${usernameKey}`;
}

export class OrbitDB extends Dexie {
  nodes!: Table<UserNode, [string, string]>;
  edges!: Table<Edge, [string, string]>;
  viewers!: Table<ViewerMeta, string>;
  settings!: Table<SettingsRecord, string>;
  diagnostics!: Table<DiagnosticRecord, string>;

  constructor(name = 'orbit') {
    super(name);
    this.version(1).stores(SCHEMA_V1);
    this.version(2)
      .stores(SCHEMA_V2)
      .upgrade(async (tx) => {
        await tx
          .table<NodeV1 & Partial<UserNode>, [string, string]>('nodes')
          .toCollection()
          .modify((n) => {
            const seen = n.lastSeenAt ?? 0;
            const history = n.usernameHistory ?? [];
            n.usernameKey = n.username.toLowerCase();
            n.usernameSeenAt = seen;
            n.usernameHistory = history;
            n.historyKeys = history.map((h) => historyKey(n.viewerId, h.toLowerCase()));
            n.firstSeenAt = seen;
            n.lastSeenAt = seen;
            n.followingCoverage ??= 'none';
            n.followersCoverage ??= 'none';
            if (n.id.startsWith(PLACEHOLDER_PREFIX)) n.isPlaceholder = true;
          });
      });
    this.version(3).stores(SCHEMA_V3);
  }
}

let instance: OrbitDB | undefined;
export function getDb(): OrbitDB {
  instance ??= new OrbitDB();
  return instance;
}
