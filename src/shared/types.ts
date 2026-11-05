// Core data model (CLAUDE.md §5.3). Every record is partitioned by viewerId.

export type Coverage = 'none' | 'partial' | 'complete';

export type EdgeSource =
  'export' | 'following_list' | 'followers_list' | 'mutuals' | 'profile_flag';

/** Keyed by Instagram's stable numeric user ID, or `username:<name>` for export-only placeholders. */
export interface UserNode {
  viewerId: string;
  id: string;
  username: string;
  fullName?: string;
  /** URL only. Images are never downloaded. */
  profilePicUrl?: string;
  isPrivate?: boolean;
  isVerified?: boolean;
  followerCount?: number;
  followingCount?: number;
  usernameHistory: string[];
  lastSeenAt: number;
  followingCoverage: Coverage;
  followersCoverage: Coverage;
}

/** Directed: `from` follows `to`. */
export interface Edge {
  viewerId: string;
  /** `${from}->${to}` */
  id: string;
  from: string;
  to: string;
  source: EdgeSource;
  firstSeenAt: number;
  lastConfirmedAt: number;
  /** Set when a complete list no longer contains this edge. */
  stale: boolean;
}

export interface ViewerMeta {
  viewerId: string;
  username: string;
  importedExportAt?: number;
}
