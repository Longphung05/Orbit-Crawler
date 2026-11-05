import { describe, expect, it } from 'vitest';
import {
  interpretResponse,
  isCandidateUrl,
  matchUrl,
  pathTemplate,
  skeleton,
  wantsBody,
} from '../../src/adapters/instagram';
import * as P from '../fixtures/instagram/payloads';

describe('URL matching', () => {
  it('recognises list endpoints, pages and searches', () => {
    expect(matchUrl(P.followingPage1.url)).toEqual({
      type: 'friendship_list',
      ownerId: P.VIEWER,
      direction: 'following',
      isFirstPage: true,
      filtered: false,
    });
    expect(matchUrl(P.followingPage2.url)).toMatchObject({ isFirstPage: false });
    expect(matchUrl(P.followingSearch.url)).toMatchObject({ filtered: true });
    expect(matchUrl(P.mutualsOfTarget.url)).toMatchObject({ direction: 'mutuals' });
  });

  it('ignores other hosts, http, and unrelated paths', () => {
    expect(isCandidateUrl('https://evil.example/api/v1/friendships/1/following/')).toBe(false);
    expect(isCandidateUrl('http://www.instagram.com/api/v1/friendships/1/following/')).toBe(false);
    expect(isCandidateUrl(`${P.IG}/api/v1/feed/timeline/`)).toBe(false);
    expect(isCandidateUrl(`${P.IG}/fake_alex/`)).toBe(false);
    expect(isCandidateUrl('not a url')).toBe(false);
  });

  it('only forwards GraphQL bodies that look like profiles', () => {
    expect(wantsBody(P.graphqlProfile.url, JSON.stringify(P.graphqlProfile.body))).toBe(true);
    expect(wantsBody(P.graphqlFeed.url, JSON.stringify(P.graphqlFeed.body))).toBe(false);
    expect(wantsBody(P.followingPage1.url, '{}')).toBe(true);
  });

  it('pathTemplate strips every value', () => {
    expect(pathTemplate(P.followingSearch.url)).toBe(
      '/api/v1/friendships/{id}/following/?count&query',
    );
    expect(pathTemplate(P.webProfilePrivate.url)).toBe('/api/v1/users/web_profile_info/?username');
  });
});

describe('interpretResponse', () => {
  it('following pages: rows, first/last page flags', () => {
    const first = interpretResponse(P.response(P.followingPage1));
    expect(first).toMatchObject({ status: 'ok', payloadType: 'friendship_list' });
    if (first.status !== 'ok') throw new Error();
    expect(first.events).toEqual([
      expect.objectContaining({
        kind: 'list_page',
        ownerId: P.VIEWER,
        direction: 'following',
        isFirstPage: true,
        isLastPage: false,
        filtered: false,
        rows: [
          expect.objectContaining({ id: '2000000001', username: 'fake_alex', isPrivate: false }),
          expect.objectContaining({ id: '2000000002', username: 'fake_jamie' }),
        ],
      }),
    ]);
    const last = interpretResponse(P.response(P.followingPage2));
    expect(last.status === 'ok' && last.events[0]).toMatchObject({ isLastPage: true });
  });

  it('skips individual bad rows but keeps the page', () => {
    const body = { ...P.followingPage1.body, users: [...P.followingPage1.body.users, { pk: 'x' }] };
    const out = interpretResponse(P.response({ url: P.followingPage1.url, body }));
    expect(out).toMatchObject({ status: 'ok', skippedRows: 1 });
  });

  it('web_profile_info: counts, friendship flags, username-only mutuals', () => {
    const out = interpretResponse(P.response(P.webProfilePrivate));
    if (out.status !== 'ok') throw new Error(JSON.stringify(out));
    expect(out.events[0]).toEqual({
      kind: 'profile',
      user: expect.objectContaining({
        id: '4000000001',
        username: 'fake_target',
        isPrivate: true,
        followerCount: 812,
        followingCount: 301,
      }),
      friendship: { viewerFollows: false, followsViewer: false, requested: true },
      mutuals: { users: [], usernames: ['fake_alex', 'fake_unknown_mutual'], count: 3 },
    });
  });

  it('404 profile → profile_missing (unavailable/blocked)', () => {
    const out = interpretResponse(P.response(P.webProfileMissing));
    expect(out.status === 'ok' && out.events).toEqual([
      { kind: 'profile_missing', username: 'fake_gone' },
    ]);
  });

  it('user info v1: friendship_status and facepile with ids', () => {
    const out = interpretResponse(P.response(P.userInfoAlex));
    if (out.status !== 'ok') throw new Error();
    expect(out.events[0]).toMatchObject({
      kind: 'profile',
      user: { id: '2000000001', followerCount: 640 },
      friendship: { viewerFollows: true, followsViewer: true, requested: false },
      mutuals: { users: [expect.objectContaining({ id: '2000000002' })], count: 7 },
    });
  });

  it('user info whose id disagrees with the URL is rejected', () => {
    const body = { user: { ...P.userInfoAlex.body.user, pk: '999', pk_id: '999', id: '999' } };
    expect(interpretResponse(P.response({ url: P.userInfoAlex.url, body }))).toMatchObject({
      status: 'schema_error',
      error: 'profile id does not match the URL',
    });
  });

  it('GraphQL profile is understood; unrelated GraphQL is ignored, not an error', () => {
    const out = interpretResponse(P.response(P.graphqlProfile));
    expect(out.status === 'ok' && out.events[0]).toMatchObject({
      user: { id: '5000000001', followerCount: 9_000_000, isVerified: true },
    });
    expect(interpretResponse(P.response(P.graphqlFeed))).toMatchObject({ status: 'ignored' });
  });

  it('friendship/show → friendship event', () => {
    const out = interpretResponse(P.response(P.friendshipShow));
    expect(out.status === 'ok' && out.events).toEqual([
      {
        kind: 'friendship',
        userId: '2000000002',
        friendship: { viewerFollows: false, followsViewer: true, requested: false },
      },
    ]);
  });

  it('schema drift → schema_error with a value-free shape (§9)', () => {
    const out = interpretResponse(P.response(P.driftedList));
    expect(out).toMatchObject({
      status: 'schema_error',
      payloadType: 'friendship_list',
      endpoint: '/api/v1/friendships/{id}/followers/?count',
    });
    if (out.status !== 'schema_error') throw new Error();
    const shape = JSON.stringify(out.shape);
    expect(shape).not.toContain('fake_x');
    expect(shape).toContain('items_v2');
  });

  it('non-JSON 200, error statuses, and status=fail are handled without throwing', () => {
    expect(
      interpretResponse({ url: P.followingPage1.url, status: 200, text: '<html>' }),
    ).toMatchObject({
      status: 'schema_error',
    });
    expect(interpretResponse({ url: P.followingPage1.url, status: 429, text: '' })).toMatchObject({
      status: 'ignored',
    });
    expect(
      interpretResponse({ url: P.followingPage1.url, status: 200, text: '{"status":"fail"}' }),
    ).toMatchObject({ status: 'ignored' });
    expect(interpretResponse({ url: 'https://x.example/', status: 200, text: '' })).toMatchObject({
      status: 'ignored',
    });
  });

  it('drops profile picture URLs that are not https', () => {
    const body = {
      ...P.followingPage1.body,
      users: [{ ...P.followingPage1.body.users[0], profile_pic_url: 'javascript:alert(1)' }],
    };
    const out = interpretResponse(P.response({ url: P.followingPage1.url, body }));
    if (out.status !== 'ok' || out.events[0]?.kind !== 'list_page') throw new Error();
    expect(out.events[0].rows[0]).not.toHaveProperty('profilePicUrl');
  });
});

describe('skeleton (diagnostics never leak values)', () => {
  it('keeps structure, drops all values', () => {
    const s = skeleton(P.webProfilePrivate.body);
    const text = JSON.stringify(s);
    for (const leak of [
      'fake_target',
      '4000000001',
      '812',
      'Fake Target',
      'fake_alex',
      'scontent',
    ]) {
      expect(text).not.toContain(leak);
    }
    expect(text).toContain('edge_mutual_followed_by');
  });

  it('collapses data-keyed maps and hides data-looking keys', () => {
    const map = Object.fromEntries(
      ['fake_a', 'fake_b', 'fake_c', 'fake_d', 'fake_e'].map((k) => [k, 1]),
    );
    expect(skeleton(map)).toEqual({ '(map)': 'number', '(entries)': '5' });
    expect(skeleton({ '2000000001': {}, 'user.name': 1, ok: true })).toEqual({
      ok: 'boolean',
      '(data-keys)': '2',
    });
  });

  it('is bounded in depth and width', () => {
    let deep: unknown = 'x';
    for (let i = 0; i < 20; i++) deep = { a: deep };
    expect(JSON.stringify(skeleton(deep))).toContain('{…}');
    const letters = (i: number) => String.fromCharCode(97 + Math.floor(i / 26), 97 + (i % 26));
    const wide = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [`field_${letters(i)}`, i % 2 ? 'a' : 1]),
    );
    expect(Object.keys(skeleton(wide) as object).length).toBeLessThanOrEqual(42);
  });
});
