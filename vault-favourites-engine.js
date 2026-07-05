(function () {
  var grid = document.getElementById('fav-grid');
  var emptyEl = document.getElementById('fav-empty');
  if (!grid) return;
  var META = window.COLLECTION_META || {};

  function render() {
    var list = window.Favourites ? window.Favourites.list() : [];
    grid.innerHTML = '';
    if (!list.length) {
      if (emptyEl) emptyEl.classList.add('show');
      return;
    }
    if (emptyEl) emptyEl.classList.remove('show');

    list.forEach(function (entry) {
      var card = document.createElement('div');
      card.className = 'fav-card';
      card.dataset.favUrl = entry.url;
      if (entry.start) card.dataset.favStart = entry.start;
      if (entry.end) card.dataset.favEnd = entry.end;

      if (entry.type === 'video') {
        var v = document.createElement('video');
        v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'metadata';
        v.src = proxyUrl(entry.url);
        if (entry.start) v.addEventListener('loadedmetadata', function () { v.currentTime = entry.start; });
        card.appendChild(v);
        var play = document.createElement('div');
        play.className = 'fav-play';
        play.innerHTML = '<svg viewBox="0 0 80 80" width="34" height="34"><polygon points="28,20 64,40 28,60" fill="white"/></svg>';
        card.appendChild(play);
      } else {
        var img = document.createElement('img');
        img.loading = 'lazy';
        img.src = proxyUrl(entry.url);
        card.appendChild(img);
      }

      var m = META[entry.slug];
      var tag = document.createElement('div');
      tag.className = 'fav-tag';
      tag.innerHTML = '<span class="fav-tag-dot" style="background:' + (m ? m.accent : '#d8622f') + '"></span><span class="fav-tag-name">' + (m ? m.label : entry.slug) + '</span>';
      card.appendChild(tag);

      card.addEventListener('click', function () {
        if (entry.type === 'video') {
          var vEl = card.querySelector('video');
          if (vEl.paused) vEl.play(); else vEl.pause();
        } else if (entry.slug) {
          window.location.href = '/pages/' + entry.slug + '/';
        }
      });

      grid.appendChild(card);
    });

    window.Favourites.initSection(document.body, { type: 'mixed' });
  }

  document.addEventListener('vault-fav-change', render);
  render();
})();
