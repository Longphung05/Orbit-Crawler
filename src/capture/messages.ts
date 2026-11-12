// Messages between Orbit's scripts. Everything crossing a boundary is validated (§12).
import { z } from 'zod';
import { ORBIT_CHANNEL } from '../adapters/instagram/constants';
import { UsernameSchema } from '../db/validation';

/** Page observer (MAIN world) ⇄ content script (isolated world), via window.postMessage. */
export const PageMessageSchema = z.discriminatedUnion('type', [
  z.object({ __orbit: z.literal(ORBIT_CHANNEL), type: z.literal('hello') }),
  z.object({ __orbit: z.literal(ORBIT_CHANNEL), type: z.literal('ready') }),
  z.object({
    __orbit: z.literal(ORBIT_CHANNEL),
    type: z.literal('response'),
    url: z.string().max(4096),
    status: z.number().int(),
    text: z.string(),
  }),
]);
export type PageMessage = z.infer<typeof PageMessageSchema>;

/** Content script → background, via runtime.sendMessage. */
export const RuntimeMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('orbit/response'),
    url: z.string().max(4096),
    status: z.number().int(),
    text: z.string(),
    at: z.number().int().nonnegative(),
    /** The tab's detected account, so a restarted service worker can attribute it. */
    viewerId: z
      .string()
      .regex(/^\d{1,25}$/)
      .nullable(),
    /**
     * The page's path when the response arrived (e.g. `/name/following/`). Names the owner of a
     * list whose payload only carries a numeric id.
     */
    pagePath: z.string().max(512).optional(),
  }),
  /** The "Followed by a, b and N others" line read from a profile header (low confidence). */
  z.object({
    type: z.literal('orbit/dom-mutuals'),
    profile: UsernameSchema,
    usernames: z.array(UsernameSchema).min(1).max(25),
    others: z.number().int().nonnegative().max(100_000_000).optional(),
    viewerId: z
      .string()
      .regex(/^\d{1,25}$/)
      .nullable(),
    at: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('orbit/viewer'),
    viewerId: z
      .string()
      .regex(/^\d{1,25}$/)
      .nullable(),
    username: z.string().optional(),
    strategy: z.string().max(64),
    at: z.number().int().nonnegative(),
  }),
]);
export type RuntimeMessage = z.infer<typeof RuntimeMessageSchema>;

export { MAX_FORWARDED_BYTES } from '../adapters/instagram/constants';
