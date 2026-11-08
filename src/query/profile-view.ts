// Turn the graph engine's answer for one profile into the badge's view model (§8.1, §8.2).
// Pure: no Dexie, no browser APIs. The service loads the data; this decides what to show.
import { groupPathsByConnector, type ReachResult } from '../graph';
import { PLACEHOLDER_PREFIX, type UserNode } from '../shared/types';
import type { BadgeState, PathsView, Person, ProfileViewOk } from './schemas';

export interface ViewContext {
  reach: ReachResult;
  nodes: ReadonlyMap<string, UserNode>;
  viewerId: string;
  viewerUsername: string | undefined;
  updatedAt: number | null;
  showAvatarImages: boolean;
}

/** At most this many connector avatars are stacked next to the badge. */
export const MAX_AVATARS = 3;
/** At most this many paths are listed in the popover (§7.2). */
export const MAX_LISTED_PATHS = 50;

const STATE_BY_DEGREE: Record<0 | 1 | 2 | 3, BadgeState> = {
  0: 'self',
  1: 'first',
  2: 'second',
  3: 'third',
};

export function toPerson(ctx: ViewContext, id: string): Person {
  const node = ctx.nodes.get(id);
  if (!node) {
    // The graph can hold an id with no stored node only after a partial wipe; stay readable.
    return {
      id,
      username: id.startsWith(PLACEHOLDER_PREFIX) ? id.slice(PLACEHOLDER_PREFIX.length) : id,
    };
  }
  const person: Person = { id, username: node.username };
  if (node.fullName) person.fullName = node.fullName;
  if (ctx.showAvatarImages && node.profilePicUrl) person.profilePicUrl = node.profilePicUrl;
  return person;
}

/**
 * Connectors worth showing as avatars: people with fewer followers first (a path through a friend
 * means more than one through a celebrity, §7.2), unknown counts last, then by name.
 */
function pickAvatars(ctx: ViewContext, connectorIds: readonly string[]): Person[] {
  const followers = (id: string): number =>
    ctx.nodes.get(id)?.followerCount ?? Number.POSITIVE_INFINITY;
  return [...connectorIds]
    .sort(
      (a, b) =>
        followers(a) - followers(b) ||
        (ctx.nodes.get(a)?.username ?? a).localeCompare(ctx.nodes.get(b)?.username ?? b) ||
        a.localeCompare(b),
    )
    .slice(0, MAX_AVATARS)
    .map((id) => toPerson(ctx, id));
}

/** Is this profile the viewer's own? (Matches by id, or by username before the node exists.) */
function isSelf(ctx: ViewContext, username: string, target: UserNode | undefined): boolean {
  if (target && !target.isPlaceholder && target.id === ctx.viewerId) return true;
  return (
    ctx.viewerUsername !== undefined && ctx.viewerUsername.toLowerCase() === username.toLowerCase()
  );
}

export function buildProfileView(
  ctx: ViewContext,
  username: string,
  target: UserNode | undefined,
): ProfileViewOk {
  const viewerIdx = ctx.reach.graph.indexOf(ctx.viewerId);
  const followingCode = viewerIdx === undefined ? 0 : ctx.reach.graph.followingCov[viewerIdx];
  const base = {
    status: 'ok' as const,
    firstLayer: (['none', 'partial', 'complete'] as const)[followingCode ?? 0] ?? 'none',
    username,
    knownAccounts: ctx.reach.graph.nodeCount,
    updatedAt: ctx.updatedAt,
    showAvatarImages: ctx.showAvatarImages,
    known: target !== undefined,
    unavailable: target?.unavailable === true,
    connectors: [] as Person[],
    hiddenHubCount: 0,
    connectorCount: 0,
  };
  const withNode = (v: ProfileViewOk): ProfileViewOk => {
    if (target?.isPrivate !== undefined) v.isPrivate = target.isPrivate;
    if (target) v.person = toPerson(ctx, target.id);
    return v;
  };

  if (isSelf(ctx, username, target)) {
    return withNode({
      ...base,
      state: 'self',
      degree: 0,
      degreeExact: true,
      connectorsExact: true,
    });
  }

  const reach = target ? ctx.reach.get(target.id) : undefined;
  if (!target || !reach) {
    // Orbit knows no path. That is "out of orbit", but never a claim that none exists. Large
    // accounts kept out of paths may still link you; say so (§7.3).
    return withNode({
      ...base,
      hiddenHubCount: target ? ctx.reach.hiddenHubs(target.id).length : 0,
      state: 'out_of_orbit',
      degree: null,
      degreeExact: false,
      connectorsExact: false,
    });
  }

  const confidence = ctx.reach.confidence(target.id);
  return withNode({
    ...base,
    state: STATE_BY_DEGREE[reach.degree],
    degree: reach.degree,
    degreeExact: confidence.degreeExact,
    connectorsExact: confidence.connectorsExact,
    connectorCount: reach.connectorCount,
    connectors: reach.degree === 1 ? [] : pickAvatars(ctx, ctx.reach.connectors(target.id)),
    hiddenHubCount: ctx.reach.hiddenHubs(target.id).length,
  });
}

export function buildPathsView(ctx: ViewContext, target: UserNode | undefined): PathsView {
  if (!target) return { status: 'ok', groups: [], total: 0, truncated: false };
  const result = ctx.reach.getPaths(target.id, { limit: MAX_LISTED_PATHS });
  const groups = groupPathsByConnector(result.paths).map((g) => ({
    connector: toPerson(ctx, g.connector),
    // [viewer, a, ..., target] → drop nothing: the UI renders "You" for the first entry.
    paths: g.paths.map((p) => p.map((id) => toPerson(ctx, id))),
  }));
  return { status: 'ok', groups, total: result.total, truncated: result.truncated };
}
