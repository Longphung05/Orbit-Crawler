# Orbit

LinkedIn-style 1st / 2nd / 3rd-degree connections for Instagram, as a Chrome MV3 extension.
Passive and local-only: Orbit never contacts Instagram by itself. See `CLAUDE.md` for the full spec.

> Status: **Phase 6 of 8**. Passive capture and the profile badge + paths popover are built;
> the side panel explorer is Phase 7.

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

## The profile badge (Phase 6)

On a profile page Orbit shows a pill next to the username: `You`, `1st`, `2nd · via 4`,
`3rd · via 2` or `Out of orbit`. Click a 2nd/3rd badge to see the people who connect you, grouped by
the person you follow. Hover for what the numbers mean.

- `≤3rd` / `via 4+`: Orbit only knows what you've imported or browsed, so a degree is "this close
  or closer" and a count is "at least". Open more lists (scroll them to the end) to firm them up.
- The badge is a separate Shadow DOM element positioned over the username; it never changes
  Instagram's own elements. If the username can't be found it sits in a bottom-right corner pill.
- Avatars are initials by default. Profile pictures would be requests to Instagram's CDN that the
  page didn't make, so they're off (`showAvatarImages` setting, no UI for it until Phase 7).
- After you open a profile, Instagram's data arrives a moment later; the badge updates itself then.

### How the answer is worked out

Orbit never asks Instagram anything. It learns from two things only:

1. **Your export** (side panel → Import). This gives it everyone you follow in one go, so you do
   **not** need to scroll your own lists. (Without an export, scroll your own Following list to the
   end once.)
2. **Pages you open yourself.** On any profile, Instagram shows "Followed by a, b and N others":
   people **you follow** who follow that profile. Each named person is a connection, so the profile
   is **2nd degree**. Orbit reads that line (and the data Instagram loads for it). You do **not**
   need to scroll their followers. If the badge says `via 2+`, click "Followed by … and N others"
   and scroll that list to the end to get the exact count.

3. **Exports friends share with you** (side panel → Import → "A friend's"). A friend's own
   `following.json` gives Orbit everything *they* follow, a whole branch of the graph with no
   scrolling. This is how 3rd-degree links appear without hours of list-scrolling. Only import an
   export the friend chose to give you.

To check one profile for a 3rd-degree link, open its Followers list and scroll a little: any
follower Orbit already knows as 2nd degree makes it 3rd.

`3rd+ ?` / `Unknown` (formerly "Out of orbit") means "Orbit has no connection data yet", not "no
connection exists". Click the badge for what to do. The popup and side panel say what Orbit has detected and what to do next, and the
side panel's **Activity** list shows every capture in plain words, so the live counters are
explainable: each line is something Instagram's own page loaded because you opened it.

### Reset

Popup or side panel → **Reset all data** (asks once) erases every account, connection, setting and
log Orbit has stored, for all accounts. It keeps only which Instagram account is logged in.
