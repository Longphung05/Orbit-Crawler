import { describe, expect, it } from 'vitest';
import { ExportReadError, parseExport, readExportFolder, readExportZip } from '../../src/import';
import { fixtureBytes, fixtureFiles, fixtureZip } from './helpers';

const NOW = Date.UTC(2025, 10, 6);
const sortByPath = <T extends { path: string }>(xs: T[]): T[] =>
  xs.slice().sort((a, b) => a.path.localeCompare(b.path));

describe('readExportZip', () => {
  it.each([0, 6, 9] as const)('reads relevant files (compression level %i)', async (level) => {
    const { files } = await readExportZip(fixtureZip('modern', {}, level));
    const stripped = files.map((f) => ({ ...f, path: f.path.split('/').slice(1).join('/') }));
    const expected = fixtureFiles('modern');
    expect(sortByPath(stripped)).toEqual(sortByPath(expected));
  });

  it('skips media without decompressing it, and reports progress', async () => {
    const media = new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 2654435761) >>> 24);
    const blob = fixtureZip('modern', {
      'media/posts/202511/photo.jpg': media,
      'your_instagram_activity/likes/liked_posts.json': new TextEncoder().encode('[]'),
    });
    const progress: number[] = [];
    const { files, skipped } = await readExportZip(blob, (p) => progress.push(p.bytesRead));
    expect(skipped).toBeGreaterThanOrEqual(2);
    expect(files.some((f) => f.path.includes('media/'))).toBe(false);
    expect(progress.at(-1)).toBe(blob.size);
    // The parsed result is the same as from the folder.
    const p = parseExport(files, { now: NOW });
    expect(p.followers?.usernames).toHaveLength(3);
  });

  it('rejects non-zip files with a friendly error', async () => {
    const notZip = new Blob([new TextEncoder().encode('{"relationships_following": []}')]);
    await expect(readExportZip(notZip)).rejects.toBeInstanceOf(ExportReadError);
    await expect(readExportZip(notZip)).rejects.toThrow(/not a zip/);
  });

  it('rejects a truncated archive with a friendly error', async () => {
    const full = new Uint8Array(await fixtureZip('modern').arrayBuffer());
    const truncated = new Blob([full.slice(0, Math.floor(full.length / 2))]);
    await expect(readExportZip(truncated)).rejects.toBeInstanceOf(ExportReadError);
  });
});

describe('readExportFolder', () => {
  it('reads only relevant files from a folder pick (Windows separators too)', async () => {
    const entries = Object.entries(fixtureBytes('modern')).map(([path, bytes]) => ({
      path: `instagram-fake_me\\${path.replace(/\//g, '\\')}`,
      blob: new Blob([bytes]),
    }));
    entries.push({ path: 'instagram-fake_me\\media\\a.jpg', blob: new Blob([new Uint8Array(10)]) });
    const progress: number[] = [];
    const { files, skipped } = await readExportFolder(entries, (p) => progress.push(p.bytesRead));
    expect(files.every((f) => !f.path.includes('\\'))).toBe(true);
    expect(files.some((f) => f.path.endsWith('followers_1.json'))).toBe(true);
    expect(skipped).toBe(1);
    expect(progress.length).toBe(files.length);
  });
});
