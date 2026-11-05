import { describe, expect, it } from 'vitest';
import { checkOwner, commitImport, parseExport, readExportZip, toSnapshot } from '../../src/import';
import { obs, store } from '../db/helpers';
import { fixtureFiles, fixtureZip } from './helpers';

const NOW = Date.UTC(2025, 10, 6);

describe('commitImport', () => {
  it('imports a zip end to end into the viewer graph', async () => {
    const s = store('1000');
    const { files } = await readExportZip(fixtureZip('modern'));
    const parsed = parseExport(files, { now: NOW, sourceName: 'instagram-fake_me-2025-11-03.zip' });
    const res = await commitImport(s, parsed, NOW);
    // following: alex, morgan, href_only; followers: alex, jamie, casey → 5 distinct accounts.
    expect(res).toEqual({ added: 6, markedStale: 0, placeholders: 5 });
    expect(await s.counts()).toEqual({ nodes: 5, edges: 6 });
    expect(await s.getEdge('1000', 'username:fake_alex')).toMatchObject({ source: 'export' });
    expect(await s.getEdge('username:fake_jamie', '1000')).toBeDefined();
    expect(await s.getEdge('1000', 'username:fake_pending')).toBeUndefined();
    expect((await s.db.viewers.get('1000'))?.importedExportAt).toBe(parsed.exportedAt);
  });

  it('re-importing the same export is idempotent', async () => {
    const s = store('1000');
    const parsed = parseExport(fixtureFiles('modern'), { now: NOW });
    await commitImport(s, parsed, NOW);
    const again = await commitImport(s, parsed, NOW + 1);
    expect(again).toMatchObject({ added: 0, markedStale: 0 });
    expect(await s.counts()).toEqual({ nodes: 5, edges: 6 });
  });

  it('links to already-known real accounts instead of creating placeholders', async () => {
    const s = store('1000');
    await s.upsertNodes([obs('42', 'fake_alex')], 1);
    const res = await commitImport(s, parseExport(fixtureFiles('modern'), { now: NOW }), NOW);
    expect(res.placeholders).toBe(4);
    expect(await s.getEdge('1000', '42')).toBeDefined();
  });

  it('a newer export marks unfollows stale; a partial list never does', async () => {
    const s = store('1000');
    const first = parseExport(fixtureFiles('classic'), { now: NOW });
    await commitImport(s, { ...first, exportedAt: 100 }, 100);

    // Next export: fake_a2 stopped following, but followers_1 is missing → partial.
    const partial = parseExport(
      fixtureFiles('classic').filter((f) => !f.path.endsWith('followers_1.json')),
      { now: NOW },
    );
    expect(toSnapshot(partial).partial).toEqual(['followers']);
    expect((await commitImport(s, { ...partial, exportedAt: 200 }, 200)).markedStale).toBe(0);

    // Complete next export without fake_a2 → its edge goes stale.
    const complete = parseExport(
      fixtureFiles('classic').map((f) =>
        f.path.endsWith('followers_2.json') ? { ...f, text: '[]' } : f,
      ),
      { now: NOW },
    );
    expect((await commitImport(s, { ...complete, exportedAt: 300 }, 300)).markedStale).toBe(1);
    expect(await s.getEdge('username:fake_a2', '1000')).toMatchObject({ stale: true });
    expect(await s.getEdge('username:fake_a1', '1000')).toMatchObject({ stale: false });
  });

  it('an export without a followers file leaves known followers untouched', async () => {
    const s = store('1000');
    await s.upsertEdges([{ from: '77', to: '1000', source: 'followers_list' }], 1);
    const followingOnly = parseExport(
      fixtureFiles('modern').filter((f) => !f.path.endsWith('followers_1.json')),
      { now: NOW },
    );
    expect(followingOnly.followers).toBeUndefined();
    await commitImport(s, followingOnly, NOW);
    expect(await s.getEdge('77', '1000')).toMatchObject({ stale: false });
  });

  it('refuses to commit a parse with errors, writing nothing', async () => {
    const s = store('1000');
    await expect(
      commitImport(s, parseExport(fixtureFiles('html'), { now: NOW }), NOW),
    ).rejects.toThrow(/HTML/);
    expect(await s.counts()).toEqual({ nodes: 0, edges: 0 });
  });
});

describe('checkOwner', () => {
  const parsed = parseExport(fixtureFiles('modern'), { now: NOW });
  it('matches case-insensitively', () => {
    expect(checkOwner(parsed, 'Fake_Me')).toBe('match');
  });
  it('flags someone else’s export', () => {
    expect(checkOwner(parsed, 'fake_other')).toBe('mismatch');
  });
  it('is unknown without personal_information or a detected viewer', () => {
    expect(checkOwner(parsed, undefined)).toBe('unknown');
    expect(checkOwner(parseExport(fixtureFiles('classic'), { now: NOW }), 'fake_me')).toBe(
      'unknown',
    );
  });
});
