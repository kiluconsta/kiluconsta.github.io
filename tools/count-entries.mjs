// Writes counts.json: how many items each collection holds, counted the way
// the site's engines count them (a null is a section break; anything else
// with a URL is a tile).
//
// The home page reads this file. The counts baked into vault-core.js
// (COLLECTION_META) are fixed when the site is built, and drift as links are
// added, pruned by the weekly health check, or deleted from the site —
// Bomb Ass Dee Pt.2 read 1,113 there while its data file held 772.
//
// Runs in both workflows, so every path that changes a data file refreshes
// it: thumbnails.yml (any push to data/, including the worker's commits) and
// link-health.yml (weekly removals). There is deliberately no timestamp in
// the output — the workflows only commit when something changed, and a
// timestamp would make every run a change.
//
// Manual run (optional): node tools/count-entries.mjs

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'counts.json');

const counts = {};
for (const file of fs.readdirSync(DATA_DIR).filter((n) => n.endsWith('.js')).sort()) {
  const ctx = {};
  vm.runInNewContext(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'), ctx, {
    filename: file,
    timeout: 5000
  });
  const list = Array.isArray(ctx.SOURCES) ? ctx.SOURCES
    : Array.isArray(ctx.IMGS) ? ctx.IMGS
    : [];
  counts[file.replace(/\.js$/, '')] = list.filter(
    (x) => x !== null && (typeof x === 'string' ? x : x && x.url)
  ).length;
}

fs.writeFileSync(OUT, JSON.stringify({ counts }, null, 2) + '\n');
console.log('counts.json:', Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' '));
