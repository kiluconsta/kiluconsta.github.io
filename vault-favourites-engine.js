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

  var list = [];
  var current = -1;

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
  }
  function closeLightbox() {
    lightbox.style.display = 'none';
    lbVideo.pause(); lbVideo.removeAttribute('src'); lbVideo.load();
    lbImg.removeAttribute('src');
  }
  function step(delta) {
    if (current < 0 || !list.length) return;
    openLightbox((current + delta + list.length) % list.length);
  }

  // Honour per-clip trim end inside the lightbox: restart at trim start
  lbVideo.addEventListener('timeupdate', function () {
    if (current < 0) return;
    var entry = list[current];
    if (entry.type !== 'video') return;
    var end = Number(entry.end);
    if (end && lbVideo.currentTime >= end) {
      lbVideo.currentTime = Number(entry.start) || 0;
    }
  });

  lbClose.addEventListener('click', closeLightbox);
  backdrop && backdrop.addEventListener('click', closeLightbox);
  lbPrev.addEventListener('click', function () { step(-1); });
  lbNext.addEventListener('click', function () { step(1); });
  document.addEventListener('keydown', function (e) {
    if (lightbox.style.display !== 'flex') return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
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

  document.addEventListener('vault-fav-change', function (e) {
    // Re-render only on real add/remove, not the heart's own refresh loop
    render();
  });
  render();
})();
