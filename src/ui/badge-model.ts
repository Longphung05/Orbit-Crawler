// What the badge says, as plain data (§8.1, §5.2). Pure, so the wording rules are testable
// without a DOM. The components only render what this returns.
import type { Person, ProfileViewOk } from '../query/schemas';

/**
 * Prefix for a degree that is only an upper bound. Orbit knows what you've browsed, so a "3rd"
 * really means "3rd or closer": `≤3rd`. (CLAUDE.md §5.2 suggests `≥`; that reads as "farther",
 * the opposite of what is meant, so the tooltip carries the plain-language version too.)
 */
export const UPPER_BOUND_MARK = '≤';

export const BOUND_TOOLTIP = 'Based on what Orbit has seen. Might be closer.';

export type BadgeTone = 'self' | 'first' | 'second' | 'third' | 'none';

export interface BadgeModel {
  /** Main text, e.g. `2nd · via 4`. */
  label: string;
  tone: BadgeTone;
  /** Tooltip / accessible description. */
  title: string;
  /** What clicking opens: the paths list, a "how to firm this up" panel, or nothing. */
  popover: 'paths' | 'tips' | null;
}

const ORDINAL: Record<1 | 2 | 3, string> = { 1: '1st', 2: '2nd', 3: '3rd' };

/** `via 4`, or `via 4+` when more connectors may exist. */
export function viaText(count: number, exact: boolean): string {
  return `via ${count}${exact ? '' : '+'}`;
}

export function badgeModel(view: ProfileViewOk): BadgeModel {
  if (view.state === 'self') {
    return { label: 'You', tone: 'self', title: 'This is your profile.', popover: null };
  }
  if (view.state === 'first') {
    const more = view.furtherConnectorCount > 0;
    return {
      label: '1st',
      tone: 'first',
      title: more
        ? 'You follow this account. Click to see who else connects you.'
        : 'You follow this account.',
      popover: more ? 'paths' : null,
    };
  }
  if (view.state === 'out_of_orbit') {
    const base = view.known
      ? `Orbit knows no connection within 3 hops. ${BOUND_TOOLTIP}`
      : `Orbit hasn't seen this account yet. ${BOUND_TOOLTIP}`;
    // There is no paths list to carry the hidden-hub line (§7.3), so the tooltip does.
    const hubs = notes(view).find((n) => n.startsWith('Also reachable'));
    return {
      label: outOfOrbitLabel(view),
      tone: 'none',
      title: hubs ? `${base} ${hubs}` : base,
      popover: 'tips',
    };
  }
  const degree = view.state === 'second' ? 2 : 3;
  const mark = view.degreeExact ? '' : UPPER_BOUND_MARK;
  const via = viaText(view.connectorCount, view.connectorsExact);
  return {
    label: `${mark}${ORDINAL[degree]} · ${via}`,
    tone: view.state,
    title:
      view.degreeExact && view.connectorsExact ? 'Click to see how you connect.' : BOUND_TOOLTIP,
    popover: 'paths',
  };
}

/**
 * "Out of orbit" read as "not connected", but it only ever means "no link seen yet". With your
 * full following list known it can't be 1st, and with no "Followed by" link it is most likely
 * 3rd or farther: `3rd+ ?`. Without that list Orbit can't even rule out 1st: `Unknown`.
 */
export function outOfOrbitLabel(view: Pick<ProfileViewOk, 'firstLayer'>): string {
  return view.firstLayer === 'complete' ? '3rd+ ?' : 'Unknown';
}

/** Popover heading: "Connected through 4 people you follow". */
export function headline(view: ProfileViewOk): string {
  if (view.state === 'out_of_orbit') {
    return view.known ? 'No connection known yet' : "Orbit hasn't seen this account yet";
  }
  if (view.state === 'first') return 'You follow this account';
  const n = view.connectorCount;
  const plus = view.connectorsExact ? '' : '+';
  const people = `${n}${plus} ${n === 1 && view.connectorsExact ? 'person' : 'people'} you follow`;
  return view.state === 'third'
    ? `Connected, three steps away, through ${people}`
    : `Connected through ${people}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(then: number, now: number): string {
  const ms = Math.max(0, now - then);
  if (ms < MINUTE) return 'just now';
  const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (ms < HOUR) return plural(Math.floor(ms / MINUTE), 'minute');
  if (ms < DAY) return plural(Math.floor(ms / HOUR), 'hour');
  if (ms < 60 * DAY) return plural(Math.floor(ms / DAY), 'day');
  return plural(Math.floor(ms / (30 * DAY)), 'month');
}

/**
 * Heading for the longer-routes section. For a 1st-degree account: other people you follow who
 * follow them (and their friends). For a 2nd-degree one: its 3rd-degree routes.
 */
export function furtherHeading(view: ProfileViewOk, connectorCount: number): string {
  const people = `${connectorCount} ${connectorCount === 1 ? 'person' : 'people'} you follow`;
  return view.state === 'first'
    ? `Also connected through ${people}`
    : `3rd-degree connections · through ${people}`;
}

/** "Last updated 3 days ago · based on 1,204 known accounts" (§8.2). */
export function freshnessLine(view: ProfileViewOk, now: number): string {
  const accounts = `based on ${view.knownAccounts.toLocaleString('en-US')} known account${view.knownAccounts === 1 ? '' : 's'}`;
  return view.updatedAt === null
    ? `Nothing confirmed yet · ${accounts}`
    : `Last updated ${relativeTime(view.updatedAt, now)} · ${accounts}`;
}

/**
 * What would make this answer better, in plain words. Orbit only knows what you've imported or
 * opened yourself, so the fix is always something you do (it never opens anything for you).
 */
export function guidance(view: ProfileViewOk): string[] {
  if (view.state === 'self' || view.state === 'first') return [];
  const tips: string[] = [];
  if (view.firstLayer !== 'complete') {
    tips.push(
      "Orbit doesn't have your full following list yet. Import your Instagram export in the Orbit side panel, or scroll your own Following list to the end.",
    );
  }
  if (view.state === 'out_of_orbit') {
    tips.push(
      'On this profile, click “Followed by … and N others” and scroll that list to the end: it shows exactly which people you follow also follow them. If there is no such line, there are probably none.',
    );
    if (view.isPrivate !== true) tips.push(THIRD_DEGREE_TIP);
  } else if (view.state === 'second' && !view.connectorsExact) {
    tips.push(
      'For an exact count, click “Followed by … and N others” on this profile and scroll that list to the end.',
    );
  } else if (view.state === 'third' && !view.degreeExact) {
    tips.push(
      'There may be a closer connection Orbit has not seen yet. Opening “Followed by …” lists firms this up.',
    );
  }
  return tips;
}

/**
 * How a human checks for a 3rd-degree link with one list instead of a crawl: the target's
 * followers, matched against the 2nd-degree accounts Orbit already knows.
 */
export const THIRD_DEGREE_TIP =
  'To check for a 3rd-degree link, open their Followers list and scroll a little. If any follower is someone your friends follow, Orbit shows 3rd. This works better the more of your friends’ Following lists (or exports they’ve shared with you) Orbit has.';

/** Extra explanatory lines for the popover, in display order. */
export function notes(view: ProfileViewOk): string[] {
  const out: string[] = [];
  if (view.isPrivate === true && view.state !== 'first') {
    out.push('Private account — Orbit can only see mutual followers.');
  }
  if (view.hiddenHubCount > 0) {
    out.push(
      `Also reachable via ${view.hiddenHubCount} large account${view.hiddenHubCount === 1 ? '' : 's'} (hidden).`,
    );
  }
  if (view.unavailable) out.push('This account looked unavailable the last time Orbit checked.');
  return out;
}

export function profileUrl(username: string): string {
  return `https://www.instagram.com/${encodeURIComponent(username)}/`;
}

export function initials(person: Pick<Person, 'username' | 'fullName'>): string {
  const source = (person.fullName?.trim() || person.username)
    .replace(/[^\p{L}\p{N}]/gu, ' ')
    .trim();
  const [first, second] = source.split(/\s+/).filter(Boolean);
  const letters = first && second ? first.charAt(0) + second.charAt(0) : (first ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

/** A stable hue (0-359) per account, so the same person always gets the same colour. */
export function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}
