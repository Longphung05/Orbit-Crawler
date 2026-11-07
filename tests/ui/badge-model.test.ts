import { describe, expect, it } from 'vitest';
import type { ProfileViewOk } from '../../src/query/schemas';
import {
  badgeModel,
  BOUND_TOOLTIP,
  freshnessLine,
  headline,
  hueFor,
  initials,
  notes,
  profileUrl,
  relativeTime,
  UPPER_BOUND_MARK,
  viaText,
} from '../../src/ui/badge-model';

function view(over: Partial<ProfileViewOk> = {}): ProfileViewOk {
  return {
    status: 'ok',
    username: 'fake_target',
    state: 'second',
    degree: 2,
    degreeExact: true,
    connectorsExact: true,
    connectorCount: 4,
    connectors: [],
    hiddenHubCount: 0,
    unavailable: false,
    known: true,
    knownAccounts: 1204,
    updatedAt: null,
    showAvatarImages: false,
    ...over,
  };
}

describe('badgeModel', () => {
  it('shows the §8.1 labels', () => {
    expect(badgeModel(view({ state: 'self', degree: 0 })).label).toBe('You');
    expect(badgeModel(view({ state: 'first', degree: 1 })).label).toBe('1st');
    expect(badgeModel(view()).label).toBe('2nd · via 4');
    expect(badgeModel(view({ state: 'third', degree: 3, connectorCount: 2 })).label).toBe(
      '3rd · via 2',
    );
    expect(badgeModel(view({ state: 'out_of_orbit', degree: null })).label).toBe('Out of orbit');
  });

  it('marks lower-bound counts with + and upper-bound degrees with the bound mark (§5.2)', () => {
    const m = badgeModel(view({ connectorsExact: false, degreeExact: false }));
    expect(m.label).toBe(`${UPPER_BOUND_MARK}2nd · via 4+`);
    expect(m.title).toBe(BOUND_TOOLTIP);
  });

  it('exact data gets no hint', () => {
    const m = badgeModel(view());
    expect(m.label).not.toContain(UPPER_BOUND_MARK);
    expect(m.title).not.toBe(BOUND_TOOLTIP);
  });

  it('only 2nd/3rd open the paths list', () => {
    expect(badgeModel(view()).hasPaths).toBe(true);
    expect(badgeModel(view({ state: 'third', degree: 3 })).hasPaths).toBe(true);
    for (const state of ['self', 'first', 'out_of_orbit'] as const) {
      expect(badgeModel(view({ state })).hasPaths).toBe(false);
    }
  });

  it('out of orbit explains whether Orbit has seen the account at all', () => {
    const seen = badgeModel(view({ state: 'out_of_orbit', degree: null, known: true })).title;
    const unseen = badgeModel(view({ state: 'out_of_orbit', degree: null, known: false })).title;
    expect(seen).toContain('no connection');
    expect(unseen).toContain("hasn't seen");
    expect(seen).toContain(BOUND_TOOLTIP);
  });

  it('out of orbit mentions hidden large accounts in its tooltip', () => {
    const m = badgeModel(view({ state: 'out_of_orbit', degree: null, hiddenHubCount: 2 }));
    expect(m.title).toContain('Also reachable via 2 large accounts (hidden).');
  });
});

describe('copy', () => {
  it('viaText', () => {
    expect(viaText(4, true)).toBe('via 4');
    expect(viaText(4, false)).toBe('via 4+');
  });

  it('headline matches §8.2', () => {
    expect(headline(view())).toBe('Connected through 4 people you follow');
    expect(headline(view({ connectorCount: 1 }))).toBe('Connected through 1 person you follow');
    expect(headline(view({ connectorsExact: false }))).toBe(
      'Connected through 4+ people you follow',
    );
    expect(headline(view({ state: 'third', degree: 3, connectorCount: 2 }))).toContain(
      '2 people you follow',
    );
  });

  it('relativeTime', () => {
    const now = 1_000_000_000_000;
    expect(relativeTime(now - 5_000, now)).toBe('just now');
    expect(relativeTime(now - 60_000, now)).toBe('1 minute ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 hours ago');
    expect(relativeTime(now - 3 * 86_400_000, now)).toBe('3 days ago');
    expect(relativeTime(now - 90 * 86_400_000, now)).toBe('3 months ago');
    expect(relativeTime(now + 5_000, now)).toBe('just now'); // clock skew never goes negative
  });

  it('freshnessLine matches §8.2', () => {
    const now = 1_000_000_000_000;
    expect(freshnessLine(view({ updatedAt: now - 3 * 86_400_000 }), now)).toBe(
      'Last updated 3 days ago · based on 1,204 known accounts',
    );
    expect(freshnessLine(view({ updatedAt: null, knownAccounts: 1 }), now)).toBe(
      'Nothing confirmed yet · based on 1 known account',
    );
  });

  it('notes: private, hidden hubs, unavailable', () => {
    expect(notes(view())).toEqual([]);
    expect(notes(view({ isPrivate: true }))).toEqual([
      'Private account — Orbit can only see mutual followers.',
    ]);
    // You follow them: you can see their lists, so no private caveat.
    expect(notes(view({ isPrivate: true, state: 'first', degree: 1 }))).toEqual([]);
    expect(notes(view({ hiddenHubCount: 2 }))).toEqual([
      'Also reachable via 2 large accounts (hidden).',
    ]);
    expect(notes(view({ hiddenHubCount: 1 }))[0]).toContain('1 large account (hidden)');
    expect(notes(view({ unavailable: true }))).toHaveLength(1);
  });
});

describe('identity helpers', () => {
  it('profileUrl encodes the username', () => {
    expect(profileUrl('fake_alex')).toBe('https://www.instagram.com/fake_alex/');
    expect(profileUrl('a/b?c')).toBe('https://www.instagram.com/a%2Fb%3Fc/');
  });

  it('initials', () => {
    expect(initials({ username: 'fake_alex' })).toBe('FA');
    expect(initials({ username: 'x', fullName: 'Alex Jamie Rivera' })).toBe('AJ');
    expect(initials({ username: 'x', fullName: 'Madonna' })).toBe('MA');
    expect(initials({ username: '___' })).toBe('?');
  });

  it('hueFor is stable and in range', () => {
    expect(hueFor('1234')).toBe(hueFor('1234'));
    for (const id of ['1', '99999999999', 'username:abc']) {
      const h = hueFor(id);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });
});
