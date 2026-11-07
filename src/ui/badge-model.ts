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
  /** Whether clicking opens a paths list (there is something to list). */
  hasPaths: boolean;
}

const ORDINAL: Record<1 | 2 | 3, string> = { 1: '1st', 2: '2nd', 3: '3rd' };

/** `via 4`, or `via 4+` when more connectors may exist. */
export function viaText(count: number, exact: boolean): string {
  return `via ${count}${exact ? '' : '+'}`;
}

export function badgeModel(view: ProfileViewOk): BadgeModel {
  if (view.state === 'self') {
    return { label: 'You', tone: 'self', title: 'This is your profile.', hasPaths: false };
  }
  if (view.state === 'first') {
    return { label: '1st', tone: 'first', title: 'You follow this account.', hasPaths: false };
  }
  if (view.state === 'out_of_orbit') {
    const base = view.known
      ? `Orbit knows no connection within 3 hops. ${BOUND_TOOLTIP}`
      : `Orbit hasn't seen this account yet. ${BOUND_TOOLTIP}`;
    // There is no paths list to carry the hidden-hub line (§7.3), so the tooltip does.
    const hubs = notes(view).find((n) => n.startsWith('Also reachable'));
    return {
      label: 'Out of orbit',
      tone: 'none',
      title: hubs ? `${base} ${hubs}` : base,
      hasPaths: false,
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
    hasPaths: true,
  };
}

/** Popover heading: "Connected through 4 people you follow". */
export function headline(view: ProfileViewOk): string {
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

/** "Last updated 3 days ago · based on 1,204 known accounts" (§8.2). */
export function freshnessLine(view: ProfileViewOk, now: number): string {
  const accounts = `based on ${view.knownAccounts.toLocaleString('en-US')} known account${view.knownAccounts === 1 ? '' : 's'}`;
  return view.updatedAt === null
    ? `Nothing confirmed yet · ${accounts}`
    : `Last updated ${relativeTime(view.updatedAt, now)} · ${accounts}`;
}

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
