// Link health checker for The Vault.
// Runs weekly via .github/workflows/link-health.yml. Probes every media URL
// (through the Cloudflare proxy for hosts that need it, mirroring the site),
// accumulates strikes for DEFINITIVE failures (404/410/403/dead DNS), and
// removes a link from data/*.js only after STRIKE_LIMIT consecutive failing
// runs. All removals are appended to health/removed-links.log.
// Timeouts / 429 / 5xx are transient: logged, never strike.
//
// Manual run: node tools/check-links.mjs [--dry-run]

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const HEALTH_DIR = path.join(ROOT, 'health');
const STRIKES_FILE = path.join(HEALTH_DIR, 'link-strikes.json');
const REMOVED_LOG = path.join(HEALTH_DIR, 'removed-links.log');
const STRIKE_LIMIT = 3;
const CONCURRENCY = 8;
const TIMEOUT_MS = 20000;
const DRY = process.argv.includes('--dry-run');

// Mirror the site's proxy config (vault-core.js)
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

// ── Collect every URL per data file ──────────────────────────
const filesUrls = new Map(); // file -> Set<url>
for (const file of fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.js'))) {
  const ctx = {};
  vm.createContext(ctx);
  try { vm.runInContext(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'), ctx); }
  catch (e) { console.error(`SKIP ${file}: parse error (${e.message})`); continue; }
  const arr = ctx.SOURCES || ctx.IMGS;
  if (!Array.isArray(arr)) continue;
  const urls = new Set();
  for (const s of arr) {
    if (!s) continue;
    const u = typeof s === 'string' ? s : s.url;
    if (u) urls.add(u);
  }
  filesUrls.set(file, urls);
}
const allUrls = [...new Set([...filesUrls.values()].flatMap((s) => [...s]))];
console.log(`checking ${allUrls.length} unique urls across ${filesUrls.size} files${DRY ? ' (dry run)' : ''}`);

// ── Probe ────────────────────────────────────────────────────
// Result: 'alive' | 'dead:<reason>' | 'transient:<reason>'
async function probe(url) {
  const target = proxyUrl(url);
  const isHls = /\.m3u8(\?|$)/i.test(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(target, {
      method: 'GET',
      headers: isHls ? {} : { 'Range': 'bytes=0-1023' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (isHls) {
      if (!res.ok) return res.status === 404 || res.status === 410 || res.status === 403
        ? `dead:${res.status}` : `transient:${res.status}`;
      const text = await res.text();
      return text.includes('#EXTM3U') ? 'alive' : 'dead:not-a-manifest';
    }
    if (res.ok || res.status === 206 || res.status === 416) { try { ctrl.abort(); } catch {} return 'alive'; }
    if (res.status === 404 || res.status === 410 || res.status === 403) return `dead:${res.status}`;
    return `transient:${res.status}`;
  } catch (e) {
    clearTimeout(timer);
    const msg = String(e.cause?.code || e.name || e.message || e);
    if (msg === 'ENOTFOUND' || msg === 'ERR_NAME_NOT_RESOLVED') return 'dead:dns';
    return `transient:${msg.slice(0, 60)}`;
  }
}

const results = new Map();
let done = 0;
async function worker(queue) {
  for (;;) {
    const url = queue.shift();
    if (!url) return;
    results.set(url, await probe(url));
    done++;
    if (done % 100 === 0 || done === allUrls.length) console.log(`probed ${done}/${allUrls.length}`);
  }
}
const queue = [...allUrls];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));

// ── Strike accounting ────────────────────────────────────────
fs.mkdirSync(HEALTH_DIR, { recursive: true });
let strikes = {};
try { strikes = JSON.parse(fs.readFileSync(STRIKES_FILE, 'utf8')); } catch {}

const nowIso = new Date().toISOString().slice(0, 10);
const toRemove = new Set();
let alive = 0, deadNow = 0, transient = 0;
for (const url of allUrls) {
  const r = results.get(url);
  if (r === 'alive') { alive++; delete strikes[url]; continue; }
  if (r.startsWith('transient:')) { transient++; continue; } // strikes unchanged
  deadNow++;
  const s = strikes[url] || { count: 0 };
  s.count++;
  s.last = nowIso;
  s.reason = r;
  strikes[url] = s;
  if (s.count >= STRIKE_LIMIT) toRemove.add(url);
}
// Drop strike entries for urls no longer present in any data file
for (const url of Object.keys(strikes)) if (!allUrls.includes(url)) delete strikes[url];

console.log(`alive: ${alive}  failing-now: ${deadNow}  transient: ${transient}  at-limit: ${toRemove.size}`);

// ── Removal: line-based, format-preserving, parse-checked ────
// Log format: date <TAB> file <TAB> line N <TAB> reason <TAB> verbatim line
// The verbatim line preserves trim data ({ url, start, end }) so any entry
// can be restored exactly by pasting the line back at (or near) line N.
const removedLines = [];
if (toRemove.size && !DRY) {
  for (const [file, urls] of filesUrls) {
    const deadHere = [...urls].filter((u) => toRemove.has(u));
    if (!deadHere.length) continue;
    const needles = new Map(deadHere.map((u) => [JSON.stringify(u), u])); // quoted, exact
    const p = path.join(DATA_DIR, file);
    const before = fs.readFileSync(p, 'utf8');
    const kept = [];
    let removedCount = 0;
    before.split('\n').forEach((line, i) => {
      for (const [needle, u] of needles) {
        if (line.includes(needle)) {
          removedLines.push(`${nowIso}\t${file}\tline ${i + 1}\t${strikes[u]?.reason || 'dead'}\t${line.trim()}`);
          removedCount++;
          return; // drop this line
        }
      }
      kept.push(line);
    });
    const after = kept.join('\n');
    fs.writeFileSync(p, after);
    // Safety: must still parse; revert if not
    try {
      const ctx = {}; vm.createContext(ctx);
      vm.runInContext(after, ctx);
      if (!Array.isArray(ctx.SOURCES || ctx.IMGS)) throw new Error('arrays missing after edit');
      for (const u of deadHere) delete strikes[u];
      console.log(`${file}: removed ${removedCount} dead link(s)`);
    } catch (e) {
      fs.writeFileSync(p, before);
      removedLines.length -= removedCount; // drop log entries for reverted file
      console.error(`${file}: edit made file unparseable — REVERTED (${e.message})`);
    }
  }
  if (removedLines.length) fs.appendFileSync(REMOVED_LOG, removedLines.join('\n') + '\n');
}

if (!DRY) fs.writeFileSync(STRIKES_FILE, JSON.stringify(strikes, null, 2));
console.log(`removed this run: ${removedLines.length}${DRY ? ' (dry run — nothing written)' : ''}`);
process.exit(0);
