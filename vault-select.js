// ════════════════════════════════════════════════════════════
// Select mode — delete and re-order a collection from the site.
//
//   Select (top right) or long-press a tile   → Select mode
//   tap / click                               → toggle a tile
//   Shift-click                               → select a range
//   click a section divider                   → toggle that section
//   drag (hold first on touch)                → re-order
//   Move to… / Delete / Done                  → the floating bar
//   Esc · ⌘A · Delete                         → exit · select all · delete
//
// All writes go through the vault-admin worker (window.VaultAdmin, set up
// by vault-additions.js), so this file never holds a URL or a key of its own.
//
// HOW THE GRID STAYS HONEST
// The page keeps a model of the data file: {k} for a section break, {url}
// for an entry, in file order. Every change is applied to that model with
// the same rules the worker applies to the file, and the grid is re-laid
// from the model. The worker's reorderEntries / removeEntries and the
// functions here must agree — if one changes, change the other.
//
// A DEPLOY IS NOT INSTANT
// A commit takes a minute or more to reach GitHub Pages, and a reload in
// that window would serve the old data file — deleted tiles back, moves
// undone, looking exactly like the edit failed. So edits are also noted
// in localStorage and re-applied on load for 15 minutes, or until the
// data file shows they have landed.
// ════════════════════════════════════════════════════════════
(function () {
  'use strict';
  var mount = document.querySelector('[data-vault-video], [data-vault-image]');
  if (!mount || !window.VaultAdmin) return;

  var isVideo = mount.hasAttribute('data-vault-video');
  var slug = mount.getAttribute(isVideo ? 'data-vault-video' : 'data-vault-image');
  var body = mount.querySelector(isVideo ? '.vs-body' : '.is-body');
  var lightbox = mount.querySelector(isVideo ? '.vs-lightbox' : '.is-lightbox');
  if (!body || !lightbox) return;

  var TILE = isVideo ? '.vs-tile' : '.is-tile';
  var DIV = isVideo ? '.vs-divider' : '.is-divider';
  var RAW = isVideo
    ? (typeof SOURCES !== 'undefined' && Array.isArray(SOURCES) ? SOURCES : [])
    : (typeof IMGS !== 'undefined' && Array.isArray(IMGS) ? IMGS : []);
  var LABELS = (typeof DIV_LABELS !== 'undefined' && Array.isArray(DIV_LABELS)) ? DIV_LABELS : [];
  var NAME = ((window.COLLECTION_META || {})[slug] || {}).label || slug;
  var NOUN = isVideo ? 'video' : 'image';
  var root = document.documentElement;

  var LONG_PRESS_MS = 480;   // enter Select mode
  var DRAG_HOLD_MS = 380;    // on touch, hold still this long before a drag starts
  var TTL = 15 * 60 * 1000;  // how long an unlanded edit is re-applied on load
  var PENDING = 'vault-pending-edits';

  // ── Styles ────────────────────────────────────────────────
  // Injected after the stylesheets, so on a tie these win — that is what
  // lets the divider's ::after (hidden by the Spatial theme) show "Select
  // section" here without !important.
  var css = ''
    + '.vsel-toggle{flex-shrink:0;height:34px;padding:0 16px;border-radius:17px;'
    + 'border:1px solid rgba(255,255,255,.19);background:rgba(255,255,255,.10);color:rgba(255,255,255,.97);'
    + 'font:inherit;font-size:13px;font-weight:600;line-height:1;cursor:pointer;'
    + 'display:inline-flex;align-items:center;justify-content:center}'
    + '.vsel-toggle:hover:not([disabled]){background:rgba(255,255,255,.18)}'
    + '.vsel-toggle[aria-pressed="true"]{background:rgba(255,255,255,.94);color:#0a0a0d;border-color:transparent}'
    + '.vsel-toggle[disabled]{opacity:.45;cursor:default}'
    + '.vsel-toggle.vsel-fixed{position:fixed;top:18px;right:18px;z-index:620}'
    + '.sp-head .vsel-toggle{margin-left:4px}'
    // On a phone the header wraps, and the button fell to its own line on the
    // left. Keep it top-right: the title truncates instead, and the item count
    // takes the second line.
    + '@media (max-width:900px){'
    + 'html .sp-head .sp-title{flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + 'html .sp-head .vsel-toggle{order:2;margin-left:auto}'
    + 'html .sp-head .sp-count{order:3;flex-basis:100%;margin-left:0}}'

    // Long-press is Select now, so the OS callout would only get in the way.
    + TILE + '{-webkit-touch-callout:none}'
    + 'html.vsel-on ' + TILE + '{cursor:pointer;-webkit-user-select:none;user-select:none}'
    + 'html.vsel-on .fav-heart,html.vsel-on .vs-play-overlay{display:none}'
    + 'html.vsel-on ' + TILE + '::before{content:"";position:absolute;top:8px;left:8px;z-index:4;'
    + 'width:24px;height:24px;box-sizing:border-box;border-radius:12px;border:2px solid rgba(255,255,255,.92);'
    + 'background:rgba(0,0,0,.30);box-shadow:0 1px 5px rgba(0,0,0,.55);'
    + 'display:flex;align-items:center;justify-content:center;'
    + 'font:800 14px/1 -apple-system,BlinkMacSystemFont,sans-serif;color:#fff}'
    + 'html.vsel-on .vsel-picked::before{content:"\\2713";background:#0a84ff;border-color:#fff}'
    + 'html.vsel-on .vsel-picked{outline:3px solid #0a84ff;outline-offset:-3px}'
    + 'html.vsel-on .vsel-picked img{opacity:.8}'
    + '.vsel-removing{opacity:.35;filter:grayscale(1);transition:opacity .2s ease}'
    + '.vsel-lifted{opacity:.25}'
    + '.vsel-flash{animation:vsel-flash 1.2s ease}'
    + '@keyframes vsel-flash{0%,60%{outline:3px solid #0a84ff;outline-offset:-3px}100%{outline-color:transparent}}'

    + 'html.vsel-on ' + DIV + '{cursor:pointer}'
    + 'html.vsel-on ' + DIV + '::after{content:"Select section";display:block;flex:none;margin-left:auto;'
    + 'height:auto;background:none;font-size:11px;font-weight:600;letter-spacing:0;text-transform:none;color:#6cb4ff}'
    + 'html.vsel-on ' + DIV + '.vsel-sec-all::after{content:"Deselect section"}'

    // While selecting, the bar replaces the search bar and the + button; on
    // a phone it also takes the rail's place, as iOS hides its tab bar.
    + 'html.vsel-on .sp-orn,html.vsel-on #va-fab{display:none}'
    + '@media (max-width:900px){html.vsel-on .sp-rail{display:none}}'
    + '.vsel-bar{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom));transform:translateX(-50%);'
    + 'z-index:640;display:none;align-items:center;gap:6px;height:60px;box-sizing:border-box;padding:0 10px;'
    + 'max-width:calc(100vw - 28px);border-radius:30px;background:rgba(255,255,255,.12);'
    + 'border:1px solid rgba(255,255,255,.21);-webkit-backdrop-filter:blur(40px) saturate(1.9);'
    + 'backdrop-filter:blur(40px) saturate(1.9);box-shadow:inset 0 1.5px 0 rgba(255,255,255,.30),'
    + 'inset 0 -1.5px 0 rgba(0,0,0,.28),0 18px 40px rgba(0,0,0,.66);color:rgba(255,255,255,.97)}'
    + 'html.vsel-on .vsel-bar{display:flex}'
    + '.vsel-bar button{box-sizing:border-box;height:40px;min-width:40px;padding:0 14px;border:0;border-radius:20px;'
    + 'background:rgba(255,255,255,.12);color:inherit;font:inherit;font-size:13px;font-weight:600;line-height:1;'
    + 'cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;flex-shrink:0}'
    + '.vsel-bar button:hover:not([disabled]){background:rgba(255,255,255,.22)}'
    + '.vsel-bar button[disabled]{opacity:.4;cursor:default}'
    + '.vsel-bar button.vsel-del{background:#d0342c;color:#fff}'
    + '.vsel-bar button.vsel-del:hover:not([disabled]){background:#e03e35}'
    + '.vsel-bar svg{width:16px;height:16px;flex-shrink:0}'
    + '.vsel-count{padding:0 8px;min-width:90px;text-align:center;font-size:13px;'
    + 'font-variant-numeric:tabular-nums;white-space:nowrap}'
    + '@media (max-width:900px){.vsel-bar{bottom:calc(14px + env(safe-area-inset-bottom))}}'
    + '@media (max-width:560px){.vsel-lbl{display:none}.vsel-count{min-width:0;padding:0 4px}'
    + '.vsel-bar button{padding:0 12px}.vsel-bar button.vsel-icon{padding:0;width:40px}}'
    + 'html.vsel-busy .vsel-bar button,html.vsel-busy .vsel-toggle{pointer-events:none;opacity:.5}'

    + '.vsel-scrim{position:fixed;inset:0;z-index:980;display:flex;align-items:center;justify-content:center;'
    + 'padding:20px;background:rgba(3,3,5,.62);-webkit-backdrop-filter:blur(24px);backdrop-filter:blur(24px)}'
    + '.vsel-sheet{width:100%;max-width:420px;max-height:82vh;overflow:auto;box-sizing:border-box;padding:24px;'
    + 'border-radius:32px;background:rgba(30,30,38,.94);border:1px solid rgba(255,255,255,.19);'
    + 'box-shadow:inset 0 1.5px 0 rgba(255,255,255,.28),0 40px 90px rgba(0,0,0,.76);color:rgba(255,255,255,.97);'
    + 'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",system-ui,sans-serif}'
    + '.vsel-sheet h2{margin:0 0 8px;font-size:19px;font-weight:700;letter-spacing:-.02em}'
    + '.vsel-sheet p{margin:0 0 16px;font-size:13.5px;line-height:1.45;color:rgba(255,255,255,.76)}'
    + '.vsel-sheet label{display:block;margin:0 0 6px;font-size:12px;font-weight:600;color:rgba(255,255,255,.76)}'
    + '.vsel-sheet input{display:block;width:100%;box-sizing:border-box;height:42px;margin:0 0 16px;padding:0 14px;'
    + 'border-radius:12px;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.14);color:#fff;font:inherit;font-size:14px}'
    + '.vsel-sheet input:focus{outline:none;border-color:rgba(255,255,255,.4)}'
    + '.vsel-actions{display:flex;gap:10px;justify-content:flex-end}'
    + '.vsel-actions button{height:44px;padding:0 20px;border:0;border-radius:22px;background:rgba(255,255,255,.12);'
    + 'color:#fff;font:inherit;font-size:14px;font-weight:600;cursor:pointer}'
    + '.vsel-actions button:hover{background:rgba(255,255,255,.2)}'
    + '.vsel-actions .vsel-danger{background:#d0342c}.vsel-actions .vsel-danger:hover{background:#e03e35}'
    + '.vsel-actions .vsel-primary{background:rgba(255,255,255,.94);color:#0a0a0d}'
    + '.vsel-moves{display:flex;flex-direction:column;gap:6px;margin:0 0 18px}'
    + '.vsel-move-row{display:flex;align-items:center;gap:6px;min-height:46px;box-sizing:border-box;'
    + 'padding:5px 5px 5px 14px;border-radius:16px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.10)}'
    + '.vsel-move-row span{flex:1;min-width:0;font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.vsel-move-row button{height:34px;padding:0 14px;border:0;border-radius:17px;background:rgba(255,255,255,.12);'
    + 'color:#fff;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;flex-shrink:0}'
    + '.vsel-move-row button:hover{background:rgba(255,255,255,.24)}'
    + '.vsel-move-sub{margin:4px 0 6px 4px;font-size:11px;font-weight:700;letter-spacing:.1em;'
    + 'text-transform:uppercase;color:rgba(255,255,255,.56)}'

    + '.vsel-toast{position:fixed;left:50%;bottom:calc(98px + env(safe-area-inset-bottom));transform:translateX(-50%);'
    + 'z-index:990;display:flex;align-items:center;gap:10px;max-width:calc(100vw - 28px);box-sizing:border-box;'
    + 'min-height:48px;padding:7px 7px 7px 18px;border-radius:24px;background:rgba(30,30,38,.95);'
    + 'border:1px solid rgba(255,255,255,.19);box-shadow:inset 0 1.5px 0 rgba(255,255,255,.26),0 18px 40px rgba(0,0,0,.66);'
    + 'color:#fff;font:500 13.5px/1.35 -apple-system,BlinkMacSystemFont,system-ui,sans-serif}'
    + '.vsel-toast.vsel-err{border-color:rgba(255,120,110,.6)}'
    + '.vsel-toast span{flex:1;min-width:0}'
    + '.vsel-toast button{flex-shrink:0;height:34px;padding:0 14px;border:0;border-radius:17px;'
    + 'background:rgba(255,255,255,.94);color:#0a0a0d;font:inherit;font-size:13px;font-weight:700;cursor:pointer}'
    + '.vsel-toast button.vsel-x{background:transparent;color:rgba(255,255,255,.7);width:34px;padding:0;font-size:18px}'

    + '.vsel-ghost{position:fixed;left:0;top:0;z-index:1000;pointer-events:none;width:84px;height:84px;'
    + 'will-change:transform}'
    + '.vsel-ghost i{position:absolute;inset:0;border-radius:18px;background:#26262e center/cover no-repeat;'
    + 'border:2px solid rgba(255,255,255,.92);box-shadow:0 20px 44px rgba(0,0,0,.7)}'
    + '.vsel-ghost b{position:absolute;top:-9px;right:-9px;min-width:26px;height:26px;box-sizing:border-box;'
    + 'padding:0 7px;border-radius:13px;background:#0a84ff;color:#fff;border:2px solid #fff;'
    + 'font:800 12px/22px -apple-system,BlinkMacSystemFont,sans-serif;text-align:center}'
    + '.vsel-marker{position:fixed;z-index:999;pointer-events:none;border-radius:2px;background:#0a84ff;'
    + 'box-shadow:0 0 0 2px rgba(10,132,255,.35),0 0 16px rgba(10,132,255,.75);display:none}'
    + 'html.vsel-dragging,html.vsel-dragging *{cursor:grabbing!important;-webkit-user-select:none;user-select:none}';
  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ── Small helpers ─────────────────────────────────────────
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function plural(n) { return n.toLocaleString() + ' ' + NOUN + (n === 1 ? '' : 's'); }
  function sectionLabel(k) { return LABELS[k] || ('Part ' + (k + 1)); }
  function isEntry(t) { return t.url != null; }
  function buzz() { try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {} }
  var ICON = {
    move: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v18M12 3l-4 4M12 3l4 4M12 21l-4-4M12 21l4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  // ── The model: the data file, as the page understands it ─
  var model = [];
  (function () {
    var k = -1;
    for (var i = 0; i < RAW.length; i++) {
      var x = RAW[i];
      if (x === null) { model.push({ k: ++k }); continue; }
      var u = typeof x === 'string' ? x : (x && x.url);
      if (u) model.push({ url: u });
    }
  })();
  var EXPECTED = model.filter(isEntry).length;

  // Mirror of the worker's reorderEntries. Returns `m` itself when there is
  // nothing to do (a target that has since gone, say).
  function reorderModel(m, urls, to) {
    var want = new Set(urls), lifted = [], rest = [];
    for (var i = 0; i < m.length; i++) {
      var t = m[i];
      (t.url != null && want.has(t.url) ? lifted : rest).push(t);
    }
    if (!lifted.length) return m;
    var at = -1;
    if (to.where === 'top') {
      for (var a = 0; a < rest.length; a++) if (isEntry(rest[a])) { at = a; break; }
      if (at === -1) at = rest.length;
    } else if (to.where === 'bottom') {
      at = rest.length;
    } else if (to.where === 'before' || to.where === 'after') {
      for (var j = 0; j < rest.length; j++) {
        if (rest[j].url === to.target) { at = to.where === 'before' ? j : j + 1; break; }
      }
      if (at === -1) return m;
    } else {
      var nulls = [];
      for (var n = 0; n < rest.length; n++) if (rest[n].k != null) nulls.push(n);
      var k = to.section;
      if (!(k >= 0 && k < nulls.length)) return m;
      at = to.where === 'section-start' ? nulls[k] + 1 : (k + 1 < nulls.length ? nulls[k + 1] : rest.length);
    }
    return rest.slice(0, at).concat(lifted, rest.slice(at));
  }
  function sameOrder(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i].url !== b[i].url || a[i].k !== b[i].k) return false;
    return true;
  }

  // ── The grid, laid out from the model ─────────────────────
  var tileByUrl = new Map();  // every tile built, including ones deleted this session
  var divBySec = new Map();   // section index → divider node
  var secByDiv = new Map();

  function indexGrid() {
    var tiles = body.querySelectorAll(TILE);
    for (var i = 0; i < tiles.length; i++) {
      if (tiles[i].dataset.favUrl) tileByUrl.set(tiles[i].dataset.favUrl, tiles[i]);
    }
    // The engines draw one divider where entries resume after one or more
    // breaks, labelled by the LAST of them, and none for an empty section —
    // bomb-ass-dee-pt-2 has one. So dividers do not map 1:1 onto sections.
    var owners = [];
    for (var m = 0; m < model.length; m++) {
      if (model[m].k != null && model[m + 1] && isEntry(model[m + 1])) owners.push(model[m].k);
    }
    var divs = body.querySelectorAll(DIV);
    for (var d = 0; d < divs.length && d < owners.length; d++) {
      divBySec.set(owners[d], divs[d]);
      secByDiv.set(divs[d], owners[d]);
    }
  }
  function dividerFor(k) {
    var d = divBySec.get(k);
    if (!d) {
      d = document.createElement('div');
      d.className = isVideo ? 'vs-divider' : 'is-divider';
      d.textContent = sectionLabel(k);
      divBySec.set(k, d);
      secByDiv.set(d, k);
    }
    return d;
  }
  // Re-appending moves the existing nodes, so every listener the engines
  // attached, every poster already loaded and every heart keep working.
  function renderOrder() {
    var frag = document.createDocumentFragment();
    var keep = new Set();
    for (var i = 0; i < model.length; i++) {
      var t = model[i];
      if (t.k != null) {
        var next = model[i + 1];
        if (next && isEntry(next)) { var d = dividerFor(t.k); keep.add(d); frag.appendChild(d); }
        continue;
      }
      var node = tileByUrl.get(t.url);
      if (node) { keep.add(node); frag.appendChild(node); }
    }
    // Anything still in the grid is no longer in the model: deleted, or a
    // section that has emptied out. The nodes stay in the maps for undo.
    var left = body.querySelectorAll(TILE + ',' + DIV);
    for (var l = 0; l < left.length; l++) if (!keep.has(left[l])) left[l].remove();
    body.insertBefore(frag, lightbox);
  }

  function updateCount() {
    var n = model.filter(isEntry).length;
    var el = document.querySelector('.sp-count');
    if (el) el.textContent = plural(n);
    try {
      var live = JSON.parse(localStorage.getItem('vault-counts') || '{}');
      live[slug] = n;
      localStorage.setItem('vault-counts', JSON.stringify(live));
    } catch (e) {}
  }

  // ── Edits that have not reached Pages yet ────────────────
  function readPending() {
    try {
      var p = JSON.parse(localStorage.getItem(PENDING) || '{}')[slug];
      if (p && p.del && p.mv) return p;
    } catch (e) {}
    return { del: {}, mv: [] };
  }
  function writePending(p) {
    try {
      var all = JSON.parse(localStorage.getItem(PENDING) || '{}');
      if (!Object.keys(p.del).length && !p.mv.length) delete all[slug]; else all[slug] = p;
      if (Object.keys(all).length) localStorage.setItem(PENDING, JSON.stringify(all));
      else localStorage.removeItem(PENDING);
    } catch (e) {}
  }
  function noteDeleted(urls) {
    var p = readPending(), now = Date.now();
    urls.forEach(function (u) { p.del[u] = now; });
    writePending(p);
  }
  function unnoteDeleted(urls) {
    var p = readPending();
    urls.forEach(function (u) { delete p.del[u]; });
    writePending(p);
  }
  function noteMoved(urls, to) {
    var p = readPending();
    p.mv.push({ urls: urls, to: to, t: Date.now() });
    writePending(p);
  }
  function replayPending() {
    var p = readPending(), now = Date.now(), changed = false;
    var inData = new Set(model.filter(isEntry).map(function (t) { return t.url; }));
    var hide = new Set();
    Object.keys(p.del).forEach(function (u) {
      // Gone from the data file → the deploy landed. Too old → stop guessing.
      if (!inData.has(u) || now - p.del[u] > TTL) delete p.del[u];
      else hide.add(u);
    });
    if (hide.size) {
      model = model.filter(function (t) { return !(t.url != null && hide.has(t.url)); });
      changed = true;
    }
    // A move cannot be told apart from "already landed", but re-applying one
    // that has landed leaves the order as it is, so replaying is safe.
    p.mv = p.mv.filter(function (m) { return now - m.t <= TTL; });
    p.mv.forEach(function (m) {
      var next = reorderModel(model, m.urls, m.to);
      if (next !== model && !sameOrder(next, model)) { model = next; changed = true; }
    });
    writePending(p);
    if (changed) { renderOrder(); updateCount(); }
  }

  // ── Readiness: the engines build the grid in chunks ──────
  // Nothing here may touch the order until every tile exists, or a late chunk
  // would land at the end of a grid that has already been re-laid.
  var ready = false, quietTimer = null;
  function checkReady(force) {
    if (ready) return;
    var n = body.querySelectorAll(TILE).length;
    if (n < EXPECTED && !(force && n > 0)) return;
    ready = true;
    mo.disconnect();
    clearTimeout(quietTimer);
    indexGrid();
    replayPending();
    toggleBtn.disabled = false;
    toggleBtn.removeAttribute('title');
  }
  var mo = new MutationObserver(function () {
    checkReady(false);
    // Should a count ever disagree with the data, settle once the grid goes quiet.
    clearTimeout(quietTimer);
    quietTimer = setTimeout(function () { checkReady(true); }, 1500);
  });

  // ── Chrome: the Select button and the action bar ─────────
  var toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'vsel-toggle';
  toggleBtn.textContent = 'Select';
  toggleBtn.setAttribute('aria-pressed', 'false');
  toggleBtn.disabled = true;
  toggleBtn.title = 'Loading the collection…';
  var head = document.querySelector('.sp-head');
  if (head) head.appendChild(toggleBtn);
  else { toggleBtn.classList.add('vsel-fixed'); document.body.appendChild(toggleBtn); }
  toggleBtn.addEventListener('click', function () { if (on) exit(); else enter(); });

  var bar = document.createElement('div');
  bar.className = 'vsel-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Selection');
  bar.innerHTML = ''
    + '<button type="button" class="vsel-all">Select all</button>'
    + '<span class="vsel-count" aria-live="polite"><b>0</b><span class="vsel-lbl"> selected</span></span>'
    + '<button type="button" class="vsel-move vsel-icon" aria-label="Move to…" disabled>' + ICON.move + '<span class="vsel-lbl">Move to…</span></button>'
    + '<button type="button" class="vsel-del vsel-icon" aria-label="Delete" disabled>' + ICON.trash + '<span class="vsel-lbl">Delete</span></button>'
    + '<button type="button" class="vsel-done">Done</button>';
  document.body.appendChild(bar);
  var allBtn = bar.querySelector('.vsel-all');
  var countNum = bar.querySelector('.vsel-count b');
  var moveBtn = bar.querySelector('.vsel-move');
  var delBtn = bar.querySelector('.vsel-del');
  allBtn.addEventListener('click', function () { selectAll(!allVisibleSelected()); });
  moveBtn.addEventListener('click', openMoveSheet);
  delBtn.addEventListener('click', confirmDelete);
  bar.querySelector('.vsel-done').addEventListener('click', exit);

  // ── Selection ─────────────────────────────────────────────
  var on = false, sel = new Set(), anchorUrl = null;

  function visibleTiles() {
    return Array.prototype.filter.call(body.querySelectorAll(TILE), function (t) {
      return !t.classList.contains('cs-hidden');
    });
  }
  function setPicked(t, v) {
    var u = t.dataset.favUrl;
    if (!u) return;
    if (v) sel.add(u); else sel.delete(u);
    t.classList.toggle('vsel-picked', v);
  }
  function allVisibleSelected() {
    var vis = visibleTiles();
    return vis.length > 0 && vis.every(function (t) { return sel.has(t.dataset.favUrl); });
  }
  function selectAll(v) {
    visibleTiles().forEach(function (t) { setPicked(t, v); });
    refresh();
  }
  function orderedSelection() {
    var out = [];
    for (var i = 0; i < model.length; i++) if (model[i].url != null && sel.has(model[i].url)) out.push(model[i].url);
    return out;
  }
  function sectionTiles(d) {
    var out = [], n = d.nextElementSibling;
    while (n && n !== lightbox && !n.matches(DIV)) {
      if (n.matches(TILE) && !n.classList.contains('cs-hidden')) out.push(n);
      n = n.nextElementSibling;
    }
    return out;
  }
  function toggleSection(d) {
    var ts = sectionTiles(d);
    var all = ts.length > 0 && ts.every(function (t) { return sel.has(t.dataset.favUrl); });
    ts.forEach(function (t) { setPicked(t, !all); });
  }
  function rangeTo(t) {
    var vis = visibleTiles(), a = -1, b = vis.indexOf(t);
    for (var i = 0; i < vis.length; i++) if (vis[i].dataset.favUrl === anchorUrl) { a = i; break; }
    if (a === -1 || b === -1) { setPicked(t, true); anchorUrl = t.dataset.favUrl; return; }
    for (var j = Math.min(a, b); j <= Math.max(a, b); j++) setPicked(vis[j], true);
  }
  function refresh() {
    var n = sel.size;
    countNum.textContent = n.toLocaleString();
    moveBtn.disabled = delBtn.disabled = n === 0;
    allBtn.textContent = allVisibleSelected() ? 'Deselect all' : 'Select all';
    // Each divider says whether its section is already fully selected.
    var divs = body.querySelectorAll(DIV);
    for (var i = 0; i < divs.length; i++) {
      var ts = sectionTiles(divs[i]);
      divs[i].classList.toggle('vsel-sec-all', ts.length > 0 && ts.every(function (t) { return sel.has(t.dataset.favUrl); }));
    }
  }
  function enter() {
    if (on || !ready) return;
    on = true;
    root.classList.add('vsel-on');
    toggleBtn.textContent = 'Done';
    toggleBtn.setAttribute('aria-pressed', 'true');
    refresh();
  }
  function exit() {
    if (!on) return;
    on = false;
    sel.forEach(function (u) { var t = tileByUrl.get(u); if (t) t.classList.remove('vsel-picked'); });
    sel.clear();
    anchorUrl = null;
    Array.prototype.forEach.call(body.querySelectorAll(DIV), function (d) { d.classList.remove('vsel-sec-all'); });
    root.classList.remove('vsel-on');
    toggleBtn.textContent = 'Select';
    toggleBtn.setAttribute('aria-pressed', 'false');
    closeSheet();
  }

  // ── Pointer input: tap, long-press, drag ─────────────────
  // Capture phase on the document, so these run BEFORE the engines' own
  // tile listeners — in Select mode a tap must never open the lightbox.
  // The release that ends a long-press or a drag produces a click, which must
  // not toggle a tile or open the lightbox. It is swallowed only if it comes
  // within 400ms of that release: a long-press is armed while the finger is
  // still down (it may be held well past the timer), and a bare flag would
  // otherwise linger and eat the next unrelated click — Done, say.
  var swallowArmed = false, swallowUntil = 0, press = null, drag = null;
  function armSwallow() { swallowArmed = false; swallowUntil = Date.now() + 400; }

  document.addEventListener('click', function (e) {
    if (Date.now() < swallowUntil) { swallowUntil = 0; e.preventDefault(); e.stopPropagation(); return; }
    if (!on || !e.target.closest) return;
    var t = e.target.closest(TILE);
    if (t && body.contains(t)) {
      e.preventDefault(); e.stopPropagation();
      if (e.shiftKey && anchorUrl) rangeTo(t);
      else { setPicked(t, !sel.has(t.dataset.favUrl)); anchorUrl = t.dataset.favUrl; }
      refresh();
      return;
    }
    var d = e.target.closest(DIV);
    if (d && body.contains(d)) { e.preventDefault(); e.stopPropagation(); toggleSection(d); refresh(); }
  }, true);

  document.addEventListener('pointerdown', function (e) {
    swallowArmed = false; swallowUntil = 0;  // only the click that ends THIS gesture is ours
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!ready || busy || !e.target.closest) return;
    var t = e.target.closest(TILE);
    if (!t || !body.contains(t)) return;
    if (!on) {
      press = {
        id: e.pointerId, x: e.clientX, y: e.clientY,
        timer: setTimeout(function () {
          press = null;
          swallowArmed = true;                 // the release would otherwise open the lightbox
          enter();
          setPicked(t, true);
          anchorUrl = t.dataset.favUrl;
          refresh();
          buzz();
        }, LONG_PRESS_MS)
      };
      return;
    }
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
      tile: t, touch: e.pointerType !== 'mouse', active: false, hold: null, target: null };
    if (drag.touch) {
      // A drag on touch must be deliberate — hold still first — or every
      // scroll through the grid would pick tiles up.
      drag.hold = setTimeout(function () { if (drag && !drag.active) startDrag(); }, DRAG_HOLD_MS);
    }
  }, true);

  function cancelPress() {
    if (press) { clearTimeout(press.timer); press = null; }
  }
  document.addEventListener('pointermove', function (e) {
    // Touch jitter fires pointermove constantly, so only real travel cancels.
    if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelPress();
    if (!drag || e.pointerId !== drag.id) return;
    drag.x = e.clientX; drag.y = e.clientY;
    if (!drag.active) {
      var travel = Math.hypot(drag.x - drag.x0, drag.y - drag.y0);
      if (drag.touch) { if (travel > 10) { clearTimeout(drag.hold); drag = null; } return; }  // a scroll
      if (travel < 6) return;
      startDrag();
    }
    e.preventDefault();
    trackDrag();
  }, true);
  document.addEventListener('pointerup', function (e) {
    cancelPress();
    if (swallowArmed) armSwallow();
    if (!drag || e.pointerId !== drag.id) return;
    clearTimeout(drag.hold);
    if (drag.active) { armSwallow(); finishDrag(true); } else drag = null;
  }, true);
  document.addEventListener('pointercancel', function () {
    cancelPress();
    if (drag) { clearTimeout(drag.hold); if (drag.active) finishDrag(false); else drag = null; }
  }, true);
  window.addEventListener('scroll', cancelPress, { passive: true, capture: true });
  // Once a drag is live, the page must not scroll under the finger.
  document.addEventListener('touchmove', function (e) { if (drag && drag.active) e.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', function (e) {
    var t = e.target.closest && e.target.closest(TILE);
    if (t && body.contains(t) && (on || press)) e.preventDefault();
  }, true);

  // ── Dragging ──────────────────────────────────────────────
  var ghost = null, marker = null, scrollRaf = 0, gridGap = 8;

  function startDrag() {
    var u = drag.tile.dataset.favUrl;
    // Dragging a selected tile carries the whole selection; an unselected one
    // moves alone, and the selection is left exactly as it was.
    drag.urls = sel.has(u) ? orderedSelection() : [u];
    drag.active = true;
    root.classList.add('vsel-dragging');
    drag.urls.forEach(function (x) { var n = tileByUrl.get(x); if (n) n.classList.add('vsel-lifted'); });
    gridGap = parseFloat(getComputedStyle(body).columnGap) || 8;

    ghost = document.createElement('div');
    ghost.className = 'vsel-ghost';
    var img = drag.tile.querySelector('img');
    var src = img && (img.currentSrc || img.src);
    ghost.innerHTML = '<i></i>' + (drag.urls.length > 1 ? '<b>' + drag.urls.length + '</b>' : '');
    if (src) ghost.firstChild.style.backgroundImage = 'url("' + src.replace(/"/g, '%22') + '")';
    marker = document.createElement('div');
    marker.className = 'vsel-marker';
    document.body.append(ghost, marker);
    buzz();
    trackDrag();
    scrollRaf = requestAnimationFrame(autoScroll);
  }
  function trackDrag() {
    if (!drag || !drag.active) return;
    ghost.style.transform = 'translate(' + (drag.x - 42) + 'px,' + (drag.y - 42) + 'px) rotate(-3deg)';
    var el = document.elementFromPoint(drag.x, drag.y);
    var t = el && el.closest && el.closest(TILE);
    var d = !t && el && el.closest && el.closest(DIV);
    drag.target = null;
    if (t && body.contains(t) && drag.urls.indexOf(t.dataset.favUrl) === -1) {
      var r = t.getBoundingClientRect();
      var before = drag.x < r.left + r.width / 2;
      drag.target = { where: before ? 'before' : 'after', target: t.dataset.favUrl };
      showMarker((before ? r.left - gridGap / 2 : r.right + gridGap / 2) - 2, r.top, 4, r.height);
    } else if (d && body.contains(d) && secByDiv.has(d)) {
      var dr = d.getBoundingClientRect();
      drag.target = { where: 'section-start', section: secByDiv.get(d) };
      showMarker(dr.left, dr.bottom + 3, dr.width, 4);
    }
    if (!drag.target) marker.style.display = 'none';
  }
  function showMarker(x, y, w, h) {
    marker.style.display = 'block';
    marker.style.left = x + 'px'; marker.style.top = y + 'px';
    marker.style.width = w + 'px'; marker.style.height = h + 'px';
  }
  // Near the top or bottom edge the page scrolls, faster the closer you get.
  function autoScroll() {
    if (!drag || !drag.active) return;
    var EDGE = 90, v = 0;
    if (drag.y < EDGE) v = -Math.ceil((EDGE - drag.y) / 5);
    else if (drag.y > innerHeight - EDGE) v = Math.ceil((drag.y - (innerHeight - EDGE)) / 5);
    if (v) { window.scrollBy(0, v); trackDrag(); }
    scrollRaf = requestAnimationFrame(autoScroll);
  }
  function finishDrag(commit) {
    var d = drag;
    drag = null;
    cancelAnimationFrame(scrollRaf);
    root.classList.remove('vsel-dragging');
    if (ghost) { ghost.remove(); ghost = null; }
    if (marker) { marker.remove(); marker = null; }
    if (!d) return;
    (d.urls || []).forEach(function (x) { var n = tileByUrl.get(x); if (n) n.classList.remove('vsel-lifted'); });
    if (commit && d.target) move(d.urls, d.target);
  }

  // ── Keyboard ──────────────────────────────────────────────
  function typing(e) { return /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable; }
  document.addEventListener('keydown', function (e) {
    if (drag && drag.active && e.key === 'Escape') { finishDrag(false); e.preventDefault(); return; }
    if (sheet) {
      if (e.key === 'Escape') { closeSheet(); e.preventDefault(); }
      else if (e.key === 'Tab') trapFocus(e);
      return;
    }
    if (!on || typing(e)) return;
    if (e.key === 'Escape') { exit(); e.preventDefault(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { selectAll(true); e.preventDefault(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size) { confirmDelete(); e.preventDefault(); }
  });

  // ── Sheets ────────────────────────────────────────────────
  var sheet = null, sheetReturn = null;
  function openSheet(html, wire) {
    closeSheet();
    sheetReturn = document.activeElement;
    sheet = document.createElement('div');
    sheet.className = 'vsel-scrim';
    sheet.innerHTML = '<div class="vsel-sheet" role="dialog" aria-modal="true" aria-labelledby="vsel-h">' + html + '</div>';
    sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });
    document.body.appendChild(sheet);
    wire(sheet.firstChild);
    var first = sheet.querySelector('input, .vsel-danger, .vsel-primary, button');
    if (first) first.focus();
  }
  function closeSheet() {
    if (!sheet) return;
    sheet.remove();
    sheet = null;
    if (sheetReturn && sheetReturn.isConnected && sheetReturn.focus) sheetReturn.focus();
  }
  function trapFocus(e) {
    var f = sheet.querySelectorAll('button, input');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  }
  function keyField() {
    return VaultAdmin.getKey() ? '' :
      '<label for="vsel-key">Vault key</label>'
      + '<input id="vsel-key" type="password" autocomplete="off" spellcheck="false" placeholder="The key set on the worker">';
  }
  // Save a key typed into the sheet. Returns false (and says so) if one is needed.
  function takeKey(sheetEl) {
    var k = sheetEl.querySelector('#vsel-key');
    if (!k) return true;
    if (!k.value.trim()) { k.focus(); k.style.borderColor = 'rgba(255,120,110,.8)'; return false; }
    VaultAdmin.setKey(k.value.trim());
    return true;
  }
  function withKey(then) {
    if (VaultAdmin.getKey()) { then(); return; }
    openSheet('<h2 id="vsel-h">Vault key needed</h2>'
      + '<p>Edits are saved through your worker, which needs the vault key. It is kept in this browser only.</p>'
      + keyField()
      + '<div class="vsel-actions"><button type="button" class="vsel-cancel">Cancel</button>'
      + '<button type="button" class="vsel-primary">Continue</button></div>', function (s) {
      s.querySelector('.vsel-cancel').addEventListener('click', closeSheet);
      s.querySelector('.vsel-primary').addEventListener('click', function () {
        if (!takeKey(s)) return;
        closeSheet();
        then();
      });
      s.querySelector('#vsel-key').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') s.querySelector('.vsel-primary').click();
      });
    });
  }

  // ── Toast ─────────────────────────────────────────────────
  var toastEl = null, toastTimer = null;
  function toast(text, action, onAction, isErr, ms) {
    dismissToast();
    toastEl = document.createElement('div');
    toastEl.className = 'vsel-toast' + (isErr ? ' vsel-err' : '');
    toastEl.setAttribute('role', isErr ? 'alert' : 'status');
    toastEl.innerHTML = '<span></span>'
      + (action ? '<button type="button" class="vsel-act"></button>' : '')
      + '<button type="button" class="vsel-x" aria-label="Dismiss">&times;</button>';
    toastEl.querySelector('span').textContent = text;
    if (action) {
      var b = toastEl.querySelector('.vsel-act');
      b.textContent = action;
      b.addEventListener('click', function () { dismissToast(); onAction(); });
    }
    toastEl.querySelector('.vsel-x').addEventListener('click', dismissToast);
    document.body.appendChild(toastEl);
    if (ms !== 0) toastTimer = setTimeout(dismissToast, ms || 6000);
  }
  function dismissToast() {
    clearTimeout(toastTimer);
    if (toastEl) { toastEl.remove(); toastEl = null; }
  }
  function failText(res, doing) {
    if (res.status === 401) {
      VaultAdmin.setKey('');   // wrong key: ask again next time rather than fail forever
      return doing + ': the vault key was not accepted.';
    }
    if (res.status === 429) return doing + ': too many edits in a row — wait a few minutes.';
    return doing + ': ' + ((res.data && res.data.error) || ('the worker returned ' + res.status)) + '.';
  }
  function reveal(url) {
    var t = tileByUrl.get(url);
    if (!t || !t.isConnected) return;
    t.scrollIntoView({ block: 'center', behavior: 'smooth' });
    t.classList.remove('vsel-flash'); void t.offsetWidth; t.classList.add('vsel-flash');
  }

  var busy = false;
  function setBusy(v) { busy = v; root.classList.toggle('vsel-busy', v); }

  // ── Favourites ────────────────────────────────────────────
  function favsOf(urls) {
    if (!window.Favourites) return [];
    var s = new Set(urls);
    return Favourites.list().filter(function (e) { return s.has(e.url) && (!e.slug || e.slug === slug); });
  }
  // Favourites._replaceAll is how sync applies a pull, so it is SILENT: on its
  // own, the gist never hears about the change and the next pull quietly puts
  // the deleted favourites back. A real change event makes sync push it.
  function announceFav(url, state) {
    document.dispatchEvent(new CustomEvent('vault-fav-change', { detail: { url: url, state: state } }));
  }
  function dropFavourites(urls) {
    if (!window.Favourites || !Favourites._replaceAll) return [];
    var s = new Set(urls), kept = [], dropped = [];
    Favourites.list().forEach(function (e, i) {
      if (s.has(e.url) && (!e.slug || e.slug === slug)) dropped.push({ i: i, e: e }); else kept.push(e);
    });
    if (!dropped.length) return [];
    Favourites._replaceAll(kept);
    announceFav(dropped[0].e.url, false);
    return dropped;
  }
  function restoreFavourites(dropped) {
    if (!dropped.length || !window.Favourites) return;
    var list = Favourites.list();
    var have = new Set(list.map(function (e) { return e.url; }));
    dropped.forEach(function (d) {
      if (!have.has(d.e.url)) list.splice(Math.min(d.i, list.length), 0, d.e);
    });
    Favourites._replaceAll(list);
    announceFav(dropped[0].e.url, true);
  }

  // ── Delete, with undo ─────────────────────────────────────
  function confirmDelete() {
    var urls = orderedSelection();
    if (!urls.length || busy) return;
    var favs = favsOf(urls).length;
    openSheet('<h2 id="vsel-h">Delete ' + esc(plural(urls.length)) + '?</h2>'
      + '<p>' + (urls.length === 1 ? 'It' : 'They') + ' will be removed from ' + esc(NAME)
      + '. You can undo this straight afterwards.'
      + (favs ? ' ' + (favs === 1 ? 'One of them is' : favs + ' of them are') + ' in Favourites and will be removed there too.' : '')
      + '</p>' + keyField()
      + '<div class="vsel-actions"><button type="button" class="vsel-cancel">Cancel</button>'
      + '<button type="button" class="vsel-danger">Delete ' + urls.length.toLocaleString() + '</button></div>', function (s) {
      s.querySelector('.vsel-cancel').addEventListener('click', closeSheet);
      s.querySelector('.vsel-danger').addEventListener('click', function () {
        if (!takeKey(s)) return;
        closeSheet();
        doDelete(urls);
      });
    });
  }
  function doDelete(urls) {
    dismissToast();
    var nodes = urls.map(function (u) { return tileByUrl.get(u); }).filter(Boolean);
    nodes.forEach(function (n) { n.classList.add('vsel-removing'); });
    setBusy(true);
    var unmark = function () { nodes.forEach(function (n) { n.classList.remove('vsel-removing'); }); };
    VaultAdmin.post({ slug: slug, action: 'remove', urls: urls }).then(function (res) {
      setBusy(false);
      unmark();
      if (!res.ok) { toast(failText(res, 'Nothing was deleted'), null, null, true); return; }
      var before = model.slice();
      var gone = new Set(urls);
      model = model.filter(function (t) { return !(t.url != null && gone.has(t.url)); });
      nodes.forEach(function (n) { n.classList.remove('vsel-picked'); });
      exit();
      renderOrder();
      var favDrop = dropFavourites(urls);
      noteDeleted(urls);
      updateCount();
      var records = (res.data && res.data.records) || [];
      var n = (res.data && res.data.removed) || urls.length;
      // No records means a worker from before undo existed: the delete still
      // happened, so say plainly why there is nothing to undo.
      toast('Deleted ' + plural(n) + ' from ' + NAME + '.'
        + (records.length ? '' : ' (Undo needs the updated worker.)'), records.length ? 'Undo' : null, function () {
        undoDelete(before, records, favDrop, urls);
      }, false, 12000);
    }, function () {
      setBusy(false);
      unmark();
      toast('Could not reach the worker — nothing was deleted.', null, null, true);
    });
  }
  function undoDelete(before, records, favDrop, urls) {
    var retry = function () { undoDelete(before, records, favDrop, urls); };
    setBusy(true);
    toast('Restoring…', null, null, false, 0);
    VaultAdmin.post({ slug: slug, action: 'restore', records: records }).then(function (res) {
      setBusy(false);
      if (!res.ok) { toast(failText(res, 'Undo failed'), 'Retry', retry, true, 0); return; }
      model = before;
      renderOrder();
      restoreFavourites(favDrop);
      unnoteDeleted(urls);
      updateCount();
      toast('Restored ' + plural(urls.length) + '.', 'Show', function () { reveal(urls[0]); });
    }, function () {
      setBusy(false);
      toast('Could not reach the worker to undo.', 'Retry', retry, true, 0);
    });
  }

  // ── Move ──────────────────────────────────────────────────
  function describe(to) {
    if (to.where === 'top') return ' to the top';
    if (to.where === 'bottom') return ' to the bottom';
    if (to.where === 'section-start') return ' to the start of ' + sectionLabel(to.section);
    if (to.where === 'section-end') return ' to the end of ' + sectionLabel(to.section);
    return '';
  }
  function sectionCount() { return model.filter(function (t) { return t.k != null; }).length; }
  function openMoveSheet() {
    var urls = orderedSelection();
    if (!urls.length || busy) return;
    var rows = ''
      + '<div class="vsel-move-row"><span>Top of ' + esc(NAME) + '</span><button type="button" data-to="top">Move here</button></div>'
      + '<div class="vsel-move-row"><span>Bottom of ' + esc(NAME) + '</span><button type="button" data-to="bottom">Move here</button></div>';
    var n = sectionCount();
    if (n) {
      rows += '<div class="vsel-move-sub">Sections</div>';
      for (var k = 0; k < n; k++) {
        rows += '<div class="vsel-move-row"><span>' + esc(sectionLabel(k)) + '</span>'
          + '<button type="button" data-to="section-start" data-k="' + k + '" aria-label="Start of ' + esc(sectionLabel(k)) + '">Start</button>'
          + '<button type="button" data-to="section-end" data-k="' + k + '" aria-label="End of ' + esc(sectionLabel(k)) + '">End</button></div>';
      }
    }
    openSheet('<h2 id="vsel-h">Move ' + esc(plural(urls.length)) + '</h2>'
      + '<p>They stay together, in the order they are in now.</p>'
      + '<div class="vsel-moves">' + rows + '</div>'
      + '<div class="vsel-actions"><button type="button" class="vsel-cancel">Cancel</button></div>', function (s) {
      s.querySelector('.vsel-cancel').addEventListener('click', closeSheet);
      Array.prototype.forEach.call(s.querySelectorAll('[data-to]'), function (b) {
        b.addEventListener('click', function () {
          var to = { where: b.dataset.to };
          if (b.dataset.k != null) to.section = Number(b.dataset.k);
          closeSheet();
          move(urls, to);
        });
      });
    });
  }
  function move(urls, to) {
    if (busy) return;
    withKey(function () {
      dismissToast();
      var before = model;
      var next = reorderModel(model, urls, to);
      if (next === model || sameOrder(next, model)) { toast('Already there.'); return; }
      model = next;
      renderOrder();                        // show it now; put it back if the save fails
      setBusy(true);
      VaultAdmin.post({ slug: slug, action: 'reorder', urls: urls, to: to }).then(function (res) {
        setBusy(false);
        if (!res.ok) {
          model = before; renderOrder();
          toast(failText(res, 'Nothing was moved'), null, null, true);
          return;
        }
        // The site and the worker deploy separately, and a worker from before
        // this feature treats an unknown action as "add" — which dedupes and
        // answers 200 having moved nothing. Only a worker that knows 'reorder'
        // reports `moved`.
        if (!res.data || typeof res.data.moved !== 'number') {
          model = before; renderOrder();
          toast('The worker has not picked up this update yet — nothing was moved. Try again in a minute.', null, null, true);
          return;
        }
        noteMoved(urls, to);
        toast('Moved ' + plural(urls.length) + describe(to) + '.', 'Show', function () { reveal(urls[0]); });
      }, function () {
        setBusy(false);
        model = before; renderOrder();
        toast('Could not reach the worker — nothing was moved.', null, null, true);
      });
    });
  }

  // ── Go ────────────────────────────────────────────────────
  mo.observe(body, { childList: true });
  checkReady(false);
})();
