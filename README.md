# Orbit

LinkedIn-style 1st / 2nd / 3rd-degree connections for Instagram, as a Chrome MV3 extension.
Passive and local-only: Orbit never contacts Instagram by itself. See `CLAUDE.md` for the full spec.

> Status: **Phase 1 (scaffold)**. Popup and side panel shells only.

## Develop

```sh
npm install        # also runs `wxt prepare`
npm run dev        # launches Chrome with the extension and hot reload
npm run build      # production build -> .output/chrome-mv3
npm test           # Vitest
npm run lint       # ESLint
npm run compile    # TypeScript typecheck (app + tests)
```

### Load the build manually

1. `npm run build`
2. Open `chrome://extensions`, enable **Developer mode**
3. **Load unpacked** → select `.output/chrome-mv3`
4. Click the Orbit toolbar icon → **Open explorer** opens the side panel

### Troubleshooting

`Cannot find native binding` from Vite/rolldown is an npm optional-dependency bug.
Delete `node_modules` and `package-lock.json`, then run `npm install` again.
