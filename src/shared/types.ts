// Core data model (CLAUDE.md §5.3). Every record is partitioned by viewerId.

export type Coverage = 'none' | 'partial' | 'complete';

export type EdgeSource =
  'export' | 'following_list' | 'followers_list' | 'mutuals' | 'profile_flag';

/** Prefix for export-only nodes whose numeric id is not yet known (§6.1). */
export const PLACEHOLDER_PREFIX = 'username:';

/**
 * Keyed by Instagram's stable numeric user ID, or `username:<name>` for export-only placeholders.
 * NEVER keyed by username alone: usernames change.
 */
export interface UserNode {
  viewerId: string;
  id: string;
  /** Current username as last observed (display form). */
  username: string;
  /** Lower-cased username, indexed for lookups. */
  usernameKey: string;
  /** When `username` was last confirmed for this id. */
  usernameSeenAt: number;
  /** Set when another account was later seen holding this username (this one renamed). */
  usernameSupersededAt?: number;
  usernameHistory: string[];
  /** `${viewerId}|${key}` for each past username: multiEntry index for resolving old @mentions. */
  historyKeys: string[];
  fullName?: string;
  /** URL only. Images are never downloaded. */
  profilePicUrl?: string;
  isPrivate?: boolean;
  isVerified?: boolean;
  followerCount?: number;
  followingCount?: number;
  /** Deactivated, deleted, banned, or blocking the viewer. Edges are kept. */
  unavailable?: boolean;
  unavailableAt?: number;
  isPlaceholder?: boolean;
  firstSeenAt: number;
  lastSeenAt: number;
  followingCoverage: Coverage;
  followersCoverage: Coverage;
  followingCompleteAt?: number;
  followersCompleteAt?: number;
  /** Hub follower list hit the storage cap (§7.4): it can never be marked complete. */
  followersCapped?: boolean;
}

/** Directed: `from` follows `to`. */
export interface Edge {
  viewerId: string;
  /** `${from}->${to}` */
  id: string;
  from: string;
  to: string;
  /** Most recent source that confirmed this edge. */
  source: EdgeSource;
  firstSeenAt: number;
  lastConfirmedAt: number;
  /** Set when a complete list no longer contains this edge. */
  stale: boolean;
  staleAt?: number;
}

export interface ViewerMeta {
  viewerId: string;
  username: string;
  importedExportAt?: number;
  lastActiveAt?: number;
}
