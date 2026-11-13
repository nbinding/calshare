# Calshare

Find a day that works for both of you. A mobile-first, static web app for sharing day-level availability with no accounts, backend or tracking.

## The four steps

1. **Owner shares.** Mark your free days across 1–3 months, optionally tagging them Morning, Afternoon or Evening. Set a passphrase and send the link.
2. **Recipient adds theirs.** They see your days with a dashed outline, mark their own (shared days are ringed) and send the link back.
3. **Owner picks.** Only days you're both free on, with compatible times, can be picked. Choose one or a few.
4. **Recipient confirms.** They lock in one final day, or several (handy for planning a week or month at a time), and get a ready-made summary message, a confirmation link and an `.ics` calendar file.

Every share screen also shows the link on its own in a selectable box, so it can be copied by hand if the browser blocks the copy buttons.

If nothing lines up, either side can change their days and send the plan back. A progress bar at the top shows whose turn it is.

## Privacy and links

- Plans are gzipped and then encrypted in the browser with **AES-256-GCM**, using a key derived from the passphrase with **PBKDF2-SHA-256** (600,000 iterations). This uses the built-in Web Crypto API, so no CryptoJS is needed. The scheme comes from [stead-mobile](https://github.com/nbinding/stead-mobile).
- The encrypted plan goes after the `#` in the URL (`#<planId>.<ciphertext>`), and browsers never send that part to a server. Send the passphrase separately.
- Days are packed into one hex digit per day, so a 3-month plan with both people's days comes to about 400 characters of URL.
- Plans you open are kept in `localStorage` on your device (`calshare-v1`), including the passphrase. When the other person replies, their link opens without asking for it again. You can forget a plan from the home screen or the final screen.
- Links older than 14 days get a warning. Opening an older link when you've already saved a later step shows a "newer version" banner.
- A strict Content-Security-Policy blocks all network requests from the page.

## Design

The look is adapted from stead-mobile, in dark grey and white: Georgia display type with a muted italic accent, Arial body, 6px radii, 56px main buttons and 44px tap targets. It follows the device's light or dark mode, or you can set it in the header. Calendar states don't depend on colour: you get a filled fill, a dashed outline and a ring with a dot.

## Run, test and host

There's no build step. Serve the folder statically, for example with GitHub Pages from the repository root:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
npm test                      # node --test: dates, encoding, overlaps, messages, crypto
```
