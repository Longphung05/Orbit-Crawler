// Messages and view models for the profile badge (§8.1, §8.2). Everything that crosses between
// the page's content script and the background is validated (§12).
import { z } from 'zod';
import { UsernameSchema } from '../db/validation';

const ViewerIdSchema = z.string().regex(/^\d{1,25}$/);

/** Content script → background. */
export const QueryRequestSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('orbit/profile'),
    username: UsernameSchema,
    /** The tab's detected account, so a restarted service worker can attribute it. */
    viewerId: ViewerIdSchema.nullable(),
  }),
  z.object({
    type: z.literal('orbit/paths'),
    username: UsernameSchema,
    viewerId: ViewerIdSchema.nullable(),
  }),
]);
export type QueryRequest = z.infer<typeof QueryRequestSchema>;

/** Extension page (side panel) → background: the graph was rewritten (import, wipe, restore). */
export const GraphChangedSchema = z.object({ type: z.literal('orbit/graph-changed') });

/** Background → content script: the graph changed, ask again. */
export const RefreshSchema = z.object({ type: z.literal('orbit/refresh') });

/** One account, as shown in the badge. Never contains anything the page didn't already show. */
export const PersonSchema = z.object({
  id: z.string().max(80),
  username: z.string().max(80),
  fullName: z.string().max(300).optional(),
  profilePicUrl: z.string().max(2048).optional(),
});
export type Person = z.infer<typeof PersonSchema>;

export const BadgeStateSchema = z.enum(['self', 'first', 'second', 'third', 'out_of_orbit']);
export type BadgeState = z.infer<typeof BadgeStateSchema>;

export const ProfileViewSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    username: z.string(),
    state: BadgeStateSchema,
    /** Degree from the viewer, or null when no path is known. */
    degree: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).nullable(),
    /** False → the true degree may be closer (§5.2). */
    degreeExact: z.boolean(),
    /** False → there may be more connectors than counted (shown as `4+`). */
    connectorsExact: z.boolean(),
    /** Distinct people you follow who connect you ("via N"). */
    connectorCount: z.number().int().nonnegative(),
    /** Up to 3, for the stacked avatars. */
    connectors: z.array(PersonSchema).max(3),
    /** Large accounts kept out of the paths (§7.3). */
    hiddenHubCount: z.number().int().nonnegative(),
    isPrivate: z.boolean().optional(),
    unavailable: z.boolean(),
    /** Has Orbit stored this account at all? */
    known: z.boolean(),
    knownAccounts: z.number().int().nonnegative(),
    /** When the graph was last confirmed by anything you browsed or imported. */
    updatedAt: z.number().nullable(),
    showAvatarImages: z.boolean(),
    person: PersonSchema.optional(),
  }),
  z.object({ status: z.literal('no_viewer') }),
  z.object({ status: z.literal('error') }),
]);
export type ProfileView = z.infer<typeof ProfileViewSchema>;
export type ProfileViewOk = Extract<ProfileView, { status: 'ok' }>;

export const PathsViewSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    /** Paths grouped by the person you follow who starts them; each is you → … → target. */
    groups: z.array(
      z.object({
        connector: PersonSchema,
        paths: z.array(z.array(PersonSchema).min(2).max(4)),
      }),
    ),
    /** Shortest paths that exist in what Orbit knows (may exceed what is listed). */
    total: z.number().nonnegative(),
    truncated: z.boolean(),
  }),
  z.object({ status: z.literal('no_viewer') }),
  z.object({ status: z.literal('error') }),
]);
export type PathsView = z.infer<typeof PathsViewSchema>;
