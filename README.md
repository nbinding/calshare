# Calshare

**Find a day that works for both of you.** Mark the days you're free, send an encrypted link, and settle on a date in four messages. There are no accounts, no server and nothing to install.

**Live app: https://nbinding.github.io/calshare/**

[![Tests](https://github.com/nbinding/calshare/actions/workflows/ci.yml/badge.svg)](https://github.com/nbinding/calshare/actions/workflows/ci.yml)
[![CodeQL](https://github.com/nbinding/calshare/actions/workflows/codeql.yml/badge.svg)](https://github.com/nbinding/calshare/actions/workflows/codeql.yml)

## How it works

| Step | Who | What happens |
|---|---|---|
| 1 | Organiser | Marks their free days across 1–3 months, optionally tagged Morning, Afternoon or Evening, then locks them with a passphrase and sends the link. |
| 2 | Guest | Opens the link with the passphrase, sees the organiser's days (dashed outline), marks their own and sends the link back. Shared days are ringed. |
| 3 | Organiser | Sees only the days both are free, with compatible times, and picks one or several. |
| 4 | Guest | Locks in one final day, or several when planning a week or month at a time, and gets a ready-made summary, a confirmation link and an `.ics` calendar file. |

**Group plans.** Choose *A group* when you start. Everyone gets the same link, adds their days and sends their own reply back to the organiser. Each guest gets a hidden random ID on their device, so two people with the same name never overwrite each other: duplicates show as *Sam · K7* and *Sam · Q2*, and each guest sees their own reply code. Replying again replaces that guest's earlier reply. The organiser sees how many can make each day (*3 of 4*), locks in one or more days and sends one confirmation to everyone.

**Editing after sending.** Every waiting screen has *Edit my days* (or *Change my picks*), and settled plans have *Change the final days* for whoever locked them in. You get a new link with an "I've updated my days, use this link instead" message and the same passphrase. Each person owns their own days, so if someone replies to an older link, your latest days are kept and a note says so.

If nothing lines up, either side can change their days and send the plan back. A progress bar shows whose turn it is. Every share screen offers Share, Copy message, Copy link, and the link on its own in a selectable box for browsers that block the copy buttons.

## Privacy and security

- **Encrypted in the browser.** Plans are gzipped, then encrypted with AES-256-GCM, using a key derived from the passphrase with PBKDF2-SHA-256 (600,000 iterations). This uses the built-in Web Crypto API, adapted from [stead-mobile](https://github.com/nbinding/stead-mobile).
- **Never sent to a server.** The encrypted plan goes after the `#` in the link (`#<planId>.<ciphertext>`), and browsers never send that part. The passphrase is sent separately. A suggested passphrase is three words from a 186-word list, and people can type their own.
- **Locked-down page.** A strict Content-Security-Policy blocks inline scripts and all network requests, and the referrer is never sent.
- **Kept on this device.** Plans you open are stored in `localStorage` (`calshare-v1`), including the passphrase, so replies open without retyping it. **Forget** removes a plan.
- **Compact links.** One hex digit per day keeps a 3-month plan with both people's days to about 250–450 characters.
- Links older than 14 days show a warning. Opening an older link after a later step has been saved points to the newer one.

## Display and accessibility

The **Display** button opens settings adapted from stead-mobile: text size (100–150%), reading font (Original, Plain sans or the bundled OpenDyslexic), appearance (device, light or dark), help with dates (weekday in every day square, today labelled, stronger outlines), more breathing room and reduced motion. The settings last for the current tab (`sessionStorage`). There's also a skip link, focus is trapped in the dialog, and calendar states are shown by shape (fill, dashed outline, ring), never by colour alone.

## Project layout

```
index.html              Page shell, CSP and metadata
src/app.js              UI, routing, local storage, events
src/core.js             Pure logic: dates, day masks, encoding, overlaps, messages, .ics
src/share.js            Passphrase encryption (PBKDF2 + AES-GCM) and passphrase words
src/style.css           Dark grey and white design system
src/fonts/              OpenDyslexic (SIL OFL)
test/*.test.mjs         Node unit and static security tests
test/e2e/*.spec.mjs     Playwright browser tests at phone sizes
test/serve.mjs          Tiny static server used by the browser tests
```

There's no build step and there are no runtime dependencies. GitHub Pages serves the repository root from `main`, so every merge to `main` goes live in about a minute.

## Running locally

```sh
npm run serve          # http://localhost:4173
npm test               # unit and security checks (no install needed)
npm ci && npm run test:e2e   # browser tests
```

See [TESTING.md](TESTING.md) for what's covered and how CI runs it, and [AGENTS.md](AGENTS.md) for guidance for AI coding agents working in this repo.
