import { OrbitGraph, type GraphEdge, type GraphNodeInfo } from '../../src/graph';
import { DEFAULT_REACH_OPTIONS, type ReachOptions } from '../../src/graph/reach';

/** `edges('V>A A>B B>C')` → GraphEdge[]. Synthetic, invented ids only. */
export function edges(spec: string): GraphEdge[] {
  return spec
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((pair) => {
      const [from, to] = pair.split('>');
      if (!from || !to) throw new Error(`bad edge spec: ${pair}`);
      return { from, to };
    });
}

export function graph(spec: string, nodes: GraphNodeInfo[] = []): OrbitGraph {
  return OrbitGraph.build(edges(spec), nodes);
}

/** Deterministic PRNG for reproducible random graphs. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

export interface RefReach {
  degree: number;
  pathCount: number;
  connectors: string[];
}

/**
 * Brute-force reference: enumerate every walk of length ≤ maxDepth from the viewer and keep
 * the shortest. Exponential, so only for tiny graphs, but obviously correct.
 */
export function referenceReach(
  edgeList: GraphEdge[],
  nodes: GraphNodeInfo[],
  viewer: string,
  options: Partial<ReachOptions> = {},
): Map<string, RefReach> {
  const opts = { ...DEFAULT_REACH_OPTIONS, ...options };
  const set = new Set<string>();
  const ids = new Set<string>([viewer]);
  for (const e of edgeList) {
    if (e.stale || e.from === e.to) continue;
    set.add(`${e.from}>${e.to}`);
    ids.add(e.from);
    ids.add(e.to);
  }
  const info = new Map(nodes.map((n) => [n.id, n]));
  const has = (a: string, b: string): boolean => set.has(`${a}>${b}`);
  const rel = (a: string, b: string): boolean => has(a, b) || (opts.undirected && has(b, a));
  const unavailable = (x: string): boolean => info.get(x)?.unavailable === true;
  const isHub = (x: string): boolean =>
    opts.excludeHubsAsIntermediaries &&
    (info.get(x)?.followerCount ?? Number.NaN) > opts.hubFollowerThreshold;
  const target = (x: string): boolean =>
    x !== viewer && (opts.includeUnavailable || !unavailable(x));
  const expand = (x: string): boolean => !unavailable(x) && !isHub(x);
  const first = (x: string): boolean => {
    if (opts.undirected) return has(viewer, x) || has(x, viewer);
    switch (opts.firstDegreeMode) {
      case 'following':
        return has(viewer, x);
      case 'either':
        return has(viewer, x) || has(x, viewer);
      case 'mutual':
        return has(viewer, x) && has(x, viewer);
    }
  };

  const walks: string[][] = [];
  const all = [...ids];
  for (const a of all) {
    if (!first(a) || !target(a)) continue;
    walks.push([viewer, a]);
    if (opts.maxDepth < 2 || !expand(a)) continue;
    for (const b of all) {
      if (!rel(a, b) || !target(b)) continue;
      walks.push([viewer, a, b]);
      if (opts.maxDepth < 3 || !expand(b)) continue;
      for (const c of all) if (rel(b, c) && target(c)) walks.push([viewer, a, b, c]);
    }
  }

  const result = new Map<string, RefReach>();
  for (const w of walks) {
    const x = w[w.length - 1] as string;
    const len = w.length - 1;
    const cur = result.get(x);
    if (!cur || len < cur.degree) {
      result.set(x, { degree: len, pathCount: 1, connectors: [w[1] as string] });
    } else if (len === cur.degree) {
      cur.pathCount++;
      if (!cur.connectors.includes(w[1] as string)) cur.connectors.push(w[1] as string);
    }
  }
  for (const r of result.values()) r.connectors.sort();
  return result;
}
