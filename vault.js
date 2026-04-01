// Replace this with your deployed worker URL (no trailing slash)
var PROXY = 'https://young-truth-052a.kiluconsta.workers.dev';

var PROXY_HOSTS = ['twimg.com', 'video.twimg.com', 'coomer.st', 'redgifs.com', 'tumblr.com', 'lpsg.com', 'rule34.xxx', 'cartoonsworld.vip', 'monstercockland.com'];

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

var home  = document.getElementById('home');
var tiles = document.querySelectorAll('.home-tile');

tiles.forEach(function(tile) {
  tile.addEventListener('click', function() {
    var id  = tile.dataset.sec;
    var sec = document.getElementById(id);
    home.style.display = 'none';
    sec.style.display  = 'block';
    sec.classList.add('fade-in');
    window.scrollTo(0, 0);
    if (typeof sec.__lazyInit === 'function') {
      sec.__lazyInit();
      sec.__lazyInit = null;
    }
  });
});

function showHome() {
  document.querySelectorAll('.content-section').forEach(function(s) {
    s.style.display = 'none';
    s.classList.remove('fade-in');
  });
  home.style.display = 'flex';
  window.scrollTo(0, 0);
}
