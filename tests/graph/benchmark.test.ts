// §7.4: BFS must run in < 50 ms for 100k edges. Timing uses the median of several runs.
// Set ORBIT_BENCH_BUDGET_MS to relax on slow CI machines.
import { describe, expect, it } from 'vitest';
import { computeReach, OrbitGraph, type GraphEdge, type GraphNodeInfo } from '../../src/graph';
import { mulberry32 } from './helpers';

const BUDGET_MS = Number(process.env.ORBIT_BENCH_BUDGET_MS ?? 50);

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function time(fn: () => void, runs = 7): number {
  fn(); // warm-up
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return median(samples);
}

/** A realistic-ish shape: viewer follows 800; each follows ~60; plus noise and a few hubs. */
function syntheticNetwork(
  edgeTarget: number,
  seed = 1,
): { edges: GraphEdge[]; nodes: GraphNodeInfo[] } {
  const rand = mulberry32(seed);
  const pool = 30_000;
  const edges: GraphEdge[] = [];
  const firsts = 800;
  for (let i = 0; i < firsts; i++) edges.push({ from: 'V', to: `u${i}` });
  while (edges.length < edgeTarget) {
    const from = rand() < 0.5 ? Math.floor(rand() * firsts) : Math.floor(rand() * pool);
    const to = rand() < 0.05 ? Math.floor(rand() * 20) : Math.floor(rand() * pool); // u0..u19 popular
    edges.push({ from: `u${from}`, to: `u${to}` });
  }
  const nodes: GraphNodeInfo[] = Array.from({ length: 20 }, (_, i) => ({
    id: `u${i * 37}`,
    followerCount: 5_000_000,
  }));
  return { edges, nodes };
}

describe('benchmark (§7.4)', () => {
  const { edges, nodes } = syntheticNetwork(100_000);
  const g = OrbitGraph.build(edges, nodes);

  it(`computeReach on 100k edges runs under ${BUDGET_MS} ms (median)`, () => {
    const buildMs = time(() => OrbitGraph.build(edges, nodes), 3);
    const bfsMs = time(() => computeReach(g, 'V'));
    const r = computeReach(g, 'V');
    const undirectedMs = time(() => computeReach(g, 'V', { undirected: true }));
    const rankMs = time(() => r.rankedAtDegree(2), 3);
    console.info(
      `[bench] ${g.nodeCount} nodes, ${g.edgeCount} edges | build ${buildMs.toFixed(1)} ms | ` +
        `BFS ${bfsMs.toFixed(1)} ms | undirected BFS ${undirectedMs.toFixed(1)} ms | ` +
        `rank 2nd ${rankMs.toFixed(1)} ms | degrees ${JSON.stringify(r.countsByDegree())}`,
    );
    expect(g.edgeCount).toBeGreaterThan(95_000);
    expect(r.countsByDegree()[3]).toBeGreaterThan(0);
    expect(bfsMs).toBeLessThan(BUDGET_MS);
  });

  it('path enumeration for a heavily connected 3rd-degree target stays bounded', () => {
    const r = computeReach(g, 'V');
    const third = r.rankedAtDegree(3)[0]!;
    const t0 = performance.now();
    const res = r.getPaths(third.id);
    const ms = performance.now() - t0;
    console.info(`[bench] getPaths(${third.id}): ${res.total} total paths, ${ms.toFixed(1)} ms`);
    expect(res.paths.length).toBeLessThanOrEqual(50);
    expect(ms).toBeLessThan(BUDGET_MS * 4);
  });
});
