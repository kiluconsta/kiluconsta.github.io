(function () {
  var mount = document.querySelector('[data-vault-image]');
  if (!mount) return;
  var slug = mount.getAttribute('data-vault-image');

  // IMGS comes from /data/<slug>.js — plain URL strings; nulls are ignored.
  var RAW = (typeof IMGS !== 'undefined') ? IMGS : [];
  var items = RAW.filter(Boolean).map(function (u) {
    return typeof u === 'string' ? { url: u } : { url: u.url };
  });

  var body = mount.querySelector('.is-body');
  var lightbox = mount.querySelector('.is-lightbox');
  var lbImg = mount.querySelector('.is-lb-img');
  var lbClose = mount.querySelector('.is-lb-close');
  var lbPrev = mount.querySelector('.is-lb-prev');
  var lbNext = mount.querySelector('.is-lb-next');
  var controls = mount.querySelector('.is-lb-controls');

  function isGif(url) { return /\.gif(\?|$)/i.test(url); }
  function tumblrResize(url, size) {
    return url.replace(/\/s\d+x\d+(?:_c\d+)?\//, '/s' + size + 'x' + size + '/');
  }
  function thumbURL(url) {
    if (/googleusercontent\.com/.test(url)) return url.replace(/=[^/]+$/, '=w50-h50-c');
    // Tumblr's /sWxH/ path segment is dynamic resizing — safe to rewrite.
    if (/media\.tumblr\.com/.test(url) && /\/s\d+x\d+/.test(url)) {
      return tumblrResize(url, isGif(url) ? 100 : 250);
    }
    return url;
  }
  // Tile source priority for GIFs: pre-generated static 100px first-frame
  // (kills animation decode in the grid) → small animated rewrite → original.
  function setTileSrc(img, url) {
    var fallback = proxyUrl(thumbURL(url));
    img.onerror = function () {
      img.onerror = null; // one-time swap, no loop
      img.src = proxyUrl(url);
    };
    if (isGif(url) && window.VaultPosters && VaultPosters.thumbFor) {
      VaultPosters.thumbFor(url, 0).then(function (staticThumb) {
        img.src = staticThumb || fallback;
      });
    } else {
      img.src = fallback;
    }
  }

  // ── Filter bar ───────────────────────────────────────────
  var filterStyle = document.createElement('style');
  filterStyle.textContent =
    '.cs-hidden{display:none!important}'
    + '.cs-filter{display:flex;align-items:center;gap:10px;margin:0 0 14px;}'
    + '.cs-filter input{flex:1;min-width:0;padding:9px 12px;border-radius:9px;'
    + 'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);'
    + 'color:#fff;font:inherit;font-size:.9rem;}'
    + '.cs-filter input:focus{outline:none;border-color:rgba(255,255,255,.4);}'
    + '.cs-count{font-size:.78rem;color:rgba(255,255,255,.4);white-space:nowrap;'
    + 'font-variant-numeric:tabular-nums;}'
    + '.cs-none{color:rgba(255,255,255,.45);font-size:.9rem;padding:22px 0;}';
  document.head.appendChild(filterStyle);

  var bar = document.createElement('div');
  bar.className = 'cs-filter';
  bar.innerHTML = '<input type="search" id="cs-q" placeholder="Filter this collection…" '
    + 'autocomplete="off" spellcheck="false" aria-label="Filter this collection">'
    + '<span class="cs-count" id="cs-count"></span>';
  var noneMsg = document.createElement('div');
  noneMsg.className = 'cs-none cs-hidden';
  noneMsg.textContent = 'Nothing here matches that.';
  body.parentNode.insertBefore(bar, body);
  body.parentNode.insertBefore(noneMsg, body);

  var qInput = bar.querySelector('#cs-q');
  var countEl = bar.querySelector('#cs-count');
  var query = '';

  function applyFilter() {
    var q = query, shown = 0;
    var tiles = body.querySelectorAll('.is-tile');
    for (var i = 0; i < tiles.length; i++) {
      var hit = !q || tiles[i].dataset.favUrl.toLowerCase().indexOf(q) !== -1;
      tiles[i].classList.toggle('cs-hidden', !hit);
      if (hit) shown++;
    }
    countEl.textContent = q ? shown + ' of ' + items.length : '';
    noneMsg.classList.toggle('cs-hidden', !(q && shown === 0));
  }
  qInput.addEventListener('input', function () {
    query = qInput.value.trim().toLowerCase();
    applyFilter();
  });

  // Chunked build so a 800-image collection paints immediately.
  var CHUNK = 200;
  function renderChunk(start) {
    var frag = document.createDocumentFragment();
    var end = Math.min(start + CHUNK, items.length);
    for (var idx = start; idx < end; idx++) {
      (function (it, i) {
        var tile = document.createElement('div');
        tile.className = 'is-tile';
        tile.dataset.favUrl = it.url;
        var img = document.createElement('img');
        img.loading = 'lazy';
        img.alt = '';
        setTileSrc(img, it.url);
        tile.appendChild(img);
        tile.addEventListener('click', function () { openLightbox(i); });
        frag.appendChild(tile);
      })(items[idx], idx);
    }
    body.insertBefore(frag, lightbox);
    if (query) applyFilter();
    // setTimeout, not requestAnimationFrame: rAF stops firing in a background
    // or throttled tab, which would leave the grid permanently half-built.
    if (end < items.length) setTimeout(function () { renderChunk(end); }, 0);
  }
  renderChunk(0);

  var favApi = window.Favourites ? window.Favourites.initSection(mount, { type: 'image', platterEl: controls }) : null;
  var imgWrap = mount.querySelector('.is-lb-img-wrap');
  VaultLB.swipe(lightbox, function () { step(-1); }, function () { step(1); });
  VaultLB.initScrollTop();
  lbImg.addEventListener('load', function () { VaultLB.loading(imgWrap, false); });
  var current = -1;
  var ssBtn = mount.querySelector('.is-btn-slideshow');
  var ssStatus = mount.querySelector('.is-ss-status');
  var ssTimer = null;

  function stopSlideshow() {
    if (ssTimer) { clearInterval(ssTimer); ssTimer = null; }
    if (ssBtn) ssBtn.classList.remove('vs-toggled');
    if (ssStatus) ssStatus.textContent = '';
  }
  function startSlideshow() {
    stopSlideshow();
    ssTimer = setInterval(function () { step(1); }, 3500);
    if (ssBtn) ssBtn.classList.add('vs-toggled');
    if (ssStatus) ssStatus.textContent = 'Slideshow';
  }
  if (ssBtn) ssBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (ssTimer) stopSlideshow(); else startSlideshow();
  });

  function openLightbox(idx) {
    current = idx;
    var it = items[idx];
    VaultLB.loading(imgWrap, true);
    lbImg.src = proxyUrl(it.url);
    lightbox.style.display = 'flex';
    VaultLB.lock(true);
    if (favApi) favApi.setCurrent({ url: it.url, slug: slug, type: 'image' });
    // Preload the next image so advancing feels instant
    if (items.length > 1) {
      var nx = new Image();
      nx.src = proxyUrl(items[(idx + 1) % items.length].url);
    }
  }
  function closeLightbox() { stopSlideshow(); lightbox.style.display = 'none'; VaultLB.lock(false); lbImg.removeAttribute('src'); }
  function step(delta) {
    if (current < 0) return;
    openLightbox((current + delta + items.length) % items.length);
  }

  lbClose.addEventListener('click', closeLightbox);
  var isBackdrop = mount.querySelector('.is-backdrop');
  isBackdrop && isBackdrop.addEventListener('click', closeLightbox);
  lbPrev.addEventListener('click', function () { step(-1); });
  lbNext.addEventListener('click', function () { step(1); });
  document.addEventListener('keydown', function (e) {
    if (lightbox.style.display !== 'flex') return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  });

  try {
    var live = JSON.parse(localStorage.getItem('vault-counts') || '{}');
    if (live[slug] !== items.length) { live[slug] = items.length; localStorage.setItem('vault-counts', JSON.stringify(live)); }
  } catch (e) {}
})();
