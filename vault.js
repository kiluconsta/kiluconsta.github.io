// ── Proxy config ──────────────────────────────────────────────
var PROXY = 'https://young-truth-052a.kiluconsta.workers.dev';

var PROXY_HOSTS = [
  'twimg.com', 'video.twimg.com', 'coomer.st', 'redgifs.com',
  'tumblr.com', 'lpsg.com', 'rule34.xxx', 'cartoonsworld.vip',
  'monstercockland.com', 'gayforfuns.com', 'gff.network',
  'dropbox.com', 'dropboxusercontent.com', 'googleusercontent.com'
];

function proxyUrl(url) {
  if (!url || !PROXY) return url;
  url = normalizeDropbox(url);
  try {
    var host = new URL(url).hostname;
    var needsProxy = PROXY_HOSTS.some(function(h) {
      return host === h || host.endsWith('.' + h);
    });
    return needsProxy ? PROXY + '?url=' + encodeURIComponent(url) : url;
  } catch(e) { return url; }
}

// Dropbox share links (www.dropbox.com/...?dl=0) return an HTML preview
// page, not the file. Rewrite to the direct-content host with raw=1 so
// the <video> element receives actual bytes instead of a webpage.
function normalizeDropbox(url) {
  try {
    if (url.indexOf('dropbox.com') === -1) return url;
    var u = new URL(url);
    if (u.hostname === 'www.dropbox.com' || u.hostname === 'dropbox.com') {
      u.hostname = 'dl.dropboxusercontent.com';
    }
    u.searchParams.delete('dl');
    u.searchParams.set('raw', '1');
    return u.toString();
  } catch(e) { return url; }
}

// ── Slug helpers ──────────────────────────────────────────────
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/&amp;/g, 'and')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── Collection metadata ───────────────────────────────────────
// Single source of truth for collection display (label / icon / accent),
// keyed by slug. Used by collection pages (to record which collection a
// favourite belongs to) and by the favourites page (to render the
// hyperlink tag). Keep in sync with the home tiles in index.html.
var COLLECTION_META = {
  "bomb-ass-dee":      { label: "Bomb Ass Dee",      icon: "💣",      accent: "#ff2d55" },
  "bomb-ass-dee-pt-2": { label: "Bomb Ass Dee Pt.2", icon: "💥",      accent: "#ff6b00" },
  "bluesky-likes":     { label: "BlueSky Likes",     icon: "🦋",      accent: "#0085ff" },
  "coomer":            { label: "Coomer",            icon: "🍑",      accent: "#9b59b6" },
  "sandf":             { label: "S&F",               icon: "🔥",      accent: "#00ff9f" },
  "images":            { label: "Images",            icon: "🖼️",      accent: "#ffcc00" },
  "x-likes-long":      { label: "X Likes (Long)",    icon: "𝕏",       accent: "#1da1f2" },
  "meatsenpaii":       { label: "MeatSenpaii",       icon: "🥩",      accent: "#ff4757" },
  "x-likes-short":     { label: "X Likes (Short)",   icon: "⚡",      accent: "#00d2ff" },
  "tumblr":            { label: "Tumblr",            icon: "📐",      accent: "#5a31f4" },
  "show-off":          { label: "Show Off",          icon: "✨",      accent: "#ffd700" },
  "gifs":              { label: "GIFs",              icon: "🟢",      accent: "#2ecc71" },
  "animations":        { label: "Animations",        icon: "🦹🏾‍♂️",     accent: "#e056fd" },
  "dropbox":           { label: "Dropbox",           icon: "📥",      accent: "#0061ff" }
};

// ── Favourites store ──────────────────────────────────────────
// Persists a list of favourited media across all pages via localStorage.
// Each entry: { url, slug, type:'video'|'image', t:<ms> }. The raw media
// URL is the stable identity (same URL favourited from a duplicate tile
// toggles both). An in-memory Set keeps has()/refresh O(1) even when a
// page has thousands of tiles listening for changes.
var Favourites = (function() {
  var KEY = 'vault-favourites';
  var _list = null;
  var _set  = null;

  function load() {
    if (_list) return _list;
    try { _list = JSON.parse(localStorage.getItem(KEY) || '[]'); }
    catch(e) { _list = []; }
    if (!Array.isArray(_list)) _list = [];
    return _list;
  }
  function rebuildSet() { _set = new Set(load().map(function(x){ return x.url; })); }
  function getSet() { if (!_set) rebuildSet(); return _set; }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(_list)); } catch(e) {}
    rebuildSet();
  }

  function has(url) { return getSet().has(url); }
  function list()   { return load().slice(); }
  function count()  { return load().length; }

  function toggle(entry) {
    var l = load();
    var i = -1;
    for (var k = 0; k < l.length; k++) { if (l[k].url === entry.url) { i = k; break; } }
    var state;
    if (i >= 0) { l.splice(i, 1); state = false; }
    else {
      l.unshift({ url: entry.url, slug: entry.slug, type: entry.type, t: Date.now() });
      state = true;
    }
    save();
    document.dispatchEvent(new CustomEvent('vault-fav-change', { detail: { url: entry.url, state: state } }));
    return state;
  }

  // Keep multiple tabs in sync (and invalidate the cache on external writes)
  window.addEventListener('storage', function(e) {
    if (e.key !== KEY) return;
    _list = null; _set = null;
    document.dispatchEvent(new CustomEvent('vault-fav-change', { detail: { url: null, state: null } }));
  });

  var HEART_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 ' +
    '3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 ' +
    '6.86-8.55 11.54L12 21.35z"/></svg>';

  // Build a heart toggle button. getEntry() returns the entry this heart
  // currently controls (a function so a single platter heart can be
  // repointed at the current item). Hearts auto-sync via the change event.
  function makeHeart(getEntry, opts) {
    opts = opts || {};
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fav-heart';
    btn.setAttribute('aria-label', 'Toggle favourite');
    btn.innerHTML = HEART_SVG;

    function refresh() {
      var e = getEntry();
      var on = !!(e && e.url && has(e.url));
      btn.classList.toggle('is-fav', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    btn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      ev.preventDefault();
      var e = getEntry();
      if (!e || !e.url) return;
      toggle(e);
      refresh();
      btn.classList.remove('just-toggled');
      void btn.offsetWidth;            // restart the pop animation
      btn.classList.add('just-toggled');
      if (typeof opts.onToggle === 'function') opts.onToggle(e);
    });

    document.addEventListener('vault-fav-change', function(ev) {
      var e = getEntry();
      if (!e || !e.url) { refresh(); return; }
      if (!ev.detail || ev.detail.url === null || ev.detail.url === e.url) refresh();
    });

    btn.__refresh = refresh;
    refresh();
    return btn;
  }

  // Decorate a collection section: add a corner heart to every tile that
  // carries data-fav-url, plus an inline heart at the right end of the
  // lightbox controls. Returns { setCurrent(url) } for the page to call
  // whenever the active lightbox item changes.
  function initSection(sec, opts) {
    opts = opts || {};
    var slug = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
    var type = opts.type || 'video';

    sec.querySelectorAll('[data-fav-url]').forEach(function(tile) {
      if (tile.__favDone) return;
      tile.__favDone = true;
      var url = tile.getAttribute('data-fav-url');
      tile.appendChild(makeHeart(function() {
        return { url: url, slug: slug, type: type };
      }, { variant: 'tile' }));
    });

    var api = { setCurrent: function() {} };
    var bar = opts.platterEl;
    if (bar) {
      var curUrl = null;
      var heart = makeHeart(function() {
        return curUrl ? { url: curUrl, slug: slug, type: type } : null;
      }, { variant: 'inline' });
      if (bar.classList.contains('vs-lb-platter')) {
        var sep = document.createElement('div');
        sep.className = 'platter-sep';
        bar.appendChild(sep);
      }
      bar.appendChild(heart);
      api.setCurrent = function(url) { curUrl = url; if (heart.__refresh) heart.__refresh(); };
    }
    return api;
  }

  return {
    has: has, list: list, count: count, toggle: toggle,
    makeHeart: makeHeart, initSection: initSection, META: COLLECTION_META
  };
})();

var secIdToSlug = {};
var slugToTile  = {};

document.querySelectorAll('.home-tile').forEach(function(tile) {
  var secId   = tile.dataset.sec;
  var labelEl = tile.querySelector('.tile-label');
  if (secId && labelEl) {
    var slug = slugify(labelEl.textContent);
    secIdToSlug[secId] = slug;
    slugToTile[slug]   = tile;
  }
});

// ── Tile count badges ─────────────────────────────────────────
// Item counts per collection (update when adding/removing media)
var TILE_COUNTS = {
  "animations": 1906,
  "bluesky-likes": 249,
  "bomb-ass-dee-pt-2": 1113,
  "bomb-ass-dee": 636,
  "coomer": 48,
  "dropbox": 461,
  "gifs": 54,
  "images": 234,
  "meatsenpaii": 2,
  "sandf": 140,
  "show-off": 221,
  "tumblr": 819,
  "x-likes-long": 531,
  "x-likes-short": 299
};

Object.keys(slugToTile).forEach(function(slug) {
  var count = TILE_COUNTS[slug];
  if (!count) return;
  var badge = document.createElement('span');
  badge.className = 'tile-count';
  badge.textContent = count >= 1000 ? (count / 1000).toFixed(1).replace('.0','') + 'k' : count;
  slugToTile[slug].appendChild(badge);
});

// ── Favourites collection tile (first collection on the home grid) ──
(function() {
  var grid = document.querySelector('.home-grid');
  if (!grid) return;                          // home page only
  secIdToSlug['favourites'] = 'favourites';   // wire up delegated navigation

  var tile = document.createElement('div');
  tile.className = 'home-tile';
  tile.dataset.sec = 'favourites';
  tile.style.setProperty('--accent', '#ff375f');
  tile.innerHTML =
    '<div class="tile-glow"></div>' +
    '<div class="tile-icon">❤️</div>' +
    '<div class="tile-label">Favourites</div>' +
    '<div class="tile-bar"></div>';

  var n = Favourites.count();
  if (n > 0) {
    var badge = document.createElement('span');
    badge.className = 'tile-count';
    badge.textContent = n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'k' : n;
    tile.appendChild(badge);
  }

  grid.insertBefore(tile, grid.firstChild);
})();

// ── Recently viewed row ───────────────────────────────────────
(function() {
  var recent;
  try { recent = JSON.parse(localStorage.getItem('vault-recent') || '[]'); }
  catch(e) { recent = []; }
  if (!recent.length) return;

  var grid = document.querySelector('.home-grid');
  if (!grid) return;

  var row = document.createElement('div');
  row.className = 'recent-row';
  row.innerHTML = '<div class="recent-label">Recently viewed</div>';

  var strip = document.createElement('div');
  strip.className = 'recent-strip';

  recent.forEach(function(item) {
    var src = slugToTile[item.slug];
    if (!src) return;
    var mini = document.createElement('div');
    mini.className = 'recent-tile';
    mini.dataset.sec = src.dataset.sec;          // delegation handles click
    mini.style.setProperty('--accent', getComputedStyle(src).getPropertyValue('--accent'));
    var icon  = src.querySelector('.tile-icon');
    var label = src.querySelector('.tile-label');
    mini.innerHTML =
      '<span class="recent-icon">'  + (icon  ? icon.textContent  : '') + '</span>' +
      '<span class="recent-name">'  + (label ? label.textContent : '') + '</span>';
    strip.appendChild(mini);
  });

  if (strip.children.length) {
    row.appendChild(strip);
    grid.parentNode.insertBefore(row, grid);
  }
})();

// ── Navigation (event delegation — covers tiles + recent strip) ──
document.addEventListener('click', function(e) {
  var el = e.target.closest('[data-sec]');
  if (!el) return;
  var slug = secIdToSlug[el.dataset.sec];
  if (slug) window.location.href = 'pages/' + slug + '.html';
});

// ── Back button (called from inside page files) ───────────────
function showHome() {
  window.location.href = '/';
}

// ── Power management ──────────────────────────────────────────
// Pause CSS animations (background, shimmer) whenever the tab is
// hidden, so a backgrounded tab stops consuming GPU/CPU. This is
// the single biggest fix for the laptop heating up while idle.
(function() {
  function applyIdle() {
    document.documentElement.classList.toggle('power-idle', document.hidden);
  }
  document.addEventListener('visibilitychange', applyIdle);
  applyIdle();
})();
