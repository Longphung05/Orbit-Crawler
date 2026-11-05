// zod schemas for Instagram web responses (§6.2). Loose by design: unknown keys are allowed and
// only the fields Orbit reads are declared. Bump ADAPTER_VERSION whenever these change.
import { z } from 'zod';

/** Instagram ids arrive as strings or numbers; normalise to digit strings. */
export const IgIdSchema = z
  .union([z.string().regex(/^\d{1,25}$/), z.number().int().nonnegative()])
  .transform(String);

const Count = z.number().int().nonnegative();
const Flag = z.boolean().nullish();

/** A user row as it appears in follower/following lists and facepiles. */
export const IgUserRowSchema = z.looseObject({
  pk: IgIdSchema.nullish(),
  pk_id: IgIdSchema.nullish(),
  id: IgIdSchema.nullish(),
  username: z.string(),
  full_name: z.string().nullish(),
  is_private: Flag,
  is_verified: Flag,
  profile_pic_url: z.string().nullish(),
});
export type IgUserRow = z.infer<typeof IgUserRowSchema>;

/** `/api/v1/friendships/{id}/{following|followers}/` */
export const FriendshipListSchema = z.looseObject({
  users: z.array(z.unknown()),
  next_max_id: z.union([z.string(), z.number()]).nullish(),
  big_list: Flag,
  status: z.string().optional(),
});

/** Relationship between the viewer and a profile. */
export const FriendshipStatusSchema = z.looseObject({
  following: Flag,
  followed_by: Flag,
  outgoing_request: Flag,
  blocking: Flag,
  is_private: Flag,
});

/** v1 user object (`/api/v1/users/{id}/info/`, and GraphQL profile queries). */
export const IgProfileSchema = IgUserRowSchema.extend({
  follower_count: Count.nullish(),
  following_count: Count.nullish(),
  friendship_status: FriendshipStatusSchema.nullish(),
  profile_context_facepile_users: z.array(z.unknown()).nullish(),
  mutual_followers_count: Count.nullish(),
});

export const UserInfoSchema = z.looseObject({ user: IgProfileSchema });

export const GraphqlProfileSchema = z.looseObject({
  data: z.looseObject({ user: IgProfileSchema }),
});

/** `/api/v1/users/web_profile_info/?username=` (older "edge" style). */
export const WebProfileUserSchema = z.looseObject({
  id: IgIdSchema,
  username: z.string(),
  full_name: z.string().nullish(),
  is_private: Flag,
  is_verified: Flag,
  profile_pic_url: z.string().nullish(),
  edge_followed_by: z.looseObject({ count: Count }).nullish(),
  edge_follow: z.looseObject({ count: Count }).nullish(),
  followed_by_viewer: Flag,
  follows_viewer: Flag,
  requested_by_viewer: Flag,
  blocked_by_viewer: Flag,
  edge_mutual_followed_by: z
    .looseObject({
      count: Count.nullish(),
      edges: z
        .array(
          z.looseObject({
            node: z.looseObject({ username: z.string(), id: IgIdSchema.nullish() }),
          }),
        )
        .nullish(),
    })
    .nullish(),
});

export const WebProfileInfoSchema = z.looseObject({
  data: z.looseObject({ user: WebProfileUserSchema.nullable() }),
});
