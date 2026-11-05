// Every Instagram URL pattern Orbit knows (§6.2, §12). URLs are hints, not truth: payloads are
// still validated by shape, and anything that doesn't match is reported, never trusted.

/** Pages where Orbit's content scripts run. */
export const CONTENT_MATCHES = ['https://www.instagram.com/*'];

const HOSTS = new Set(['www.instagram.com', 'instagram.com', 'i.instagram.com']);

export type PayloadType =
  'friendship_list' | 'web_profile_info' | 'user_info' | 'friendship_status' | 'graphql_profile';

export type ListKind = 'following' | 'followers' | 'mutuals';

export type UrlMatch =
  | {
      type: 'friendship_list';
      ownerId: string;
      direction: ListKind;
      /** No max_id → the first page of a fresh scroll session. */
      isFirstPage: boolean;
      /** A search inside the list: results are true but never the whole list. */
      filtered: boolean;
    }
  | { type: 'web_profile_info'; username: string | undefined }
  | { type: 'user_info'; userId: string }
  | { type: 'friendship_status'; userId: string }
  | { type: 'graphql_profile' };

const LIST_RE = /^\/api\/v1\/friendships\/(\d+)\/(following|followers|mutual_followers)\/?$/;
const WEB_PROFILE_RE = /^\/api\/v1\/users\/web_profile_info\/?$/;
const USER_INFO_RE = /^\/api\/v1\/users\/(\d+)\/info\/?$/;
const FRIENDSHIP_SHOW_RE = /^\/api\/v1\/friendships\/show\/(\d+)\/?$/;
const GRAPHQL_RE = /^\/(?:api\/)?graphql(?:\/query)?\/?$/;

/** GraphQL carries everything; only forward bodies that look like a profile (cheap text test). */
export const GRAPHQL_PROFILE_HINT = /"(?:friendship_status|follower_count|edge_followed_by)"/;

export function isInstagramUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

export function matchUrl(raw: string): UrlMatch | undefined {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'https:' || !HOSTS.has(u.hostname)) return undefined;
  const path = u.pathname;

  const list = LIST_RE.exec(path);
  if (list?.[1]) {
    const direction: ListKind =
      list[2] === 'following' ? 'following' : list[2] === 'followers' ? 'followers' : 'mutuals';
    return {
      type: 'friendship_list',
      ownerId: list[1],
      direction,
      isFirstPage: !u.searchParams.get('max_id'),
      filtered: !!u.searchParams.get('query'),
    };
  }
  if (WEB_PROFILE_RE.test(path)) {
    return { type: 'web_profile_info', username: u.searchParams.get('username') ?? undefined };
  }
  const info = USER_INFO_RE.exec(path);
  if (info?.[1]) return { type: 'user_info', userId: info[1] };
  const show = FRIENDSHIP_SHOW_RE.exec(path);
  if (show?.[1]) return { type: 'friendship_status', userId: show[1] };
  if (GRAPHQL_RE.test(path)) return { type: 'graphql_profile' };
  return undefined;
}

/** Cheap pre-filter used in the page: should this response be cloned and forwarded? */
export function isCandidateUrl(raw: string): boolean {
  return matchUrl(raw) !== undefined;
}

/** Second-stage filter once the body is read (keeps irrelevant GraphQL traffic in the page). */
export function wantsBody(raw: string, text: string): boolean {
  const m = matchUrl(raw);
  if (!m) return false;
  return m.type !== 'graphql_profile' || GRAPHQL_PROFILE_HINT.test(text);
}

/**
 * A URL with every value removed (numeric path segments → {id}, query values dropped), safe to
 * show in diagnostics: it identifies the endpoint, never the person.
 */
export function pathTemplate(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/\/\d+(?=\/|$)/g, '/{id}');
    const keys = [...new Set(u.searchParams.keys())].sort();
    return keys.length ? `${path}?${keys.join('&')}` : path;
  } catch {
    return '(invalid url)';
  }
}
