// Guards for CLAUDE.md §2 hard constraints. These fail the build if someone "optimizes" around them.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import config from '../../wxt.config';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCANNED_DIRS = ['src', 'entrypoints'];

/**
 * Files allowed to reference network primitives. Phase 5's MAIN-world observer must *wrap*
 * fetch/XHR read-only; it is the only exception and gets its own dedicated tests.
 */
const NETWORK_ALLOWLIST = new Set<string>(['src/capture/main-world-observer.ts']);

const FORBIDDEN_NETWORK = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bsendBeacon\b/,
  /\bEventSource\b/,
];
const FORBIDDEN_EVERYWHERE = [
  /\b(chrome|browser)\.cookies\b/, // §2.3 no credential handling
  /\b(chrome|browser)\.webRequest\b/,
  /document\.cookie/,
  /\bscrollBy\s*\(|\bscrollTo\s*\(|\.scrollTop\s*=/, // §2.1 no auto-scrolling
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx|js)$/.test(name) ? [full] : [];
  });
}

const files = SCANNED_DIRS.flatMap((d) => walk(join(ROOT, d))).map((full) => ({
  rel: relative(ROOT, full).split(sep).join('/'),
  text: readFileSync(full, 'utf8'),
}));

describe('§2 hard constraints', () => {
  it('scans at least the scaffold files', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it.each(files.map((f) => [f.rel, f] as const))('%s makes no network calls', (_rel, f) => {
    if (NETWORK_ALLOWLIST.has(f.rel)) return;
    for (const re of FORBIDDEN_NETWORK) expect(f.text, `${f.rel} matches ${re}`).not.toMatch(re);
  });

  it.each(files.map((f) => [f.rel, f] as const))(
    '%s touches no cookies or scrolling',
    (_rel, f) => {
      for (const re of FORBIDDEN_EVERYWHERE)
        expect(f.text, `${f.rel} matches ${re}`).not.toMatch(re);
    },
  );

  it('manifest requests no credential or request-interception permissions', async () => {
    const raw = config.manifest;
    const manifest = await (typeof raw === 'function'
      ? raw({ browser: 'chrome', manifestVersion: 3, mode: 'production', command: 'build' })
      : raw);
    if (!manifest) throw new Error('manifest missing');
    const perms: string[] = manifest.permissions ?? [];
    for (const banned of ['cookies', 'webRequest', 'webRequestBlocking', 'debugger', 'tabs']) {
      expect(perms).not.toContain(banned);
    }
    expect(manifest.host_permissions ?? []).toEqual([]);
  });
});
