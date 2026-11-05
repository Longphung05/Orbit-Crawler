// Turn one observed Instagram response into adapter-neutral capture events (§6.2).
// Pure and total: every input yields an outcome; nothing throws.
import { z } from 'zod';
import { NodeObservationSchema, UsernameSchema, type NodeObservation } from '../../db/validation';
import {
  FriendshipListSchema,
  FriendshipStatusSchema,
  GraphqlProfileSchema,
  IgProfileSchema,
  IgUserRowSchema,
  UserInfoSchema,
  WebProfileInfoSchema,
  type IgUserRow,
} from './schemas';
import { skeleton, type Skeleton } from './skeleton';
import { matchUrl, pathTemplate, type ListKind, type PayloadType } from './urls';

export interface Friendship {
  viewerFollows?: boolean;
  followsViewer?: boolean;
  requested?: boolean;
}

export interface MutualHint {
  /** "Followed by" accounts with known ids (all are accounts the viewer follows). */
  users: NodeObservation[];
  /** Ones known only by username. */
  usernames: string[];
  count?: number;
}

export type CaptureEvent =
  | { kind: 'profile'; user: NodeObservation; friendship?: Friendship; mutuals?: MutualHint }
  | { kind: 'friendship'; userId: string; friendship: Friendship }
  | { kind: 'profile_missing'; username: string }
  | {
      kind: 'list_page';
      ownerId: string;
      direction: ListKind;
      rows: NodeObservation[];
      isFirstPage: boolean;
      isLastPage: boolean;
      filtered: boolean;
    };

export type AdapterOutcome =
  | {
      status: 'ok';
      payloadType: PayloadType;
      endpoint: string;
      events: CaptureEvent[];
      skippedRows: number;
    }
  | {
      status: 'schema_error';
      payloadType: PayloadType;
      endpoint: string;
      error: string;
      shape: Skeleton;
    }
  | { status: 'ignored'; reason: string };

export interface ObservedResponse {
  url: string;
  status: number;
  text: string;
}

function toObservation(
  row: IgUserRow,
  extra: Partial<NodeObservation> = {},
): NodeObservation | undefined {
  const id = row.pk_id ?? row.pk ?? row.id;
  if (!id) return undefined;
  const obs: NodeObservation = { id, username: row.username, ...extra };
  if (row.full_name) obs.fullName = row.full_name;
  if (typeof row.is_private === 'boolean') obs.isPrivate = row.is_private;
  if (typeof row.is_verified === 'boolean') obs.isVerified = row.is_verified;
  if (row.profile_pic_url?.startsWith('https://')) obs.profilePicUrl = row.profile_pic_url;
  const res = NodeObservationSchema.safeParse(obs);
  return res.success ? res.data : undefined;
}

/** Parse rows one by one: a single odd row shouldn't drop a whole page. */
function parseRows(raw: readonly unknown[]): { rows: NodeObservation[]; skipped: number } {
  const rows: NodeObservation[] = [];
  let skipped = 0;
  for (const r of raw) {
    const parsed = IgUserRowSchema.safeParse(r);
    const obs = parsed.success ? toObservation(parsed.data) : undefined;
    if (obs) rows.push(obs);
    else skipped++;
  }
  return { rows, skipped };
}

function friendshipFrom(
  fs: z.infer<typeof FriendshipStatusSchema> | null | undefined,
): Friendship | undefined {
  if (!fs) return undefined;
  const f: Friendship = {};
  if (typeof fs.following === 'boolean') f.viewerFollows = fs.following;
  if (typeof fs.followed_by === 'boolean') f.followsViewer = fs.followed_by;
  if (typeof fs.outgoing_request === 'boolean') f.requested = fs.outgoing_request;
  return Object.keys(f).length ? f : undefined;
}

function issue(err: z.ZodError): string {
  const i = err.issues[0];
  return i ? `${i.path.join('.') || '(root)'}: ${i.message}` : 'unexpected shape';
}

export function interpretResponse(res: ObservedResponse): AdapterOutcome {
  const match = matchUrl(res.url);
  if (!match) return { status: 'ignored', reason: 'not an endpoint Orbit reads' };
  const endpoint = pathTemplate(res.url);
  const payloadType = match.type;

  // A missing profile: deactivated, deleted, banned, or blocking the viewer (§9).
  if (match.type === 'web_profile_info' && res.status === 404) {
    const u = UsernameSchema.safeParse(match.username);
    return u.success
      ? {
          status: 'ok',
          payloadType,
          endpoint,
          events: [{ kind: 'profile_missing', username: u.data }],
          skippedRows: 0,
        }
      : { status: 'ignored', reason: 'missing profile without a username' };
  }
  if (res.status !== 200) return { status: 'ignored', reason: `HTTP ${res.status}` };

  let json: unknown;
  try {
    json = JSON.parse(res.text);
  } catch {
    return {
      status: 'schema_error',
      payloadType,
      endpoint,
      error: 'response is not JSON',
      shape: 'string',
    };
  }
  // Instagram signals rate limits / login walls with {status:"fail"}: not a schema change.
  if (json && typeof json === 'object' && (json as { status?: unknown }).status === 'fail') {
    return { status: 'ignored', reason: 'instagram returned status=fail' };
  }
  const fail = (err: z.ZodError | string): AdapterOutcome => ({
    status: 'schema_error',
    payloadType,
    endpoint,
    error: typeof err === 'string' ? err : issue(err),
    shape: skeleton(json),
  });

  switch (match.type) {
    case 'friendship_list': {
      const parsed = FriendshipListSchema.safeParse(json);
      if (!parsed.success) return fail(parsed.error);
      const { rows, skipped } = parseRows(parsed.data.users);
      if (rows.length === 0 && skipped > 0) return fail('no list rows matched the user schema');
      const next = parsed.data.next_max_id;
      return {
        status: 'ok',
        payloadType,
        endpoint,
        skippedRows: skipped,
        events: [
          {
            kind: 'list_page',
            ownerId: match.ownerId,
            direction: match.direction,
            rows,
            isFirstPage: match.isFirstPage,
            isLastPage: next === null || next === undefined || next === '',
            filtered: match.filtered,
          },
        ],
      };
    }

    case 'web_profile_info': {
      const parsed = WebProfileInfoSchema.safeParse(json);
      if (!parsed.success) return fail(parsed.error);
      const user = parsed.data.data.user;
      if (!user) {
        const u = UsernameSchema.safeParse(match.username);
        return u.success
          ? {
              status: 'ok',
              payloadType,
              endpoint,
              events: [{ kind: 'profile_missing', username: u.data }],
              skippedRows: 0,
            }
          : { status: 'ignored', reason: 'empty profile without a username' };
      }
      const extra: Partial<NodeObservation> = {};
      if (user.edge_followed_by) extra.followerCount = user.edge_followed_by.count;
      if (user.edge_follow) extra.followingCount = user.edge_follow.count;
      const obs = toObservation({ ...user, id: user.id }, extra);
      if (!obs) return fail('profile has no usable id/username');
      const friendship: Friendship = {};
      if (typeof user.followed_by_viewer === 'boolean')
        friendship.viewerFollows = user.followed_by_viewer;
      if (typeof user.follows_viewer === 'boolean') friendship.followsViewer = user.follows_viewer;
      if (typeof user.requested_by_viewer === 'boolean')
        friendship.requested = user.requested_by_viewer;
      const event: CaptureEvent = { kind: 'profile', user: obs };
      if (Object.keys(friendship).length) event.friendship = friendship;
      const m = user.edge_mutual_followed_by;
      if (m) {
        const users: NodeObservation[] = [];
        const usernames: string[] = [];
        for (const e of m.edges ?? []) {
          const withId = e.node.id
            ? toObservation({ id: e.node.id, username: e.node.username })
            : undefined;
          if (withId) users.push(withId);
          else if (UsernameSchema.safeParse(e.node.username).success)
            usernames.push(e.node.username);
        }
        const hint: MutualHint = { users, usernames };
        if (typeof m.count === 'number') hint.count = m.count;
        event.mutuals = hint;
      }
      return { status: 'ok', payloadType, endpoint, events: [event], skippedRows: 0 };
    }

    case 'user_info':
    case 'graphql_profile': {
      let u: z.infer<typeof IgProfileSchema>;
      if (match.type === 'user_info') {
        const parsed = UserInfoSchema.safeParse(json);
        if (!parsed.success) return fail(parsed.error);
        u = parsed.data.user;
      } else {
        const parsed = GraphqlProfileSchema.safeParse(json);
        // GraphQL carries many query types; a non-profile shape is not drift.
        if (!parsed.success) return { status: 'ignored', reason: 'not a profile query' };
        u = parsed.data.data.user;
      }
      const extra: Partial<NodeObservation> = {};
      if (typeof u.follower_count === 'number') extra.followerCount = u.follower_count;
      if (typeof u.following_count === 'number') extra.followingCount = u.following_count;
      const obs = toObservation(u, extra);
      if (!obs) return fail('profile has no usable id/username');
      if (match.type === 'user_info' && obs.id !== match.userId)
        return fail('profile id does not match the URL');
      const event: CaptureEvent = { kind: 'profile', user: obs };
      const f = friendshipFrom(u.friendship_status);
      if (f) event.friendship = f;
      if (u.profile_context_facepile_users) {
        const { rows } = parseRows(u.profile_context_facepile_users);
        const hint: MutualHint = { users: rows, usernames: [] };
        if (typeof u.mutual_followers_count === 'number') hint.count = u.mutual_followers_count;
        event.mutuals = hint;
      }
      return { status: 'ok', payloadType, endpoint, events: [event], skippedRows: 0 };
    }

    case 'friendship_status': {
      const parsed = FriendshipStatusSchema.safeParse(json);
      if (!parsed.success) return fail(parsed.error);
      const f = friendshipFrom(parsed.data);
      if (!f) return fail('no friendship fields');
      return {
        status: 'ok',
        payloadType,
        endpoint,
        events: [{ kind: 'friendship', userId: match.userId, friendship: f }],
        skippedRows: 0,
      };
    }
  }
}
