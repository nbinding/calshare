// Encrypted share links for Calshare (adapted from nbinding/stead-mobile).
// The plan is compressed, then encrypted in the browser with AES-GCM (Web Crypto).
// The key comes from a passphrase through PBKDF2-SHA-256. The result travels after
// the # in the address, which browsers never send to a server.
// Byte layout: [format 1][flags 1][salt 16][iv 12][ciphertext...], base64url encoded.

export const ITERATIONS = 600000;
const FORMAT = 1;
const FLAG_GZIP = 1;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBase64Url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromBase64Url(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('bad link');
  let b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const writer = stream.writable.getWriter();
  writer.write(bytes); writer.close();
  const reader = stream.readable.getReader();
  const parts = []; let n = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; parts.push(value); n += value.length; }
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const canZip = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

async function deriveKey(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function seal(value, passphrase, iterations = ITERATIONS) {
  let body = enc.encode(JSON.stringify(value));
  let flags = 0;
  if (canZip()) { body = await pipe(body, new CompressionStream('gzip')); flags |= FLAG_GZIP; }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, body));
  const out = new Uint8Array(2 + 16 + 12 + cipher.length);
  out[0] = FORMAT; out[1] = flags; out.set(salt, 2); out.set(iv, 18); out.set(cipher, 30);
  return toBase64Url(out);
}

export class WrongPassphrase extends Error {}

export async function open(code, passphrase, iterations = ITERATIONS) {
  const bytes = fromBase64Url(code);
  if (bytes.length < 31 || bytes[0] !== FORMAT) throw new Error('bad link');
  const flags = bytes[1];
  const key = await deriveKey(passphrase, bytes.subarray(2, 18), iterations);
  let body;
  try { body = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(18, 30) }, key, bytes.subarray(30))); }
  catch { throw new WrongPassphrase('wrong passphrase'); }
  if (flags & FLAG_GZIP) {
    if (!canZip()) throw new Error('This browser cannot open compressed links. Try a recent version of Chrome, Safari, Firefox or Edge.');
    body = await pipe(body, new DecompressionStream('gzip'));
  }
  return JSON.parse(dec.decode(body));
}

const WORDS = ('acorn amber anchor apple arch atlas autumn badge bamboo banner barley basin beacon bench birch biscuit blossom bonnet border bramble breeze brick bridge brook bucket button cabin cable camel candle canvas canyon carpet castle cedar cellar chalk channel cherry chestnut cinder circle clover cobble comet copper coral cotton cradle crater crayon cricket crystal cupboard daisy dawn delta denim dew dolphin dune ember engine fable falcon feather fern fiddle field flint forest fossil fountain fox garden garnet ginger glacier globe granite gravel grove harbour harvest hazel heather hedge heron hill honey horizon island ivory jasmine jetty juniper kettle kite lagoon lantern larch lark lemon lily linen lobster locket lupin maple marble marsh meadow mesa mint mitten moss motor nectar nest nutmeg oak oasis ocean olive orbit orchard otter paddle pebble pepper pigeon pine planet plum pocket pony poppy prairie puffin quarry quill rabbit raven reef ribbon ridge river robin rocket rowan saddle saffron sail salmon sapling satin scarf shell shore silver sketch slate sparrow spruce stable star stone summit swallow teapot thistle thunder timber tulip tunnel valley velvet violet walnut wave willow window winter wren yarrow zephyr').split(' ');

export function suggestPassphrase(count = 4) {
  const pick = crypto.getRandomValues(new Uint32Array(count));
  return Array.from(pick, n => WORDS[n % WORDS.length]).join('-');
}
export const WORD_COUNT = WORDS.length;
