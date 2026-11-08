import { describe, expect, it } from 'vitest';
import { createDomScanner, SCAN_DELAYS_MS, type DomScanDeps } from '../../src/capture';
import type { RuntimeMessage } from '../../src/capture/messages';

function setup(over: Partial<DomScanDeps> = {}) {
  let path: string | undefined = 'fake_target';
  let found: { usernames: string[]; others?: number } | undefined = {
    usernames: ['fake_ann', 'fake_ben'],
    others: 3,
  };
  let clock = 1_000;
  let nextHandle = 1;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  const sent: RuntimeMessage[] = [];
  const deps: DomScanDeps = {
    profileUsername: () => path,
    viewerId: () => '1000',
    read: () => found,
    send: (m) => sent.push(m),
    setTimeout: (fn, ms) => {
      const h = nextHandle++;
      pending.set(h, { fn, ms });
      return h;
    },
    clearTimeout: (h) => pending.delete(h as number),
    now: () => clock,
    ...over,
  };
  const scanner = createDomScanner(deps);
  /** Run the timers due by `ms`, in order. */
  const advance = (ms: number): void => {
    for (const [h, t] of [...pending].sort((a, b) => a[1].ms - b[1].ms)) {
      if (t.ms <= ms) {
        pending.delete(h);
        t.fn();
      }
    }
  };
  return {
    scanner,
    sent,
    pending,
    advance,
    setPath: (p: string | undefined) => (path = p),
    setFound: (f: typeof found) => (found = f),
    tick: (ms: number) => (clock += ms),
  };
}

describe('createDomScanner', () => {
  it('sends the line once it is found, then stops looking', () => {
    const t = setup();
    t.scanner.schedule();
    expect(t.pending.size).toBe(SCAN_DELAYS_MS.length);
    t.advance(SCAN_DELAYS_MS[0]!);
    expect(t.sent).toEqual([
      {
        type: 'orbit/dom-mutuals',
        profile: 'fake_target',
        usernames: ['fake_ann', 'fake_ben'],
        others: 3,
        viewerId: '1000',
        at: 1_000,
      },
    ]);
    expect(t.pending.size).toBe(0);
  });

  it('keeps looking while Instagram has not rendered the line yet', () => {
    const t = setup();
    t.setFound(undefined);
    t.scanner.schedule();
    t.advance(SCAN_DELAYS_MS[0]!);
    expect(t.sent).toHaveLength(0);
    expect(t.pending.size).toBe(SCAN_DELAYS_MS.length - 1);
    t.setFound({ usernames: ['fake_ann'] });
    t.advance(SCAN_DELAYS_MS[1]!);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).not.toHaveProperty('others');
  });

  it('gives up after the last attempt', () => {
    const t = setup();
    t.setFound(undefined);
    t.scanner.schedule();
    t.advance(Number.MAX_SAFE_INTEGER);
    expect(t.sent).toHaveLength(0);
    expect(t.pending.size).toBe(0);
  });

  it('drops a scan if the person navigated away meanwhile', () => {
    const t = setup();
    t.scanner.schedule();
    t.setPath('fake_someone_else');
    t.advance(Number.MAX_SAFE_INTEGER);
    expect(t.sent).toHaveLength(0);
  });

  it('does nothing off profile pages or while the account is unknown', () => {
    const off = setup();
    off.setPath(undefined);
    off.scanner.schedule();
    expect(off.pending.size).toBe(0);

    const anon = setup({ viewerId: () => null });
    anon.scanner.schedule();
    expect(anon.pending.size).toBe(0);
  });

  it('rescheduling replaces the old timers', () => {
    const t = setup();
    t.scanner.schedule();
    t.scanner.schedule();
    expect(t.pending.size).toBe(SCAN_DELAYS_MS.length);
  });

  it('does not repeat the same line within five minutes, but does later or when it changes', () => {
    const t = setup();
    t.scanner.schedule();
    t.advance(Number.MAX_SAFE_INTEGER);
    expect(t.sent).toHaveLength(1);

    t.scanner.schedule(); // same page, same line
    t.advance(Number.MAX_SAFE_INTEGER);
    expect(t.sent).toHaveLength(1);

    t.setFound({ usernames: ['fake_ann', 'fake_cat'], others: 3 });
    t.scanner.schedule();
    t.advance(Number.MAX_SAFE_INTEGER);
    expect(t.sent).toHaveLength(2);

    t.tick(6 * 60_000);
    t.scanner.schedule();
    t.advance(Number.MAX_SAFE_INTEGER);
    expect(t.sent).toHaveLength(3);
  });

  it('never names the profile itself, and sends nothing if that leaves no one', () => {
    const t = setup();
    t.setFound({ usernames: ['Fake_Target', 'fake_ann'] });
    t.scanner.schedule();
    t.advance(Number.MAX_SAFE_INTEGER);
    expect((t.sent[0] as { usernames: string[] }).usernames).toEqual(['fake_ann']);

    const only = setup();
    only.setFound({ usernames: ['fake_target'] });
    only.scanner.schedule();
    only.advance(Number.MAX_SAFE_INTEGER);
    expect(only.sent).toHaveLength(0);
  });

  it('a throwing reader never escapes into the page', () => {
    const t = setup({
      read: () => {
        throw new Error('boom');
      },
    });
    t.scanner.schedule();
    expect(() => t.advance(Number.MAX_SAFE_INTEGER)).not.toThrow();
  });

  it('destroy cancels pending scans', () => {
    const t = setup();
    t.scanner.schedule();
    t.scanner.destroy();
    expect(t.pending.size).toBe(0);
  });
});
