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

  var frag = document.createDocumentFragment();
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

  items.forEach(function (it, idx) {
    if (divByIndex[idx] !== undefined) {
      var div = document.createElement('div');
      div.className = 'vs-divider';
      div.textContent = divByIndex[idx];
      frag.appendChild(div);
    }
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
    tile.addEventListener('click', function () { openLightbox(idx); });
    frag.appendChild(tile);
    posterObserver.observe(tile);
  });
  body.insertBefore(frag, lightbox);

  // ── Lightbox ─────────────────────────────────────────────
  var favApi = window.Favourites ? window.Favourites.initSection(mount, { type: 'video', platterEl: platter }) : null;
  var videoWrap = mount.querySelector('.vs-lb-video-wrap');
  setToggle(btnLoop, loopMode); setToggle(btnAuto, autoMode);
  setToggle(btnShuffle, shuffleMode); setToggle(btnTimer, timerMode);
  VaultLB.swipe(lightbox, function () { step(-1); }, function () { step(1); });
  VaultLB.initScrollTop();
  VaultLB.initJumpNav([].slice.call(body.querySelectorAll('.vs-divider')));
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
