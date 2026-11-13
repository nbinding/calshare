// Static security checks on the shipped files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = f => readFile(new URL(`../${f}`, import.meta.url), 'utf8');

test('index.html keeps a strict Content-Security-Policy', async () => {
  const html = await read('index.html');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  assert.ok(csp, 'CSP meta tag missing');
  for (const rule of ["default-src 'self'", "script-src 'self'", "connect-src 'none'", "base-uri 'none'", "form-action 'none'"]) assert.ok(csp.includes(rule), `CSP lacks ${rule}`);
  assert.ok(!/unsafe-inline|unsafe-eval/.test(csp), 'CSP must not allow unsafe-inline or unsafe-eval');
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
});

test('index.html has no inline scripts or event handlers', async () => {
  const html = await read('index.html');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), 'inline <script> found');
  assert.ok(!/\son[a-z]+=/i.test(html), 'inline event handler found');
});

test('app code avoids eval-like APIs and external hosts', async () => {
  for (const f of ['src/app.js', 'src/core.js', 'src/share.js']) {
    const js = await read(f);
    assert.ok(!/\beval\(|new Function\(|document\.write\(/.test(js), `${f} uses an eval-like API`);
    assert.ok(!/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket\(/.test(js), `${f} makes network requests`);
  }
});

test('app templates use no inline style attributes (blocked by the CSP)', async () => {
  const js = await read('src/app.js');
  assert.ok(!/\sstyle="/.test(js), 'inline style="" found in src/app.js; use a class instead');
});

test('passphrase key derivation stays strong', async () => {
  const js = await read('src/share.js');
  assert.match(js, /ITERATIONS = 600000/);
  assert.match(js, /name: 'AES-GCM', length: 256/);
  assert.match(js, /getRandomValues\(new Uint8Array\(16\)\)/); // fresh salt per link
  assert.match(js, /getRandomValues\(new Uint8Array\(12\)\)/); // fresh IV per link
});
