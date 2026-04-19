// ── Proxy config ─────────────────────────────────────────────────────────────
var PROXY = 'https://young-truth-052a.kiluconsta.workers.dev';

var PROXY_HOSTS = [
  'twimg.com', 'video.twimg.com', 'coomer.st', 'redgifs.com',
  'tumblr.com', 'lpsg.com', 'rule34.xxx', 'cartoonsworld.vip',
  'monstercockland.com', 'gayforfuns.com'
];

function proxyUrl(url) {
  if (!url || !PROXY) return url;
  try {
    var host = new URL(url).hostname;
    var needsProxy = PROXY_HOSTS.some(function(h) {
      return host === h || host.endsWith('.' + h);
    });
    return needsProxy ? PROXY + '?url=' + encodeURIComponent(url) : url;
  } catch(e) { return url; }
}

// ── Slug helpers ──────────────────────────────────────────────────────────────

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/&amp;/g, 'and')   // HTML entity
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-') // non-alphanumeric → hyphen
    .replace(/^-+|-+$/g, '');    // trim leading/trailing hyphens
}

// Build two-way maps at startup from the tile DOM:
//   secIdToSlug : { 'sec0': 'bomb-ass-dee', ... }
//   slugToSecId : { 'bomb-ass-dee': 'sec0', ... }
var secIdToSlug = {};
var slugToSecId = {};

document.querySelectorAll('.home-tile').forEach(function(tile) {
  var secId = tile.dataset.sec;
  var labelEl = tile.querySelector('.tile-label');
  if (!secId || !labelEl) return;
  var slug = slugify(labelEl.textContent);
  secIdToSlug[secId] = slug;
  slugToSecId[slug]  = secId;
});

// ── Router ────────────────────────────────────────────────────────────────────
// URLs:  kiluconsta.github.io/          → home
//        kiluconsta.github.io/#bomb-ass-dee → sec0
//        kiluconsta.github.io/#gifs         → sec11
// Works as direct links, refreshes, and browser back/forward.

var home  = document.getElementById('home');
var tiles = document.querySelectorAll('.home-tile');

// Navigate to a section by its secId ('sec0', etc.)
function showSection(secId, pushState) {
  var sec = document.getElementById(secId);
  if (!sec || !sec.classList.contains('content-section')) {
    showHomeView(false);
    return;
  }

  home.style.display = 'none';
  document.querySelectorAll('.content-section').forEach(function(s) {
    s.style.display = 'none';
    s.classList.remove('fade-in');
  });

  sec.style.display = 'block';
  sec.classList.add('fade-in');
  window.scrollTo(0, 0);

  if (typeof sec.__lazyInit === 'function') {
    sec.__lazyInit();
    sec.__lazyInit = null;
  }

  var slug = secIdToSlug[secId] || secId;

  if (pushState !== false) {
    history.pushState({ section: secId }, '', '#' + slug);
  }

  var tile  = document.querySelector('[data-sec="' + secId + '"]');
  var label = tile ? tile.querySelector('.tile-label') : null;
  document.title = (label ? label.textContent : secId) + ' — The Vault';
}

// Navigate home
function showHomeView(pushState) {
  document.querySelectorAll('.content-section').forEach(function(s) {
    var lb = s.querySelector('.vs-lightbox');
    if (lb && lb.style.display === 'flex') {
      lb.style.display = 'none';
      var v = lb.querySelector('video');
      if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    }
    s.style.display = 'none';
    s.classList.remove('fade-in');
  });

  home.style.display = 'flex';
  window.scrollTo(0, 0);
  document.title = 'The Vault';

  if (pushState !== false) {
    history.pushState({ section: 'home' }, '', location.pathname);
  }
}

// Called by back buttons inside sections: onclick="showHome()"
function showHome() {
  showHomeView(true);
}

// Tile click handlers
tiles.forEach(function(tile) {
  tile.addEventListener('click', function() {
    showSection(tile.dataset.sec, true);
  });
});

// Browser back / forward
window.addEventListener('popstate', function() {
  var slug = location.hash.replace('#', '');
  if (!slug || slug === 'home') {
    showHomeView(false);
  } else {
    // Resolve slug → secId, falling back to treating it as a raw secId
    var secId = slugToSecId[slug] || slug;
    showSection(secId, false);
  }
});

// Initial load — honour hash in URL (direct link or refresh)
(function() {
  var slug = location.hash.replace('#', '');
  if (slug && slug !== 'home') {
    var secId = slugToSecId[slug] || slug;
    var sec   = document.getElementById(secId);
    if (sec && sec.classList.contains('content-section')) {
      history.replaceState({ section: secId }, '', '#' + (secIdToSlug[secId] || secId));
      showSection(secId, false);
      return;
    }
  }
  history.replaceState({ section: 'home' }, '', location.pathname);
  showHomeView(false);
})();
