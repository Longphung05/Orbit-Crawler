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

/**
 * Only your own profile header carries an "Edit profile" link. Matched by href, which is not
 * localised. Scoped to the header so the nav's Settings entry never counts.
 */
export const OWN_PROFILE_SELECTOR = 'header a[href^="/accounts/edit"]';

/** Is the page currently showing the logged-in account's own profile? */
export function isOwnProfilePage(root: { querySelector(selector: string): unknown }): boolean {
  return root.querySelector(OWN_PROFILE_SELECTOR) !== null;
}

/**
 * Things Instagram puts on the username's line right after it: the verified tick, the "⋯" options
 * button, the settings gear on your own profile. The badge goes after them, never over them.
 */
export const USERNAME_ROW_ITEM_SELECTOR = 'svg, button, a, img, [role="button"]';
/** Items further than this past the previous one aren't "next to the name" (e.g. a far column). */
const ROW_MAX_GAP_PX = 24;
/** How far up from the username element to look for its line. */
const ROW_MAX_DEPTH = 5;

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface RowElement {
  parentElement: RowElement | null;
  getBoundingClientRect(): Box;
  querySelectorAll(selector: string): ArrayLike<RowElement>;
}

/**
 * Right edge (viewport px) of the cluster of icons/buttons on the username's line, starting at
 * the name itself (`name`, its text box). Only reads layout; never touches the page.
 */
export function usernameRowEnd(anchor: RowElement, name: Box): number {
  const items: Box[] = [];
  let node = anchor.parentElement;
  for (let depth = 0; node && depth < ROW_MAX_DEPTH; depth++, node = node.parentElement) {
    // Taller than a line or two: this is the whole header, not the username's row.
    if (node.getBoundingClientRect().height > Math.max(name.height, 16) * 3) break;
    const found = node.querySelectorAll(USERNAME_ROW_ITEM_SELECTOR);
    for (let i = 0; i < found.length; i++) {
      const b = found[i]?.getBoundingClientRect();
      if (!b || b.width === 0 || b.height === 0) continue;
      const mid = (b.top + b.bottom) / 2;
      if (mid < name.top || mid > name.bottom) continue; // a different line
      if (b.left < name.right - 1) continue; // the name itself, or something before it
      items.push(b);
    }
  }
  items.sort((a, b) => a.left - b.left);
  let right = name.right;
  for (const b of items) {
    if (b.left - right > ROW_MAX_GAP_PX) break;
    right = Math.max(right, b.right);
  }
  return right;
}

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
