// Immutable, integer-indexed directed graph (CLAUDE.md §5, §7.4).
// Pure TypeScript: no browser APIs, Dexie, or adapters.
import type { Coverage } from '../shared/types';

/** Directed edge: `from` follows `to`. */
export interface GraphEdge {
  from: string;
  to: string;
  stale?: boolean;
  lastConfirmedAt?: number;
}

export interface GraphNodeInfo {
  id: string;
  username?: string;
  followerCount?: number;
  /** Deactivated, deleted, banned, or blocking the viewer (§9 Identity). */
  unavailable?: boolean;
  followingCoverage?: Coverage;
  followersCoverage?: Coverage;
}

export interface BuildOptions {
  /** Drop edges last confirmed before this timestamp (ms). The engine never reads the clock itself. */
  minConfirmedAt?: number;
}

/** Compressed sparse rows: neighbours of i are adj[start[i] .. start[i+1]), sorted ascending, unique. */
export interface Csr {
  start: Int32Array;
  adj: Int32Array;
}

const COVERAGE_CODE: Record<Coverage, number> = { none: 0, partial: 1, complete: 2 };
export const COMPLETE = 2;

function buildCsr(n: number, src: ArrayLike<number>, dst: ArrayLike<number>): Csr {
  const start = new Int32Array(n + 1);
  for (let k = 0; k < src.length; k++) start[src[k]! + 1]!++;
  for (let i = 0; i < n; i++) start[i + 1]! += start[i]!;
  const cursor = start.slice(0, n);
  const adj = new Int32Array(src.length);
  for (let k = 0; k < src.length; k++) adj[cursor[src[k]!]!++] = dst[k]!;

  // Sort each row, then compact duplicates in place (write index never passes read index).
  const compactStart = new Int32Array(n + 1);
  let w = 0;
  for (let i = 0; i < n; i++) {
    const lo = start[i]!;
    const hi = start[i + 1]!;
    adj.subarray(lo, hi).sort();
    compactStart[i] = w;
    let prev = -1;
    for (let r = lo; r < hi; r++) {
      const v = adj[r]!;
      if (v !== prev) {
        adj[w++] = v;
        prev = v;
      }
    }
  }
  compactStart[n] = w;
  return { start: compactStart, adj: adj.slice(0, w) };
}

function rowHas(csr: Csr, i: number, j: number): boolean {
  let lo = csr.start[i]!;
  let hi = csr.start[i + 1]! - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = csr.adj[mid]!;
    if (v === j) return true;
    if (v < j) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

export class OrbitGraph {
  private undirectedCache: Csr | undefined;

  private constructor(
    private readonly index: Map<string, number>,
    readonly ids: readonly string[],
    readonly out: Csr,
    readonly inn: Csr,
    readonly usernames: readonly (string | undefined)[],
    /** NaN when unknown. */
    readonly followerCounts: Float64Array,
    readonly unavailable: Uint8Array,
    readonly followingCov: Uint8Array,
    readonly followersCov: Uint8Array,
  ) {}

  static build(
    edges: Iterable<GraphEdge>,
    nodes: Iterable<GraphNodeInfo> = [],
    options: BuildOptions = {},
  ): OrbitGraph {
    const index = new Map<string, number>();
    const ids: string[] = [];
    const intern = (id: string): number => {
      let i = index.get(id);
      if (i === undefined) {
        i = ids.length;
        ids.push(id);
        index.set(id, i);
      }
      return i;
    };

    const src: number[] = [];
    const dst: number[] = [];
    const { minConfirmedAt } = options;
    for (const e of edges) {
      if (e.stale) continue;
      if (e.from === e.to) continue; // self-loops are ignored (§9 Graph)
      if (
        minConfirmedAt !== undefined &&
        e.lastConfirmedAt !== undefined &&
        e.lastConfirmedAt < minConfirmedAt
      ) {
        continue;
      }
      src.push(intern(e.from));
      dst.push(intern(e.to));
    }

    const infos: GraphNodeInfo[] = [];
    for (const info of nodes) {
      intern(info.id);
      infos.push(info);
    }

    const n = ids.length;
    const usernames: (string | undefined)[] = new Array<string | undefined>(n).fill(undefined);
    const followerCounts = new Float64Array(n).fill(Number.NaN);
    const unavailable = new Uint8Array(n);
    const followingCov = new Uint8Array(n);
    const followersCov = new Uint8Array(n);
    for (const info of infos) {
      const i = index.get(info.id)!;
      usernames[i] = info.username;
      followerCounts[i] = info.followerCount ?? Number.NaN;
      unavailable[i] = info.unavailable ? 1 : 0;
      followingCov[i] = COVERAGE_CODE[info.followingCoverage ?? 'none'];
      followersCov[i] = COVERAGE_CODE[info.followersCoverage ?? 'none'];
    }

    return new OrbitGraph(
      index,
      ids,
      buildCsr(n, src, dst),
      buildCsr(n, dst, src),
      usernames,
      followerCounts,
      unavailable,
      followingCov,
      followersCov,
    );
  }

  get nodeCount(): number {
    return this.ids.length;
  }

  get edgeCount(): number {
    return this.out.adj.length;
  }

  indexOf(id: string): number | undefined {
    return this.index.get(id);
  }

  idAt(i: number): string {
    return this.ids[i]!;
  }

  /** Display name for sorting: username if known, else the id. */
  labelAt(i: number): string {
    return this.usernames[i] ?? this.ids[i]!;
  }

  hasEdge(from: number, to: number): boolean {
    return rowHas(this.out, from, to);
  }

  /** Union of in- and out-neighbours, each relationship once (mutual follows aren't double-counted). */
  undirected(): Csr {
    if (!this.undirectedCache) {
      const m = this.out.adj.length;
      const src = new Int32Array(m * 2);
      const dst = new Int32Array(m * 2);
      let k = 0;
      for (let i = 0; i < this.ids.length; i++) {
        for (let r = this.out.start[i]!; r < this.out.start[i + 1]!; r++) {
          const j = this.out.adj[r]!;
          src[k] = i;
          dst[k++] = j;
          src[k] = j;
          dst[k++] = i;
        }
      }
      this.undirectedCache = buildCsr(this.ids.length, src, dst);
    }
    return this.undirectedCache;
  }
}
