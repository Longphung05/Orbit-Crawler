import { describe, expect, it } from 'vitest';
import { classify, dateFromName, isRelevantPath, parseExport } from '../../src/import';
import { fixtureFiles } from './helpers';

const NOW = Date.UTC(2025, 10, 6);

describe('classify / isRelevantPath', () => {
  it.each([
    ['connections/followers_and_following/followers_1.json', 'followers', 1],
    ['followers_and_following/followers_12.json', 'followers', 12],
    ['x/following.json', 'following', 1],
    ['x/Following_2.json', 'following', 2],
    ['x/followers_1.html', 'html', undefined],
    ['connections.json', 'legacy_connections', undefined],
    ["x/follow_requests_you've_received.json", 'follow_requests_received', undefined],
    ['media/posts/2025/photo.jpg', 'unknown', undefined],
  ])('%s → %s', (path, kind, part) => {
    expect(classify(path)).toEqual(part === undefined ? { kind } : { kind, part });
  });

  it('only decompresses relationship files and unknown JSON in the followers folder', () => {
    expect(isRelevantPath('a/connections/followers_and_following/followers_1.json')).toBe(true);
    expect(isRelevantPath('a/connections/followers_and_following/new_thing.json')).toBe(true);
    expect(isRelevantPath('a\\connections\\followers_and_following\\following.json')).toBe(true);
    expect(isRelevantPath('a/media/posts/202511/big.mp4')).toBe(false);
    expect(isRelevantPath('a/your_instagram_activity/likes/liked_posts.json')).toBe(false);
    expect(isRelevantPath('a/connections/')).toBe(false);
  });
});

describe('dateFromName', () => {
  it('reads the date in the archive name as UTC start of day', () => {
    expect(dateFromName('instagram-fake_me-2025-11-03-AbCd.zip', NOW)).toBe(Date.UTC(2025, 10, 3));
  });
  it('rejects absent or implausible dates', () => {
    expect(dateFromName(undefined, NOW)).toBeUndefined();
    expect(dateFromName('export.zip', NOW)).toBeUndefined();
    expect(dateFromName('x-2099-01-01.zip', NOW)).toBeUndefined();
    expect(dateFromName('x-2025-13-45.zip', NOW)).toBeUndefined();
  });
});

describe('modern export (2024+ layout)', () => {
  const parsed = parseExport(fixtureFiles('modern'), { now: NOW });

  it('reads followers from `value`', () => {
    expect(parsed.followers).toEqual({
      usernames: ['fake_alex', 'fake_jamie', 'fake.casey_99'],
      complete: true,
    });
  });

  it('reads following from `title`, falling back to the /_u/ href', () => {
    expect(parsed.following?.usernames).toEqual(['fake_alex', 'fake_morgan', 'fake_href_only']);
    expect(parsed.following?.complete).toBe(true);
  });

  it('excludes pending follow requests from following (§9)', () => {
    expect(parsed.pendingFollowRequests).toEqual(['fake_pending']);
    expect(parsed.following?.usernames).not.toContain('fake_pending');
    expect(parsed.warnings).toContain('1 pending follow request(s) were excluded from following.');
  });

  it('identifies the owner and reports unreadable entries', () => {
    expect(parsed.ownerUsername).toBe('fake_me');
    expect(parsed.warnings).toContain('1 entry had no readable username and was skipped.');
    expect(parsed.errors).toEqual([]);
  });

  it('reports every file: parsed, ignored, unrecognised', () => {
    const byName = Object.fromEntries(parsed.files.map((f) => [f.path.split('/').pop(), f]));
    expect(byName['followers_1.json']).toMatchObject({ status: 'parsed', entries: 3 });
    expect(byName['close_friends.json']).toMatchObject({ status: 'ignored', entries: 1 });
    expect(byName['some_new_feature.json']).toMatchObject({
      kind: 'unknown',
      status: 'unrecognized',
    });
    expect(byName['personal_information.json']).toMatchObject({ status: 'parsed' });
  });

  it('dates the export from the latest entry when there is no archive name', () => {
    expect(parsed.exportedAtSource).toBe('latest-entry');
    expect(parsed.exportedAt).toBe(1762041600 * 1000);
  });

  it('prefers the archive-name date when it is later (still a safe lower bound)', () => {
    const p = parseExport(fixtureFiles('modern'), {
      now: NOW,
      sourceName: 'instagram-fake_me-2025-11-03-AbCd.zip',
    });
    expect(p.exportedAtSource).toBe('archive-name');
    expect(p.exportedAt).toBe(Date.UTC(2025, 10, 3));
  });
});

describe('classic export (split followers)', () => {
  it('merges parts (bare and wrapped) and dedupes case-insensitively', () => {
    const p = parseExport(fixtureFiles('classic'), { now: NOW });
    expect(p.followers).toEqual({ usernames: ['fake_a1', 'fake_a2'], complete: true });
    expect(p.following).toEqual({ usernames: ['fake_b1'], complete: true });
    expect(p.ownerUsername).toBeUndefined();
  });

  it('a missing part makes the list partial', () => {
    const files = fixtureFiles('classic').filter((f) => !f.path.endsWith('followers_1.json'));
    const p = parseExport(files, { now: NOW });
    expect(p.followers).toEqual({ usernames: ['fake_a2', 'FAKE_A1'], complete: false });
    expect(p.warnings.some((w) => w.includes('missing 1 part'))).toBe(true);
  });

  it('an unreadable part makes the list partial, and the rest is still used', () => {
    const files = fixtureFiles('classic').map((f) =>
      f.path.endsWith('followers_2.json') ? { ...f, text: '{ not json' } : f,
    );
    const p = parseExport(files, { now: NOW });
    expect(p.followers).toEqual({ usernames: ['fake_a1'], complete: false });
    expect(p.files.find((f) => f.path.endsWith('followers_2.json'))).toMatchObject({
      status: 'failed',
      message: 'not valid JSON',
    });
  });
});

describe('legacy connections.json (pre-2021)', () => {
  it('reads username maps and warns that the export date is unknown', () => {
    const p = parseExport(fixtureFiles('legacy'), { now: NOW });
    expect(p.followers).toEqual({ usernames: ['fake_old1', 'fake_old2'], complete: true });
    expect(p.following).toEqual({ usernames: ['fake_old1'], complete: true });
    expect(p.exportedAtSource).toBe('import-time');
    expect(p.exportedAt).toBe(NOW);
    expect(p.warnings.some((w) => w.includes('no readable username'))).toBe(true);
  });
});

describe('unusable exports', () => {
  it('HTML-format export → clear error', () => {
    const p = parseExport(fixtureFiles('html'), { now: NOW });
    expect(p.errors).toEqual([
      'This export is in HTML format. Request it again from Instagram and choose JSON.',
    ]);
  });

  it('nothing relevant → error explaining what to request', () => {
    const p = parseExport([], { now: NOW });
    expect(p.errors[0]).toMatch(/Followers and following/);
  });

  it('schema drift on a list file → reported, never thrown (§6.1)', () => {
    const p = parseExport(
      [
        { path: 'x/followers_1.json', text: '{"followers_v9": {"items": []}}' },
        { path: 'x/following.json', text: '"just a string"' },
      ],
      { now: NOW },
    );
    expect(p.files.every((f) => f.status === 'failed')).toBe(true);
    expect(p.files[0]?.message).toMatch(/unexpected shape/);
    expect(p.followers).toBeUndefined();
    expect(p.errors.length).toBe(1);
  });

  it('survives hostile values without throwing', () => {
    const weird = [
      { path: 'x/followers_1.json', text: '[null, 5, {"string_list_data": "nope"}]' },
      { path: 'x/following.json', text: '{"relationships_following":[{"title":"<script>"}]}' },
      { path: 'x/personal_information.json', text: '{"profile_user":[]}' },
      { path: 'x/pending_follow_requests.json', text: '[]' },
    ];
    expect(() => parseExport(weird, { now: NOW })).not.toThrow();
    const p = parseExport(weird, { now: NOW });
    expect(p.following?.usernames).toEqual([]);
  });
});
