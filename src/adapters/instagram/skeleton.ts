// Value-free structural summary of a payload, for diagnostics when a schema stops matching.
// Contains key names and types only: never strings, numbers, ids, or usernames.

export type Skeleton = string | Skeleton[] | { [key: string]: Skeleton };

const MAX_DEPTH = 6;
const MAX_KEYS = 40;

/** Object keys that are themselves data (e.g. legacy username → date maps) are summarised. */
const SAFE_KEY = /^[a-z_][a-z0-9_]{0,63}$/i;

export function skeleton(value: unknown, depth = 0): Skeleton {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    return depth >= MAX_DEPTH ? ['…'] : [skeleton(value[0], depth + 1)];
  }
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object': {
      if (depth >= MAX_DEPTH) return '{…}';
      const entries = Object.entries(value as Record<string, unknown>);
      // Many keys with identical value shapes is a map (e.g. username → date): its keys are data.
      if (entries.length >= 5) {
        const shapes = new Set(entries.map(([, v]) => JSON.stringify(skeleton(v, depth + 1))));
        if (shapes.size === 1) {
          return {
            '(map)': skeleton(entries[0]?.[1], depth + 1),
            '(entries)': String(entries.length),
          };
        }
      }
      const out: Record<string, Skeleton> = {};
      let unsafe = 0;
      for (const [k, v] of entries.slice(0, MAX_KEYS)) {
        // Keys that look like data (digits, dots, odd characters) are counted, not shown.
        if (SAFE_KEY.test(k) && !/^\d/.test(k) && !/\d{4,}/.test(k))
          out[k] = skeleton(v, depth + 1);
        else unsafe++;
      }
      if (unsafe) out['(data-keys)'] = String(unsafe);
      if (entries.length > MAX_KEYS) out['(more-keys)'] = String(entries.length - MAX_KEYS);
      return out;
    }
    default:
      return typeof value;
  }
}
