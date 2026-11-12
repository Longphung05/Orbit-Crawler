import { describe, expect, it } from 'vitest';
import {
  findUsernameAnchor,
  profileUsernameFromPath,
  USERNAME_ANCHOR_SELECTORS,
  usernameRowEnd,
  type Box,
  type RowElement,
} from '../../src/adapters/instagram';

describe('profileUsernameFromPath', () => {
  it.each([
    ['/fake_alex/', 'fake_alex'],
    ['/fake_alex', 'fake_alex'],
    ['/Fake.Alex_9/reels/', 'Fake.Alex_9'],
    ['/fake_alex/tagged/', 'fake_alex'],
    ['/fake_alex/followers/', 'fake_alex'],
    ['/fake_alex/following/', 'fake_alex'],
    ['/fake_alex/followers/mutualOnly', 'fake_alex'],
  ])('%s is the profile of %s', (path, name) => {
    expect(profileUsernameFromPath(path)).toBe(name);
  });

  it.each([
    '/',
    '/explore/',
    '/explore/tags/cats/',
    '/reels/',
    '/reel/Cabc123/',
    '/p/Cabc123/',
    '/direct/inbox/',
    '/accounts/login/',
    '/stories/fake_alex/123/',
    '/Explore/', // reserved names match case-insensitively
    '/fake_alex/p/Cabc123/', // a post is not the profile page
    '/fake_alex/unknown_tab/',
    '/fake_alex/reels/extra/',
    '/has space/',
    `/${'a'.repeat(31)}/`,
    '/bad-name/',
  ])('%s is not a profile page', (path) => {
    expect(profileUsernameFromPath(path)).toBeUndefined();
  });
});

describe('findUsernameAnchor', () => {
  const el = (text: string | null) => ({ textContent: text });
  /** A fake document: each selector returns its own elements. */
  const doc = (bySelector: Record<string, { textContent: string | null }[]>) => ({
    querySelectorAll: (s: string) => bySelector[s] ?? [],
  });

  it('matches the username text, ignoring case and surrounding whitespace', () => {
    const target = el('  Fake_Alex ');
    expect(findUsernameAnchor(doc({ 'header h2': [el('other'), target] }), 'fake_alex')).toBe(
      target,
    );
  });

  it('prefers earlier selectors', () => {
    const h2 = el('fake_alex');
    const span = el('fake_alex');
    const found = findUsernameAnchor(
      doc({ 'header span': [span], 'header h2': [h2] }),
      'fake_alex',
    );
    expect(found).toBe(h2);
  });

  it('falls back through every selector, then to null when markup drifted', () => {
    const span = el('fake_alex');
    expect(findUsernameAnchor(doc({ 'header span': [span] }), 'fake_alex')).toBe(span);
    expect(findUsernameAnchor(doc({}), 'fake_alex')).toBeNull();
    expect(
      findUsernameAnchor(doc({ 'header h2': [el(null), el('fake_alexander')] }), 'fake_alex'),
    ).toBeNull();
  });

  it('only ever queries inside the header', () => {
    for (const s of USERNAME_ANCHOR_SELECTORS) expect(s.startsWith('header ')).toBe(true);
  });
});

describe('usernameRowEnd', () => {
  type Fake = RowElement & { kids: Fake[] };
  const box = (left: number, width: number, top = 10, height = 20): Box => ({
    left,
    right: left + width,
    top,
    bottom: top + height,
    width,
    height,
  });
  const el = (b: Box, kids: Fake[] = []): Fake => {
    const node: Fake = {
      parentElement: null,
      kids,
      getBoundingClientRect: () => b,
      // Every descendant counts as an icon/button for this fake.
      querySelectorAll: () => {
        const all: Fake[] = [];
        const walk = (n: Fake): void => n.kids.forEach((k) => (all.push(k), walk(k)));
        walk(node);
        return all;
      },
    };
    for (const k of kids) k.parentElement = node;
    return node;
  };
  const name = box(0, 100);

  it('clears the icons right after the name (gear, verified tick, ⋯)', () => {
    const anchor = el(name);
    const tick = el(box(104, 16, 12, 16));
    const dots = el(box(128, 24, 8, 24));
    el(box(0, 400, 4, 32), [anchor, tick, dots]);
    expect(usernameRowEnd(anchor, name)).toBe(152);
  });

  it('ignores other lines, things far along the row, and the whole header', () => {
    const anchor = el(name);
    const below = el(box(110, 80, 60, 30)); // the button row under the name
    const far = el(box(300, 24)); // not next to the name
    const row = el(box(0, 400, 4, 32), [anchor, below, far]);
    el(box(0, 600, 0, 300), [row, el(box(104, 24))]); // header-level: too tall, never searched
    expect(usernameRowEnd(anchor, name)).toBe(100);
  });
});
