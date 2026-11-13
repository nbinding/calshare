# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex and others) working in this repository.

**What this is:** Calshare, a static, client-only web app for agreeing on a day with one other person through encrypted links. It's live at https://nbinding.github.io/calshare/ and served by GitHub Pages from the root of `main`. **Anything merged to `main` is live within about a minute**, so only merge when the owner asks.

## Ground rules

- **No backend, no accounts, no tracking, no network calls.** The Content-Security-Policy in `index.html` sets `connect-src 'none'`, and `test/security.test.mjs` enforces it. Don't add analytics, CDNs, web fonts from other hosts or `fetch` calls.
- **No build step and no runtime dependencies.** Plain ES modules in `src/` are loaded directly by `index.html`. Keep it that way unless the owner asks otherwise. `@playwright/test` is the only dev dependency.
- **Treat everything inside a link as untrusted.** Names, titles and dates come from someone else's link. Every value that goes into HTML must pass through `h()` in `src/app.js`. `test/e2e/security.spec.mjs` checks this.
- **Don't weaken the crypto.** PBKDF2-SHA-256 with 600,000 iterations, AES-256-GCM, and a random salt and IV for each link. Ask before changing any of it.
- **Keep old links working.** `fromWire()` in `src/core.js` must keep reading payloads from earlier releases (for example `f` as a single number, which is now a list). Add a test whenever the wire format changes.
- **Mobile first.** Every screen must work at 320px wide with no sideways scrolling, at 150% text size and with OpenDyslexic. Tap targets are at least 44px.
- Keep plan data out of logs, URLs other than the `#` fragment, and anything sent off the device.

## Where things live

| File | Role |
|---|---|
| `src/core.js` | Pure logic with no DOM: dates (UTC calendar dates), day masks (`FREE` plus `MORNING`, `AFTERNOON`, `EVENING` and `MAYBE` bits, one base-32 digit per day in links), `cycle` (calendar taps), `setTime` (per-day buttons), `meet`/`overlap`, hex day encoding, `toWire`/`fromWire`, messages, `.ics`. Put logic here so it can be unit tested. |
| `src/share.js` | `seal`/`open` (gzip, PBKDF2, AES-GCM, base64url) and `suggestPassphrase` (3 words). |
| `src/app.js` | A single state object `S`, `render()` rebuilds `#app` from template strings, and events are delegated through `data-act` attributes. Display preferences go in `sessionStorage`, plans in `localStorage`. |
| `src/ds/` | Pinned copy of the nbinding design system: tokens (`--nb-*`), fonts, `nb-` components and `js/nb.js` (`esc`, `toast`, `copy`, `prefs`, `mark`). **Don't edit it here.** Change the design system repo, then run `node scripts/sync-ds.mjs ../nbinding-design-system`. |
| `src/style.css` | Calshare-only layout on top of the design system: page spacing, the per-day time rows, the desktop shell. Use `--nb-*` tokens. |

How a plan moves between people: `step` is the step that *produced* the link (1 organiser shared, 2 guest replied, 3 organiser picked, 4 settled). `turnAfter(step)` says whose turn it is next. Roles are `a` (organiser) and `b` (guest), remembered for each plan id on the device.

- **Groups** (`group: true`, wire `g`): one step-1 invite goes to many guests. Each reply (step 2) carries the guest's hidden id (`b.id`, wire `b.u`). The organiser's device files replies under that id in `localStorage` (`replies`), and the organiser locks in the final days straight from the collect view (step 4, with `people` in the link).
- **Versions** (`a.v`, `b.v`): each send of your own days bumps your version. On opening a link, a newer local copy of *your own* days wins (`enterPlan`), so replies to old links never undo edits.
- **Edit**: `edit()` reopens the step that made the current link, with `S.editing` set so the message says to use the new link.

## Before you push

```sh
npm test                 # always: unit and static security checks
npm run test:e2e         # for any UI or flow change (Chromium is pre-installed in Claude Code cloud sessions)
```

- Add or update tests with every behaviour change. See [TESTING.md](TESTING.md).
- Never skip, disable or loosen a test to get CI green. Fix the cause.
- Browser tests fix the date at 2026-11-13. Use dates after that in new tests.

## Style

- Plain, friendly UK English in the UI ("organiser", sentence case, no jargon).
- Use design-system components (`nb-` classes) for anything on screen. Add a new component to the design system first, rather than styling it only here.
- Visual language: dark grey and white only. Bricolage Grotesque (display, dates) and Inter (body), self-hosted in `src/fonts/`. Your days hatch at 45°, theirs at -45°, shared days are solid, maybes add a dotted outline and "?". Show every state by shape, not colour alone. Few boxes: structure with space and type. 60px primary buttons, 44px minimum tap targets.
- The app opens on the calendar; details are asked at send time. Calendar screens end with the sticky `.dock` (count and one next action). Holding a day, right-clicking it or the **Times and maybes** button opens the bottom sheet.
- Keep functions small and code compact, following the existing style. Comments explain *why*, not *what*.

## Git

- Work on a branch, open a pull request and let CI run. Squash-merge into `main` only when the owner asks, because merging deploys.
- Don't put secrets, personal details or model names in commits, code or docs.
