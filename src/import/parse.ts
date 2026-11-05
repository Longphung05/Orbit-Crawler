// Official export parser (§6.1). Pure: takes already-read text files, returns usable lists plus a
// report of everything it recognised, ignored, or couldn't read. Never throws on bad input.
import type { z } from 'zod';
import { UsernameSchema } from '../db/validation';
import {
  FollowersFileSchema,
  FollowingFileSchema,
  LegacyConnectionsSchema,
  OTHER_RELATIONSHIP_KEYS,
  PersonalInfoSchema,
  RelationshipEntrySchema,
  type RelationshipEntry,
} from './schemas';

export interface ExportFile {
  /** Path inside the archive/folder, forward slashes. */
  path: string;
  text: string;
}

type OtherKind = keyof typeof OTHER_RELATIONSHIP_KEYS;
export type FileKind =
  | 'followers'
  | 'following'
  | OtherKind
  | 'legacy_connections'
  | 'personal_information'
  | 'html'
  | 'known_unused'
  | 'unknown';

export interface FileReport {
  path: string;
  kind: FileKind;
  /** parsed: used · ignored: recognised but not needed · unrecognized · failed: couldn't read */
  status: 'parsed' | 'ignored' | 'unrecognized' | 'failed';
  entries?: number;
  message?: string;
}

export interface ExportList {
  usernames: string[];
  /** False if a part was missing or unreadable: apply, but never infer unfollows from it. */
  complete: boolean;
}

export type ExportedAtSource = 'archive-name' | 'latest-entry' | 'import-time';

export interface ParsedExport {
  following?: ExportList;
  followers?: ExportList;
  pendingFollowRequests: string[];
  /** Username the export says it belongs to, if personal_information was included. */
  ownerUsername?: string;
  exportedAt: number;
  exportedAtSource: ExportedAtSource;
  files: FileReport[];
  warnings: string[];
  /** Fatal problems: nothing should be imported. */
  errors: string[];
}

export interface ParseOptions {
  /** Zip file or folder name, e.g. `instagram-someone-2026-11-01-AbCd.zip` (date hint). */
  sourceName?: string;
  now: number;
}

const MAX_TEXT_CHARS = 200 * 1024 * 1024;

const OTHER_FILES: Record<string, OtherKind> = {
  'pending_follow_requests.json': 'pending_follow_requests',
  'close_friends.json': 'close_friends',
  'blocked_profiles.json': 'blocked_profiles',
  'blocked_accounts.json': 'blocked_profiles',
  'recently_unfollowed_profiles.json': 'recently_unfollowed',
  'recently_unfollowed_accounts.json': 'recently_unfollowed',
  'restricted_profiles.json': 'restricted_profiles',
  'restricted_accounts.json': 'restricted_profiles',
  'removed_suggestions.json': 'removed_suggestions',
  "follow_requests_you've_received.json": 'follow_requests_received',
  'hide_story_from.json': 'hide_story_from',
};

/** Seen in real exports; not relationship data Orbit needs, so not even parsed. */
const KNOWN_UNUSED = new Set([
  'following_hashtags.json',
  "profiles_you've_favorited.json",
  'recent_follow_requests.json',
  'custom_lists.json',
]);

function basename(path: string): string {
  return (path.split('/').pop() ?? path).toLowerCase();
}

export function classify(path: string): { kind: FileKind; part?: number } {
  const name = basename(path);
  const list = /^(followers|following)(?:_(\d+))?\.(json|html)$/.exec(name);
  if (list) {
    if (list[3] === 'html') return { kind: 'html' };
    const kind = list[1] === 'followers' ? 'followers' : 'following';
    return { kind, part: list[2] ? Number(list[2]) : 1 };
  }
  const other = OTHER_FILES[name];
  if (other) return { kind: other };
  if (KNOWN_UNUSED.has(name)) return { kind: 'known_unused' };
  if (name === 'connections.json') return { kind: 'legacy_connections' };
  if (name === 'personal_information.json') return { kind: 'personal_information' };
  return { kind: 'unknown' };
}

/** Which archive entries are worth decompressing (media and everything else are skipped). */
export function isRelevantPath(path: string): boolean {
  const p = path.replace(/\\/g, '/').toLowerCase();
  if (p.endsWith('/')) return false;
  return (
    classify(p).kind !== 'unknown' ||
    (p.includes('followers_and_following/') && p.endsWith('.json'))
  );
}

function validUsername(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().replace(/^@/, '');
  return UsernameSchema.safeParse(trimmed).success ? trimmed : undefined;
}

function usernameFromHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const segments = new URL(href).pathname.split('/').filter(Boolean);
    const last = segments[0] === '_u' ? segments[1] : segments[0];
    return validUsername(last);
  } catch {
    return undefined;
  }
}

interface ExtractedEntries {
  usernames: string[];
  invalid: number;
  latestMs?: number;
}

/** Username is in `value` (older), `title` (newer following.json), or only the href. */
function extract(entries: readonly RelationshipEntry[]): ExtractedEntries {
  const usernames: string[] = [];
  let invalid = 0;
  let latestMs: number | undefined;
  for (const entry of entries) {
    const items = entry.string_list_data ?? [];
    let name: string | undefined;
    for (const item of items) {
      name ??= validUsername(item.value);
      if (typeof item.timestamp === 'number' && item.timestamp > 0) {
        const ms = item.timestamp < 1e12 ? item.timestamp * 1000 : item.timestamp;
        latestMs = Math.max(latestMs ?? 0, ms);
      }
    }
    name ??= validUsername(entry.title);
    for (const item of items) name ??= usernameFromHref(item.href);
    if (name) usernames.push(name);
    else invalid++;
  }
  return latestMs === undefined ? { usernames, invalid } : { usernames, invalid, latestMs };
}

function dedupe(usernames: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const u of usernames) if (!seen.has(u.toLowerCase())) seen.set(u.toLowerCase(), u);
  return [...seen.values()];
}

function zodSummary(err: z.ZodError): string {
  const issue = err.issues[0];
  return issue ? `${issue.path.join('.') || '(root)'}: ${issue.message}` : 'unexpected shape';
}

/** `…-2026-11-01-…` in the archive/folder name → UTC start of that day (a safe lower bound). */
export function dateFromName(name: string | undefined, now: number): number | undefined {
  const m = name ? /(20\d{2})-(\d{2})-(\d{2})/.exec(name) : null;
  if (!m) return undefined;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const plausible = t >= Date.UTC(2010, 0, 1) && t <= now + 86_400_000;
  return Number.isNaN(t) || !plausible ? undefined : t;
}

function relationshipArray(json: unknown, preferredKey: string): unknown {
  if (Array.isArray(json) || json === null || typeof json !== 'object') return json;
  const obj = json as Record<string, unknown>;
  if (preferredKey in obj) return obj[preferredKey];
  const arrays = Object.entries(obj).filter(
    ([k, v]) => k.startsWith('relationships_') && Array.isArray(v),
  );
  return arrays.length === 1 ? arrays[0]?.[1] : json;
}

interface ListAccumulator {
  parts: Map<number, string[]>;
  failedParts: number;
}

export function parseExport(files: readonly ExportFile[], opts: ParseOptions): ParsedExport {
  const reports: FileReport[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const lists: Record<'followers' | 'following', ListAccumulator> = {
    followers: { parts: new Map(), failedParts: 0 },
    following: { parts: new Map(), failedParts: 0 },
  };
  let legacy: { followers?: string[]; following?: string[] } | undefined;
  let pending: string[] = [];
  let ownerUsername: string | undefined;
  let latestEntryMs: number | undefined;
  let invalidEntries = 0;
  let sawHtml = false;

  for (const file of files) {
    const path = file.path.replace(/\\/g, '/');
    const { kind, part } = classify(path);
    const report = (r: Omit<FileReport, 'path' | 'kind'>): void => {
      reports.push({ path, kind, ...r });
    };

    if (kind === 'html') {
      sawHtml = true;
      report({ status: 'unrecognized', message: 'HTML format: request the export in JSON format' });
      continue;
    }
    if (kind === 'unknown') {
      report({ status: 'unrecognized', message: 'not a file Orbit knows; skipped' });
      continue;
    }
    if (kind === 'known_unused') {
      report({ status: 'ignored', message: 'not used by Orbit' });
      continue;
    }
    if (file.text.length > MAX_TEXT_CHARS) {
      report({ status: 'failed', message: 'file too large' });
      if (kind === 'followers' || kind === 'following') lists[kind].failedParts++;
      continue;
    }

    let json: unknown;
    try {
      json = JSON.parse(file.text);
    } catch {
      report({ status: 'failed', message: 'not valid JSON' });
      if (kind === 'followers' || kind === 'following') lists[kind].failedParts++;
      continue;
    }

    if (kind === 'followers' || kind === 'following') {
      const schema = kind === 'followers' ? FollowersFileSchema : FollowingFileSchema;
      const res = schema.safeParse(json);
      if (!res.success) {
        report({ status: 'failed', message: `unexpected shape (${zodSummary(res.error)})` });
        lists[kind].failedParts++;
        continue;
      }
      const data = res.data;
      const entries = Array.isArray(data)
        ? data
        : 'relationships_followers' in data
          ? data.relationships_followers
          : data.relationships_following;
      const ex = extract(entries as RelationshipEntry[]);
      invalidEntries += ex.invalid;
      if (ex.latestMs !== undefined) latestEntryMs = Math.max(latestEntryMs ?? 0, ex.latestMs);
      const acc = lists[kind];
      acc.parts.set(part ?? 1, [...(acc.parts.get(part ?? 1) ?? []), ...ex.usernames]);
      report({ status: 'parsed', entries: ex.usernames.length });
      continue;
    }

    if (kind === 'legacy_connections') {
      const res = LegacyConnectionsSchema.safeParse(json);
      if (!res.success) {
        report({ status: 'failed', message: `unexpected shape (${zodSummary(res.error)})` });
        continue;
      }
      const pick = (rec: Record<string, unknown> | undefined): string[] | undefined => {
        if (!rec) return undefined;
        const names = Object.keys(rec).map(validUsername);
        invalidEntries += names.filter((n) => !n).length;
        return names.filter((n): n is string => n !== undefined);
      };
      legacy = {};
      const lf = pick(res.data.followers);
      const lg = pick(res.data.following);
      if (lf) legacy.followers = lf;
      if (lg) legacy.following = lg;
      report({ status: 'parsed', entries: (lf?.length ?? 0) + (lg?.length ?? 0) });
      continue;
    }

    if (kind === 'personal_information') {
      const res = PersonalInfoSchema.safeParse(json);
      const map = res.success ? res.data.profile_user[0]?.string_map_data : undefined;
      const key = map && Object.keys(map).find((k) => /^user\s*name$/i.test(k.trim()));
      const name = key ? validUsername(map[key]?.value) : undefined;
      if (name) {
        ownerUsername = name;
        report({ status: 'parsed', message: 'account owner identified' });
      } else {
        report({ status: 'ignored', message: 'could not find the account username' });
      }
      continue;
    }

    // Other known relationship files. The wrapper key varies between export versions, so take
    // the expected key, else any single `relationships_*` array, else a bare array.
    const res = RelationshipEntrySchema.array().safeParse(
      relationshipArray(json, OTHER_RELATIONSHIP_KEYS[kind]),
    );
    if (!res.success) {
      if (kind === 'pending_follow_requests') {
        report({ status: 'failed', message: `unexpected shape (${zodSummary(res.error)})` });
        warnings.push(
          "Couldn't read pending follow requests; any that are pending may be counted as follows.",
        );
      } else {
        // Not used by Orbit: an unexpected shape here is harmless, so don't alarm anyone.
        report({ status: 'ignored', message: 'not used by Orbit' });
      }
      continue;
    }
    const ex = extract(res.data);
    if (kind === 'pending_follow_requests') {
      pending = ex.usernames;
      report({ status: 'parsed', entries: ex.usernames.length });
    } else {
      report({ status: 'ignored', entries: ex.usernames.length, message: 'not used by Orbit' });
    }
  }

  // Assemble lists; detect missing parts (followers_1, followers_3 but no followers_2).
  const assemble = (kind: 'followers' | 'following'): ExportList | undefined => {
    const acc = lists[kind];
    const legacyList = legacy?.[kind];
    if (acc.parts.size === 0) {
      if (legacyList) return { usernames: dedupe(legacyList), complete: true };
      if (acc.failedParts > 0) {
        warnings.push(`Couldn't read your ${kind} list, so it was skipped.`);
      }
      return undefined;
    }
    const nums = [...acc.parts.keys()].sort((a, b) => a - b);
    const max = nums[nums.length - 1] ?? 1;
    const gaps = max - nums.length;
    let complete = acc.failedParts === 0;
    if (gaps > 0) {
      complete = false;
      warnings.push(
        `Your ${kind} list is missing ${gaps} part file(s); it was imported as partial.`,
      );
    } else if (!complete) {
      warnings.push(`Part of your ${kind} list couldn't be read; it was imported as partial.`);
    }
    const usernames = dedupe(nums.flatMap((n) => acc.parts.get(n) ?? []));
    return { usernames, complete };
  };
  const followers = assemble('followers');
  let following = assemble('following');

  // §9: a pending follow request is not a follow.
  if (following && pending.length > 0) {
    const pendingKeys = new Set(pending.map((p) => p.toLowerCase()));
    const kept = following.usernames.filter((u) => !pendingKeys.has(u.toLowerCase()));
    if (kept.length !== following.usernames.length) {
      warnings.push(
        `${following.usernames.length - kept.length} pending follow request(s) were excluded from following.`,
      );
      following = { ...following, usernames: kept };
    }
  }

  if (invalidEntries > 0) {
    warnings.push(
      invalidEntries === 1
        ? '1 entry had no readable username and was skipped.'
        : `${invalidEntries} entries had no readable username and were skipped.`,
    );
  }

  if (!followers && !following) {
    errors.push(
      sawHtml
        ? 'This export is in HTML format. Request it again from Instagram and choose JSON.'
        : 'No followers or following files were found. When requesting the export, include "Followers and following" and choose JSON.',
    );
  }

  // Export time: the latest safe lower bound. Over-estimating would wrongly stale recent follows.
  const fromName = dateFromName(opts.sourceName, opts.now);
  let exportedAt: number;
  let exportedAtSource: ExportedAtSource;
  if (fromName === undefined && latestEntryMs === undefined) {
    exportedAt = opts.now;
    exportedAtSource = 'import-time';
    warnings.push(
      "Couldn't tell when this export was made; using now. Follows you made after requesting it may briefly look stale.",
    );
  } else if (latestEntryMs !== undefined && (fromName === undefined || latestEntryMs > fromName)) {
    exportedAt = Math.min(latestEntryMs, opts.now);
    exportedAtSource = 'latest-entry';
  } else {
    exportedAt = fromName as number;
    exportedAtSource = 'archive-name';
  }

  const result: ParsedExport = {
    pendingFollowRequests: pending,
    exportedAt,
    exportedAtSource,
    files: reports,
    warnings,
    errors,
  };
  if (following) result.following = following;
  if (followers) result.followers = followers;
  if (ownerUsername) result.ownerUsername = ownerUsername;
  return result;
}
