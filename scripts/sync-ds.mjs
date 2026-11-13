// Copy the nbinding design system's src/ into src/ds/ and record which commit it came from.
// Calshare can't load it from another host (its CSP allows only 'self'), so it carries a pinned copy.
//   node scripts/sync-ds.mjs ../nbinding-design-system        (a local clone, at the commit you want)
import { cp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const from = resolve(process.argv[2] || '../nbinding-design-system');
const to = resolve(new URL('../src/ds', import.meta.url).pathname);
const commit = execFileSync('git', ['-C', from, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['-C', from, 'status', '--porcelain', 'src'], { encoding: 'utf8' }).trim();
if (dirty) throw new Error(`${from}/src has uncommitted changes; commit or stash them first`);
await rm(to, { recursive: true, force: true });
await cp(`${from}/src`, to, { recursive: true });
await writeFile(`${to}/VERSION`, `nbinding/nbinding-design-system@${commit}\n`);
console.log(`src/ds now matches nbinding-design-system@${commit.slice(0, 7)}`);
