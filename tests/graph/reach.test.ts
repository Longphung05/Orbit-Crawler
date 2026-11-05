import { describe, expect, it } from 'vitest';
import { computeReach, groupPathsByConnector, OrbitGraph } from '../../src/graph';
import { edges, graph, mulberry32, shuffle } from './helpers';

describe('build', () => {
  it('ignores self-loops and dedupes repeated edges', () => {
    const g = graph('V>A A>A V>A A>B');
    expect(g.edgeCount).toBe(2);
    const r = computeReach(g, 'V');
    expect(r.get('B')).toMatchObject({ degree: 2, pathCount: 1 });
    expect(r.degree('A')).toBe(1);
  });

  it('drops stale edges', () => {
    const g = OrbitGraph.build([
      { from: 'V', to: 'A' },
      { from: 'A', to: 'B', stale: true },
    ]);
    expect(computeReach(g, 'V').degree('B')).toBeUndefined();
  });

  it('drops edges confirmed before minConfirmedAt but keeps undated edges', () => {
    const g = OrbitGraph.build(
      [
        { from: 'V', to: 'A', lastConfirmedAt: 100 },
        { from: 'V', to: 'B', lastConfirmedAt: 5 },
        { from: 'V', to: 'C' },
      ],
      [],
      { minConfirmedAt: 50 },
    );
    const r = computeReach(g, 'V');
    expect(r.degree('A')).toBe(1);
    expect(r.degree('B')).toBeUndefined();
    expect(r.degree('C')).toBe(1);
  });
});

describe('degrees (§5.1)', () => {
  it('viewer is degree 0 even when absent from the graph', () => {
    const r = computeReach(graph('A>B'), 'V');
    expect(r.degree('V')).toBe(0);
    expect(r.get('V')).toEqual({ id: 'V', degree: 0, pathCount: 1, connectorCount: 0 });
    expect(r.degree('A')).toBeUndefined();
  });

  it('chain: 1st, 2nd, 3rd, then out of orbit', () => {
    const r = computeReach(graph('V>A A>B B>C C>D'), 'V');
    expect([r.degree('A'), r.degree('B'), r.degree('C'), r.degree('D')]).toEqual([
      1,
      2,
      3,
      undefined,
    ]);
    expect(r.countsByDegree()).toEqual({ 0: 1, 1: 1, 2: 1, 3: 1 });
  });

  it('follows edge direction: being followed is not 1st in "following" mode', () => {
    const r = computeReach(graph('A>V'), 'V');
    expect(r.degree('A')).toBeUndefined();
  });

  it('"either" mode counts followers as 1st but still traverses outward', () => {
    const r = computeReach(graph('A>V B>A A>C'), 'V', { firstDegreeMode: 'either' });
    expect(r.degree('A')).toBe(1);
    expect(r.degree('C')).toBe(2);
    expect(r.degree('B')).toBeUndefined(); // B → A, not A → B
  });

  it('"mutual" mode requires both directions', () => {
    const r = computeReach(graph('V>A A>V V>B A>B'), 'V', { firstDegreeMode: 'mutual' });
    expect(r.degree('A')).toBe(1);
    expect(r.degree('B')).toBe(2); // V follows B but B doesn't follow back → reached via A
  });

  it('undirected treats any relationship as a link and counts mutual follows once', () => {
    const r = computeReach(graph('A>V B>A A>B'), 'V', { undirected: true });
    expect(r.degree('A')).toBe(1);
    expect(r.get('B')).toMatchObject({ degree: 2, pathCount: 1, connectorCount: 1 });
  });

  it('respects maxDepth', () => {
    const r = computeReach(graph('V>A A>B B>C'), 'V', { maxDepth: 2 });
    expect(r.degree('B')).toBe(2);
    expect(r.degree('C')).toBeUndefined();
  });

  it('edges back into the viewer never change the viewer degree', () => {
    const r = computeReach(graph('V>A A>B B>V'), 'V');
    expect(r.degree('V')).toBe(0);
  });
});

describe('path counts and connectors (§7.1)', () => {
  it('diamond: two connectors to a 2nd-degree node', () => {
    const r = computeReach(graph('V>A V>B A>X B>X'), 'V');
    expect(r.get('X')).toEqual({ id: 'X', degree: 2, pathCount: 2, connectorCount: 2 });
    expect(r.connectors('X')).toEqual(['A', 'B']);
    expect(r.predecessors('X')).toEqual(['A', 'B']);
  });

  it('3rd degree: path DP and connector union', () => {
    const r = computeReach(graph('V>A V>B A>C B>C A>D C>X D>X'), 'V');
    // V-A-C-X, V-B-C-X, V-A-D-X
    expect(r.get('X')).toEqual({ id: 'X', degree: 3, pathCount: 3, connectorCount: 2 });
    expect(r.connectors('X')).toEqual(['A', 'B']);
    expect(r.predecessors('X')).toEqual(['C', 'D']);
  });

  it('only counts shortest paths', () => {
    // X is 2nd via A, also reachable at length 3 via B → C → X.
    const r = computeReach(graph('V>A V>B A>X B>C C>X'), 'V');
    expect(r.get('X')).toMatchObject({ degree: 2, pathCount: 1, connectorCount: 1 });
  });

  it('cycles and mutual follows terminate and count each connector once (§9 Graph)', () => {
    const r = computeReach(graph('V>A A>B B>A B>V A>C B>C C>A'), 'V');
    expect(r.degree('B')).toBe(2);
    expect(r.get('C')).toMatchObject({ degree: 2, pathCount: 1, connectorCount: 1 });
  });

  it('1st-degree node connectors are itself', () => {
    const r = computeReach(graph('V>A'), 'V');
    expect(r.connectors('A')).toEqual(['A']);
    expect(r.predecessors('A')).toEqual(['V']);
  });

  it('ranks 2nd-degree accounts by connector count, then label', () => {
    const g = graph('V>A V>B V>C A>X B>X C>X A>Y B>Y A>Z', [
      { id: 'Y', username: 'yara' },
      { id: 'Z', username: 'aaron' },
    ]);
    const ranked = computeReach(g, 'V').rankedAtDegree(2);
    expect(ranked.map((x) => [x.id, x.connectorCount])).toEqual([
      ['X', 3],
      ['Y', 2],
      ['Z', 1],
    ]);
  });
});

describe('hubs (§7.3)', () => {
  const hub = { id: 'H', followerCount: 2_000_000 };

  it('hubs are not intermediaries by default but remain targets', () => {
    const r = computeReach(
      graph('V>H H>X V>A A>H2', [hub, { id: 'H2', followerCount: 90_000 }]),
      'V',
    );
    expect(r.degree('H')).toBe(1); // target is a hub → still has a degree
    expect(r.degree('H2')).toBe(2);
    expect(r.degree('X')).toBeUndefined();
    expect(r.hiddenHubs('X')).toEqual(['H']);
    expect(r.isHub('H')).toBe(true);
  });

  it('hidden hubs only listed when they would give an equal or shorter path', () => {
    // X is 2nd via A. Hub H is 1st and follows X (equal) → listed. Hub H3 is 2nd (longer) → not.
    const g = graph('V>A A>X V>H H>X V>B B>H3 H3>X', [hub, { id: 'H3', followerCount: 1e6 }]);
    const r = computeReach(g, 'V');
    expect(r.degree('X')).toBe(2);
    expect(r.hiddenHubs('X')).toEqual(['H']);
  });

  it('with exclusion off, hubs are normal intermediaries and nothing is hidden', () => {
    const r = computeReach(graph('V>H H>X', [hub]), 'V', { excludeHubsAsIntermediaries: false });
    expect(r.degree('X')).toBe(2);
    expect(r.hiddenHubs('X')).toEqual([]);
  });

  it('threshold is configurable and strictly greater-than', () => {
    const g = graph('V>H H>X', [{ id: 'H', followerCount: 50_000 }]);
    expect(computeReach(g, 'V').degree('X')).toBe(2);
    expect(computeReach(g, 'V', { hubFollowerThreshold: 49_999 }).degree('X')).toBeUndefined();
  });
});

describe('unavailable accounts (§9 Identity)', () => {
  const nodes = [{ id: 'A', unavailable: true }];

  it('are excluded from paths and targets by default', () => {
    const r = computeReach(graph('V>A A>X V>B B>A', nodes), 'V');
    expect(r.degree('A')).toBeUndefined();
    expect(r.degree('X')).toBeUndefined();
  });

  it('includeUnavailable shows them as targets but never as middle hops', () => {
    const r = computeReach(graph('V>A A>X', nodes), 'V', { includeUnavailable: true });
    expect(r.degree('A')).toBe(1);
    expect(r.degree('X')).toBeUndefined();
  });
});

describe('getPaths (§7.2)', () => {
  it('returns explicit paths from viewer to target', () => {
    const r = computeReach(graph('V>A A>B B>X'), 'V');
    expect(r.getPaths('X')).toEqual({ paths: [['V', 'A', 'B', 'X']], total: 1, truncated: false });
    expect(r.getPaths('V').paths).toEqual([]);
    expect(r.getPaths('nobody').paths).toEqual([]);
  });

  it('prefers intermediaries with fewer followers, unknown counts last', () => {
    const g = graph('V>A V>B V>C A>X B>X C>X', [
      { id: 'A', followerCount: 9000 },
      { id: 'B', followerCount: 200 },
    ]);
    expect(
      computeReach(g, 'V')
        .getPaths('X')
        .paths.map((p) => p[1]),
    ).toEqual(['B', 'A', 'C']);
  });

  it('breaks ties alphabetically by username', () => {
    const g = graph('V>p1 V>p2 V>p3 p1>X p2>X p3>X', [
      { id: 'p1', username: 'zoe' },
      { id: 'p2', username: 'amir' },
      { id: 'p3', username: 'maya' },
    ]);
    expect(
      computeReach(g, 'V')
        .getPaths('X')
        .paths.map((p) => p[1]),
    ).toEqual(['p2', 'p3', 'p1']);
  });

  it('interaction score outranks follower counts when provided', () => {
    const g = graph('V>A V>B A>X B>X', [
      { id: 'A', followerCount: 10 },
      { id: 'B', followerCount: 10_000 },
    ]);
    const r = computeReach(g, 'V');
    const scores: Record<string, number> = { B: 5 };
    expect(r.getPaths('X', { interactionScore: (id) => scores[id] ?? 0 }).paths[0]).toEqual([
      'V',
      'B',
      'X',
    ]);
  });

  it('is deterministic regardless of edge insertion order (§9 ties)', () => {
    const spec = 'V>A V>B V>C A>D B>D C>E A>E D>X E>X';
    const nodes = [{ id: 'D', followerCount: 5 }];
    const expected = computeReach(graph(spec, nodes), 'V').getPaths('X').paths;
    const rand = mulberry32(7);
    for (let i = 0; i < 20; i++) {
      const g = OrbitGraph.build(shuffle(edges(spec), rand), nodes);
      expect(computeReach(g, 'V').getPaths('X').paths).toEqual(expected);
    }
  });

  it('applies limit and reports truncation at maxEnumerate', () => {
    const firsts = Array.from({ length: 30 }, (_, i) => `f${i}`);
    const spec = firsts.map((f) => `V>${f} ${f}>X`).join(' ');
    const r = computeReach(graph(spec), 'V');
    expect(r.getPaths('X', { limit: 5 })).toMatchObject({ total: 30, truncated: false });
    expect(r.getPaths('X', { limit: 5 }).paths).toHaveLength(5);
    const capped = r.getPaths('X', { maxEnumerate: 10 });
    expect(capped).toMatchObject({ total: 30, truncated: true });
    expect(capped.paths).toHaveLength(10);
  });

  it('groups paths by connector, preserving rank order', () => {
    const r = computeReach(graph('V>A V>B A>C A>D B>C C>X D>X'), 'V');
    const groups = groupPathsByConnector(r.getPaths('X').paths);
    expect(groups.map((g) => [g.connector, g.paths.length])).toEqual([
      ['A', 2],
      ['B', 1],
    ]);
  });
});

describe('confidence (§5.2)', () => {
  it('nothing is exact without coverage', () => {
    const r = computeReach(graph('V>A A>X'), 'V');
    expect(r.confidence('X')).toEqual({ degreeExact: false, connectorsExact: false });
    expect(r.confidence('A')).toEqual({ degreeExact: true, connectorsExact: true });
    expect(r.confidence('V')).toEqual({ degreeExact: true, connectorsExact: true });
    expect(r.confidence('ghost')).toEqual({ degreeExact: false, connectorsExact: false });
  });

  it('2nd degree is exact once the viewer following list and connectors are complete', () => {
    const nodes = [
      { id: 'V', followingCoverage: 'complete' as const },
      { id: 'A', followingCoverage: 'complete' as const },
      { id: 'B', followingCoverage: 'complete' as const },
    ];
    const r = computeReach(graph('V>A V>B A>X', nodes), 'V');
    expect(r.confidence('X')).toEqual({ degreeExact: true, connectorsExact: true });
  });

  it('target with complete followers list makes connectors exact', () => {
    const nodes = [{ id: 'X', followersCoverage: 'complete' as const }];
    const r = computeReach(graph('V>A V>B A>X', nodes), 'V');
    expect(r.confidence('X')).toEqual({ degreeExact: true, connectorsExact: true });
  });

  it('unknown 1st-degree accounts may exist when the viewer following list is incomplete', () => {
    // Every *known* connector is fully mapped, but V's own list is partial: there may be
    // more people V follows who also follow X.
    const nodes = [
      { id: 'V', followingCoverage: 'partial' as const },
      { id: 'A', followingCoverage: 'complete' as const },
    ];
    const r = computeReach(graph('V>A A>X', nodes), 'V');
    expect(r.confidence('X').connectorsExact).toBe(false);
  });

  it('"mutual" mode needs the viewer followers list too before 1st degree is complete', () => {
    const nodes = [
      { id: 'V', followingCoverage: 'complete' as const },
      { id: 'A', followingCoverage: 'complete' as const },
    ];
    const g = graph('V>A A>V A>X', nodes);
    expect(computeReach(g, 'V').confidence('X').connectorsExact).toBe(true);
    expect(
      computeReach(g, 'V', { firstDegreeMode: 'mutual' }).confidence('X').connectorsExact,
    ).toBe(false);
  });

  it('a partially loaded 1st-degree following list leaves connectors as a lower bound', () => {
    const nodes = [
      { id: 'V', followingCoverage: 'complete' as const },
      { id: 'A', followingCoverage: 'complete' as const },
      { id: 'B', followingCoverage: 'partial' as const },
    ];
    const r = computeReach(graph('V>A V>B A>X', nodes), 'V');
    expect(r.confidence('X')).toEqual({ degreeExact: true, connectorsExact: false });
  });

  it('3rd degree needs every layer known', () => {
    const complete = {
      followingCoverage: 'complete' as const,
      followersCoverage: 'complete' as const,
    };
    const all = ['V', 'A', 'B', 'X'].map((id) => ({ id, ...complete }));
    const r = computeReach(graph('V>A A>B B>X', all), 'V');
    expect(r.confidence('X')).toEqual({ degreeExact: true, connectorsExact: true });

    const partial = all.map((n) =>
      n.id === 'B' ? { ...n, followersCoverage: 'partial' as const } : n,
    );
    const r2 = computeReach(graph('V>A A>B B>X', partial), 'V');
    // A's following list is complete, so B's followers from layer 1 are still known.
    expect(r2.confidence('X')).toEqual({ degreeExact: true, connectorsExact: true });

    const unknownX = all.map((n) => (n.id === 'X' ? { id: 'X' } : n));
    const r3 = computeReach(graph('V>A A>B B>X', unknownX), 'V');
    expect(r3.confidence('X').connectorsExact).toBe(false);
  });

  it('mutual mode: knowing the target does not follow back proves not-1st', () => {
    const nodes = [{ id: 'X', followingCoverage: 'complete' as const }];
    const r = computeReach(graph('V>A A>V V>X A>X', nodes), 'V', { firstDegreeMode: 'mutual' });
    expect(r.degree('X')).toBe(2);
    expect(r.confidence('X').degreeExact).toBe(true);
  });
});
