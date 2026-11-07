// What a profile page looks like on instagram.com: which URLs are profiles, and which element
// carries the username (where the badge goes). Every Instagram-specific route and selector for
// the badge lives here (§12). Read-only: nothing here changes the page.

/** First path segments that are Instagram features, not usernames. */
const RESERVED_ROOTS = new Set([
  'about',
  'accounts',
  'api',
  'ar',
  'archive',
  'challenge',
  'communities',
  'developer',
  'direct',
  'directory',
  'download',
  'emails',
  'explore',
  'graphql',
  'lite',
  'locations',
  'login',
  'legal',
  'nametag',
  'oauth',
  'p',
  'press',
  'privacy',
  'reel',
  'reels',
  'session',
  'stories',
  'threads',
  'topics',
  'tv',
  'web',
]);

/** `/<username>/<tab>/`: profile tabs and the lists that open over a profile. */
const PROFILE_TABS = new Set([
  'channel',
  'followers',
  'following',
  'guides',
  'reels',
  'reposts',
  'saved',
  'tagged',
  'video',
]);

const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;

/**
 * The profile a URL path shows, or undefined when it isn't a profile page (feed, explore, a post,
 * messages, ...). A post under a profile (`/name/p/<id>/`) is not a profile page.
 */
export function profileUsernameFromPath(pathname: string): string | undefined {
  const segments = pathname.split('/').filter(Boolean);
  const [name, tab, extra] = segments;
  if (!name || !USERNAME_RE.test(name)) return undefined;
  if (RESERVED_ROOTS.has(name.toLowerCase())) return undefined;
  if (segments.length === 1) return name;
  if (!tab || !PROFILE_TABS.has(tab)) return undefined;
  if (segments.length === 2) return name;
  // `/name/followers/mutualOnly` and similar.
  if (segments.length === 3 && (tab === 'followers' || tab === 'following') && extra) return name;
  return undefined;
}

/** Candidates for the element showing the username, most to least reliable. */
export const USERNAME_ANCHOR_SELECTORS = [
  'header h2',
  'header h1',
  'header a[href]',
  'header span',
] as const;

interface TextElement {
  textContent: string | null;
}

/**
 * The profile header's username element, or null when Instagram's markup has drifted (the badge
 * then falls back to a floating corner pill). Matches on the element's visible text, which is the
 * username itself and is not localised.
 */
export function findUsernameAnchor<T extends TextElement>(
  root: { querySelectorAll(selector: string): ArrayLike<T> },
  username: string,
): T | null {
  const want = username.toLowerCase();
  for (const selector of USERNAME_ANCHOR_SELECTORS) {
    const found = root.querySelectorAll(selector);
    for (let i = 0; i < found.length; i++) {
      const el = found[i];
      if (el && el.textContent?.trim().toLowerCase() === want) return el;
    }
  }
  return null;
}
