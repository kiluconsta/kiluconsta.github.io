// ── Proxy config ──────────────────────────────────────────────
var PROXY = 'https://young-truth-052a.kiluconsta.workers.dev';

var PROXY_HOSTS = [
  'twimg.com', 'video.twimg.com', 'coomer.st', 'redgifs.com',
  'tumblr.com', 'lpsg.com', 'rule34.xxx', 'cartoonsworld.vip',
  'monstercockland.com', 'gayforfuns.com', 'dropbox.com'
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

// ── Slug helpers ──────────────────────────────────────────────
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/&amp;/g, 'and')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

var secIdToSlug = {};

document.querySelectorAll('.home-tile').forEach(function(tile) {
  var secId   = tile.dataset.sec;
  var labelEl = tile.querySelector('.tile-label');
  if (secId && labelEl) {
    secIdToSlug[secId] = slugify(labelEl.textContent);
  }
});

// ── Tile navigation ───────────────────────────────────────────
document.querySelectorAll('.home-tile').forEach(function(tile) {
  tile.addEventListener('click', function() {
    var slug = secIdToSlug[tile.dataset.sec];
    if (slug) window.location.href = 'pages/' + slug + '.html';
  });
});

// ── Back button (called from inside page files) ───────────────
function showHome() {
  window.location.href = '/';
}
