import { describe, expect, it } from 'vitest';
import { ListSessions, watchRoute } from '../../src/capture';

function fakeEnv() {
  let href = 'https://www.instagram.com/';
  const listeners = new Map<string, Set<() => void>>();
  const nav = new Map<string, Set<() => void>>();
  let tick: (() => void) | undefined;
  const add = (m: Map<string, Set<() => void>>) => (t: string, fn: () => void) => {
    if (!m.has(t)) m.set(t, new Set());
    m.get(t)!.add(fn);
  };
  const remove = (m: Map<string, Set<() => void>>) => (t: string, fn: () => void) =>
    m.get(t)?.delete(fn);
  return {
    setHref: (h: string) => (href = h),
    fire: (t: string) => listeners.get(t)?.forEach((f) => f()),
    fireNav: (t: string) => nav.get(t)?.forEach((f) => f()),
    poll: () => tick?.(),
    counts: () => ({
      win: listeners.get('popstate')?.size ?? 0,
      nav: nav.get('navigatesuccess')?.size ?? 0,
    }),
    deps: {
      getHref: () => href,
      addEventListener: add(listeners),
      removeEventListener: remove(listeners),
      navigation: { addEventListener: add(nav), removeEventListener: remove(nav) },
      setInterval: (fn: () => void) => {
        tick = fn;
        return 1;
      },
      clearInterval: () => (tick = undefined),
    },
  };
}

describe('watchRoute', () => {
  it('reports each URL change once, from any signal', () => {
    const env = fakeEnv();
    const seen: string[] = [];
    watchRoute(env.deps, (h) => seen.push(h));
    env.setHref('https://www.instagram.com/fake_alex/');
    env.fireNav('navigatesuccess');
    env.fire('popstate'); // same URL: no duplicate
    env.setHref('https://www.instagram.com/fake_alex/followers/');
    env.poll();
    env.poll();
    expect(seen).toEqual([
      'https://www.instagram.com/fake_alex/',
      'https://www.instagram.com/fake_alex/followers/',
    ]);
  });

  it('stop() removes every listener', () => {
    const env = fakeEnv();
    const stop = watchRoute(env.deps, () => undefined);
    expect(env.counts()).toEqual({ win: 1, nav: 1 });
    stop();
    expect(env.counts()).toEqual({ win: 0, nav: 0 });
  });

  it('a throwing callback never escapes', () => {
    const env = fakeEnv();
    watchRoute(env.deps, () => {
      throw new Error('boom');
    });
    env.setHref('https://www.instagram.com/x/');
    expect(() => env.poll()).not.toThrow();
  });
});

describe('ListSessions', () => {
  const k = { viewerId: 'v', tabId: 1, ownerId: 'o', direction: 'following' };
  it('expires idle sessions', () => {
    const s = new ListSessions();
    s.start(k, 0);
    expect(s.touch(k, 10 * 60_000)).toBe(0);
    expect(s.touch(k, 50 * 60_000)).toBeUndefined();
  });
  it('forgetTab only drops that tab', () => {
    const s = new ListSessions();
    s.start(k, 0);
    s.start({ ...k, tabId: 2 }, 0);
    s.forgetTab(1);
    expect(s.size).toBe(1);
  });
});
