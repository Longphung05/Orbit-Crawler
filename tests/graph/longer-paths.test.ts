// Longer routes beyond the shortest ones: a 2nd-degree account's 3rd-degree routes, and the
// "who else connects you" routes for a 1st-degree account.
import { describe, expect, it } from 'vitest';
import { computeReach } from '../../src/graph';
import { graph } from './helpers';

describe('getLongerPaths', () => {
  it('lists 3rd-degree routes to a 2nd-degree account (the @appleqlam case)', () => {
    // V follows A and B. A follows T (so T is 2nd). B follows C, C follows T (a 3rd-degree route).
    const r = computeReach(graph('V>A V>B A>T B>C C>T'), 'V');
    expect(r.degree('T')).toBe(2);
    expect(r.getPaths('T').paths).toEqual([['V', 'A', 'T']]);
    const longer = r.getLongerPaths('T');
    expect(longer.paths).toEqual([['V', 'B', 'C', 'T']]);
    expect(longer).toMatchObject({ total: 1, truncated: false, connectorCount: 1 });
  });

  it('never repeats a shortest path or routes through people you already follow', () => {
    // A and B are both 1st; A → B → T would run back through someone you follow: not listed.
    const r = computeReach(graph('V>A V>B A>B B>T A>T'), 'V');
    expect(r.getLongerPaths('T').paths).toEqual([]);
  });

  it('for a 1st-degree account: other people you follow who follow them, and their friends', () => {
    const r = computeReach(graph('V>T V>A V>B A>T B>C C>T T>D D>T'), 'V');
    expect(r.getLongerPaths('T').paths).toEqual([
      ['V', 'A', 'T'],
      ['V', 'B', 'C', 'T'],
    ]);
    // D is only reachable through T itself: never a route to T.
    expect(r.getLongerPaths('T').connectorCount).toBe(2);
  });

  it('keeps hubs out of the middle, and has nothing to add for 3rd-degree or unknown accounts', () => {
    const g = graph('V>A V>B A>T B>H H>T A>X X>Y Y>Z', [{ id: 'H', followerCount: 10_000_000 }]);
    const r = computeReach(g, 'V');
    expect(r.getLongerPaths('T').paths).toEqual([]);
    expect(r.getLongerPaths('Z').paths).toEqual([]); // 3rd: no longer route within 3 hops
    expect(r.getLongerPaths('nobody').paths).toEqual([]);
    expect(r.getLongerPaths('V').paths).toEqual([]);
  });

  it('caps enumeration and says so', () => {
    const spec = ['V>A', 'A>T'];
    for (let i = 0; i < 30; i++) spec.push(`V>B${i}`, `B${i}>C${i}`, `C${i}>T`);
    const r = computeReach(graph(spec.join(' ')), 'V');
    const capped = r.getLongerPaths('T', { maxEnumerate: 10, limit: 5 });
    expect(capped).toMatchObject({ total: 10, truncated: true });
    expect(capped.paths).toHaveLength(5);
    expect(r.longerPathStats('T')).toMatchObject({ total: 30, connectorCount: 30 });
  });
});

describe('complete "Followed by" list', () => {
  it('makes a 2nd-degree connector count exact', () => {
    const spec = 'V>A V>B A>T';
    expect(computeReach(graph(spec), 'V').confidence('T').connectorsExact).toBe(false);
    const known = computeReach(graph(spec, [{ id: 'T', mutualsComplete: true }]), 'V');
    expect(known.confidence('T').connectorsExact).toBe(true);
    // It doesn't cover your followers, so 'either' mode can't rely on it.
    const either = computeReach(graph(spec, [{ id: 'T', mutualsComplete: true }]), 'V', {
      firstDegreeMode: 'either',
    });
    expect(either.confidence('T').connectorsExact).toBe(false);
  });
});
