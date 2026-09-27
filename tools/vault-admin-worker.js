/**
 * vault-admin — Cloudflare Worker that appends links to data/<slug>.js.
 *
 * Deploy this as a SEPARATE worker from the existing media proxy
 * (young-truth-052a) so the proxy keeps running untouched.
 *
 * Secrets to set (Workers → Settings → Variables → Encrypt):
 *   GITHUB_TOKEN  fine-grained PAT, repo kiluconsta/kiluconsta.github.io only,
 *                 permission: Contents → Read and write. Nothing else.
 *   VAULT_KEY     any long random string. You paste this into the site once;
 *                 it is what stops strangers from POSTing to this worker.
 *
 * Then put the worker URL into ADMIN_URL at the top of /vault-additions.js.
 */

const REPO = 'kiluconsta/kiluconsta.github.io';
const BRANCH = 'mein';

// Without this, GitHub stamps API commits with the token owner's default
// identity (the real account name and email). Pin it to the alias instead.
const COMMIT_IDENTITY = {
  name: 'darkstarth',
  email: 'kiluconsta@users.noreply.github.com'
};

// Only these files can ever be written, and only in this shape.
const VIDEO_SLUGS = [
  'animations', 'bluesky-likes', 'bomb-ass-dee', 'bomb-ass-dee-pt-2',
  'coomer', 'dropbox', 'meatsenpaii', 'x-likes-long', 'x-likes-short',
  // Salvage target: survivors of sections that dead links gutted. Its data
  // file is created on first write rather than shipped empty.
  'tragic-dee'
];
const CREATABLE = ['tragic-dee'];
const NEW_FILE = '// ═══════════════════════════════════════════════════════════════\n'
  + '// Tragic Dee — salvaged links\n'
  + '//\n'
  + '// Machine-written by the health page when a section is gutted by dead\n'
  + '// links. Sections are named after the host the links came from.\n'
  + '// ═══════════════════════════════════════════════════════════════\n'
  + 'var DIV_LABELS = [];\n\nvar SOURCES = [\n];\n';
const IMAGE_SLUGS = ['gifs', 'images', 'sandf', 'show-off', 'tumblr'];

// Only these origins get CORS headers back. Previously any origin was echoed,
// which let any site read this worker's responses. The key is still the real
// authentication — this is a second, cheap barrier.
const ALLOWED_ORIGINS = [
  'https://kiluconsta.github.io'
];
function originAllowed(origin) {
  if (!origin) return true;                 // curl / non-browser: key still required
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return /^https?:\/\/localhost(:\d+)?$/.test(origin);   // local testing
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': originAllowed(origin) ? (origin || '*') : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Vault-Key',
    'Access-Control-Max-Age': '86400'
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin) }
  });
}

// Length-independent compare so the key can't be recovered by timing.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = ba.length ^ bb.length;
  for (let i = 0; i < Math.max(ba.length, bb.length); i++) {
    diff |= (ba[i] || 0) ^ (bb[i] || 0);
  }
  return diff === 0;
}

// Base64 in chunks. `btoa(String.fromCharCode(...bytes))` blows the argument
// stack on real data files — dropbox.js alone is ~250KB — with
// "Maximum call stack size exceeded".
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function jsString(s) {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, '') + '"';
}

/**
 * Insert one or more entry lines into the array literal, in order.
 * Video files: `var SOURCES = [ … ]` where a bare `null,` opens a new section,
 * so section N is the run of lines after the Nth null (0-based).
 * Image files: `var IMGS = [ … ]` — flat, always appended at the end.
 */
export function insertLine(text, varName, newLines, sectionIndex) {
  if (!Array.isArray(newLines)) newLines = [newLines];
  const lines = text.split('\n');
  const openRe = new RegExp('var\\s+' + varName + '\\s*=\\s*\\[');
  const open = lines.findIndex((l) => openRe.test(l));
  if (open === -1) throw new Error('could not find `var ' + varName + ' = [` in file');

  let close = -1;
  for (let i = open + 1; i < lines.length; i++) {
    if (/^\s*\];\s*$/.test(lines[i])) { close = i; break; }
  }
  if (close === -1) throw new Error('could not find the closing `];` of ' + varName);

  let at = close;
  if (sectionIndex !== null && sectionIndex !== undefined) {
    const nulls = [];
    for (let i = open + 1; i < close; i++) {
      if (/^\s*null\s*,?\s*$/.test(lines[i])) nulls.push(i);
    }
    if (sectionIndex >= nulls.length) throw new Error('section ' + sectionIndex + ' does not exist');
    // End of this section = the next section break, or the end of the array.
    at = sectionIndex + 1 < nulls.length ? nulls[sectionIndex + 1] : close;
  }

  // Match the indentation actually used by the entry above the insertion point.
  let indent = '  ';
  for (let i = at - 1; i > open; i--) {
    const m = lines[i].match(/^(\s+)\S/);
    if (m) { indent = m[1]; break; }
  }

  lines.splice(at, 0, ...newLines.map(function (l) { return indent + l; }));
  return lines.join('\n');
}

/**
 * The URL on a line, but only when the line is a real entry.
 * Every data file opens with a comment block that contains a sample
 * `"https://…"`, so matching URLs anywhere in the text picks up documentation
 * as if it were content. An entry is a whole line holding either a bare string
 * or an object literal — nothing else counts.
 */
export function entryUrl(line) {
  const t = line.trim();
  if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return null;
  if (!/^(\{.*\}|"[^"]*")\s*,?$/.test(t)) return null;
  const m = t.match(/"(https?:\/\/[^"]+)"/);
  return m ? m[1] : null;
}

/**
 * Append a new section: a `null` break at the end of the array, plus its label
 * in DIV_LABELS. Creates the DIV_LABELS declaration if the file has none,
 * which is the case for image collections that never used sections.
 */
export function addSection(text, varName, label) {
  const lines = text.split('\n');
  const openRe = new RegExp('var\\s+' + varName + '\\s*=\\s*\\[');
  const open = lines.findIndex((l) => openRe.test(l));
  if (open === -1) throw new Error('could not find `var ' + varName + ' = [`');
  let close = -1;
  for (let i = open + 1; i < lines.length; i++) {
    if (/^\s*\];\s*$/.test(lines[i])) { close = i; break; }
  }
  if (close === -1) throw new Error('could not find the closing `];`');

  const quoted = jsString(label);
  const labelsAt = lines.findIndex((l) => /var\s+DIV_LABELS\s*=\s*\[/.test(l));
  if (labelsAt === -1) {
    lines.splice(open, 0, 'var DIV_LABELS = [' + quoted + '];', '');
    return lines.join('\n').replace(/\n\];/, '\n  null,\n];');
  }
  // Single-line declaration is how every data file writes it.
  const m = lines[labelsAt].match(/^(var\s+DIV_LABELS\s*=\s*\[)(.*)(\];\s*)$/);
  if (!m) throw new Error('DIV_LABELS is not on one line — edit it by hand');
  const inner = m[2].trim();
  lines[labelsAt] = m[1] + (inner ? inner + ', ' : '') + quoted + '];';
  lines.splice(close, 0, '  null,');
  return lines.join('\n');
}

/** Rename the label at DIV_LABELS[index]. */
export function renameSection(text, index, label) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /var\s+DIV_LABELS\s*=\s*\[/.test(l));
  if (at === -1) throw new Error('this collection has no sections');
  const m = lines[at].match(/^(var\s+DIV_LABELS\s*=\s*\[)(.*)(\];\s*)$/);
  if (!m) throw new Error('DIV_LABELS is not on one line — edit it by hand');
  const parts = m[2].match(/"(?:[^"\\]|\\.)*"/g) || [];
  if (index < 0 || index >= parts.length) throw new Error('section ' + index + ' does not exist');
  parts[index] = jsString(label);
  lines[at] = m[1] + parts.join(', ') + '];';
  return lines.join('\n');
}

/**
 * Move one entry to another position: to the end of a section, or to the very
 * top or bottom of the array. The entry line is lifted verbatim, so a trimmed
 * clip keeps its start/end.
 *   where: 'section' (needs sectionIndex) | 'top' | 'bottom'
 */
export function moveUrl(text, varName, url, where, sectionIndex) {
  const lines = text.split('\n');
  const openRe = new RegExp('var\\s+' + varName + '\\s*=\\s*\\[');
  const open = lines.findIndex((l) => openRe.test(l));
  if (open === -1) throw new Error('could not find `var ' + varName + ' = [`');
  let close = -1;
  for (let i = open + 1; i < lines.length; i++) {
    if (/^\s*\];\s*$/.test(lines[i])) { close = i; break; }
  }
  if (close === -1) throw new Error('could not find the closing `];`');

  const from = lines.findIndex((l, i) => i > open && i < close && entryUrl(l) === url);
  if (from === -1) throw new Error('that link is not in this collection');
  const [moved] = lines.splice(from, 1);
  close -= 1; // the array just got one line shorter

  let at;
  if (where === 'top') {
    // After a leading section break, if the array opens with one.
    at = /^\s*null\s*,?\s*$/.test(lines[open + 1]) ? open + 2 : open + 1;
  } else if (where === 'bottom') {
    at = close;
  } else {
    const nulls = [];
    for (let i = open + 1; i < close; i++) {
      if (/^\s*null\s*,?\s*$/.test(lines[i])) nulls.push(i);
    }
    if (sectionIndex == null || sectionIndex < 0 || sectionIndex >= nulls.length) {
      throw new Error('section ' + sectionIndex + ' does not exist');
    }
    at = sectionIndex + 1 < nulls.length ? nulls[sectionIndex + 1] : close;
  }

  let indent = '  ';
  for (let i = at - 1; i > open; i--) {
    const m = lines[i].match(/^(\s+)\S/);
    if (m) { indent = m[1]; break; }
  }
  lines.splice(at, 0, indent + moved.trim());
  return lines.join('\n');
}

/** Every URL currently present as an entry, in file order. */
export function listUrls(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const u = entryUrl(line);
    if (u) out.push(u);
  }
  return out;
}

/**
 * Delete the entries whose URL matches, wherever they sit in the array.
 * Only whole entries are touched, so section breaks, comments and the array
 * scaffolding are never disturbed.
 */
export function removeUrls(text, urls) {
  const wanted = new Set(urls);
  const kept = [];
  let removed = 0;
  for (const line of text.split('\n')) {
    const u = entryUrl(line);
    if (u && wanted.has(u)) { removed++; continue; }
    kept.push(line);
  }
  if (!removed) throw new Error('none of those URLs are in this collection');
  return { text: kept.join('\n'), removed };
}

// ── Select mode: delete with exact undo, and re-ordering ─────────────────

const NULL_RE = /^\s*null\s*,?\s*$/;

// A link that can be written into a data file AND read back out of it.
// jsString would escape a quote safely, but entryUrl's `"[^"]*"` could then
// never see the line again: an entry nothing can remove or move. Real media
// URLs never carry these characters unencoded (0 of 6,513 in the data).
const LINK_RE = /^https?:\/\/[^\s"\\<>`]+$/i;

function arrayBounds(lines, varName) {
  const openRe = new RegExp('var\\s+' + varName + '\\s*=\\s*\\[');
  const open = lines.findIndex((l) => openRe.test(l));
  if (open === -1) throw new Error('could not find `var ' + varName + ' = [`');
  for (let i = open + 1; i < lines.length; i++) {
    if (/^\s*\];\s*$/.test(lines[i])) return { open, close: i };
  }
  throw new Error('could not find the closing `];` of ' + varName);
}

function indentAt(lines, at, open) {
  for (let i = at - 1; i > open; i--) {
    const m = lines[i].match(/^(\s+)\S/);
    if (m) return m[1];
  }
  return '  ';
}

/**
 * An entry line as data. The data files hold exactly two shapes — a bare
 * `"url",` or `{ url: "…", start: N, end: N },` — so {url, start, end} is
 * lossless. That is what lets undo send structured records back instead of
 * raw lines: data/*.js is executed as a script, so the worker must never
 * write text a caller supplied verbatim.
 */
export function parseEntry(line) {
  const url = entryUrl(line);
  if (!url) return null;
  const t = line.trim();
  const out = { url, start: null, end: null };
  if (t.startsWith('{')) {
    const s = t.match(/\bstart\s*:\s*(\d+(?:\.\d+)?)/);
    const e = t.match(/\bend\s*:\s*(\d+(?:\.\d+)?)/);
    if (s) out.start = Number(s[1]);
    if (e) out.end = Number(e[1]);
  }
  return out;
}

/** The inverse of parseEntry, in the same form the add path writes. */
export function serialiseEntry(e) {
  if (e.start == null && e.end == null) return jsString(e.url) + ',';
  const parts = ['url: ' + jsString(e.url)];
  if (e.start != null) parts.push('start: ' + e.start);
  if (e.end != null) parts.push('end: ' + e.end);
  return '{ ' + parts.join(', ') + ' },';
}

/**
 * removeUrls, plus a record of where each entry was, so undo can put it back
 * exactly. Position is stored relative to what SURVIVES — the entry it
 * followed (`after`) and the section it was in — never as a line number,
 * which any later edit to the file would invalidate.
 *   after:   URL of the nearest surviving entry above it in its section,
 *            or null if it was first in the section
 *   section: null breaks seen before it; -1 is the run before the first
 *   gap:     blank/comment lines between that anchor and it (files have them)
 *   indent:  its own leading whitespace (files are not consistently indented)
 *   trail:   its own trailing whitespace (two lines in x-likes-long have some)
 */
export function removeEntries(text, varName, urls) {
  const lines = text.split('\n');
  const { open, close } = arrayBounds(lines, varName);
  const wanted = new Set(urls);
  const kept = lines.slice(0, open + 1);
  const records = [];
  let section = -1, lastKept = null, gap = 0;
  for (let i = open + 1; i < close; i++) {
    const line = lines[i];
    if (NULL_RE.test(line)) { section++; lastKept = null; gap = 0; kept.push(line); continue; }
    const e = parseEntry(line);
    if (e && wanted.has(e.url)) {
      records.push({ url: e.url, start: e.start, end: e.end, after: lastKept, section, gap,
        indent: line.match(/^[ \t]*/)[0], trail: line.match(/[ \t]*$/)[0] });
      continue;
    }
    if (e) { lastKept = e.url; gap = 0; } else gap++;
    kept.push(line);
  }
  if (!records.length) throw new Error('none of those URLs are in this collection');
  return { text: kept.concat(lines.slice(close)).join('\n'), removed: records.length, records };
}

/**
 * Put removed entries back where removeEntries found them, in ONE pass over
 * the file. Records queue up behind the line they followed; as the pass
 * reaches that line it starts counting the blank/comment lines after it and
 * releases each record once its `gap` is reached, so a run of deleted tiles
 * comes back in order and on the right side of any blank line. (Splicing
 * per record was O(n²) — undoing a select-all on Dropbox is ~1,900 × ~1,900
 * line scans, past a Worker's CPU budget.) An entry already present is
 * skipped, so a second Undo is harmless; if the entry a record followed has
 * since gone, it falls back to the end of its section.
 */
export function restoreEntries(text, varName, records) {
  const lines = text.split('\n');
  const { open, close } = arrayBounds(lines, varName);

  const inFile = new Set();
  let fallbackIndent = null;
  for (let i = open + 1; i < close; i++) {
    const u = entryUrl(lines[i]);
    if (u) inFile.add(u);
    if (fallbackIndent === null) { const m = lines[i].match(/^([ \t]+)\S/); if (m) fallbackIndent = m[1]; }
  }
  if (fallbackIndent === null) fallbackIndent = '  ';

  const queues = new Map();
  const present = new Set(inFile);
  let restored = 0, skipped = 0;
  for (const r of records) {
    if (present.has(r.url)) { skipped++; continue; }
    present.add(r.url);
    const key = r.after
      ? (inFile.has(r.after) ? 'u:' + r.after : 'e:' + r.section)
      : (r.section < 0 ? 'start' : 's:' + r.section);
    const indent = typeof r.indent === 'string' ? r.indent : fallbackIndent;
    if (!queues.has(key)) queues.set(key, []);
    const trail = typeof r.trail === 'string' ? r.trail : '';
    queues.get(key).push({ gap: r.gap || 0, line: indent + serialiseEntry(r) + trail });
    restored++;
  }

  const out = lines.slice(0, open + 1);
  let active = null, activeGap = 0;
  // Release the active anchor's records up to the current gap (or all of them).
  const drain = (all) => {
    const q = active && queues.get(active);
    if (!q) return;
    while (q.length && (all || q[0].gap <= activeGap)) out.push(q.shift().line);
    if (!q.length) queues.delete(active);
  };
  const emitAll = (key) => {
    const q = queues.get(key);
    if (q) { for (const x of q) out.push(x.line); queues.delete(key); }
  };
  const anchor = (key) => { active = key; activeGap = 0; drain(false); };

  anchor('start');
  let section = -1;
  for (let i = open + 1; i < close; i++) {
    const line = lines[i];
    const isNull = NULL_RE.test(line);
    const u = isNull ? null : entryUrl(line);
    if (isNull || u) {
      drain(true);                     // anything still waiting belongs above this line
      if (isNull) {
        emitAll('e:' + section);       // fallbacks go at the end of the section closing here
        out.push(line);
        anchor('s:' + (++section));
      } else {
        out.push(line);
        anchor('u:' + u);
      }
      continue;
    }
    out.push(line);                    // a blank line or a comment
    activeGap++;
    drain(false);
  }
  drain(true);
  emitAll('e:' + section);
  for (const q of queues.values()) for (const x of q) out.push(x.line); // sections now gone
  return { text: out.concat(lines.slice(close)).join('\n'), restored, skipped };
}

/**
 * Move a set of entries, as one block, to a new position. The lines are
 * lifted verbatim (trims kept) and keep their relative order from the file.
 *   to.where: 'top' | 'bottom'
 *             'before' | 'after'              (to.target: a URL not being moved)
 *             'section-start' | 'section-end' (to.section: index of a null break)
 */
export function reorderEntries(text, varName, urls, to) {
  const all = text.split('\n');
  const b = arrayBounds(all, varName);
  const wanted = new Set(urls);
  if (to.target && wanted.has(to.target)) throw new Error('cannot move links next to themselves');

  // One pass: lift the moving lines out, keep everything else.
  const lifted = [];
  const lines = all.slice(0, b.open + 1);
  for (let i = b.open + 1; i < b.close; i++) {
    if (wanted.has(entryUrl(all[i]))) lifted.push(all[i].trim());
    else lines.push(all[i]);
  }
  const open = b.open;
  const close = lines.length;
  lines.push(...all.slice(b.close));
  if (lifted.length !== wanted.size) {
    throw new Error((wanted.size - lifted.length) + ' of those links are not in this collection');
  }

  const nulls = [];
  for (let i = open + 1; i < close; i++) if (NULL_RE.test(lines[i])) nulls.push(i);

  let at;
  if (to.where === 'top') {
    // Directly before the first entry, so the block becomes the first tiles
    // on the page. (Not "after a leading break": a blank or comment line after
    // the `[` would put them above the first divider instead.) Select mode's
    // in-page model uses this same definition, so the grid it shows matches
    // the file this writes.
    at = close;
    for (let i = open + 1; i < close; i++) if (entryUrl(lines[i])) { at = i; break; }
  } else if (to.where === 'bottom') {
    at = close;
  } else if (to.where === 'before' || to.where === 'after') {
    let t = -1;
    for (let i = open + 1; i < close; i++) if (entryUrl(lines[i]) === to.target) { t = i; break; }
    if (t === -1) throw new Error('the link to move next to is not in this collection');
    at = to.where === 'before' ? t : t + 1;
  } else {
    const k = to.section;
    if (!Number.isInteger(k) || k < 0 || k >= nulls.length) throw new Error('section ' + k + ' does not exist');
    at = to.where === 'section-start' ? nulls[k] + 1 : (k + 1 < nulls.length ? nulls[k + 1] : close);
  }

  const indent = indentAt(lines, at, open);
  lines.splice(at, 0, ...lifted.map((l) => indent + l));
  return { text: lines.join('\n'), moved: lifted.length };
}

// ── Scraping a source page ───────────────────────────────────────────────
// Fetching a URL the caller supplies would make this worker a general-purpose
// proxy: an SSRF hole reachable by anyone holding the key, including into
// Cloudflare's own metadata endpoints. So both the page fetched and the links
// extracted are restricted to hosts the site already deals with.
const PROXY_HOSTS = [
  'twimg.com', 'video.twimg.com', 'coomer.st', 'redgifs.com',
  'tumblr.com', 'lpsg.com', 'rule34.xxx', 'cartoonsworld.vip',
  'monstercockland.com', 'gayforfuns.com', 'gff.network',
  'dropbox.com', 'dropboxusercontent.com', 'googleusercontent.com',
  'bsky.network', 'video.bsky.app', 'bsky.social', 'bsky.app'
];
const MEDIA_RE = /\.(mp4|m4v|webm|m3u8|mov|jpe?g|png|gifv?|webp|avif)(\?|#|$)/i;

function hostAllowed(u) {
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    const h = url.hostname.toLowerCase();
    // Reject anything that resolves inward regardless of the allowlist.
    if (/^(localhost|\[|\d+\.\d+\.\d+\.\d+$)/.test(h)) {
      if (!/^\d+\.\d+\.\d+\.\d+$/.test(h)) return false;
      const p = h.split('.').map(Number);
      if (p[0] === 10 || p[0] === 127 || p[0] === 0 ||
          (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
          (p[0] === 192 && p[1] === 168) ||
          (p[0] === 169 && p[1] === 254)) return false;
      return false; // no bare-IP sources are expected at all
    }
    return PROXY_HOSTS.some((allowed) => h === allowed || h.endsWith('.' + allowed));
  } catch (e) { return false; }
}

export function extractMedia(html, baseUrl) {
  const found = new Set();
  const push = (raw) => {
    if (!raw) return;
    let u = raw.replace(/&amp;/g, '&').trim();
    try { u = new URL(u, baseUrl).toString(); } catch (e) { return; }
    if (!MEDIA_RE.test(u)) return;
    if (!hostAllowed(u)) return;
    found.add(u);
  };
  // src/href/content attributes, plus bare URLs inside inline JSON blobs.
  const attrRe = /(?:src|href|content|data-src|data-video|poster)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = attrRe.exec(html)) !== null) push(m[1]);
  // Backslashes are allowed through and stripped below: inline JSON writes
  // URLs as https:\/\/host\/path, and stopping at the first one loses the path.
  const bareRe = /https?:\\?\/\\?\/[^\s"'<>]+/gi;
  while ((m = bareRe.exec(html)) !== null) push(m[0].replace(/\\/g, ''));
  return [...found];
}

// ── Rate limiting ────────────────────────────────────────────────────────
// A valid key otherwise allows unlimited writes at any speed, so a leaked key
// could rewrite every data file before you noticed.
//
// This counter lives in the isolate, so it is best-effort: Cloudflare may run
// several isolates, and each keeps its own tally. It reliably stops a runaway
// script or a stuck retry loop; it is not a hard guarantee. Bind a KV
// namespace as RATE_KV for a limit that holds across isolates.
const WRITE_LIMIT = 40;          // writes ...
const WRITE_WINDOW_MS = 300000;  // ... per 5 minutes, per caller
const hits = new Map();

function clientId(request) {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')
    || 'unknown';
}

async function rateLimited(request, env) {
  const id = clientId(request);
  const now = Date.now();

  if (env.RATE_KV) {
    const key = 'rl:' + id;
    let stamps = [];
    try { stamps = JSON.parse((await env.RATE_KV.get(key)) || '[]'); } catch (e) {}
    stamps = stamps.filter((t) => now - t < WRITE_WINDOW_MS);
    if (stamps.length >= WRITE_LIMIT) return true;
    stamps.push(now);
    await env.RATE_KV.put(key, JSON.stringify(stamps), {
      expirationTtl: Math.ceil(WRITE_WINDOW_MS / 1000)
    });
    return false;
  }

  const stamps = (hits.get(id) || []).filter((t) => now - t < WRITE_WINDOW_MS);
  if (stamps.length >= WRITE_LIMIT) { hits.set(id, stamps); return true; }
  stamps.push(now);
  hits.set(id, stamps);
  if (hits.size > 500) hits.clear(); // never let the map grow without bound
  return false;
}

// Structured line per write, visible in the Cloudflare dashboard's live logs.
// Never logs the key or the URLs themselves — just what changed.
function audit(request, fields) {
  try {
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      ip: clientId(request),
      ua: (request.headers.get('User-Agent') || '').slice(0, 80),
      ...fields
    }));
  } catch (e) {}
}

// ── Favourites sync ──────────────────────────────────────────────────────
// The gist token used to sit in localStorage on the public site. It lives here
// now; the browser holds only VAULT_KEY, which reaches nothing but this worker.
const SYNC_FILENAME = 'vault-favourites.json';

function ghFetch(env, path, opts = {}) {
  return fetch('https://api.github.com' + path, {
    ...opts,
    headers: {
      'Authorization': 'Bearer ' + env.GIST_TOKEN,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'vault-admin-worker',
      ...(opts.headers || {})
    }
  });
}

// Set GIST_ID to skip discovery; otherwise find the gist by filename, creating
// it the first time.
async function findGist(env) {
  if (env.GIST_ID) return env.GIST_ID;
  const r = await ghFetch(env, '/gists?per_page=100');
  if (!r.ok) throw new Error('gist list failed (' + r.status + ')');
  const hit = (await r.json()).find((g) => g.files && g.files[SYNC_FILENAME]);
  if (hit) return hit.id;
  const files = { [SYNC_FILENAME]: { content: JSON.stringify({ updated: 0, list: [] }) } };
  const c = await ghFetch(env, '/gists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description: 'The Vault — favourites sync', public: false, files })
  });
  if (!c.ok) throw new Error('gist create failed (' + c.status + ')');
  return (await c.json()).id;
}

async function handleSync(body, env, origin) {
  if (!env.GIST_TOKEN) {
    return json({ error: 'worker is missing GIST_TOKEN' }, 500, origin);
  }
  let id;
  try { id = await findGist(env); }
  catch (e) { return json({ error: e.message }, 502, origin); }

  if (body.op === 'pull') {
    const r = await ghFetch(env, '/gists/' + id);
    if (!r.ok) return json({ error: 'gist fetch failed (' + r.status + ')' }, 502, origin);
    const g = await r.json();
    let doc = { updated: 0, list: [] };
    try { doc = JSON.parse(g.files[SYNC_FILENAME].content); } catch (e) {}
    return json({ ok: true, doc }, 200, origin);
  }

  if (body.op === 'push') {
    const doc = body.doc;
    if (!doc || !Array.isArray(doc.list) || typeof doc.updated !== 'number') {
      return json({ error: 'doc must be { updated:number, list:array }' }, 400, origin);
    }
    if (doc.list.length > 20000) return json({ error: 'favourites list too large' }, 400, origin);
    const files = { [SYNC_FILENAME]: { content: JSON.stringify(doc) } };
    const r = await ghFetch(env, '/gists/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files })
    });
    if (!r.ok) return json({ error: 'push failed (' + r.status + ')' }, 502, origin);
    return json({ ok: true }, 200, origin);
  }

  return json({ error: 'op must be pull or push' }, 400, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, origin);

    // A browser always sends Origin on a cross-origin POST, so an unexpected
    // one means the request did not come from this site.
    if (!originAllowed(origin)) return json({ error: 'origin not allowed' }, 403, origin);

    // Cap the body before parsing so a huge payload cannot be buffered.
    // Select-all on Dropbox is ~1,900 URLs (~250KB); an undo carries a
    // record per entry on top. 1MB covers the largest collection twice over.
    const MAX_BODY = 1024 * 1024;
    const declared = Number(request.headers.get('Content-Length') || 0);
    if (declared > MAX_BODY) return json({ error: 'request too large' }, 413, origin);

    if (!env.VAULT_KEY) {
      return json({ error: 'worker is missing VAULT_KEY' }, 500, origin);
    }
    if (!safeEqual(request.headers.get('X-Vault-Key') || '', env.VAULT_KEY)) {
      return json({ error: 'bad key' }, 401, origin);
    }

    let body;
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY) return json({ error: 'request too large' }, 413, origin);
      body = JSON.parse(raw);
    } catch { return json({ error: 'bad JSON' }, 400, origin); }

    // Favourites sync is a different resource from the data files.
    if (new URL(request.url).pathname.replace(/\/+$/, '') === '/sync') {
      return handleSync(body, env, origin);
    }

    if (!env.GITHUB_TOKEN) {
      return json({ error: 'worker is missing GITHUB_TOKEN' }, 500, origin);
    }

    if (await rateLimited(request, env)) {
      audit(request, { action: 'rate-limited' });
      return json({ error: 'too many writes — wait a few minutes' }, 429, origin);
    }

    const slug = String(body.slug || '');
    const isVideo = VIDEO_SLUGS.includes(slug);
    const isImage = IMAGE_SLUGS.includes(slug);
    if (!isVideo && !isImage) return json({ error: 'unknown collection: ' + slug }, 400, origin);

    // All actions share the sha-guarded read/write loop below.
    const ACTIONS = ['add', 'remove', 'add-section', 'rename-section', 'move', 'scan', 'dedupe',
      'restore', 'reorder'];
    const action = ACTIONS.includes(body.action) ? body.action : 'add';
    const isSectionOp = action === 'add-section' || action === 'rename-section';
    const needsNoUrls = isSectionOp || action === 'dedupe' || action === 'restore';

    // 'scan' reads a page and returns what it found. It writes nothing, so it
    // returns before any of the commit machinery below.
    if (action === 'scan') {
      const page = String(body.page || '').trim();
      if (!hostAllowed(page)) {
        return json({
          error: 'that host is not one this vault fetches from',
          allowed: PROXY_HOSTS
        }, 400, origin);
      }
      let html;
      try {
        const r = await fetch(page, {
          headers: { 'User-Agent': 'Mozilla/5.0 vault-admin' },
          redirect: 'follow'
        });
        if (!r.ok) return json({ error: 'source page returned ' + r.status }, 502, origin);
        const type = r.headers.get('Content-Type') || '';
        if (!/text\/html|application\/json|text\/plain/i.test(type)) {
          return json({ error: 'source page is not a document (' + type + ')' }, 415, origin);
        }
        html = (await r.text()).slice(0, 3000000);
      } catch (e) {
        return json({ error: 'could not fetch that page' }, 502, origin);
      }
      const urls = extractMedia(html, page);
      audit(request, { action: 'scan', host: new URL(page).hostname, found: urls.length });
      return json({ ok: true, found: urls.length, urls: urls.slice(0, 200) }, 200, origin);
    }

    let label = '';
    if (isSectionOp) {
      label = String(body.label == null ? '' : body.label).trim();
      if (!label || label.length > 120) {
        return json({ error: 'label must be 1–120 characters' }, 400, origin);
      }
    }

    // Accepts `url` (one) or `urls` (a batch). A batch lands in a single commit
    // so the thumbnail bot fires once instead of once per link.
    const rawUrls = Array.isArray(body.urls)
      ? body.urls
      : (body.url == null ? [] : [body.url]);
    const urls = rawUrls.map((u) => String(u == null ? '' : u).trim()).filter(Boolean);
    if (!needsNoUrls && !urls.length) return json({ error: 'no urls given' }, 400, origin);
    // Bulk edits from Select mode can cover a whole collection; adds cannot.
    const URL_CAP = (action === 'remove' || action === 'reorder') ? 2000 : 200;
    if (urls.length > URL_CAP) {
      return json({ error: 'too many urls at once (max ' + URL_CAP + ')' }, 400, origin);
    }
    for (const u of urls) {
      if (!LINK_RE.test(u) || u.length > 2000) {
        return json({ error: 'not a valid http(s) link: ' + u.slice(0, 80) }, 400, origin);
      }
    }

    // Build the entries exactly as EDITING.md documents them. Trim seconds only
    // describe one clip, so they are accepted only for a single-link request.
    let newLines = [];
    if (action === 'remove') {
      // nothing to build — the URLs themselves identify what to drop
    } else if (isVideo && urls.length === 1) {
      const start = body.start === '' || body.start == null ? null : Number(body.start);
      const end = body.end === '' || body.end == null ? null : Number(body.end);
      for (const v of [start, end]) {
        if (v !== null && (!Number.isFinite(v) || v < 0)) {
          return json({ error: 'start/end must be non-negative seconds' }, 400, origin);
        }
      }
      if (start === null && end === null) {
        newLines = [jsString(urls[0]) + ','];
      } else {
        const parts = ['url: ' + jsString(urls[0])];
        if (start !== null) parts.push('start: ' + start);
        if (end !== null) parts.push('end: ' + end);
        newLines = ['{ ' + parts.join(', ') + ' },'];
      }
    } else {
      newLines = urls.map((u) => jsString(u) + ',');
    }

    // Undo sends back what 'remove' returned. Every field is re-validated and
    // the line is rebuilt by serialiseEntry, never taken from the caller.
    let records = null;
    if (action === 'restore') {
      if (!Array.isArray(body.records) || !body.records.length) {
        return json({ error: 'no records to restore' }, 400, origin);
      }
      if (body.records.length > 2000) return json({ error: 'too many records (max 2000)' }, 400, origin);
      const isUrl = (u) => typeof u === 'string' && u.length <= 2000 && LINK_RE.test(u);
      const isSecs = (v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
      records = [];
      for (const r of body.records) {
        const rec = {
          url: r && r.url, start: r && r.start != null ? r.start : null,
          end: r && r.end != null ? r.end : null,
          after: r && r.after != null ? r.after : null, section: r && r.section,
          gap: r && r.gap != null ? r.gap : 0,
          indent: r && typeof r.indent === 'string' ? r.indent : undefined,
          trail: r && typeof r.trail === 'string' ? r.trail : undefined
        };
        if (!isUrl(rec.url) || !isSecs(rec.start) || !isSecs(rec.end)
            || (rec.after !== null && !isUrl(rec.after))
            || !Number.isInteger(rec.section) || rec.section < -1
            || !Number.isInteger(rec.gap) || rec.gap < 0 || rec.gap > 10000
            // Whitespace only: this string is written into the file as-is.
            || (rec.indent !== undefined && !/^[ \t]{0,16}$/.test(rec.indent))
            || (rec.trail !== undefined && !/^[ \t]{0,16}$/.test(rec.trail))) {
          return json({ error: 'malformed restore record' }, 400, origin);
        }
        // Trims only exist on video entries.
        if (!isVideo) { rec.start = null; rec.end = null; }
        records.push(rec);
      }
    }

    let to = null;
    if (action === 'reorder') {
      const t = body.to || {};
      const WHERE = ['top', 'bottom', 'before', 'after', 'section-start', 'section-end'];
      if (!WHERE.includes(t.where)) return json({ error: 'to.where must be one of ' + WHERE.join(', ') }, 400, origin);
      to = { where: t.where };
      if (t.where === 'before' || t.where === 'after') {
        to.target = String(t.target || '').trim();
        if (!LINK_RE.test(to.target)) return json({ error: 'to.target must be a link' }, 400, origin);
      }
      if (t.where === 'section-start' || t.where === 'section-end') {
        to.section = Number(t.section);
        if (!Number.isInteger(to.section) || to.section < 0) {
          return json({ error: 'to.section must be a non-negative integer' }, 400, origin);
        }
      }
    }

    // Image collections support sections too, once their data file has null
    // breaks and a DIV_LABELS array.
    let section = body.section == null || body.section === '' ? null : Number(body.section);
    if (section !== null && (!Number.isInteger(section) || section < 0)) {
      return json({ error: 'section must be a non-negative integer' }, 400, origin);
    }

    const path = 'data/' + slug + '.js';
    const api = `https://api.github.com/repos/${REPO}/contents/${path}`;
    const gh = {
      'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'vault-admin-worker',
      'X-GitHub-Api-Version': '2022-11-28'
    };

    // Read → modify → write, using the blob sha so a concurrent bot commit is
    // rejected rather than clobbered. The thumbnail and link-health bots commit
    // on their own schedule, so losing that race is routine — re-read and try
    // again rather than handing the problem back.
    let removed = 0, skipped = [], lastErr = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const getRes = await fetch(`${api}?ref=${BRANCH}`, { headers: gh });
      let file = null, current;
      if (getRes.ok) {
        file = await getRes.json();
        current = new TextDecoder().decode(
          Uint8Array.from(atob(file.content.replace(/\n/g, '')), (c) => c.charCodeAt(0))
        );
      } else if (getRes.status === 404 && CREATABLE.includes(slug) && action === 'add') {
        // First salvage into this collection: start the file rather than fail.
        current = NEW_FILE;
      } else {
        return json({ error: 'could not read ' + path, status: getRes.status }, 502, origin);
      }

      let updated, lines = newLines, addedUrls = [];
      let removedRecords = [], restoredCount = 0, movedCount = 0;
      removed = 0; skipped = [];
      try {
        if (action === 'dedupe') {
          // Keep the first occurrence of each URL, drop later repeats.
          const seenU = new Set();
          const kept = [];
          current.split('\n').forEach(function (line) {
            const u = entryUrl(line);
            if (u) {
              if (seenU.has(u)) { removed++; return; }
              seenU.add(u);
            }
            kept.push(line);
          });
          if (!removed) {
            return json({ ok: true, commit: null, path, added: 0, removed: 0,
              note: 'no duplicates in this collection' }, 200, origin);
          }
          updated = kept.join('\n');
        } else if (action === 'move') {
          const where = ['top', 'bottom', 'section'].includes(body.where) ? body.where : 'section';
          updated = moveUrl(current, isVideo ? 'SOURCES' : 'IMGS', urls[0], where, section);
        } else if (action === 'add-section') {
          updated = addSection(current, isVideo ? 'SOURCES' : 'IMGS', label);
        } else if (action === 'rename-section') {
          updated = renameSection(current, section == null ? -1 : section, label);
        } else if (action === 'remove') {
          const r = removeEntries(current, isVideo ? 'SOURCES' : 'IMGS', urls);
          updated = r.text;
          removed = r.removed;
          removedRecords = r.records;
        } else if (action === 'restore') {
          const r = restoreEntries(current, isVideo ? 'SOURCES' : 'IMGS', records);
          if (!r.restored) {
            return json({ ok: true, commit: null, path, restored: 0, skipped: r.skipped,
              note: 'everything is already back' }, 200, origin);
          }
          updated = r.text;
          restoredCount = r.restored;
          skipped = new Array(r.skipped);
        } else if (action === 'reorder') {
          const r = reorderEntries(current, isVideo ? 'SOURCES' : 'IMGS', urls, to);
          if (r.text === current) {
            return json({ ok: true, commit: null, path, moved: 0, note: 'already in that order' }, 200, origin);
          }
          updated = r.text;
          movedCount = r.moved;
        } else {
          // Drop anything already in the file rather than creating a second
          // tile for the same media — files have picked up duplicates this way.
          const existing = new Set(listUrls(current));
          const fresh = [];
          urls.forEach((u) => {
            if (existing.has(u)) skipped.push(u);
            else { fresh.push(u); existing.add(u); }
          });
          if (!fresh.length) {
            return json({
              ok: true, commit: null, path, added: 0,
              skipped: skipped.length,
              note: skipped.length === 1
                ? 'that link is already in this collection'
                : 'all ' + skipped.length + ' links are already in this collection'
            }, 200, origin);
          }
          // Rebuild the lines from just the fresh URLs, keeping the trim form.
          lines = (newLines.length === 1 && fresh.length === 1)
            ? newLines
            : fresh.map((u) => jsString(u) + ',');
          addedUrls = fresh;
          updated = insertLine(current, isVideo ? 'SOURCES' : 'IMGS', lines, section);
        }
      } catch (e) {
        return json({ error: e.message }, 422, origin);
      }

      const putRes = await fetch(api, {
        method: 'PUT',
        headers: { ...gh, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: action === 'dedupe'
            ? `data: remove ${removed} duplicate links from ${slug}`
            : action === 'move'
            ? `data: reorder link in ${slug}`
            : action === 'add-section'
            ? `data: add section "${label}" to ${slug}`
            : action === 'rename-section'
            ? `data: rename section in ${slug}`
            : action === 'restore'
            ? `data: restore ${restoredCount} link${restoredCount === 1 ? '' : 's'} to ${slug}`
            : action === 'reorder'
            ? `data: reorder ${movedCount} link${movedCount === 1 ? '' : 's'} in ${slug}`
            : action === 'remove'
            ? (removed === 1
                ? `data: remove link from ${slug}`
                : `data: remove ${removed} links from ${slug}`)
            : (lines.length === 1
                ? `data: add link to ${slug}`
                : `data: add ${lines.length} links to ${slug}`),
          content: toBase64(updated),
          ...(file ? { sha: file.sha } : {}),
          branch: BRANCH,
          author: COMMIT_IDENTITY,
          committer: COMMIT_IDENTITY
        })
      });

      if (putRes.ok) {
        const out = await putRes.json();
        const sha = out.commit && out.commit.sha;
        audit(request, {
          action, slug, added: ['remove', 'restore', 'reorder'].includes(action) ? 0 : lines.length,
          removed, skipped: skipped.length, commit: sha, retries: attempt
        });
        return json({
          ok: true, commit: sha, path,
          added: (action === 'remove' || action === 'move' || action === 'dedupe' || isSectionOp
                  || action === 'restore' || action === 'reorder')
            ? 0 : lines.length,
          // Exactly what went in, so the site can offer a precise undo.
          addedUrls,
          // Where each removed entry sat, so Select mode can undo exactly.
          records: removedRecords,
          restored: restoredCount, moved: movedCount,
          removed, skipped: skipped.length, retries: attempt
        }, 200, origin);
      }

      const detail = await putRes.text();
      lastErr = { status: putRes.status, detail: detail.slice(0, 300) };
      const conflict = putRes.status === 409 || putRes.status === 422;
      if (!conflict) break;
      // Someone committed between our read and write. Back off briefly and
      // rebuild against whatever is there now.
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }

    audit(request, { action, slug, error: true, status: lastErr && lastErr.status });
    return json({
      error: lastErr && (lastErr.status === 409 || lastErr.status === 422)
        ? 'the file kept changing under us — try again in a moment'
        : 'commit failed',
      status: lastErr && lastErr.status,
      detail: lastErr && lastErr.detail
    }, 502, origin);
  }
};
