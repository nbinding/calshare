# Testing

Calshare has three layers of automated checks. All of them run on every pull request and on every push to `main`. The live site is https://nbinding.github.io/calshare/

## 1. Unit and static security tests (`npm test`)

These use Node's built-in test runner, need no install, and run in about a second.

| File | Covers |
|---|---|
| `test/core.test.mjs` | Painting days and time tags, overlap rules (for example morning vs evening never match), dates across year boundaries, compact day encoding, round trips of plans to and from the wire format (including links from the first release that held a single final day), draft messages, multi-day summaries and `.ics` output, and encryption with right and wrong passphrases. |
| `test/security.test.mjs` | The strict Content-Security-Policy is still in `index.html` (no `unsafe-inline` or `unsafe-eval`, `connect-src 'none'`). No inline scripts or event handlers. No `eval`, `new Function`, `fetch` or other network APIs in the app code. Key derivation stays at 600,000 PBKDF2 iterations with AES-256-GCM and a fresh salt and IV for each link. |

## 2. Browser tests (`npm run test:e2e`)

These are Playwright tests in `test/e2e/`. Each test runs on two phone sizes, iPhone 13 and iPhone SE (320px wide), with the clock fixed to 13 November 2026 so the calendar is the same on every run. `test/serve.mjs` serves the repo.

| File | Covers |
|---|---|
| `flow.spec.mjs` | The full four-step flow between two separate browser profiles (one light, one dark): a three-word passphrase, the link box matching the URL, the wrong-passphrase error, live match counts, the reply opening without retyping the passphrase, only shared days being pickable, locking in two days, the final card and summary, the older-link warning, and the home-screen status. Also the "no days in common" path. Fails on any console error or sideways scrolling. |
| `accessibility.spec.mjs` | The Display dialog takes and returns focus and closes with Escape. Every setting at its maximum (150%, OpenDyslexic, dark, help with dates, more spacing, reduced motion) is applied, survives a reload, and keeps every calendar label inside its square with no sideways scrolling. Reset works. The skip link moves focus to the main content. |
| `security.spec.mjs` | A crafted link with `<img onerror>` and `<script>` in the name and title is shown as text and never runs. A link whose plan id doesn't match its contents is rejected. The page makes no requests to other hosts. |

First run:

```sh
npm ci
npx playwright install chromium   # skip in Claude Code cloud sessions: a matching browser is pre-installed
npm run test:e2e
```

`@playwright/test` is pinned to an exact version, so it matches the browser installed in development environments. Dependabot doesn't open minor or patch updates for it. Update it deliberately.

## 3. CodeQL code scanning

`.github/workflows/codeql.yml` runs GitHub's `security-extended` JavaScript queries on pull requests, on pushes to `main` and weekly. Findings appear under **Security → Code scanning**. The main risk for this app is cross-site scripting from content inside shared links: all plan text is passed through `h()` in `src/app.js` before it goes into HTML.

## Continuous integration

`.github/workflows/ci.yml` runs two jobs:

- **Unit and security checks:** `npm test`
- **Browser tests (phone sizes):** installs Chromium, runs Playwright, and uploads the report and traces as an artifact if anything fails. CI retries a failing browser test once.

Dependabot (`.github/dependabot.yml`) keeps the GitHub Actions versions current weekly and checks npm monthly.

## Recommended repository settings

Only the repo owner can change these, in **Settings**:

- **Code security:** turn on secret scanning and push protection.
- **Branches → `main`:** require the *Unit and security checks*, *Browser tests (phone sizes)* and *Analyze JavaScript* checks to pass before merging. This stops a broken change from going live.

## Manual checks before a release

Automated tests use Chromium. Quickly check on a real iPhone (Safari) and Android phone:

- Share… opens the system share sheet. Copy buttons copy, and the link box can be selected by hand.
- A link sent through WhatsApp or iMessage arrives whole and opens.
- **Add to calendar** imports the `.ics` file with every chosen day.
