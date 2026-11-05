// Shapes of Instagram's official "Download your information" JSON export (§6.1).
// The format drifts over time, so every schema is loose (unknown keys allowed) and every
// field we read is optional; the parser decides what's usable and reports the rest.
import { z } from 'zod';

/** `{ href, value, timestamp }`. Newer exports drop `value` for following and use `title`. */
export const StringListItemSchema = z.looseObject({
  href: z.string().optional(),
  value: z.string().optional(),
  timestamp: z.number().optional(),
});

export const RelationshipEntrySchema = z.looseObject({
  title: z.string().optional(),
  string_list_data: z.array(StringListItemSchema).optional(),
});
export type RelationshipEntry = z.infer<typeof RelationshipEntrySchema>;

const Entries = z.array(RelationshipEntrySchema);

/** followers_1.json: a bare array (most exports) or wrapped (some versions). */
export const FollowersFileSchema = z.union([
  Entries,
  z.looseObject({ relationships_followers: Entries }),
]);

/** following.json */
export const FollowingFileSchema = z.union([
  z.looseObject({ relationships_following: Entries }),
  Entries,
]);

/** Other relationship files: one `relationships_*` key holding entries. */
export const OTHER_RELATIONSHIP_KEYS = {
  pending_follow_requests: 'relationships_follow_requests_sent',
  close_friends: 'relationships_close_friends',
  blocked_profiles: 'relationships_blocked_users',
  recently_unfollowed: 'relationships_unfollowed_users',
  restricted_profiles: 'relationships_restricted_users',
  removed_suggestions: 'relationships_dismissed_suggested_users',
  follow_requests_received: 'relationships_follow_requests_received',
  hide_story_from: 'relationships_hide_stories_from',
} as const;

/** Pre-2021 `connections.json`: `{ followers: { username: isoDate }, following: {...} }`. */
export const LegacyConnectionsSchema = z.looseObject({
  followers: z.record(z.string(), z.unknown()).optional(),
  following: z.record(z.string(), z.unknown()).optional(),
});

/** personal_information.json: used only to check the export belongs to the detected account. */
export const PersonalInfoSchema = z.looseObject({
  profile_user: z
    .array(
      z.looseObject({
        string_map_data: z.record(z.string(), z.looseObject({ value: z.string().optional() })),
      }),
    )
    .min(1),
});
