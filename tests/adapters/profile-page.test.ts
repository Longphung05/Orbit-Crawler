import { describe, expect, it } from 'vitest';
import {
  findUsernameAnchor,
  profileUsernameFromPath,
  USERNAME_ANCHOR_SELECTORS,
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
