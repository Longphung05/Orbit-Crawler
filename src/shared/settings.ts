// User-configurable settings (CLAUDE.md §5.1, §7.3, §7.4, §8.3, §9).
import { z } from 'zod';

export const OrbitSettingsSchema = z.object({
  firstDegreeMode: z.enum(['following', 'mutual', 'either']),
  undirected: z.boolean(),
  hubFollowerThreshold: z.number().int().positive(),
  excludeHubsAsIntermediaries: z.boolean(),
  /** Max follower rows stored for a hub's follower list (§7.4). */
  hubFollowerListCap: z.number().int().positive(),
  staleAfterDays: z.number().int().positive(),
  /** Exclude edges unconfirmed for staleAfterDays (otherwise they're only dimmed). */
  excludeStale: z.boolean(),
});

export type OrbitSettings = z.infer<typeof OrbitSettingsSchema>;

export const DEFAULT_SETTINGS: Readonly<OrbitSettings> = Object.freeze({
  firstDegreeMode: 'following',
  undirected: false,
  hubFollowerThreshold: 50_000,
  excludeHubsAsIntermediaries: true,
  hubFollowerListCap: 2_000,
  staleAfterDays: 90,
  excludeStale: false,
});
