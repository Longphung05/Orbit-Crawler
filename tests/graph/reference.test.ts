// Randomised cross-check: the BFS engine must agree with a brute-force walk enumerator.
import { describe, expect, it } from 'vitest';
import { computeReach, OrbitGraph, type GraphEdge, type GraphNodeInfo } from '../../src/graph';
import type { ReachOptions } from '../../src/graph/reach';
import { mulberry32, referenceReach } from './helpers';

const MODES = ['following', 'either', 'mutual'] as const;

describe('engine matches brute-force reference on random graphs', () => {
  const rand = mulberry32(20261106);

  for (let trial = 0; trial < 400; trial++) {
    const n = 4 + Math.floor(rand() * 10);
    const ids = ['V', ...Array.from({ length: n - 1 }, (_, i) => `n${i}`)];
    const density = 0.1 + rand() * 0.35;
    const edgeList: GraphEdge[] = [];
    for (const a of ids) {
      for (const b of ids) {
        if (rand() < density) edgeList.push({ from: a, to: b, stale: rand() < 0.05 });
      }
    }
    if (rand() < 0.3 && edgeList.length > 0) edgeList.push({ ...edgeList[0]! }); // duplicate
    const nodes: GraphNodeInfo[] = ids.map((id) => ({
      id,
      followerCount: rand() < 0.15 ? 1_000_000 : Math.floor(rand() * 1000),
      unavailable: id !== 'V' && rand() < 0.08,
    }));
    const options: Partial<ReachOptions> = {
      firstDegreeMode: MODES[Math.floor(rand() * 3)]!,
      undirected: rand() < 0.25,
      excludeHubsAsIntermediaries: rand() < 0.7,
      includeUnavailable: rand() < 0.3,
      maxDepth: rand() < 0.8 ? 3 : 2,
    };

    it(`trial ${trial} (${n} nodes, ${edgeList.length} edges, ${JSON.stringify(options)})`, () => {
      const r = computeReach(OrbitGraph.build(edgeList, nodes), 'V', options);
      const ref = referenceReach(edgeList, nodes, 'V', options);
      for (const id of ids.slice(1)) {
        const expected = ref.get(id);
        const got = r.get(id);
        if (!expected) {
          expect(got, id).toBeUndefined();
          continue;
        }
        expect(got, id).toEqual({
          id,
          degree: expected.degree,
          pathCount: expected.pathCount,
          connectorCount: expected.connectors.length,
        });
        expect(r.connectors(id), id).toEqual(expected.connectors);
        const paths = r.getPaths(id, { limit: Infinity });
        expect(paths.paths.length, id).toBe(expected.pathCount);
        for (const p of paths.paths) {
          expect(p[0]).toBe('V');
          expect(p[p.length - 1]).toBe(id);
          expect(p.length - 1).toBe(expected.degree);
        }
      }
    });
  }
});
