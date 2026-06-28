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

// ── Collection registry ───────────────────────────────────────
// Single source of truth for every collection: label, icon, accent,
// media type, and item count. The home grid, count badges, type
// filter, recently-viewed strip, and favourite tags are all driven
// from here. To add a collection: add an entry below in display order
// and create the matching pages/<slug>.html.
var COLLECTION_META = {
  "bomb-ass-dee":      { label: "Bomb Ass Dee",      icon: "💣",      accent: "#ff2d55", type: "video", count: 636 },
  "bomb-ass-dee-pt-2": { label: "Bomb Ass Dee Pt.2", icon: "💥",      accent: "#ff6b00", type: "video", count: 1113 },
  "bluesky-likes":     { label: "BlueSky Likes",     icon: "🦋",      accent: "#0085ff", type: "video", count: 249 },
  "coomer":            { label: "Coomer",            icon: "🍑",      accent: "#9b59b6", type: "video", count: 48 },
  "sandf":             { label: "S&F",               icon: "🔥",      accent: "#00ff9f", type: "image", count: 140 },
  "images":            { label: "Images",            icon: "🖼️",      accent: "#ffcc00", type: "image", count: 234 },
  "x-likes-long":      { label: "X Likes (Long)",    icon: "𝕏",       accent: "#1da1f2", type: "video", count: 531 },
  "meatsenpaii":       { label: "MeatSenpaii",       icon: "🥩",      accent: "#ff4757", type: "video", count: 2 },
  "x-likes-short":     { label: "X Likes (Short)",   icon: "⚡",      accent: "#00d2ff", type: "video", count: 299 },
  "tumblr":            { label: "Tumblr",            icon: "📐",      accent: "#ff6584", type: "image", count: 819 },
  "show-off":          { label: "Show Off",          icon: "✨",      accent: "#ffe66d", type: "image", count: 221 },
  "gifs":              { label: "GIFs",              icon: "🟢",      accent: "#a8ff78", type: "image", count: 54 },
  "animations":        { label: "Animations",        icon: "🦹🏾‍♂️",     accent: "#BF40BF", type: "video", count: 1906 },
  "dropbox":           { label: "Dropbox",           icon: "📥",      accent: "#FFFFFF", type: "video", count: 461 }
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

// ── Home: registry-driven grid + search + filter ──────────────
(function() {
  var grid = document.getElementById('home-grid');
  if (!grid) return;                       // home page only

  function fmtCount(n) {
    return n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'k' : String(n);
  }

  function buildTile(opts) {
    var tile = document.createElement('div');
    tile.className = 'home-tile' + (opts.fav ? ' is-fav-tile' : '');
    tile.dataset.slug  = opts.slug;
    tile.dataset.type  = opts.type || '';
    tile.dataset.label = (opts.label || '').toLowerCase();
    tile.style.setProperty('--accent', opts.accent || '#7c3cff');
    tile.tabIndex = 0;
    tile.setAttribute('role', 'link');
    tile.setAttribute('aria-label', opts.label);

    var html =
      '<div class="tile-glow"></div>' +
      '<div class="tile-icon">' + opts.icon + '</div>' +
      '<div class="tile-label">' + opts.label + '</div>' +
      '<div class="tile-bar"></div>';
    if (!opts.fav && opts.type) {
      html += '<div class="tile-type">' + (opts.type === 'video' ? 'Video' : 'Image') + '</div>';
    }
    tile.innerHTML = html;

    if (opts.count != null) {
      var badge = document.createElement('span');
      badge.className = 'tile-count';
      badge.textContent = fmtCount(opts.count);
      tile.appendChild(badge);
    }
    return tile;
  }

  // Favourites tile first
  grid.appendChild(buildTile({
    slug: 'favourites', label: 'Favourites', icon: '❤️',
    accent: '#ff375f', type: '', count: Favourites.count(), fav: true
  }));

  // Collection tiles (object key order == display order)
  Object.keys(COLLECTION_META).forEach(function(slug) {
    var m = COLLECTION_META[slug];
    grid.appendChild(buildTile({
      slug: slug, label: m.label, icon: m.icon, accent: m.accent,
      type: m.type, count: m.count, fav: false
    }));
  });

  var tiles = grid.querySelectorAll('.home-tile');
  tiles.forEach(function(t, i) { t.style.animationDelay = Math.min(i * 0.04, 0.6) + 's'; });

  // ── Navigation ──
  function go(slug) { if (slug) window.location.href = 'pages/' + slug + '.html'; }
  grid.addEventListener('click', function(e) {
    var t = e.target.closest('.home-tile'); if (t) go(t.dataset.slug);
  });
  grid.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var t = e.target.closest('.home-tile'); if (t) { e.preventDefault(); go(t.dataset.slug); }
  });

  // Prefetch collection page on hover/focus for instant navigation
  var prefetched = {};
  function prefetch(slug) {
    if (!slug || slug === 'favourites' || prefetched[slug]) return;
    prefetched[slug] = true;
    var l = document.createElement('link');
    l.rel = 'prefetch'; l.href = 'pages/' + slug + '.html';
    document.head.appendChild(l);
  }
  grid.addEventListener('mouseover', function(e) {
    var t = e.target.closest('.home-tile'); if (t) prefetch(t.dataset.slug);
  });
  grid.addEventListener('focusin', function(e) {
    var t = e.target.closest('.home-tile'); if (t) prefetch(t.dataset.slug);
  });

  // ── Search + type filter ──
  var searchInput = document.getElementById('vault-search');
  var searchWrap  = document.getElementById('home-search');
  var clearBtn    = document.getElementById('vault-search-clear');
  var emptyEl     = document.getElementById('home-empty');
  var filterBar   = document.getElementById('home-filter');
  var query = '';
  var typeFilter = 'all';

  function applyFilter() {
    var shown = 0;
    tiles.forEach(function(t) {
      var isFav = t.dataset.slug === 'favourites';
      var matchesType =
        typeFilter === 'all' ? true :
        isFav ? false :
        t.dataset.type === typeFilter;
      var matchesQuery = !query ||
        t.dataset.label.indexOf(query) !== -1 ||
        (isFav && 'favourites'.indexOf(query) !== -1);
      var visible = matchesType && matchesQuery;
      t.classList.toggle('hidden', !visible);
      if (visible) shown++;
    });
    if (emptyEl) emptyEl.classList.toggle('show', shown === 0);
  }

  if (searchInput) {
    searchInput.addEventListener('input', function() {
      query = searchInput.value.trim().toLowerCase();
      if (searchWrap) searchWrap.classList.toggle('has-text', query.length > 0);
      applyFilter();
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', function() {
      searchInput.value = ''; query = '';
      if (searchWrap) searchWrap.classList.remove('has-text');
      applyFilter(); searchInput.focus();
    });
  }
  if (filterBar) {
    filterBar.addEventListener('click', function(e) {
      var btn = e.target.closest('.home-filter-btn'); if (!btn) return;
      typeFilter = btn.dataset.filter;
      filterBar.querySelectorAll('.home-filter-btn').forEach(function(b) {
        b.classList.toggle('active', b === btn);
      });
      applyFilter();
    });
  }

  // Global shortcuts: "/" or Cmd/Ctrl+K focuses search; Esc clears
  document.addEventListener('keydown', function(e) {
    var typing = document.activeElement === searchInput;
    if ((e.key === '/' && !typing) ||
        ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
      e.preventDefault(); if (searchInput) searchInput.focus();
    } else if (e.key === 'Escape' && typing && searchInput.value) {
      searchInput.value = ''; query = '';
      if (searchWrap) searchWrap.classList.remove('has-text');
      applyFilter();
    }
  });

  // ── Recently viewed strip ──
  (function() {
    var recent;
    try { recent = JSON.parse(localStorage.getItem('vault-recent') || '[]'); }
    catch(e) { recent = []; }
    if (!recent.length) return;

    var row = document.createElement('div');
    row.className = 'recent-row';
    row.innerHTML = '<div class="recent-label">Recently viewed</div>';
    var strip = document.createElement('div');
    strip.className = 'recent-strip';

    recent.forEach(function(item) {
      var m = COLLECTION_META[item.slug];
      if (!m) return;
      var mini = document.createElement('div');
      mini.className = 'recent-tile';
      mini.dataset.slug = item.slug;
      mini.style.setProperty('--accent', m.accent);
      mini.innerHTML =
        '<span class="recent-icon">' + m.icon + '</span>' +
        '<span class="recent-name">' + m.label + '</span>';
      mini.addEventListener('click', function() { go(item.slug); });
      strip.appendChild(mini);
    });

    if (strip.children.length) {
      row.appendChild(strip);
      grid.parentNode.insertBefore(row, grid);
    }
  })();
})();

// ── Back button (called from inside page files) ───────────────
function showHome() {
  window.location.href = '/';
}

// ── Power management ──────────────────────────────────────────
// Pause CSS animations whenever the tab is hidden so a backgrounded
// tab stops consuming GPU/CPU.
(function() {
  function applyIdle() {
    document.documentElement.classList.toggle('power-idle', document.hidden);
  }
  document.addEventListener('visibilitychange', applyIdle);
  applyIdle();
})();
