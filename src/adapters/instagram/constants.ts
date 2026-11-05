// Bump ADAPTER_VERSION whenever any matcher or schema changes; diagnostics are keyed by it.
export const ADAPTER_VERSION = '2026.11.0';

/** window.postMessage tag between Orbit's page observer and content script. */
export const ORBIT_CHANNEL = 'orbit-capture-v1';

/** Largest response body forwarded out of the page. */
export const MAX_FORWARDED_BYTES = 4 * 1024 * 1024;
