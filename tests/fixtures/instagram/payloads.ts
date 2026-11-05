// SYNTHETIC Instagram web payloads with invented accounts (§12). They mirror the response shapes
// Orbit's adapter expects; they are not recordings. When a real response shape differs, add a
// sanitized fixture here (fake usernames and ids, structure preserved) alongside the fix.

export const IG = 'https://www.instagram.com';
export const VIEWER = '1000000001';

const row = (pk: string, username: string, extra: Record<string, unknown> = {}) => ({
  pk,
  pk_id: pk,
  id: pk,
  username,
  full_name: `Fake ${username}`,
  is_private: false,
  is_verified: false,
  profile_pic_url: `https://scontent.example.invalid/${pk}.jpg`,
  ...extra,
});

export const followingPage1 = {
  url: `${IG}/api/v1/friendships/${VIEWER}/following/?count=12`,
  body: {
    users: [row('2000000001', 'fake_alex'), row('2000000002', 'fake_jamie')],
    big_list: true,
    page_size: 12,
    next_max_id: '12',
    status: 'ok',
  },
};

export const followingPage2 = {
  url: `${IG}/api/v1/friendships/${VIEWER}/following/?count=12&max_id=12`,
  body: {
    users: [row('2000000003', 'fake.casey', { is_private: true })],
    big_list: false,
    page_size: 12,
    status: 'ok',
  },
};

export const followersOfAlex = {
  url: `${IG}/api/v1/friendships/2000000001/followers/?count=12&search_surface=follow_list_page`,
  body: {
    users: [row('3000000001', 'fake_morgan'), row(VIEWER, 'fake_me')],
    big_list: false,
    status: 'ok',
  },
};

export const followingSearch = {
  url: `${IG}/api/v1/friendships/2000000001/following/?count=12&query=fa`,
  body: { users: [row('3000000002', 'fake_riley')], status: 'ok' },
};

export const mutualsOfTarget = {
  url: `${IG}/api/v1/friendships/4000000001/mutual_followers/`,
  body: { users: [row('2000000001', 'fake_alex')], status: 'ok' },
};

/** Older "edge"-style profile endpoint; private account the viewer doesn't follow. */
export const webProfilePrivate = {
  url: `${IG}/api/v1/users/web_profile_info/?username=fake_target`,
  body: {
    data: {
      user: {
        id: '4000000001',
        username: 'fake_target',
        full_name: 'Fake Target',
        is_private: true,
        is_verified: false,
        profile_pic_url: 'https://scontent.example.invalid/4000000001.jpg',
        edge_followed_by: { count: 812 },
        edge_follow: { count: 301 },
        followed_by_viewer: false,
        follows_viewer: false,
        requested_by_viewer: true,
        edge_mutual_followed_by: {
          count: 3,
          edges: [
            { node: { username: 'fake_alex' } },
            { node: { username: 'fake_unknown_mutual' } },
          ],
        },
      },
    },
    status: 'ok',
  },
};

export const webProfileMissing = {
  url: `${IG}/api/v1/users/web_profile_info/?username=fake_gone`,
  status: 404,
  body: { message: 'User not found', status: 'fail' },
};

/** v1 info endpoint with friendship status and a facepile. */
export const userInfoAlex = {
  url: `${IG}/api/v1/users/2000000001/info/`,
  body: {
    user: {
      ...row('2000000001', 'fake_alex'),
      follower_count: 640,
      following_count: 210,
      friendship_status: { following: true, followed_by: true, outgoing_request: false },
      profile_context_facepile_users: [row('2000000002', 'fake_jamie')],
      mutual_followers_count: 7,
    },
    status: 'ok',
  },
};

/** GraphQL profile query (newer web). */
export const graphqlProfile = {
  url: `${IG}/graphql/query`,
  body: {
    data: {
      user: {
        pk: '5000000001',
        id: '5000000001',
        username: 'fake_celeb',
        full_name: 'Fake Celeb',
        is_private: false,
        is_verified: true,
        follower_count: 9_000_000,
        following_count: 12,
        friendship_status: { following: false, followed_by: false, outgoing_request: false },
      },
    },
    extensions: { is_final: true },
  },
};

/** GraphQL that has nothing to do with profiles (feed etc). */
export const graphqlFeed = {
  url: `${IG}/graphql/query`,
  body: { data: { xdt_api__v1__feed__timeline__connection: { edges: [] } } },
};

export const friendshipShow = {
  url: `${IG}/api/v1/friendships/show/2000000002/`,
  body: {
    following: false,
    followed_by: true,
    blocking: false,
    outgoing_request: false,
    status: 'ok',
  },
};

/** A list payload whose shape drifted (users renamed): must be reported, never applied. */
export const driftedList = {
  url: `${IG}/api/v1/friendships/${VIEWER}/followers/?count=12`,
  body: { items_v2: [{ user_id: '1', handle: 'fake_x' }], status: 'ok' },
};

export function response(p: { url: string; body: unknown; status?: number }) {
  return { url: p.url, status: p.status ?? 200, text: JSON.stringify(p.body) };
}
