// Degree, path counts, connectors, hub handling, confidence, and path enumeration (CLAUDE.md §5.2, §7).
import { DEFAULT_SETTINGS, type OrbitSettings } from '../shared/settings';
import { COMPLETE, type Csr, type OrbitGraph } from './graph';

export type Degree = 0 | 1 | 2 | 3;

export interface ReachOptions extends Pick<
  OrbitSettings,
  'firstDegreeMode' | 'undirected' | 'hubFollowerThreshold' | 'excludeHubsAsIntermediaries'
> {
  /** Unavailable accounts are never intermediaries; with this on they can still be targets. */
  includeUnavailable: boolean;
  maxDepth: 1 | 2 | 3;
}

export const DEFAULT_REACH_OPTIONS: Readonly<ReachOptions> = Object.freeze({
  firstDegreeMode: DEFAULT_SETTINGS.firstDegreeMode,
  undirected: DEFAULT_SETTINGS.undirected,
  hubFollowerThreshold: DEFAULT_SETTINGS.hubFollowerThreshold,
  excludeHubsAsIntermediaries: DEFAULT_SETTINGS.excludeHubsAsIntermediaries,
  includeUnavailable: false,
  maxDepth: 3,
});

export interface Reach {
  id: string;
  degree: Degree;
  /** Number of distinct shortest paths from the viewer. */
  pathCount: number;
  /** Distinct 1st-degree accounts starting any shortest path: the "via N" number. */
  connectorCount: number;
}

export interface Confidence {
  /** False → the true degree may be closer (UI shows `≥`). */
  degreeExact: boolean;
  /** False → more connectors may exist (UI shows `+`). */
  connectorsExact: boolean;
}

export interface PathOptions {
  limit?: number;
  /** Hard cap on paths materialised before sorting; protects against 3rd-degree blow-ups. */
  maxEnumerate?: number;
  /** Higher = you interact with this account more. Ranks paths first when provided. */
  interactionScore?: (id: string) => number;
}

export interface PathsResult {
  /** Each path is [viewer, ..., target] as ids, best first. */
  paths: string[][];
  /** Total number of shortest paths (may exceed paths.length). */
  total: number;
  /** True if enumeration hit maxEnumerate, so ranking covers only a subset. */
  truncated: boolean;
}

const EMPTY: readonly string[] = Object.freeze([]);

export class ReachResult {
  private readonly connectorCache = new Map<number, Int32Array>();
  /** Expandable 1st-degree nodes (sorted), used for confidence checks. */
  private readonly layer1: Int32Array;

  constructor(
    readonly graph: OrbitGraph,
    readonly viewerId: string,
    readonly options: Readonly<ReachOptions>,
    private readonly viewer: number,
    private readonly degrees: Int8Array,
    private readonly pathCounts: Float64Array,
    private readonly expandable: Uint8Array,
  ) {
    const l1: number[] = [];
    for (let i = 0; i < degrees.length; i++) if (degrees[i] === 1 && expandable[i]) l1.push(i);
    this.layer1 = Int32Array.from(l1);
  }

  // ── Lookups ────────────────────────────────────────────────────────────────

  degree(id: string): Degree | undefined {
    if (id === this.viewerId) return 0;
    const i = this.graph.indexOf(id);
    if (i === undefined) return undefined;
    const d = this.degrees[i]!;
    return d < 0 ? undefined : (d as Degree);
  }

  get(id: string): Reach | undefined {
    const degree = this.degree(id);
    if (degree === undefined) return undefined;
    if (degree === 0) return { id, degree, pathCount: 1, connectorCount: 0 };
    const i = this.graph.indexOf(id)!;
    return {
      id,
      degree,
      pathCount: this.pathCounts[i]!,
      connectorCount: this.connectorIdx(i).length,
    };
  }

  isHub(id: string): boolean {
    const i = this.graph.indexOf(id);
    return i !== undefined && this.isHubIdx(i);
  }

  countsByDegree(): Record<Degree, number> {
    const counts: Record<Degree, number> = { 0: 1, 1: 0, 2: 0, 3: 0 };
    for (const d of this.degrees) if (d > 0) counts[d as Degree]++;
    return counts;
  }

  /** Ids at a degree, sorted by connector count desc, then label (the "people you probably know" list). */
  rankedAtDegree(degree: 1 | 2 | 3): Reach[] {
    const out: Reach[] = [];
    for (let i = 0; i < this.degrees.length; i++) {
      if (this.degrees[i] === degree) {
        out.push({
          id: this.graph.idAt(i),
          degree,
          pathCount: this.pathCounts[i]!,
          connectorCount: this.connectorIdx(i).length,
        });
      }
    }
    return out.sort(
      (a, b) =>
        b.connectorCount - a.connectorCount ||
        cmpStr(this.label(a.id), this.label(b.id)) ||
        cmpStr(a.id, b.id),
    );
  }

  // ── Connectors / predecessors ─────────────────────────────────────────────

  /** Shortest-path predecessors (ids, sorted). */
  predecessors(id: string): readonly string[] {
    const i = this.graph.indexOf(id);
    if (i === undefined || this.degrees[i]! <= 0) return EMPTY;
    return this.toIds(this.predIdx(i));
  }

  /** Distinct 1st-degree accounts that start any shortest path to `id` (ids, sorted). */
  connectors(id: string): readonly string[] {
    const i = this.graph.indexOf(id);
    if (i === undefined || this.degrees[i]! <= 0) return EMPTY;
    return this.toIds(this.connectorIdx(i));
  }

  /**
   * Hubs excluded as intermediaries that would otherwise give an equal or shorter path to `id`
   * ("Also reachable via 2 large accounts (hidden)", §7.3).
   */
  hiddenHubs(id: string): readonly string[] {
    if (!this.options.excludeHubsAsIntermediaries || id === this.viewerId) return EMPTY;
    const x = this.graph.indexOf(id);
    if (x === undefined) return EMPTY;
    const dx = this.degrees[x]!;
    const result: number[] = [];
    const csr = this.reverseCsr();
    for (let r = csr.start[x]!; r < csr.start[x + 1]!; r++) {
      const h = csr.adj[r]!;
      const dh = this.degrees[h]!;
      if (dh < 1 || dh >= this.options.maxDepth) continue;
      if (this.graph.unavailable[h] || !this.isHubIdx(h)) continue;
      if (dx < 0 || dh + 1 <= dx) result.push(h);
    }
    return this.toIds(Int32Array.from(result));
  }

  // ── Confidence (§5.2: degrees are upper bounds, counts are lower bounds) ───

  confidence(id: string): Confidence {
    if (id === this.viewerId) return { degreeExact: true, connectorsExact: true };
    const x = this.graph.indexOf(id);
    if (x === undefined) return { degreeExact: false, connectorsExact: false };
    const d = this.degrees[x]!;
    if (d < 0) return { degreeExact: false, connectorsExact: false };
    if (d === 1) return { degreeExact: true, connectorsExact: true };

    const not1st = this.notFirstDegreeKnown(x);
    const layer1Complete = this.firstLayerComplete();
    // Every 1st-degree account's relationship to `target` is known: either the target's inbound
    // list is complete, or the 1st-degree layer itself is complete and each member is checked.
    const allL1Known = (target: number): boolean => {
      if (this.fullyKnownInbound(target)) return true;
      if (!layer1Complete) return false;
      for (const a of this.layer1) if (!this.relKnown(a, target)) return false;
      return true;
    };

    if (d === 2) {
      // Degree exact iff we know X isn't 1st. Connectors exact iff every 1st-degree A's
      // relationship to X is known (present, or absent with complete coverage).
      return { degreeExact: not1st, connectorsExact: allL1Known(x) };
    }

    // d === 3: X must also be provably not 2nd → no expandable 1st-degree A relates to X.
    const not2nd = allL1Known(x);
    // Connectors exact iff all of X's 2nd-degree predecessors are known, and for each, all its
    // 1st-degree predecessors are known.
    const allPredsOfXKnown = this.fullyKnownInbound(x);
    let predsComplete = allPredsOfXKnown;
    if (predsComplete) {
      for (const b of this.predIdx(x)) {
        if (!allL1Known(b)) {
          predsComplete = false;
          break;
        }
      }
    }
    return { degreeExact: not1st && not2nd, connectorsExact: predsComplete };
  }

  // ── Paths (§7.2) ──────────────────────────────────────────────────────────

  getPaths(targetId: string, opts: PathOptions = {}): PathsResult {
    const limit = opts.limit ?? 50;
    const maxEnumerate = opts.maxEnumerate ?? 10_000;
    const x = this.graph.indexOf(targetId);
    if (targetId === this.viewerId || x === undefined || this.degrees[x]! <= 0) {
      return { paths: [], total: 0, truncated: false };
    }

    const total = this.pathCounts[x]!;
    const raw: Int32Array[] = [];
    const d = this.degrees[x]!;
    const buf = new Int32Array(d + 1);
    buf[0] = this.viewer;
    let truncated = false;

    const walk = (node: number, depth: number): void => {
      buf[depth] = node;
      if (depth === 1) {
        raw.push(buf.slice());
        return;
      }
      for (const p of this.rankedIdx(this.predIdx(node))) {
        if (raw.length >= maxEnumerate) {
          truncated = true;
          return;
        }
        walk(p, depth - 1);
      }
    };
    walk(x, d);

    const score = opts.interactionScore;
    const keyed = raw.map((path) => {
      let interaction = 0;
      let maxFollowers = 0;
      let sumFollowers = 0;
      for (let k = 1; k < path.length - 1; k++) {
        const node = path[k]!;
        if (score) interaction += score(this.graph.idAt(node));
        const f = this.graph.followerCounts[node]!;
        const fc = Number.isNaN(f) ? Number.POSITIVE_INFINITY : f;
        maxFollowers = Math.max(maxFollowers, fc);
        if (!Number.isNaN(f)) sumFollowers += f;
      }
      const labels = Array.from(path, (n) => this.graph.labelAt(n)).join('\u0000');
      const ids = Array.from(path, (n) => this.graph.idAt(n));
      return { ids, interaction, maxFollowers, sumFollowers, labels };
    });

    keyed.sort(
      (a, b) =>
        b.interaction - a.interaction ||
        cmpNum(a.maxFollowers, b.maxFollowers) ||
        a.sumFollowers - b.sumFollowers ||
        cmpStr(a.labels, b.labels) ||
        cmpStr(a.ids.join('\u0000'), b.ids.join('\u0000')),
    );

    return { paths: keyed.slice(0, limit).map((k) => k.ids), total, truncated };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private isHubIdx(i: number): boolean {
    return this.graph.followerCounts[i]! > this.options.hubFollowerThreshold;
  }

  private label(id: string): string {
    const i = this.graph.indexOf(id);
    return i === undefined ? id : this.graph.labelAt(i);
  }

  /** Edges pointing *into* a node, in the traversal sense. */
  private reverseCsr(): Csr {
    return this.options.undirected ? this.graph.undirected() : this.graph.inn;
  }

  private predIdx(x: number): Int32Array {
    const d = this.degrees[x]!;
    if (d === 1) return Int32Array.of(this.viewer);
    const csr = this.reverseCsr();
    const preds: number[] = [];
    for (let r = csr.start[x]!; r < csr.start[x + 1]!; r++) {
      const u = csr.adj[r]!;
      if (this.degrees[u] === d - 1 && this.expandable[u]) preds.push(u);
    }
    return Int32Array.from(preds); // already sorted (CSR rows are sorted)
  }

  private connectorIdx(x: number): Int32Array {
    const d = this.degrees[x]!;
    if (d === 1) return Int32Array.of(x);
    if (d === 2) return this.predIdx(x);
    let cached = this.connectorCache.get(x);
    if (!cached) {
      const set = new Set<number>();
      for (const b of this.predIdx(x)) for (const a of this.predIdx(b)) set.add(a);
      cached = Int32Array.from(set).sort();
      this.connectorCache.set(x, cached);
    }
    return cached;
  }

  /** Sort indices for enumeration: fewer followers first (unknown last), then label, then id. */
  private rankedIdx(idx: Int32Array): number[] {
    const g = this.graph;
    const fc = (i: number): number => {
      const f = g.followerCounts[i]!;
      return Number.isNaN(f) ? Number.POSITIVE_INFINITY : f;
    };
    return Array.from(idx).sort(
      (a, b) =>
        cmpNum(fc(a), fc(b)) || cmpStr(g.labelAt(a), g.labelAt(b)) || cmpStr(g.idAt(a), g.idAt(b)),
    );
  }

  private toIds(idx: ArrayLike<number>): string[] {
    return Array.from(idx, (i) => this.graph.idAt(i)).sort(cmpStr);
  }

  /** True if we know `from → to` does NOT exist (complete coverage on either end, no edge seen). */
  private knowsNoEdge(from: number, to: number): boolean {
    if (this.graph.hasEdge(from, to)) return false;
    return this.graph.followingCov[from] === COMPLETE || this.graph.followersCov[to] === COMPLETE;
  }

  /** In traversal terms: is the relationship a→b either known present or known absent? */
  private relKnown(a: number, b: number): boolean {
    const g = this.graph;
    if (this.options.undirected) {
      if (g.hasEdge(a, b) || g.hasEdge(b, a)) return true;
      return this.knowsNoEdge(a, b) && this.knowsNoEdge(b, a);
    }
    return g.hasEdge(a, b) || this.knowsNoEdge(a, b);
  }

  /** All traversal in-neighbours of x are known (its follower list is complete). */
  private fullyKnownInbound(x: number): boolean {
    const g = this.graph;
    if (this.options.undirected)
      return g.followersCov[x] === COMPLETE && g.followingCov[x] === COMPLETE;
    return g.followersCov[x] === COMPLETE;
  }

  /** Do we know the full set of the viewer's 1st-degree accounts? */
  private firstLayerComplete(): boolean {
    const g = this.graph;
    const v = this.viewer;
    const following = g.followingCov[v] === COMPLETE;
    const followers = g.followersCov[v] === COMPLETE;
    if (this.options.undirected) return following && followers;
    // 'mutual' needs both lists: an A you follow might follow you back without Orbit knowing.
    return this.options.firstDegreeMode === 'following' ? following : following && followers;
  }

  private notFirstDegreeKnown(x: number): boolean {
    const v = this.viewer;
    const noVX = this.knowsNoEdge(v, x);
    const noXV = this.knowsNoEdge(x, v);
    if (this.options.undirected) return noVX && noXV;
    switch (this.options.firstDegreeMode) {
      case 'following':
        return noVX;
      case 'either':
        return noVX && noXV;
      case 'mutual':
        return noVX || noXV;
    }
  }
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cmpNum(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Multi-layer BFS from the viewer (§7.1). O(V + E). Stale edges were already dropped at build time.
 */
export function computeReach(
  graph: OrbitGraph,
  viewerId: string,
  options: Partial<ReachOptions> = {},
): ReachResult {
  const opts: ReachOptions = { ...DEFAULT_REACH_OPTIONS, ...options };
  const n = graph.nodeCount;
  const degrees = new Int8Array(n).fill(-1);
  const pathCounts = new Float64Array(n);
  const expandable = new Uint8Array(n);
  const { followerCounts, unavailable } = graph;
  const threshold = opts.hubFollowerThreshold;
  const excludeHubs = opts.excludeHubsAsIntermediaries;
  for (let i = 0; i < n; i++) {
    expandable[i] = unavailable[i] || (excludeHubs && followerCounts[i]! > threshold) ? 0 : 1;
  }
  const isTarget = (i: number): boolean => opts.includeUnavailable || !unavailable[i];

  const v = graph.indexOf(viewerId);
  if (v === undefined) {
    return new ReachResult(graph, viewerId, opts, -1, degrees, pathCounts, expandable);
  }
  degrees[v] = 0;
  pathCounts[v] = 1;

  // Layer 1 depends on firstDegreeMode / undirected.
  let frontier: number[] = [];
  const mark1 = (x: number): void => {
    if (degrees[x] === -1 && isTarget(x)) {
      degrees[x] = 1;
      pathCounts[x] = 1;
      frontier.push(x);
    }
  };
  const { out, inn } = graph;
  const mode = opts.undirected ? 'either' : opts.firstDegreeMode;
  if (mode === 'following' || mode === 'either') {
    for (let r = out.start[v]!; r < out.start[v + 1]!; r++) mark1(out.adj[r]!);
  }
  if (mode === 'either') {
    for (let r = inn.start[v]!; r < inn.start[v + 1]!; r++) mark1(inn.adj[r]!);
  }
  if (mode === 'mutual') {
    for (let r = out.start[v]!; r < out.start[v + 1]!; r++) {
      const x = out.adj[r]!;
      if (graph.hasEdge(x, v)) mark1(x);
    }
  }

  const fwd = opts.undirected ? graph.undirected() : out;
  for (let d = 2; d <= opts.maxDepth; d++) {
    const next: number[] = [];
    for (const u of frontier) {
      if (!expandable[u]) continue; // hubs/unavailable can be targets but not middle hops
      const pu = pathCounts[u]!;
      for (let r = fwd.start[u]!; r < fwd.start[u + 1]!; r++) {
        const x = fwd.adj[r]!;
        const dx = degrees[x]!;
        if (dx === -1) {
          if (!isTarget(x)) continue;
          degrees[x] = d;
          pathCounts[x] = pu;
          next.push(x);
        } else if (dx === d) {
          pathCounts[x]! += pu;
        }
      }
    }
    frontier = next;
  }

  return new ReachResult(graph, viewerId, opts, v, degrees, pathCounts, expandable);
}

/** Group ranked paths by their 1st-degree connector, preserving rank order (§8.2). */
export function groupPathsByConnector(
  paths: readonly string[][],
): { connector: string; paths: string[][] }[] {
  const groups = new Map<string, string[][]>();
  for (const p of paths) {
    const c = p[1];
    if (c === undefined) continue;
    let g = groups.get(c);
    if (!g) groups.set(c, (g = []));
    g.push(p);
  }
  return Array.from(groups, ([connector, ps]) => ({ connector, paths: ps }));
}
