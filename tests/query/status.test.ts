import { describe, expect, it, vi } from 'vitest';
import { QueryRouter, QueryService, StatusTracker, type ProfileViewOk } from '../../src/query';
import { freshDb } from '../db/helpers';

function okView(username: string): ProfileViewOk {
  return {
    status: 'ok',
    username,
    state: 'second',
    degree: 2,
    degreeExact: true,
    connectorsExact: true,
    connectorCount: 2,
    connectors: [],
    hiddenHubCount: 0,
    unavailable: false,
    known: true,
    knownAccounts: 5,
    firstLayer: 'complete',
    updatedAt: null,
    showAvatarImages: false,
  };
}

describe('StatusTracker', () => {
  it('starts empty', () => {
    expect(new StatusTracker().snapshot()).toEqual({ status: 'ok' });
  });

  it('shows "calculating" until the answer arrives', () => {
    const t = new StatusTracker();
    t.begin(1, '1000', 'fake_a', 10);
    expect(t.snapshot().viewing).toMatchObject({ username: 'fake_a', calculating: true });
    t.finish(1, '1000', 'fake_a', okView('fake_a'), 11);
    expect(t.snapshot().viewing).toMatchObject({ calculating: false, view: { state: 'second' } });
  });

  it('keeps the last answer visible while the same profile recalculates', () => {
    const t = new StatusTracker();
    t.begin(1, '1000', 'fake_a', 10);
    t.finish(1, '1000', 'fake_a', okView('fake_a'), 11);
    t.begin(1, '1000', 'Fake_A', 20);
    expect(t.snapshot().viewing).toMatchObject({ calculating: true, view: { username: 'fake_a' } });
    t.begin(1, '1000', 'fake_b', 30); // a different profile: no stale answer carried over
    expect(t.snapshot().viewing?.view).toBeUndefined();
  });

  it('ignores an answer for a profile the tab has already left', () => {
    const t = new StatusTracker();
    t.begin(1, '1000', 'fake_a', 10);
    t.begin(1, '1000', 'fake_b', 11);
    t.finish(1, '1000', 'fake_a', okView('fake_a'), 12);
    expect(t.snapshot().viewing).toMatchObject({ username: 'fake_b', calculating: true });
  });

  it('reports the most recently active tab, and forgets closed ones', () => {
    const t = new StatusTracker();
    t.begin(1, '1000', 'fake_a', 10);
    t.begin(2, '1000', 'fake_b', 20);
    expect(t.snapshot().viewing?.username).toBe('fake_b');
    t.forgetTab(2);
    expect(t.snapshot().viewing?.username).toBe('fake_a');
    t.clear();
    expect(t.snapshot()).toEqual({ status: 'ok' });
  });

  it('an error reply ends calculating without inventing an answer', () => {
    const t = new StatusTracker();
    t.begin(1, '1000', 'fake_a', 10);
    t.finish(1, '1000', 'fake_a', { status: 'error' }, 11);
    expect(t.snapshot().viewing).toMatchObject({ calculating: false });
    expect(t.snapshot().viewing?.view).toBeUndefined();
  });
});

describe('QueryRouter status', () => {
  const IG = { tabId: 4, url: 'https://www.instagram.com/fake_a/', fromSelf: true };
  function setup() {
    const service = new QueryService(freshDb());
    vi.spyOn(service, 'profile').mockResolvedValue(okView('fake_a'));
    const status = new StatusTracker();
    const router = new QueryRouter({
      service,
      status,
      viewerForTab: () => '1000',
      refreshTabs: vi.fn(),
      now: () => 50,
    });
    return { router, status };
  }

  it('a badge query is tracked from begin to finish', async () => {
    const { router, status } = setup();
    const pending = router.handle(
      { type: 'orbit/profile', username: 'fake_a', viewerId: null },
      IG,
    );
    expect(status.snapshot().viewing).toMatchObject({ calculating: true });
    await pending;
    expect(status.snapshot().viewing).toMatchObject({
      calculating: false,
      view: { state: 'second' },
    });
  });

  it('the popup / side panel (no tab) can read the status', async () => {
    const { router, status } = setup();
    status.begin(4, '1000', 'fake_a', 1);
    expect(await router.handle({ type: 'orbit/status' }, { fromSelf: true })).toMatchObject({
      status: 'ok',
      viewing: { username: 'fake_a' },
    });
  });

  it('web pages and other extensions cannot read it', () => {
    const { router } = setup();
    expect(router.handle({ type: 'orbit/status' }, IG)).toBeUndefined();
    expect(router.handle({ type: 'orbit/status' }, { fromSelf: false })).toBeUndefined();
  });

  it('graph-changed clears what the panels were showing', () => {
    const { router, status } = setup();
    status.begin(4, '1000', 'fake_a', 1);
    router.handle({ type: 'orbit/graph-changed' }, { fromSelf: true });
    expect(status.snapshot()).toEqual({ status: 'ok' });
  });
});
