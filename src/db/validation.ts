// DB boundary validation (§12: all external data passes through zod before touching the DB).
import { z } from 'zod';

/** Instagram numeric user id (pk). Placeholder ids can never be passed in as observations. */
export const IgUserIdSchema = z.string().regex(/^\d{1,25}$/, 'expected a numeric Instagram id');

/** Instagram usernames: letters, digits, periods, underscores, max 30. */
export const UsernameSchema = z
  .string()
  .min(1)
  .max(30)
  .regex(/^[A-Za-z0-9._]+$/, 'invalid Instagram username');

export const NodeObservationSchema = z.object({
  id: IgUserIdSchema,
  username: UsernameSchema,
  fullName: z.string().max(300).optional(),
  profilePicUrl: z.url({ protocol: /^https$/ }).optional(),
  isPrivate: z.boolean().optional(),
  isVerified: z.boolean().optional(),
  followerCount: z.number().int().nonnegative().optional(),
  followingCount: z.number().int().nonnegative().optional(),
});
export type NodeObservation = z.infer<typeof NodeObservationSchema>;

export const ListDirectionSchema = z.enum(['following', 'followers', 'mutuals']);
export type ListDirection = z.infer<typeof ListDirectionSchema>;

export const TimestampSchema = z.number().int().nonnegative();
