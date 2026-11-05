// DB → pure graph engine bridge. The engine never imports Dexie; this module adapts records.
import { OrbitGraph, type GraphEdge, type GraphNodeInfo } from '../graph';
import type { OrbitSettings } from '../shared/settings';
import type { Edge, UserNode } from '../shared/types';
import type { ViewerStore } from './viewer-store';

const DAY_MS = 86_400_000;

export function toGraphEdge(e: Edge): GraphEdge {
  return { from: e.from, to: e.to, stale: e.stale, lastConfirmedAt: e.lastConfirmedAt };
}

export function toGraphNode(n: UserNode): GraphNodeInfo {
  const info: GraphNodeInfo = {
    id: n.id,
    username: n.username,
    followingCoverage: n.followingCoverage,
    // A capped hub list is by definition incomplete.
    followersCoverage: n.followersCapped ? 'partial' : n.followersCoverage,
  };
  if (n.followerCount !== undefined) info.followerCount = n.followerCount;
  if (n.unavailable) info.unavailable = true;
  return info;
}

/** Edges unconfirmed for `staleAfterDays` are "old": dimmed, or excluded if the setting says so. */
export function isOldEdge(
  e: Edge,
  settings: Pick<OrbitSettings, 'staleAfterDays'>,
  now: number,
): boolean {
  return now - e.lastConfirmedAt > settings.staleAfterDays * DAY_MS;
}

export async function loadGraph(store: ViewerStore, now: number): Promise<OrbitGraph> {
  const [nodes, edges, settings] = await Promise.all([
    store.allNodes(),
    store.allEdges(),
    store.getSettings(),
  ]);
  const minConfirmedAt = settings.excludeStale ? now - settings.staleAfterDays * DAY_MS : undefined;
  return OrbitGraph.build(
    edges.map(toGraphEdge),
    nodes.map(toGraphNode),
    minConfirmedAt === undefined ? {} : { minConfirmedAt },
  );
}
