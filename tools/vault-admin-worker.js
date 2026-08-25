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
  'coomer', 'dropbox', 'meatsenpaii', 'x-likes-long', 'x-likes-short'
];
const IMAGE_SLUGS = ['gifs', 'images', 'sandf', 'show-off', 'tumblr'];

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
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

    if (!env.VAULT_KEY) {
      return json({ error: 'worker is missing VAULT_KEY' }, 500, origin);
    }
    if (!safeEqual(request.headers.get('X-Vault-Key') || '', env.VAULT_KEY)) {
      return json({ error: 'bad key' }, 401, origin);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad JSON' }, 400, origin); }

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
    const ACTIONS = ['add', 'remove', 'add-section', 'rename-section'];
    const action = ACTIONS.includes(body.action) ? body.action : 'add';
    const isSectionOp = action === 'add-section' || action === 'rename-section';

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
    if (!isSectionOp && !urls.length) return json({ error: 'no urls given' }, 400, origin);
    if (urls.length > 200) return json({ error: 'too many urls at once (max 200)' }, 400, origin);
    for (const u of urls) {
      if (!/^https?:\/\/\S+$/i.test(u) || u.length > 2000) {
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
      if (!getRes.ok) {
        return json({ error: 'could not read ' + path, status: getRes.status }, 502, origin);
      }
      const file = await getRes.json();
      const current = new TextDecoder().decode(
        Uint8Array.from(atob(file.content.replace(/\n/g, '')), (c) => c.charCodeAt(0))
      );

      let updated, lines = newLines, addedUrls = [];
      removed = 0; skipped = [];
      try {
        if (action === 'add-section') {
          updated = addSection(current, isVideo ? 'SOURCES' : 'IMGS', label);
        } else if (action === 'rename-section') {
          updated = renameSection(current, section == null ? -1 : section, label);
        } else if (action === 'remove') {
          const r = removeUrls(current, urls);
          updated = r.text;
          removed = r.removed;
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
          message: action === 'add-section'
            ? `data: add section "${label}" to ${slug}`
            : action === 'rename-section'
            ? `data: rename section in ${slug}`
            : action === 'remove'
            ? (removed === 1
                ? `data: remove link from ${slug}`
                : `data: remove ${removed} links from ${slug}`)
            : (lines.length === 1
                ? `data: add link to ${slug}`
                : `data: add ${lines.length} links to ${slug}`),
          content: toBase64(updated),
          sha: file.sha,
          branch: BRANCH,
          author: COMMIT_IDENTITY,
          committer: COMMIT_IDENTITY
        })
      });

      if (putRes.ok) {
        const out = await putRes.json();
        const sha = out.commit && out.commit.sha;
        audit(request, {
          action, slug, added: action === 'remove' ? 0 : lines.length,
          removed, skipped: skipped.length, commit: sha, retries: attempt
        });
        return json({
          ok: true, commit: sha, path,
          added: (action === 'remove' || isSectionOp) ? 0 : lines.length,
          // Exactly what went in, so the site can offer a precise undo.
          addedUrls,
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
