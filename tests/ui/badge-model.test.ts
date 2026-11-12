import { describe, expect, it } from 'vitest';
import type { ProfileViewOk } from '../../src/query/schemas';
import {
  badgeModel,
  BOUND_TOOLTIP,
  freshnessLine,
  furtherHeading,
  guidance,
  headline,
  hueFor,
  initials,
  notes,
  profileUrl,
  relativeTime,
  THIRD_DEGREE_TIP,
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
    firstLayer: 'complete',
    updatedAt: null,
    showAvatarImages: false,
    furtherConnectorCount: 0,
    ...over,
  };
}

describe('longer routes', () => {
  it('makes a 1st-degree badge clickable only when there is more to show', () => {
    expect(badgeModel(view({ state: 'first', degree: 1 })).popover).toBeNull();
    const more = view({ state: 'first', degree: 1, furtherConnectorCount: 3 });
    expect(badgeModel(more)).toMatchObject({ label: '1st', popover: 'paths' });
    expect(headline(more)).toBe('You follow this account');
    expect(furtherHeading(more, 3)).toBe('Also connected through 3 people you follow');
    expect(furtherHeading(view(), 1)).toBe('3rd-degree connections · through 1 person you follow');
  });
});

describe('badgeModel', () => {
  it('shows the §8.1 labels', () => {
    expect(badgeModel(view({ state: 'self', degree: 0 })).label).toBe('You');
    expect(badgeModel(view({ state: 'first', degree: 1 })).label).toBe('1st');
    expect(badgeModel(view()).label).toBe('2nd · via 4');
    expect(badgeModel(view({ state: 'third', degree: 3, connectorCount: 2 })).label).toBe(
      '3rd · via 2',
    );
    expect(badgeModel(view({ state: 'out_of_orbit', degree: null })).label).toBe('3rd+ ?');
    expect(
      badgeModel(view({ state: 'out_of_orbit', degree: null, firstLayer: 'partial' })).label,
    ).toBe('Unknown');
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

  it('2nd/3rd open the paths list, out of orbit opens tips, you/1st open nothing', () => {
    expect(badgeModel(view()).popover).toBe('paths');
    expect(badgeModel(view({ state: 'third', degree: 3 })).popover).toBe('paths');
    expect(badgeModel(view({ state: 'out_of_orbit' })).popover).toBe('tips');
    for (const state of ['self', 'first'] as const) {
      expect(badgeModel(view({ state })).popover).toBeNull();
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

describe('guidance', () => {
  it('nothing to add for you or accounts you follow', () => {
    expect(guidance(view({ state: 'self' }))).toEqual([]);
    expect(guidance(view({ state: 'first' }))).toEqual([]);
  });

  it('out of orbit says what is missing and what to do, never that Orbit will do it', () => {
    const tips = guidance(view({ state: 'out_of_orbit', degree: null }));
    expect(tips).toHaveLength(2);
    expect(tips[0]).toContain('Followed by');
    expect(tips[1]).toBe(THIRD_DEGREE_TIP);
    for (const t of tips) expect(t).not.toMatch(/automatic/i);
  });

  it('no 3rd-degree followers tip for a private account (its followers list is hidden)', () => {
    const tips = guidance(view({ state: 'out_of_orbit', degree: null, isPrivate: true }));
    expect(tips).not.toContain(THIRD_DEGREE_TIP);
  });

  it('asks for an import first when your own following list is not complete', () => {
    const tips = guidance(view({ state: 'out_of_orbit', degree: null, firstLayer: 'none' }));
    expect(tips).toHaveLength(3);
    expect(tips[0]).toContain('Import your Instagram export');
  });

  it('2nd degree with a lower-bound count points at the Followed by list; exact says nothing', () => {
    expect(guidance(view({ connectorsExact: false }))[0]).toContain('exact count');
    expect(guidance(view())).toEqual([]);
  });

  it('out of orbit titles distinguish unseen from unconnected', () => {
    expect(headline(view({ state: 'out_of_orbit', known: false }))).toContain("hasn't seen");
    expect(headline(view({ state: 'out_of_orbit', known: true }))).toBe('No connection known yet');
  });
});
