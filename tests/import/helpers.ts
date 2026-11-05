import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, type Zippable } from 'fflate';
import type { ExportFile } from '../../src/import';

export const FIXTURES = fileURLToPath(new URL('../fixtures/export/', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Fixture folder as raw path → bytes, paths relative to the fixture root, forward slashes. */
export function fixtureBytes(name: string): Record<string, Uint8Array<ArrayBuffer>> {
  const root = join(FIXTURES, name);
  const out: Record<string, Uint8Array<ArrayBuffer>> = {};
  for (const full of walk(root))
    out[relative(root, full).split(sep).join('/')] = new Uint8Array(readFileSync(full));
  return out;
}

export function fixtureFiles(name: string): ExportFile[] {
  return Object.entries(fixtureBytes(name))
    .filter(([p]) => !p.endsWith('README.md'))
    .map(([path, bytes]) => ({ path, text: new TextDecoder().decode(bytes) }));
}

/** Build a zip of a fixture folder (nested under a top folder, like real exports), plus extras. */
export function fixtureZip(
  name: string,
  extra: Record<string, Uint8Array> = {},
  level: 0 | 6 | 9 = 6,
): Blob {
  const entries: Zippable = {};
  for (const [p, bytes] of Object.entries({ ...fixtureBytes(name), ...extra })) {
    entries[`instagram-fake_me-2025-11-03-AbCd/${p}`] = bytes;
  }
  return new Blob([zipSync(entries, { level })]);
}
