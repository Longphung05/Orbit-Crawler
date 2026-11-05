// §2 guarantees for the in-page observer: read-only, never initiates requests, never throws.
import { describe, expect, it, vi } from 'vitest';
import { installObserver, type ObservableWindow, type ObserverDeps } from '../../src/capture';

const LIST = 'https://www.instagram.com/api/v1/friendships/1/following/?count=12';
const OTHER = 'https://www.instagram.com/api/v1/feed/timeline/';
const flush = () => new Promise((r) => setTimeout(r, 0));

class CountingResponse extends Response {
  static clones = 0;
  override clone(): Response {
    CountingResponse.clones++;
    return super.clone();
  }
}

class FakeXHR {
  static instances: FakeXHR[] = [];
  responseType = '';
  responseText = '';
  response: unknown = null;
  status = 0;
  opened: unknown[] = [];
  sent: unknown[] = [];
  private listeners: Record<string, (() => void)[]> = {};
  constructor() {
    FakeXHR.instances.push(this);
  }
  open(...args: unknown[]): void {
    this.opened = args;
  }
  send(...args: unknown[]): void {
    this.sent = args;
  }
  addEventListener(type: string, fn: () => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
  /** Simulate the server answering. */
  respond(status: number, text: string): void {
    this.status = status;
    this.responseText = text;
    for (const fn of this.listeners.load ?? []) fn();
  }
}

function setup(overrides: Partial<ObserverDeps> = {}) {
  const pageFetch = vi.fn(
    async (input: RequestInfo | URL) =>
      new CountingResponse(`{"for":"${String(input)}"}`, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  const win = {
    fetch: pageFetch as unknown as typeof fetch,
    XMLHttpRequest: FakeXHR as unknown as typeof XMLHttpRequest,
    location: { href: 'https://www.instagram.com/fake_alex/' },
  } satisfies ObservableWindow;
  const posted: { url: string; status: number; text: string }[] = [];
  const deps: ObserverDeps = {
    isCandidate: (u) => u.includes('/friendships/'),
    wantsBody: () => true,
    post: (m) => posted.push(m),
    maxBytes: 1024,
    ...overrides,
  };
  const uninstall = installObserver(win, deps);
  return { win, pageFetch, posted, uninstall };
}

describe('fetch observer', () => {
  it('returns the exact Response the page asked for, body still readable', async () => {
    const { win, posted } = setup();
    const res = await win.fetch(LIST);
    expect(res).toBeInstanceOf(CountingResponse);
    expect(await res.json()).toEqual({ for: LIST });
    await flush();
    expect(posted).toEqual([{ url: LIST, status: 200, text: `{"for":"${LIST}"}` }]);
  });

  it('never issues requests of its own: one page call → one network call, same arguments', async () => {
    const { win, pageFetch } = setup();
    const init = { method: 'GET', headers: { 'x-test': '1' } };
    await win.fetch(LIST, init);
    await win.fetch(OTHER);
    await flush();
    expect(pageFetch).toHaveBeenCalledTimes(2);
    expect(pageFetch.mock.calls[0]).toEqual([LIST, init]);
  });

  it('does not clone or read non-candidate responses', async () => {
    CountingResponse.clones = 0;
    const { win, posted } = setup();
    await win.fetch(OTHER);
    await flush();
    expect(CountingResponse.clones).toBe(0);
    expect(posted).toEqual([]);
  });

  it('resolves relative URLs against the page and handles Request/URL inputs', async () => {
    const { win, posted } = setup();
    await win.fetch('/api/v1/friendships/1/following/');
    await win.fetch(new URL(LIST));
    await win.fetch(new Request(LIST));
    await flush();
    expect(posted.map((p) => p.url)).toEqual([
      'https://www.instagram.com/api/v1/friendships/1/following/',
      LIST,
      LIST,
    ]);
  });

  it('page rejections pass through unchanged', async () => {
    const { win, pageFetch } = setup();
    const boom = new TypeError('network down');
    pageFetch.mockRejectedValueOnce(boom);
    await expect(win.fetch(LIST)).rejects.toBe(boom);
  });

  it('observer failures never reach the page', async () => {
    const { win } = setup({
      isCandidate: () => {
        throw new Error('adapter bug');
      },
    });
    await expect(win.fetch(LIST)).resolves.toBeInstanceOf(Response);
    const second = setup({
      post: () => {
        throw new Error('post bug');
      },
    });
    const res = await second.win.fetch(LIST);
    await flush();
    expect(res.ok).toBe(true);
  });

  it('skips bodies over maxBytes and ones wantsBody rejects', async () => {
    const big = setup({ maxBytes: 5 });
    await big.win.fetch(LIST);
    const picky = setup({ wantsBody: () => false });
    await picky.win.fetch(LIST);
    await flush();
    expect(big.posted).toEqual([]);
    expect(picky.posted).toEqual([]);
  });

  it('uninstall restores the original fetch', () => {
    const { win, pageFetch, uninstall } = setup();
    uninstall();
    expect(win.fetch).toBe(pageFetch);
  });
});

describe('XHR observer', () => {
  it('passes open/send through untouched and reports text responses after load', () => {
    FakeXHR.instances = [];
    const { win, posted } = setup();
    const xhr = new win.XMLHttpRequest() as unknown as FakeXHR;
    let pageSaw = '';
    xhr.addEventListener('load', () => (pageSaw = xhr.responseText));
    (xhr as unknown as XMLHttpRequest).open('GET', LIST, true);
    (xhr as unknown as XMLHttpRequest).send(null);
    expect(xhr.opened).toEqual(['GET', LIST, true]);
    expect(xhr.sent).toEqual([null]);
    xhr.respond(200, '{"users":[]}');
    expect(pageSaw).toBe('{"users":[]}');
    expect(posted).toEqual([{ url: LIST, status: 200, text: '{"users":[]}' }]);
  });

  it('ignores binary response types and non-candidates', () => {
    const { win, posted } = setup();
    const a = new win.XMLHttpRequest() as unknown as FakeXHR;
    a.responseType = 'arraybuffer';
    (a as unknown as XMLHttpRequest).open('GET', LIST);
    (a as unknown as XMLHttpRequest).send();
    a.respond(200, 'ignored');
    const b = new win.XMLHttpRequest() as unknown as FakeXHR;
    (b as unknown as XMLHttpRequest).open('GET', OTHER);
    (b as unknown as XMLHttpRequest).send();
    b.respond(200, '{}');
    expect(posted).toEqual([]);
  });
});
