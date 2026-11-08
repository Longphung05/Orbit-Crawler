// Turn a parsed export into DB writes for one viewer.
import type { ExportSnapshotInput, ExportSnapshotResult, ViewerStore } from '../db';
import type { ParsedExport } from './parse';

export type OwnerCheck = 'match' | 'mismatch' | 'unknown';

/** Guard against importing someone else's export into your graph. */
export function checkOwner(parsed: ParsedExport, viewerUsername: string | undefined): OwnerCheck {
  if (!parsed.ownerUsername || !viewerUsername) return 'unknown';
  return parsed.ownerUsername.toLowerCase() === viewerUsername.toLowerCase() ? 'match' : 'mismatch';
}

export function toSnapshot(parsed: ParsedExport, friendUsername?: string): ExportSnapshotInput {
  const input: ExportSnapshotInput = { exportedAt: parsed.exportedAt };
  if (friendUsername) input.ownerUsername = friendUsername;
  const partial: ('following' | 'followers')[] = [];
  if (parsed.following) {
    input.following = parsed.following.usernames;
    if (!parsed.following.complete) partial.push('following');
  }
  if (parsed.followers) {
    input.followers = parsed.followers.usernames;
    if (!parsed.followers.complete) partial.push('followers');
  }
  if (partial.length > 0) input.partial = partial;
  return input;
}

export async function commitImport(
  store: ViewerStore,
  parsed: ParsedExport,
  now: number,
  /** Set when importing a friend's export (shared with their consent) instead of your own. */
  friendUsername?: string,
): Promise<ExportSnapshotResult> {
  if (parsed.errors.length > 0) throw new Error(parsed.errors.join(' '));
  return store.applyExportSnapshot(toSnapshot(parsed, friendUsername), now);
}
