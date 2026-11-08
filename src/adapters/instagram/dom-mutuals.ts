// Low-confidence fallback (§6.2): read the "Followed by a, b and N others" line a profile header
// already shows. Instagram only lists people the *viewer follows* there, so each named account
// `a` gives V → a and a → profile, which makes the profile 2nd degree. Read-only; every locale
// phrase and selector lives here (§9 Localization, §12).
import { profileUsernameFromPath } from './profile-page';

export interface DomMutuals {
  /** Usernames named in the line (people you follow who follow this profile). */
  usernames: string[];
  /** The "and N others" count, when the line has one. */
  others?: number;
}

/** "Followed by" in the languages Instagram's web UI most commonly uses. */
const PREFIXES: readonly RegExp[] = [
  /^followed by\s+/i,
  /^seguid[oa] por\s+/i, // es, pt
  /^suivi(?:e)? par\s+/i, // fr
  /^gefolgt von\s+/i, // de
  /^seguito da\s+/i, // it
];

/** "+ 12 more", "and 12 others", "y 12 más", "et 12 autres", "und 12 weitere" ... */
const OTHERS_RE =
  /(\d[\d.,]*)\s*(?:more|others?|otros|otras|más|mas|outros|outras|autres|weitere|andere|altri|altre)\b/i;

const MAX_NAMES = 25;
const MAX_LINE_CHARS = 400;
const USERNAME_ONLY = /^[A-Za-z0-9._]{1,30}$/;

interface LinkLike {
  getAttribute(name: string): string | null;
}

export interface LineElement {
  textContent: string | null;
  querySelectorAll(selector: string): ArrayLike<LinkLike>;
}

function afterPrefix(text: string): string | undefined {
  const t = text.trim();
  for (const re of PREFIXES) {
    const m = re.exec(t);
    if (m) return t.slice(m[0].length);
  }
  return undefined;
}

function usernameFromHref(href: string | null): string | undefined {
  if (!href) return undefined;
  let path = href;
  if (/^https?:\/\//i.test(href)) {
    try {
      const u = new URL(href);
      if (u.hostname !== 'www.instagram.com' && u.hostname !== 'instagram.com') return undefined;
      path = u.pathname;
    } catch {
      return undefined;
    }
  }
  // Single-segment links only: "/name/". The "and N others" link has more segments.
  const segments = path.split('?')[0]?.split('/').filter(Boolean) ?? [];
  if (segments.length !== 1) return undefined;
  return profileUsernameFromPath(`/${segments[0]}/`);
}

function dedupe(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const k = n.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(n);
    }
  }
  return out.slice(0, MAX_NAMES);
}

/**
 * Parse one element that holds the whole "Followed by …" line. Prefers the names' link targets
 * (exact usernames); falls back to the visible text when the names aren't links.
 */
export function parseFollowedByLine(el: LineElement): DomMutuals | undefined {
  const text = el.textContent ?? '';
  if (text.length > MAX_LINE_CHARS) return undefined;
  const rest = afterPrefix(text);
  if (rest === undefined) return undefined;

  const links = el.querySelectorAll('a[href]');
  let names: string[] = [];
  for (let i = 0; i < links.length; i++) {
    const name = usernameFromHref(links[i]?.getAttribute('href') ?? null);
    if (name) names.push(name);
  }
  if (names.length === 0) {
    // "alice, bob and 3 others" / "alice, bob + 3 more": take the leading comma/and-separated names.
    const head = rest.split(/\s+(?:\+|and|y|e|et|und)\s+\d/i)[0] ?? '';
    names = head
      .split(/\s*(?:,|\s&\s|\s(?:and|y|e|et|und)\s)\s*/i)
      .map((s) => s.trim().replace(/^@/, ''))
      .filter((s) => USERNAME_ONLY.test(s));
  }
  const usernames = dedupe(names);
  if (usernames.length === 0) return undefined;

  const result: DomMutuals = { usernames };
  const others = OTHERS_RE.exec(rest);
  if (others?.[1]) {
    const n = Number(others[1].replace(/[.,]/g, ''));
    if (Number.isSafeInteger(n) && n >= 0) result.others = n;
  }
  return result;
}

/** Elements that can hold the line, inside the profile header only. */
export const FOLLOWED_BY_SELECTOR = 'header span, header div';

/**
 * The profile header's "Followed by …" line, or undefined (no mutuals shown, or the markup
 * drifted). Among elements whose text starts with the phrase, the tightest one is the line itself.
 */
export function findFollowedByLine<T extends LineElement>(root: {
  querySelectorAll(selector: string): ArrayLike<T>;
}): DomMutuals | undefined {
  const candidates = root.querySelectorAll(FOLLOWED_BY_SELECTOR);
  let best: { el: T; len: number } | undefined;
  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i];
    if (!el) continue;
    const text = el.textContent ?? '';
    if (text.length > MAX_LINE_CHARS || afterPrefix(text) === undefined) continue;
    if (!best || text.length < best.len) best = { el, len: text.length };
  }
  return best ? parseFollowedByLine(best.el) : undefined;
}
