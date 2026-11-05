# Orbit

LinkedIn-style 1st / 2nd / 3rd-degree connections for Instagram, as a Chrome MV3 extension.
Passive and local-only: Orbit never contacts Instagram by itself. See `CLAUDE.md` for the full spec.

> Status: **Phase 5 of 8**. Passive capture works on instagram.com; the profile badge is Phase 6.

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

## Your Instagram data export

1. Instagram → **Accounts Center → Your information and permissions → Download your information**
2. Choose **Some of your information → Followers and following** (no need for media)
3. Format **JSON** (not HTML), date range **All time**
4. Download the `.zip` when Instagram emails you

### Check an export locally (no extension needed)

```sh
npm run inspect-export -- "C:\path\to\instagram-you-2026-11-01-xxxx.zip"
npm run inspect-export -- "C:\path\to\unzipped-folder"
```

Prints which files were recognised, follower/following counts, and the detected export date.
It never prints usernames, writes nothing, and makes no network requests.

### Import into the extension

Side panel → **Import your Instagram export** → choose the `.zip` (or unzipped folder). You can
review the result straight away; saving it needs Orbit to know which Instagram account is yours,
which it detects when you open instagram.com while logged in (Phase 5).

## Try it on Instagram

1. `npm run build`, then in `chrome://extensions` click **Reload** on Orbit (or Load unpacked
   `.output/chrome-mv3` the first time). Reload any open instagram.com tabs.
2. Browse normally while logged in: open your own profile once, then a few profiles and their
   Followers / Following lists. Scroll a short list to the end to see it marked complete.
3. The toolbar popup shows accounts/connections growing and a health dot:
   grey = nothing seen yet, green = capturing, amber/red = some response types not understood.
4. Side panel → **Capture status** lists each response type. If anything is red, click
   **Copy diagnostics** and share it: it holds endpoint patterns, counts and data *shapes*
   only, never usernames or ids.

Orbit only reads responses the page already received. It never opens pages, scrolls, or sends
requests, so what it learns grows only as fast as you browse.

### Troubleshooting

`Cannot find native binding` from Vite/rolldown is an npm optional-dependency bug.
Delete `node_modules` and `package-lock.json`, then run `npm install` again.
