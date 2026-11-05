import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

// See CLAUDE.md §2: Orbit never makes requests to Instagram on its own.
// Host permissions for instagram.com are added in Phase 5 (passive capture) only.
export default defineConfig({
  manifest: {
    name: 'Orbit',
    description:
      'See how close any Instagram profile is to you: 1st, 2nd, 3rd degree. Passive and local-only.',
    permissions: ['sidePanel'],
    side_panel: { default_path: 'sidepanel.html' },
    action: { default_title: 'Orbit' },
  },
  vite: () => ({
    plugins: [preact(), tailwindcss()],
  }),
});
