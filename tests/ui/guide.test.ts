import { describe, expect, it } from 'vitest';
import type { ProfileViewOk } from '../../src/query/schemas';
import type { ViewerMeta } from '../../src/shared/types';
import { buildGuide, hasFollowingList } from '../../src/ui/guide';

const viewer = (over: Partial<ViewerMeta> = {}): ViewerMeta => ({
  viewerId: '1000',
  username: 'fake_me',
  ...over,
});
const imported = viewer({ importedExportAt: 1 });

function view(over: Partial<ProfileViewOk> = {}): ProfileViewOk {
  return {
    status: 'ok',
    username: 'fake_target',
    state: 'out_of_orbit',
    degree: null,
    degreeExact: false,
    connectorsExact: false,
    connectorCount: 0,
    connectors: [],
    hiddenHubCount: 0,
    unavailable: false,
    known: true,
    knownAccounts: 10,
    firstLayer: 'complete',
    updatedAt: null,
    showAvatarImages: false,
    ...over,
  };
}
const viewing = (v?: ProfileViewOk, calculating = false) => ({
  viewerId: '1000',
  username: 'fake_target',
  at: 1,
  calculating,
  ...(v ? { view: v } : {}),
});

describe('buildGuide: setup steps', () => {
  it('loading', () => {
    expect(buildGuide({ viewer: undefined, viewing: undefined }).tone).toBe('wait');
  });

  it('no account yet: open Instagram, and reassure about passwords', () => {
    const g = buildGuide({ viewer: null, viewing: undefined });
    expect(g.title).toBe('Waiting for Instagram');
    expect(g.lines.join(' ')).toMatch(/never sees your password/);
  });

  it('account detected without a username: open your own profile', () => {
    const g = buildGuide({ viewer: viewer({ username: '' }), viewing: undefined });
    expect(g.title).toBe('Account detected');
    expect(g.lines[0]).toContain('own profile');
  });

  it('no following list yet: import, or scroll your own list', () => {
    const g = buildGuide({ viewer: viewer(), viewing: undefined });
    expect(g.tone).toBe('next');
    expect(g.title).toContain('@fake_me');
    expect(g.lines.join(' ')).toMatch(/import/i);
    expect(g.lines.join(' ')).toMatch(/Following list/);
  });

  it('an import or a fully scrolled Following list both count', () => {
    expect(hasFollowingList(viewer())).toBe(false);
    expect(hasFollowingList(imported)).toBe(true);
    expect(hasFollowingList(viewer({ followingCoverage: 'complete' }))).toBe(true);
    expect(hasFollowingList(viewer({ followingCoverage: 'partial' }))).toBe(false);
  });
});

describe('buildGuide: ready', () => {
  it('idle: just browse', () => {
    const g = buildGuide({ viewer: imported, viewing: undefined });
    expect(g.tone).toBe('ok');
    expect(g.lines[0]).toContain('Browse Instagram normally');
  });

  it('says it is calculating while the answer is pending', () => {
    const g = buildGuide({ viewer: imported, viewing: viewing(undefined, true) });
    expect(g.lines).toEqual(['Looking at @fake_target: working out their orbit…']);
  });

  it('shows the badge label and, for out of orbit, what to do', () => {
    const g = buildGuide({ viewer: imported, viewing: viewing(view()) });
    expect(g.lines[0]).toBe('Looking at @fake_target: 3rd+ ?');
    expect(g.lines[1]).toContain('no connection data');
    expect(g.lines.join(' ')).toContain('Followed by');
  });

  it('shows the degree once known', () => {
    const g = buildGuide({
      viewer: imported,
      viewing: viewing(
        view({
          state: 'second',
          degree: 2,
          degreeExact: true,
          connectorsExact: true,
          connectorCount: 3,
        }),
      ),
    });
    expect(g.lines).toEqual(['Looking at @fake_target: 2nd · via 3']);
  });

  it('own profile', () => {
    const g = buildGuide({
      viewer: imported,
      viewing: viewing(view({ state: 'self', degree: 0 })),
    });
    expect(g.lines).toEqual(["You're on your own profile."]);
  });

  it('keeps showing the last answer while recalculating', () => {
    const g = buildGuide({ viewer: imported, viewing: viewing(view(), true) });
    expect(g.lines[0]).toContain('recalculating… (was 3rd+ ?)');
  });

  it("ignores another account's profile (account switch)", () => {
    const other = { ...viewing(view()), viewerId: '2000' };
    expect(buildGuide({ viewer: imported, viewing: other }).lines[0]).toContain('Browse Instagram');
  });
});
