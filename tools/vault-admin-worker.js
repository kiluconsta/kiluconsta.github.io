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

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, origin);

    if (!env.VAULT_KEY || !env.GITHUB_TOKEN) {
      return json({ error: 'worker is missing VAULT_KEY or GITHUB_TOKEN' }, 500, origin);
    }
    if (!safeEqual(request.headers.get('X-Vault-Key') || '', env.VAULT_KEY)) {
      return json({ error: 'bad key' }, 401, origin);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad JSON' }, 400, origin); }

    const slug = String(body.slug || '');
    const isVideo = VIDEO_SLUGS.includes(slug);
    const isImage = IMAGE_SLUGS.includes(slug);
    if (!isVideo && !isImage) return json({ error: 'unknown collection: ' + slug }, 400, origin);

    // Accepts `url` (one) or `urls` (a batch). A batch lands in a single commit
    // so the thumbnail bot fires once instead of once per link.
    const rawUrls = Array.isArray(body.urls)
      ? body.urls
      : (body.url == null ? [] : [body.url]);
    const urls = rawUrls.map((u) => String(u == null ? '' : u).trim()).filter(Boolean);
    if (!urls.length) return json({ error: 'no urls given' }, 400, origin);
    if (urls.length > 200) return json({ error: 'too many urls at once (max 200)' }, 400, origin);
    for (const u of urls) {
      if (!/^https?:\/\/\S+$/i.test(u) || u.length > 2000) {
        return json({ error: 'not a valid http(s) link: ' + u.slice(0, 80) }, 400, origin);
      }
    }

    // Build the entries exactly as EDITING.md documents them. Trim seconds only
    // describe one clip, so they are accepted only for a single-link request.
    let newLines;
    if (isVideo && urls.length === 1) {
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

    let section = null;
    if (isVideo) {
      section = body.section == null || body.section === '' ? null : Number(body.section);
      if (section !== null && (!Number.isInteger(section) || section < 0)) {
        return json({ error: 'section must be a non-negative integer' }, 400, origin);
      }
    }

    const path = 'data/' + slug + '.js';
    const api = `https://api.github.com/repos/${REPO}/contents/${path}`;
    const gh = {
      'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'vault-admin-worker',
      'X-GitHub-Api-Version': '2022-11-28'
    };

    // Read → modify → write, using the blob sha so a concurrent bot commit
    // makes GitHub reject this write (409) instead of silently clobbering it.
    const getRes = await fetch(`${api}?ref=${BRANCH}`, { headers: gh });
    if (!getRes.ok) {
      return json({ error: 'could not read ' + path, status: getRes.status }, 502, origin);
    }
    const file = await getRes.json();
    const current = new TextDecoder().decode(
      Uint8Array.from(atob(file.content.replace(/\n/g, '')), (c) => c.charCodeAt(0))
    );

    let updated;
    try {
      updated = insertLine(current, isVideo ? 'SOURCES' : 'IMGS', newLines, section);
    } catch (e) {
      return json({ error: e.message }, 422, origin);
    }

    const encoded = toBase64(updated);
    const putRes = await fetch(api, {
      method: 'PUT',
      headers: { ...gh, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: newLines.length === 1
          ? `data: add link to ${slug}`
          : `data: add ${newLines.length} links to ${slug}`,
        content: encoded,
        sha: file.sha,
        branch: BRANCH,
        author: COMMIT_IDENTITY,
        committer: COMMIT_IDENTITY
      })
    });

    if (!putRes.ok) {
      const detail = await putRes.text();
      const conflict = putRes.status === 409 || putRes.status === 422;
      return json({
        error: conflict
          ? 'the file changed while committing (a bot ran) — try again'
          : 'commit failed',
        status: putRes.status,
        detail: detail.slice(0, 300)
      }, 502, origin);
    }

    const out = await putRes.json();
    return json({
      ok: true,
      commit: out.commit && out.commit.sha,
      path,
      added: newLines.length
    }, 200, origin);
  }
};
