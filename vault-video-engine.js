(function () {
  var mount = document.querySelector('[data-vault-video]');
  if (!mount) return;
  var slug = mount.getAttribute('data-vault-video');

  // Parse the v3-format globals from /data/<slug>.js:
  // SOURCES entries are URL strings, {url,start,end} objects, or null (section break).
  var RAW = (typeof SOURCES !== 'undefined') ? SOURCES : [];
  var LABELS = (typeof DIV_LABELS !== 'undefined') ? DIV_LABELS : [];
  var items = [];
  var dividers = [];
  var divCount = 0;
  RAW.forEach(function (s) {
    if (s === null) {
      dividers.push({ atIndex: items.length, label: LABELS[divCount] || ('Part ' + (divCount + 1)) });
      divCount++;
      return;
    }
    if (typeof s === 'string') items.push({ url: s });
    else items.push({ url: s.url, start: s.start != null ? s.start : null, end: s.end != null ? s.end : null });
  });

  var body = mount.querySelector('.vs-body');
  var lightbox = mount.querySelector('.vs-lightbox');
  var backdrop = mount.querySelector('.vs-backdrop');
  var lbVideo = mount.querySelector('.vs-lb-video');
  var lbClose = mount.querySelector('.vs-lb-close');
  var lbPrev = mount.querySelector('.vs-lb-prev');
  var lbNext = mount.querySelector('.vs-lb-next');
  var counter = mount.querySelector('.vs-lb-counter');
  var platter = mount.querySelector('.vs-lb-platter');
  var btnShuffle = mount.querySelector('.vs-btn-shuffle');
  var btnLoop = mount.querySelector('.vs-btn-loop');
  var btnAuto = mount.querySelector('.vs-btn-auto');
  var btnTimer = mount.querySelector('.vs-btn-timer');
  var btnFullscreen = mount.querySelector('.vs-btn-fullscreen');

  function attachVideoSrc(videoEl, url) {
    if (videoEl.__hls) { try { videoEl.__hls.destroy(); } catch (e) {} videoEl.__hls = null; }
    var isHls = /\.m3u8(\?|$)/i.test(url);
    if (!isHls) { videoEl.src = url; return; }
    if (videoEl.canPlayType('application/vnd.apple.mpegurl')) { videoEl.src = url; return; }
    if (window.Hls && window.Hls.isSupported()) {
      var hls = new window.Hls({ maxBufferLength: 30, maxMaxBufferLength: 60 });
      hls.on(window.Hls.Events.ERROR, function (evt, data) {
        if (!data.fatal) return;
        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else { try { hls.destroy(); } catch (e) {} videoEl.__hls = null; }
      });
      hls.loadSource(url);
      hls.attachMedia(videoEl);
      videoEl.__hls = hls;
    } else {
      videoEl.src = url;
    }
  }

  // ── Poster capture at the 1.3s mark (trim-aware) ───────────
  function posterTime(it) { return (it.start || 0) + 1.3; }

  var divByIndex = {};
  dividers.forEach(function (d) { divByIndex[d.atIndex] = d.label; });

  var posterObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var tile = entry.target;
      if (!entry.isIntersecting) return;
      posterObserver.unobserve(tile);
      var idx = Number(tile.dataset.vi);
      var it = items[idx];
      var img = tile.querySelector('img');
      VaultPosters.load(it.url, posterTime(it), function (dataUrl) {
        if (dataUrl) { img.src = dataUrl; img.style.display = 'block'; }
        tile.classList.remove('loading');
      });
    });
  }, { rootMargin: '600px' });

  // ── Filter bar ───────────────────────────────────────────
  // Scrolling is the only way through a long collection otherwise.
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
    + '.cs-none{color:rgba(255,255,255,.45);font-size:.9rem;padding:22px 0;}'
    + '.vs-tile{position:relative;}'
    + '.vs-clip-badge{position:absolute;right:6px;bottom:6px;z-index:2;'
    + 'padding:2px 6px;border-radius:5px;font-size:11px;line-height:1.4;'
    + 'font-variant-numeric:tabular-nums;color:#fff;background:rgba(0,0,0,.72);'
    + 'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);'
    + 'pointer-events:none;letter-spacing:.02em;}'
    // A blank tile reads as broken; a moving one reads as loading.
    + '.vs-tile.loading{background:linear-gradient(100deg,'
    + 'rgba(255,255,255,.04) 30%,rgba(255,255,255,.09) 50%,rgba(255,255,255,.04) 70%);'
    + 'background-size:220% 100%;animation:cs-shimmer 1.4s ease-in-out infinite;}'
    + '@keyframes cs-shimmer{from{background-position:180% 0}to{background-position:-40% 0}}'
    + '@media (prefers-reduced-motion:reduce){.vs-tile.loading{animation:none;}}'
    // Known-dead links stay clickable — the log can be stale, so judge for yourself.
    + '.vs-tile.cs-dead{opacity:.4;}'
    + '.vs-dead-badge{position:absolute;left:6px;bottom:6px;z-index:2;padding:2px 6px;'
    + 'border-radius:5px;font-size:10px;letter-spacing:.04em;text-transform:uppercase;'
    + 'color:#ff8d97;background:rgba(255,77,94,.18);pointer-events:none;}'
    // UI-06 density
    + '.cs-density{display:flex;gap:3px;flex:0 0 auto;}'
    + '.cs-density button{padding:6px 8px;border-radius:7px;cursor:pointer;font:inherit;'
    + 'font-size:.8rem;line-height:1;color:rgba(255,255,255,.45);'
    + 'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);}'
    + '.cs-density button.on{color:#000;background:#fff;border-color:#fff;}'
    // Grid columns are driven by a min tile width, so this stays responsive.
    + '.cs-d-lg .vs-body,.cs-d-lg .is-body{grid-template-columns:repeat(auto-fill,minmax(220px,1fr))!important;}'
    + '.cs-d-md .vs-body,.cs-d-md .is-body{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))!important;}'
    + '.cs-d-sm .vs-body,.cs-d-sm .is-body{grid-template-columns:repeat(auto-fill,minmax(100px,1fr))!important;}'
    // UI-04 sticky section heading
    + '.vs-divider,.is-divider{position:sticky;top:0;z-index:3;'
    + 'background:var(--v-bg,#07070a);padding-top:10px;padding-bottom:6px;}';
  document.head.appendChild(filterStyle);

  // ── Known-dead links ─────────────────────────────────────
  // thumbs-failures.log lists what the generator could not fetch. Marking those
  // tiles explains a broken-looking thumbnail instead of leaving you guessing.
  var deadSet = null;
  fetch('/health/thumbs-failures.log', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.text() : ''; })
    .then(function (txt) {
      if (!txt) return;
      deadSet = new Set(txt.split('\n').map(function (l) { return l.split('\t')[0]; }).filter(Boolean));
      markDead();
    })
    .catch(function () {});

  function markDead() {
    if (!deadSet) return;
    var tiles = body.querySelectorAll('.vs-tile:not(.cs-checked)');
    for (var i = 0; i < tiles.length; i++) {
      tiles[i].classList.add('cs-checked');
      var it = items[Number(tiles[i].dataset.vi)];
      if (it && deadSet.has(it.url)) {
        tiles[i].classList.add('cs-dead');
        var b = document.createElement('span');
        b.className = 'vs-dead-badge';
        b.textContent = 'dead?';
        tiles[i].appendChild(b);
      }
    }
  }

  var bar = document.createElement('div');
  bar.className = 'cs-filter';
  bar.innerHTML = '<input type="search" id="cs-q" placeholder="Filter this collection…" '
    + 'autocomplete="off" spellcheck="false" aria-label="Filter this collection">'
    + '<span class="cs-count" id="cs-count"></span>'
    + '<div class="cs-density" role="group" aria-label="Tile size">'
    + '<button type="button" data-d="lg" title="Large tiles">▢</button>'
    + '<button type="button" data-d="md" title="Medium tiles">▦</button>'
    + '<button type="button" data-d="sm" title="Small tiles">▩</button>'
    + '</div>';
  var noneMsg = document.createElement('div');
  noneMsg.className = 'cs-none cs-hidden';
  noneMsg.textContent = 'Nothing here matches that.';
  body.parentNode.insertBefore(bar, body);
  body.parentNode.insertBefore(noneMsg, body);

  var qInput = bar.querySelector('#cs-q');
  var countEl = bar.querySelector('#cs-count');
  var query = '';

  function applyFilter() {
    var q = query;
    var shown = 0;
    var tiles = body.querySelectorAll('.vs-tile');
    for (var i = 0; i < tiles.length; i++) {
      var it = items[Number(tiles[i].dataset.vi)];
      var hit = !q || (it && it.url.toLowerCase().indexOf(q) !== -1);
      tiles[i].classList.toggle('cs-hidden', !hit);
      if (hit) shown++;
    }
    // Section headings are meaningless once the list is filtered.
    var divs = body.querySelectorAll('.vs-divider');
    for (var d = 0; d < divs.length; d++) divs[d].classList.toggle('cs-hidden', !!q);
    countEl.textContent = q ? shown + ' of ' + items.length : '';
    noneMsg.classList.toggle('cs-hidden', !(q && shown === 0));
  }
  qInput.addEventListener('input', function () {
    query = qInput.value.trim().toLowerCase();
    applyFilter();
  });

  // ── Tile density ─────────────────────────────────────────
  // One fixed tile size suits a phone or a desktop, not both.
  var D_KEY = 'vault-density';
  function setDensity(d) {
    var root = document.documentElement;
    root.classList.remove('cs-d-lg', 'cs-d-md', 'cs-d-sm');
    root.classList.add('cs-d-' + d);
    bar.querySelectorAll('.cs-density button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.d === d);
    });
    try { localStorage.setItem(D_KEY, d); } catch (e) {}
  }
  var startD = 'md';
  try { startD = localStorage.getItem(D_KEY) || 'md'; } catch (e) {}
  setDensity(startD);
  bar.querySelectorAll('.cs-density button').forEach(function (b) {
    b.addEventListener('click', function () { setDensity(b.dataset.d); });
  });

  // ── Filmstrip (UI-08) ────────────────────────────────────
  // Stepping one at a time was the only way to move around inside the lightbox.
  // Reuses the poster each tile already generated, so it costs no new decoding.
  var stripStyle = document.createElement('style');
  stripStyle.textContent =
    '.vs-strip{position:absolute;left:0;right:0;bottom:0;z-index:5;display:flex;gap:6px;'
    + 'padding:10px 12px;overflow-x:auto;scrollbar-width:none;'
    + 'background:linear-gradient(to top,rgba(0,0,0,.82),rgba(0,0,0,0));}'
    + '.vs-strip::-webkit-scrollbar{display:none;}'
    + '.vs-strip img{height:52px;width:auto;min-width:34px;border-radius:5px;cursor:pointer;'
    + 'object-fit:cover;opacity:.45;transition:opacity .15s ease,outline-color .15s ease;'
    + 'outline:2px solid transparent;outline-offset:-2px;background:rgba(255,255,255,.07);}'
    + '.vs-strip img:hover{opacity:.8;}'
    + '.vs-strip img.on{opacity:1;outline-color:#fff;}'
    + '@media (max-width:600px){.vs-strip img{height:40px;}}';
  document.head.appendChild(stripStyle);

  var strip = document.createElement('div');
  strip.className = 'vs-strip';
  var stripBuilt = false;
  if (videoWrapEl()) videoWrapEl().appendChild(strip);

  function videoWrapEl() { return mount.querySelector('.vs-lb-video-wrap'); }

  function paintStrip(idx) {
    if (!strip.isConnected) {
      var w = videoWrapEl();
      if (!w) return;
      w.appendChild(strip);
    }
    // Build once, lazily — a 1,900-item strip would be absurd, so window it.
    var RADIUS = 25;
    var from = Math.max(0, idx - RADIUS);
    var to = Math.min(items.length, idx + RADIUS + 1);
    if (!stripBuilt || strip.dataset.from != from || strip.dataset.to != to) {
      strip.dataset.from = from; strip.dataset.to = to;
      strip.innerHTML = '';
      for (var i = from; i < to; i++) {
        (function (n) {
          var tile = body.querySelector('.vs-tile[data-vi="' + n + '"]');
          var src = tile && tile.querySelector('img') && tile.querySelector('img').src;
          var im = document.createElement('img');
          im.alt = '';
          im.loading = 'lazy';
          if (src && src.indexOf('data:') === 0) im.src = src;
          im.dataset.n = n;
          im.addEventListener('click', function (e) { e.stopPropagation(); openLightbox(n); });
          strip.appendChild(im);
        })(i);
      }
      stripBuilt = true;
    }
    strip.querySelectorAll('img').forEach(function (im) {
      var on = Number(im.dataset.n) === idx;
      im.classList.toggle('on', on);
      if (on) im.scrollIntoView({ block: 'nearest', inline: 'center' });
    });
  }

  function onGridComplete() {
    VaultLB.initJumpNav([].slice.call(body.querySelectorAll('.vs-divider')));
    if (query) applyFilter();
  }

  function buildTile(it, idx) {
    var tile = document.createElement('div');
    tile.className = 'vs-tile loading';
    tile.dataset.vi = idx;
    tile.dataset.favUrl = it.url;
    if (it.start) tile.dataset.favStart = it.start;
    if (it.end) tile.dataset.favEnd = it.end;

    var img = document.createElement('img');
    img.alt = ''; img.style.display = 'none';
    var overlay = document.createElement('div');
    overlay.className = 'vs-play-overlay';
    overlay.innerHTML = '<svg viewBox="0 0 80 80" fill="none"><polygon points="28,20 64,40 28,60" fill="white"/></svg>';
    tile.append(img, overlay);

    // A trimmed clip is indistinguishable from a full video in the grid, so
    // say how long it runs — or where it starts, when there is no end.
    if (it.start != null || it.end != null) {
      var badge = document.createElement('span');
      badge.className = 'vs-clip-badge';
      badge.textContent = (it.end != null)
        ? clock(it.end - (it.start || 0))
        : '› ' + clock(it.start);
      tile.appendChild(badge);
    }

    tile.addEventListener('click', function () { openLightbox(idx); });
    return tile;
  }

  function clock(secs) {
    secs = Math.max(0, Math.round(secs));
    var h = Math.floor(secs / 3600);
    var m = Math.floor((secs % 3600) / 60);
    var s = secs % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m))
      + ':' + String(s).padStart(2, '0');
  }

  // Build in chunks across frames rather than all at once. The largest
  // collection is ~1,900 tiles, and constructing every node up front delays
  // first paint on a phone for no benefit — nothing below the fold is visible.
  var scroller = window.VaultScroll ? VaultScroll.init(slug) : null;
  var CHUNK = 200;
  function renderChunk(start) {
    var frag = document.createDocumentFragment();
    var end = Math.min(start + CHUNK, items.length);
    for (var idx = start; idx < end; idx++) {
      if (divByIndex[idx] !== undefined) {
        var div = document.createElement('div');
        div.className = 'vs-divider';
        div.textContent = divByIndex[idx];
        frag.appendChild(div);
      }
      var tile = buildTile(items[idx], idx);
      frag.appendChild(tile);
      posterObserver.observe(tile);
    }
    body.insertBefore(frag, lightbox);
    // Tiles can arrive while a filter is already typed.
    if (query) applyFilter();
    markDead();
    if (scroller) scroller.reachedTarget();
    // setTimeout, not requestAnimationFrame: rAF stops firing in a background
    // or throttled tab, which would leave the grid permanently half-built.
    if (end < items.length) {
      setTimeout(function () { renderChunk(end); }, 0);
    } else {
      onGridComplete();
    }
  }
  renderChunk(0);

  // ── Lightbox ─────────────────────────────────────────────
  var favApi = window.Favourites ? window.Favourites.initSection(mount, { type: 'video', platterEl: platter }) : null;
  var videoWrap = mount.querySelector('.vs-lb-video-wrap');
  setToggle(btnLoop, loopMode); setToggle(btnAuto, autoMode);
  setToggle(btnShuffle, shuffleMode); setToggle(btnTimer, timerMode);
  VaultLB.swipe(lightbox, function () { step(-1); }, function () { step(1); });
  VaultLB.initScrollTop();
  lbVideo.addEventListener('playing', function () { VaultLB.loading(videoWrap, false); startAdv(); });
  lbVideo.addEventListener('waiting', function () { VaultLB.loading(videoWrap, true); pauseAdv(); });
  lbVideo.addEventListener('pause', function () { pauseAdv(); });
  var current = -1;
  var loopMode = VaultLB.getMode('loop');
  var autoMode = VaultLB.getMode('auto');
  var shuffleMode = VaultLB.getMode('shuffle');
  var timerMode = VaultLB.getMode('timer');
  var TIMER_SECS = 12;
  var advTimer = null, advRemaining = 0, advStartedAt = 0;

  function clearAdv() { if (advTimer) { clearTimeout(advTimer); advTimer = null; } }
  // Reset the 12s budget for a new clip; it starts counting on 'playing'.
  function resetAdv() { clearAdv(); advRemaining = TIMER_SECS * 1000; advStartedAt = 0; }
  function startAdv() {
    if (!timerMode || advTimer || current < 0 || advRemaining <= 0) return;
    advStartedAt = Date.now();
    advTimer = setTimeout(function () { advTimer = null; step(1); }, advRemaining);
  }
  function pauseAdv() {
    if (!advTimer) return;
    advRemaining -= Date.now() - advStartedAt;
    clearAdv();
  }

  function setToggle(btn, on) { if (btn) btn.classList.toggle('vs-toggled', on); }

  function openLightbox(idx) {
    current = idx;
    var it = items[idx];
    VaultLB.loading(videoWrap, true);
    attachVideoSrc(lbVideo, proxyUrl(it.url));
    lbVideo.currentTime = it.start || 0;
    lbVideo.play().catch(function () {});
    lightbox.style.display = 'flex';
    VaultLB.lock(true);
    counter.textContent = (idx + 1) + ' / ' + items.length;
    paintStrip(idx);
    if (favApi) favApi.setCurrent({ url: it.url, slug: slug, type: 'video', start: it.start, end: it.end });
    resetAdv(); // 12s budget starts counting once the video is actually playing
  }
  function closeLightbox() {
    lightbox.style.display = 'none';
    VaultLB.lock(false);
    clearAdv();
    lbVideo.pause();
    if (lbVideo.__hls) { try { lbVideo.__hls.destroy(); } catch (e) {} }
    lbVideo.removeAttribute('src'); lbVideo.load();
  }
  function nextIndex(delta) {
    if (shuffleMode && items.length > 1) {
      var n;
      do { n = Math.floor(Math.random() * items.length); } while (n === current);
      return n;
    }
    return (current + delta + items.length) % items.length;
  }
  function step(delta) {
    if (current < 0) return;
    openLightbox(nextIndex(delta));
  }
  function restartCurrent() {
    var it = items[current];
    lbVideo.currentTime = it.start || 0;
    lbVideo.play().catch(function () {});
  }
  function onClipEnd() {
    if (loopMode) restartCurrent();
    else if (autoMode) step(1);
    // else: stop on the last frame, user decides
  }

  // Trim end: treat as clip end
  lbVideo.addEventListener('timeupdate', function () {
    if (current < 0) return;
    var it = items[current];
    if (it.end && lbVideo.currentTime >= it.end) onClipEnd();
  });
  // Natural end of file
  lbVideo.addEventListener('ended', function () {
    if (current < 0) return;
    onClipEnd();
  });

  lbClose.addEventListener('click', closeLightbox);
  backdrop && backdrop.addEventListener('click', closeLightbox);
  lbPrev.addEventListener('click', function () { step(-1); });
  lbNext.addEventListener('click', function () { step(1); });
  if (btnShuffle) btnShuffle.addEventListener('click', function () { shuffleMode = !shuffleMode; setToggle(btnShuffle, shuffleMode); VaultLB.setMode('shuffle', shuffleMode); });
  if (btnLoop) btnLoop.addEventListener('click', function () {
    loopMode = !loopMode;
    if (loopMode) { autoMode = false; setToggle(btnAuto, false); VaultLB.setMode('auto', false); }
    setToggle(btnLoop, loopMode);
    VaultLB.setMode('loop', loopMode);
  });
  if (btnTimer) btnTimer.addEventListener('click', function () {
    timerMode = !timerMode;
    if (timerMode) { autoMode = false; setToggle(btnAuto, false); VaultLB.setMode('auto', false); }
    setToggle(btnTimer, timerMode);
    VaultLB.setMode('timer', timerMode);
    if (timerMode) { resetAdv(); if (!lbVideo.paused && lightbox.style.display === 'flex') startAdv(); }
    else clearAdv();
  });
  if (btnAuto) btnAuto.addEventListener('click', function () {
    autoMode = !autoMode;
    if (autoMode) {
      loopMode = false; setToggle(btnLoop, false); VaultLB.setMode('loop', false);
      timerMode = false; setToggle(btnTimer, false); VaultLB.setMode('timer', false); clearAdv();
    }
    setToggle(btnAuto, autoMode);
    VaultLB.setMode('auto', autoMode);
  });
  if (btnFullscreen) btnFullscreen.addEventListener('click', function () { lbVideo.requestFullscreen && lbVideo.requestFullscreen(); });

  document.addEventListener('keydown', function (e) {
    if (lightbox.style.display !== 'flex') return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'l' || e.key === 'L') { btnLoop && btnLoop.click(); }
    else if (e.key === 'a' || e.key === 'A') { btnAuto && btnAuto.click(); }
    else if (e.key === 't' || e.key === 'T') { btnTimer && btnTimer.click(); }
    else if (e.key === 's' || e.key === 'S') { btnShuffle && btnShuffle.click(); }
    else if (e.key === 'f' || e.key === 'F') { btnFullscreen && btnFullscreen.click(); }
  });

  try {
    var live = JSON.parse(localStorage.getItem('vault-counts') || '{}');
    if (live[slug] !== items.length) { live[slug] = items.length; localStorage.setItem('vault-counts', JSON.stringify(live)); }
  } catch (e) {}
})();
