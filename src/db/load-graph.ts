// DB → pure graph engine bridge. The engine never imports Dexie; this module adapts records.
import { OrbitGraph, type GraphEdge, type GraphNodeInfo } from '../graph';
import type { OrbitSettings } from '../shared/settings';
import type { Coverage, Edge, UserNode } from '../shared/types';
import type { ViewerStore } from './viewer-store';

const DAY_MS = 86_400_000;
const RANK: Record<Coverage, number> = { none: 0, partial: 1, complete: 2 };
const maxCoverage = (a: Coverage = 'none', b: Coverage = 'none'): Coverage =>
  RANK[a] >= RANK[b] ? a : b;

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
  if (n.mutualsCompleteAt !== undefined) info.mutualsComplete = true;
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

export interface GraphSnapshot {
  graph: OrbitGraph;
  /** Every stored account, by id, for turning graph ids back into people. */
  nodes: ReadonlyMap<string, UserNode>;
  settings: OrbitSettings;
  /** Most recent time any known edge was confirmed (the graph's freshness), or null if empty. */
  updatedAt: number | null;
}

export async function loadSnapshot(store: ViewerStore, now: number): Promise<GraphSnapshot> {
  const [nodes, edges, settings] = await Promise.all([
    store.allNodes(),
    store.allEdges(),
    store.getSettings(),
  ]);
  const minConfirmedAt = settings.excludeStale ? now - settings.staleAfterDays * DAY_MS : undefined;
  let updatedAt: number | null = null;
  for (const e of edges)
    if (updatedAt === null || e.lastConfirmedAt > updatedAt) updatedAt = e.lastConfirmedAt;
  const infos = nodes.map(toGraphNode);
  const meta = await store.db.viewers.get(store.viewerId);
  if (meta?.followingCoverage || meta?.followersCoverage) {
    // The viewer's own list coverage may live only on the viewer record (see completeList).
    let info = infos.find((i) => i.id === store.viewerId);
    if (!info) infos.push((info = { id: store.viewerId }));
    info.followingCoverage = maxCoverage(info.followingCoverage, meta.followingCoverage);
    info.followersCoverage = maxCoverage(info.followersCoverage, meta.followersCoverage);
  }
  const graph = OrbitGraph.build(
    edges.map(toGraphEdge),
    infos,
    minConfirmedAt === undefined ? {} : { minConfirmedAt },
  );
  return { graph, nodes: new Map(nodes.map((n) => [n.id, n])), settings, updatedAt };
}

export async function loadGraph(store: ViewerStore, now: number): Promise<OrbitGraph> {
  return (await loadSnapshot(store, now)).graph;
}
