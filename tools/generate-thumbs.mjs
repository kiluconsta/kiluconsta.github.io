// Thumbnail generator for The Vault.
// Runs in GitHub Actions (see .github/workflows/thumbnails.yml) — you never
// need to run this by hand. For every video in data/*.js it extracts one
// frame at (start + 1.3s) into thumbs/<hash>.jpg. Incremental: existing
// thumbs are skipped, thumbs for removed links are deleted.
//
// Manual run (optional): node tools/generate-thumbs.mjs
// Requires: node >= 18, ffmpeg on PATH.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const THUMBS_DIR = path.join(ROOT, 'thumbs');
const CONCURRENCY = 4;
const PER_ITEM_TIMEOUT_S = 90;

// Must mirror the site's proxy config (vault-core.js)
const PROXY = 'https://young-truth-052a.kiluconsta.workers.dev';
const PROXY_HOSTS = [
  'twimg.com', 'video.twimg.com', 'coomer.st', 'redgifs.com',
  'tumblr.com', 'lpsg.com', 'rule34.xxx', 'cartoonsworld.vip',
  'monstercockland.com', 'gayforfuns.com', 'gff.network',
  'dropbox.com', 'dropboxusercontent.com', 'googleusercontent.com',
  'bsky.network', 'video.bsky.app'
];
function normalizeDropbox(url) {
  try {
    if (!url.includes('dropbox.com')) return url;
    const u = new URL(url);
    if (u.hostname === 'www.dropbox.com' || u.hostname === 'dropbox.com') u.hostname = 'dl.dropboxusercontent.com';
    u.searchParams.delete('dl');
    u.searchParams.set('raw', '1');
    return u.toString();
  } catch { return url; }
}
function proxyUrl(url) {
  url = normalizeDropbox(url);
  try {
    const host = new URL(url).hostname;
    const needs = PROXY_HOSTS.some((h) => host === h || host.endsWith('.' + h));
    return needs ? `${PROXY}?url=${encodeURIComponent(url)}` : url;
  } catch { return url; }
}

// Thumb key — MUST stay in sync with VaultPosters in vault-core.js
function posterTime(item) { return (item.start || 0) + 1.3; }
function thumbKey(url, time) {
  return crypto.createHash('sha1').update(url + '@' + time).digest('hex').slice(0, 16);
}

// ── Collect every video item across all data files ──────────
const wanted = new Map(); // hash -> { url, time }
for (const file of fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.js'))) {
  const ctx = {};
  vm.createContext(ctx);
  try { vm.runInContext(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'), ctx); }
  catch (e) { console.error(`SKIP ${file}: does not parse (${e.message})`); continue; }
  const sources = ctx.SOURCES;
  if (!Array.isArray(sources)) continue; // image collections need no thumbs
  for (const s of sources) {
    if (s === null || s === undefined) continue;
    const item = typeof s === 'string' ? { url: s } : { url: s.url, start: s.start };
    if (!item.url) continue;
    const time = posterTime(item);
    wanted.set(thumbKey(item.url, time), { url: item.url, time });
  }
}
console.log(`videos referenced across data files: ${wanted.size}`);

// ── Diff against existing thumbs ─────────────────────────────
fs.mkdirSync(THUMBS_DIR, { recursive: true });
const existing = new Set(
  fs.readdirSync(THUMBS_DIR).filter((f) => f.endsWith('.jpg')).map((f) => f.replace(/\.jpg$/, ''))
);
const toMake = [...wanted.entries()].filter(([h]) => !existing.has(h));
const toPrune = [...existing].filter((h) => !wanted.has(h));

for (const h of toPrune) fs.unlinkSync(path.join(THUMBS_DIR, `${h}.jpg`));
console.log(`existing: ${existing.size}  new: ${toMake.length}  pruned: ${toPrune.length}`);

// ── Generate with bounded concurrency ────────────────────────
function grabFrame(url, time, outPath) {
  return new Promise((resolve) => {
    const src = proxyUrl(url);
    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', String(time),
      '-i', src,
      '-frames:v', '1',
      '-vf', "scale=240:-2",
      '-q:v', '4',
      outPath,
    ];
    execFile('ffmpeg', args, { timeout: PER_ITEM_TIMEOUT_S * 1000 }, (err) => {
      if (err || !fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
        try { fs.existsSync(outPath) && fs.unlinkSync(outPath); } catch {}
        resolve({ ok: false, err: err ? String(err.message || err).slice(0, 200) : 'empty output' });
      } else {
        resolve({ ok: true });
      }
    });
  });
}

let done = 0, ok = 0;
const failures = [];
async function worker(jobs) {
  for (;;) {
    const job = jobs.shift();
    if (!job) return;
    const [hash, { url, time }] = job;
    const res = await grabFrame(url, time, path.join(THUMBS_DIR, `${hash}.jpg`));
    done++;
    if (res.ok) ok++;
    else failures.push({ url, err: res.err });
    if (done % 25 === 0 || done === toMake.length) console.log(`progress: ${done}/${toMake.length} (${ok} ok)`);
  }
}
const jobs = [...toMake];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(jobs)));

if (failures.length) {
  console.log(`\n${failures.length} failed (site falls back to in-browser capture for these):`);
  for (const f of failures.slice(0, 30)) console.log(`  ${f.url}\n    ${f.err}`);
  fs.writeFileSync(path.join(THUMBS_DIR, '_failures.log'),
    failures.map((f) => `${f.url}\t${f.err}`).join('\n'));
} else {
  try { fs.unlinkSync(path.join(THUMBS_DIR, '_failures.log')); } catch {}
}
console.log(`\ndone: ${ok}/${toMake.length} generated, ${toPrune.length} pruned`);
// Always exit 0 — dead links must not fail the workflow.
process.exit(0);
