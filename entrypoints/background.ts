export default defineBackground(() => {
  // Phase 1: no-op service worker. Storage writes and message routing arrive in Phase 3/5.
  // This worker must never make network requests to Instagram (CLAUDE.md §2).
  browser.runtime.onInstalled.addListener(({ reason }) => {
    console.info(`[orbit] installed (${reason})`);
  });
});
