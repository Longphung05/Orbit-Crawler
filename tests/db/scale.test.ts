// §9 Scale: a 10k-following export must write in one pass without per-row round trips.
import { describe, expect, it } from 'vitest';
import { store } from './helpers';

describe('scale', () => {
  it('applies a 10k-following / 5k-followers export snapshot', async () => {
    const s = store();
    const following = Array.from({ length: 10_000 }, (_, i) => `fake_user_${i}`);
    const followers = following.slice(0, 5_000);
    const t0 = performance.now();
    await s.applyExportSnapshot({ following, followers, exportedAt: 100 }, 200);
    const ms = performance.now() - t0;
    console.info(`[bench] export snapshot 10k/5k: ${ms.toFixed(0)} ms (fake-indexeddb)`);
    expect(await s.counts()).toEqual({ nodes: 10_000, edges: 15_000 });
  }, 60_000);
});
