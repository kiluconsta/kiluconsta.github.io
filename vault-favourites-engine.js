(function () {
  var grid = document.getElementById('fav-grid');
  var emptyEl = document.getElementById('fav-empty');
  if (!grid) return;
  var META = window.COLLECTION_META || {};

  var lightbox = document.querySelector('.fav-lightbox');
  var lbVideo = lightbox.querySelector('.fav-lb-video');
  var lbImg = lightbox.querySelector('.fav-lb-img');
  var lbClose = lightbox.querySelector('.fav-lb-close');
  var lbPrev = lightbox.querySelector('.fav-lb-prev');
  var lbNext = lightbox.querySelector('.fav-lb-next');
  var backdrop = lightbox.querySelector('.fav-lb-backdrop');
  var lbWrap = lightbox.querySelector('.fav-lb-wrap');
  var counter = lightbox.querySelector('.vs-lb-counter');
  var platter = lightbox.querySelector('.vs-lb-platter');
  var btnShuffle = lightbox.querySelector('.vs-btn-shuffle');
  var btnLoop = lightbox.querySelector('.vs-btn-loop');
  var btnAuto = lightbox.querySelector('.vs-btn-auto');
  var btnTimer = lightbox.querySelector('.vs-btn-timer');
  var btnFullscreen = lightbox.querySelector('.vs-btn-fullscreen');

  var list = [];
  var current = -1;
  var loopMode = VaultLB.getMode('loop');
  var autoMode = VaultLB.getMode('auto');
  var shuffleMode = VaultLB.getMode('shuffle');
  var timerMode = VaultLB.getMode('timer');
  var TIMER_SECS = 12;
  var advTimer = null;

  function setToggle(btn, on) { if (btn) btn.classList.toggle('vs-toggled', on); }
  setToggle(btnLoop, loopMode); setToggle(btnAuto, autoMode);
  setToggle(btnShuffle, shuffleMode); setToggle(btnTimer, timerMode);

  function armTimer() {
    if (advTimer) { clearTimeout(advTimer); advTimer = null; }
    if (timerMode && current >= 0) advTimer = setTimeout(function () { step(1); }, TIMER_SECS * 1000);
  }
  function nextIndex(delta) {
    if (shuffleMode && list.length > 1) {
      var n;
      do { n = Math.floor(Math.random() * list.length); } while (n === current);
      return n;
    }
    return (current + delta + list.length) % list.length;
  }

  function posterTime(entry) { return (Number(entry.start) || 0) + 1.3; }

  function capturePoster(entry, img, card) {
    VaultPosters.load(entry.url, posterTime(entry), function (dataUrl) {
      if (dataUrl) { img.src = dataUrl; img.style.display = 'block'; }
      card.classList.remove('loading');
    });
  }

  function openLightbox(idx) {
    current = idx;
    var entry = list[idx];
    counter.textContent = (idx + 1) + ' / ' + list.length;
    if (btnFullscreen) btnFullscreen.style.display = entry.type === 'video' ? '' : 'none';
    if (favApi) favApi.setCurrent({ url: entry.url, slug: entry.slug, type: entry.type,
      start: entry.start != null ? Number(entry.start) : null,
      end: entry.end != null ? Number(entry.end) : null });
    VaultLB.loading(lbWrap, true);
    armTimer();
    if (entry.type === 'video') {
      lbImg.style.display = 'none'; lbImg.removeAttribute('src');
      lbVideo.style.display = 'block';
      lbVideo.src = proxyUrl(entry.url);
      lbVideo.currentTime = Number(entry.start) || 0;
      lbVideo.muted = false;
      lbVideo.play().catch(function () {});
    } else {
      lbVideo.pause(); lbVideo.removeAttribute('src'); lbVideo.style.display = 'none';
      lbImg.style.display = 'block';
      lbImg.src = proxyUrl(entry.url);
    }
    lightbox.style.display = 'flex';
    VaultLB.lock(true);
  }
  function closeLightbox() {
    lightbox.style.display = 'none';
    VaultLB.lock(false);
    if (advTimer) { clearTimeout(advTimer); advTimer = null; }
    lbVideo.pause(); lbVideo.removeAttribute('src'); lbVideo.load();
    lbImg.removeAttribute('src');
  }
  function step(delta) {
    if (current < 0 || !list.length) return;
    openLightbox(nextIndex(delta));
  }

  function onClipEnd() {
    var entry = list[current];
    if (loopMode) {
      lbVideo.currentTime = Number(entry.start) || 0;
      lbVideo.play().catch(function () {});
    } else if (autoMode) {
      step(1);
    }
  }
  // Honour per-clip trim end inside the lightbox
  lbVideo.addEventListener('timeupdate', function () {
    if (current < 0) return;
    var entry = list[current];
    if (entry.type !== 'video') return;
    var end = Number(entry.end);
    if (end && lbVideo.currentTime >= end) {
      if (loopMode || autoMode) onClipEnd();
      else { lbVideo.currentTime = Number(entry.start) || 0; lbVideo.play().catch(function () {}); }
    }
  });
  lbVideo.addEventListener('ended', function () { if (current >= 0) onClipEnd(); });
  lbVideo.addEventListener('playing', function () { VaultLB.loading(lbWrap, false); });
  lbVideo.addEventListener('waiting', function () { VaultLB.loading(lbWrap, true); });
  lbImg.addEventListener('load', function () { VaultLB.loading(lbWrap, false); });

  if (btnShuffle) btnShuffle.addEventListener('click', function () {
    shuffleMode = !shuffleMode; setToggle(btnShuffle, shuffleMode); VaultLB.setMode('shuffle', shuffleMode);
  });
  if (btnLoop) btnLoop.addEventListener('click', function () {
    loopMode = !loopMode;
    if (loopMode) { autoMode = false; setToggle(btnAuto, false); VaultLB.setMode('auto', false); }
    setToggle(btnLoop, loopMode); VaultLB.setMode('loop', loopMode);
  });
  if (btnAuto) btnAuto.addEventListener('click', function () {
    autoMode = !autoMode;
    if (autoMode) {
      loopMode = false; setToggle(btnLoop, false); VaultLB.setMode('loop', false);
      timerMode = false; setToggle(btnTimer, false); VaultLB.setMode('timer', false); armTimer();
    }
    setToggle(btnAuto, autoMode); VaultLB.setMode('auto', autoMode);
  });
  if (btnTimer) btnTimer.addEventListener('click', function () {
    timerMode = !timerMode;
    if (timerMode) { autoMode = false; setToggle(btnAuto, false); VaultLB.setMode('auto', false); }
    setToggle(btnTimer, timerMode); VaultLB.setMode('timer', timerMode);
    armTimer();
  });
  if (btnFullscreen) btnFullscreen.addEventListener('click', function () {
    if (current < 0 || list[current].type !== 'video') return;
    lbVideo.requestFullscreen && lbVideo.requestFullscreen();
  });

  VaultLB.swipe(lightbox, function () { step(-1); }, function () { step(1); });
  lbClose.addEventListener('click', closeLightbox);
  backdrop && backdrop.addEventListener('click', closeLightbox);
  lbPrev.addEventListener('click', function () { step(-1); });
  lbNext.addEventListener('click', function () { step(1); });
  document.addEventListener('keydown', function (e) {
    if (lightbox.style.display !== 'flex') return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'l' || e.key === 'L') { btnLoop && btnLoop.click(); }
    else if (e.key === 'a' || e.key === 'A') { btnAuto && btnAuto.click(); }
    else if (e.key === 's' || e.key === 'S') { btnShuffle && btnShuffle.click(); }
    else if (e.key === 't' || e.key === 'T') { btnTimer && btnTimer.click(); }
    else if (e.key === 'f' || e.key === 'F') { btnFullscreen && btnFullscreen.click(); }
  });

  function render() {
    list = window.Favourites ? window.Favourites.list() : [];
    grid.innerHTML = '';
    if (!list.length) {
      if (emptyEl) emptyEl.classList.add('show');
      return;
    }
    if (emptyEl) emptyEl.classList.remove('show');

    list.forEach(function (entry, idx) {
      var card = document.createElement('div');
      card.className = 'fav-card' + (entry.type === 'video' ? ' loading' : '');
      card.dataset.favUrl = entry.url;
      if (entry.start) card.dataset.favStart = entry.start;
      if (entry.end) card.dataset.favEnd = entry.end;

      if (entry.type === 'video') {
        var img = document.createElement('img');
        img.alt = ''; img.style.display = 'none';
        card.appendChild(img);
        var play = document.createElement('div');
        play.className = 'fav-play';
        play.innerHTML = '<svg viewBox="0 0 80 80" width="34" height="34"><polygon points="28,20 64,40 28,60" fill="white"/></svg>';
        card.appendChild(play);
        capturePoster(entry, img, card);
      } else {
        var im = document.createElement('img');
        im.loading = 'lazy';
        im.src = proxyUrl(entry.url);
        card.appendChild(im);
      }

      var m = META[entry.slug];
      var tag = document.createElement('div');
      tag.className = 'fav-tag';
      tag.innerHTML = '<span class="fav-tag-dot" style="background:' + (m ? m.accent : '#d8622f') + '"></span><span class="fav-tag-name">' + (m ? m.label : entry.slug) + '</span>';
      card.appendChild(tag);

      card.addEventListener('click', function () { openLightbox(idx); });
      grid.appendChild(card);
    });

    window.Favourites.initSection(document.body, { type: 'mixed' });
  }

  var favApi = window.Favourites
    ? window.Favourites.initSection(lightbox, { type: 'mixed', platterEl: platter })
    : null;

  document.addEventListener('vault-fav-change', function (e) {
    // Re-render only on real add/remove, not the heart's own refresh loop
    render();
  });
  render();

  // ── Sync card ─────────────────────────────────────────────
  (function () {
    var card = document.getElementById('sync-card');
    if (!card || !window.VaultSync) return;
    var dot = document.getElementById('sync-dot');
    var label = document.getElementById('sync-label');
    var toggleBtn = document.getElementById('sync-toggle');
    var setup = document.getElementById('sync-setup');
    var tokenInput = document.getElementById('sync-token');
    var saveBtn = document.getElementById('sync-save');
    var errEl = document.getElementById('sync-error');

    var LABELS = {
      off: 'Device-only (not synced)',
      pending: 'Change pending\u2026',
      syncing: 'Syncing\u2026',
      synced: 'Synced with GitHub',
      error: 'Sync error'
    };
    function paint(status, detail) {
      dot.className = 'sync-dot ' + status;
      label.textContent = LABELS[status] || status;
      toggleBtn.textContent = status === 'off' ? 'Enable GitHub sync' : 'Disable';
      if (status === 'error' && detail) { errEl.textContent = detail; errEl.hidden = false; }
      else if (status === 'synced') { errEl.hidden = true; }
    }
    document.addEventListener('vault-sync-status', function (e) { paint(e.detail.status, e.detail.detail); });
    paint(VaultSync.enabled() ? VaultSync.getStatus() : 'off');

    toggleBtn.addEventListener('click', function () {
      if (VaultSync.enabled()) {
        VaultSync.disable();
        setup.hidden = true;
        paint('off');
      } else {
        setup.hidden = !setup.hidden;
        if (!setup.hidden) tokenInput.focus();
      }
    });
    saveBtn.addEventListener('click', function () {
      var tok = tokenInput.value.trim();
      if (!tok) { tokenInput.focus(); return; }
      errEl.hidden = true;
      saveBtn.disabled = true; saveBtn.textContent = 'Connecting\u2026';
      VaultSync.enable(tok).then(function (ok) {
        saveBtn.disabled = false; saveBtn.textContent = 'Connect';
        if (ok) { setup.hidden = true; tokenInput.value = ''; }
      });
    });
  })();
})();
