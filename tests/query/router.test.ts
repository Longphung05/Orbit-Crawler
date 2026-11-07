import { describe, expect, it, vi } from 'vitest';
import { QueryRouter, QueryService } from '../../src/query';
import { freshDb } from '../db/helpers';

const IG_SENDER = { tabId: 4, url: 'https://www.instagram.com/fake_alex/', fromSelf: true };

function setup(viewerForTab: (t: number) => string | undefined = () => '1000') {
  const service = new QueryService(freshDb());
  const profile = vi.spyOn(service, 'profile').mockResolvedValue({ status: 'error' });
  const paths = vi.spyOn(service, 'paths').mockResolvedValue({ status: 'error' });
  const invalidate = vi.spyOn(service, 'invalidate');
  const refreshTabs = vi.fn();
  const router = new QueryRouter({ service, viewerForTab, refreshTabs });
  return { router, profile, paths, invalidate, refreshTabs };
}

const profileMsg = { type: 'orbit/profile', username: 'fake_alex', viewerId: null };

describe('QueryRouter', () => {
  it("routes profile and paths queries with the tab's account", async () => {
    const { router, profile, paths } = setup();
    await router.handle(profileMsg, IG_SENDER);
    expect(profile).toHaveBeenCalledWith('1000', 'fake_alex');
    await router.handle({ ...profileMsg, type: 'orbit/paths' }, IG_SENDER);
    expect(paths).toHaveBeenCalledWith('1000', 'fake_alex');
  });

  it("the coordinator's account wins; the message covers a restarted worker", async () => {
    const a = setup(() => '1000');
    await a.router.handle({ ...profileMsg, viewerId: '2000' }, IG_SENDER);
    expect(a.profile).toHaveBeenCalledWith('1000', 'fake_alex');

    const b = setup(() => undefined);
    await b.router.handle({ ...profileMsg, viewerId: '2000' }, IG_SENDER);
    expect(b.profile).toHaveBeenCalledWith('2000', 'fake_alex');
  });

  it('no known account → no_viewer, and the graph is never read', async () => {
    const { router, profile } = setup(() => undefined);
    expect(await router.handle(profileMsg, IG_SENDER)).toEqual({ status: 'no_viewer' });
    expect(profile).not.toHaveBeenCalled();
  });

  it('ignores other extensions, non-Instagram pages, and tabless senders', () => {
    const { router, profile } = setup();
    expect(router.handle(profileMsg, { ...IG_SENDER, fromSelf: false })).toBeUndefined();
    expect(
      router.handle(profileMsg, { ...IG_SENDER, url: 'https://evil.example/' }),
    ).toBeUndefined();
    expect(router.handle(profileMsg, { ...IG_SENDER, url: undefined })).toBeUndefined();
    expect(router.handle(profileMsg, { fromSelf: true })).toBeUndefined();
    expect(profile).not.toHaveBeenCalled();
  });

  it('rejects malformed requests', () => {
    const { router, profile } = setup();
    for (const bad of [
      null,
      'orbit/profile',
      { type: 'orbit/profile' },
      { ...profileMsg, username: 'not a name!' },
      { ...profileMsg, username: 'x'.repeat(31) },
      { ...profileMsg, viewerId: 'abc' },
      { type: 'orbit/other', username: 'fake_alex', viewerId: null },
    ]) {
      expect(router.handle(bad, IG_SENDER)).toBeUndefined();
    }
    expect(profile).not.toHaveBeenCalled();
  });

  it('graph-changed from an extension page drops caches and refreshes tabs', () => {
    const { router, invalidate, refreshTabs } = setup();
    expect(router.handle({ type: 'orbit/graph-changed' }, { fromSelf: true })).toBeUndefined();
    expect(invalidate).toHaveBeenCalledWith();
    expect(refreshTabs).toHaveBeenCalledOnce();
  });

  it('graph-changed from a web page (or another extension) is ignored', () => {
    const { router, invalidate, refreshTabs } = setup();
    router.handle({ type: 'orbit/graph-changed' }, IG_SENDER);
    router.handle({ type: 'orbit/graph-changed' }, { fromSelf: false });
    expect(invalidate).not.toHaveBeenCalled();
    expect(refreshTabs).not.toHaveBeenCalled();
  });
});
