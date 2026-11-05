// User-configurable settings (CLAUDE.md §5.1, §7.3, §8.3, §9).

export interface OrbitSettings {
  firstDegreeMode: 'following' | 'mutual' | 'either';
  undirected: boolean;
  hubFollowerThreshold: number;
  excludeHubsAsIntermediaries: boolean;
  staleAfterDays: number;
  excludeStale: boolean;
}

export const DEFAULT_SETTINGS: Readonly<OrbitSettings> = Object.freeze({
  firstDegreeMode: 'following',
  undirected: false,
  hubFollowerThreshold: 50_000,
  excludeHubsAsIntermediaries: true,
  staleAfterDays: 90,
  excludeStale: false,
});
