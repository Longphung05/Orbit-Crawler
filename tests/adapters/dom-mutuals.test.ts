import { describe, expect, it } from 'vitest';
import {
  findFollowedByLine,
  FOLLOWED_BY_SELECTOR,
  parseFollowedByLine,
  type LineElement,
} from '../../src/adapters/instagram';

const link = (href: string | null) => ({
  getAttribute: (n: string) => (n === 'href' ? href : null),
});
const line = (text: string | null, hrefs: (string | null)[] = []): LineElement => ({
  textContent: text,
  querySelectorAll: () => hrefs.map(link),
});

describe('parseFollowedByLine', () => {
  it('reads names from link targets and the "N others" count', () => {
    const el = line('Followed by fake_ann, fake_ben and 12 others', [
      '/fake_ann/',
      '/fake_ben/',
      '/fake_zed/followers/mutualOnly', // the "others" link: more than one segment, not a name
    ]);
    expect(parseFollowedByLine(el)).toEqual({ usernames: ['fake_ann', 'fake_ben'], others: 12 });
  });

  it('accepts absolute Instagram links and ignores other hosts and reserved paths', () => {
    const el = line('Followed by a', [
      'https://www.instagram.com/fake_ann/',
      'https://evil.example/fake_evil/',
      '/explore/',
      null,
    ]);
    expect(parseFollowedByLine(el)).toEqual({ usernames: ['fake_ann'] });
  });

  it('handles "+ N more" and thousands separators', () => {
    expect(parseFollowedByLine(line('Followed by fake_ann + 1,204 more', ['/fake_ann/']))).toEqual({
      usernames: ['fake_ann'],
      others: 1204,
    });
  });

  it('falls back to the visible text when the names are not links', () => {
    expect(parseFollowedByLine(line('Followed by fake_ann, fake_ben and 3 others'))).toEqual({
      usernames: ['fake_ann', 'fake_ben'],
      others: 3,
    });
    expect(parseFollowedByLine(line('Followed by fake_ann and fake_ben'))).toEqual({
      usernames: ['fake_ann', 'fake_ben'],
    });
    expect(parseFollowedByLine(line('Followed by @fake_ann'))).toEqual({ usernames: ['fake_ann'] });
  });

  it.each([
    ['Seguido por fake_ann y 4 más', 4],
    ['Suivi par fake_ann et 4 autres', 4],
    ['Gefolgt von fake_ann und 4 weitere', 4],
    ['Seguito da fake_ann e 4 altri', 4],
  ])('understands other languages: %s', (text, others) => {
    expect(parseFollowedByLine(line(text))).toEqual({ usernames: ['fake_ann'], others });
  });

  it('dedupes names case-insensitively and caps the list', () => {
    const many = Array.from({ length: 40 }, (_, i) => `/fake_user${i}/`);
    expect(
      parseFollowedByLine(line('Followed by x', ['/Fake_Ann/', '/fake_ann/']))?.usernames,
    ).toEqual(['Fake_Ann']);
    expect(parseFollowedByLine(line('Followed by x', many))?.usernames).toHaveLength(25);
  });

  it('is undefined for anything else', () => {
    expect(parseFollowedByLine(line('Following fake_ann', ['/fake_ann/']))).toBeUndefined();
    expect(parseFollowedByLine(line(null))).toBeUndefined();
    expect(parseFollowedByLine(line('Followed by nobody useful here!'))).toBeUndefined();
    expect(
      parseFollowedByLine(line(`Followed by ${'x'.repeat(500)}`, ['/fake_ann/'])),
    ).toBeUndefined();
  });
});

describe('findFollowedByLine', () => {
  const doc = (els: LineElement[]) => ({
    querySelectorAll: (s: string) => (s === FOLLOWED_BY_SELECTOR ? els : []),
  });

  it('picks the tightest element that holds the line, not a wrapper around it', () => {
    const inner = line('Followed by fake_ann and 3 others', ['/fake_ann/']);
    const outer = line('Followed by fake_ann and 3 others plus the rest of the bio text', [
      '/fake_ann/',
      '/fake_bio_link/',
    ]);
    expect(findFollowedByLine(doc([outer, inner]))).toEqual({ usernames: ['fake_ann'], others: 3 });
  });

  it('ignores elements that merely mention the phrase later', () => {
    const bio = line('My bio. Followed by nobody', ['/fake_x/']);
    expect(findFollowedByLine(doc([bio]))).toBeUndefined();
  });

  it('is undefined when the header has no such line, or markup drifted', () => {
    expect(findFollowedByLine(doc([]))).toBeUndefined();
    expect(findFollowedByLine(doc([line('Posts 12')]))).toBeUndefined();
  });

  it('only looks inside the profile header', () => {
    expect(FOLLOWED_BY_SELECTOR.split(',').every((s) => s.trim().startsWith('header '))).toBe(true);
  });
});
