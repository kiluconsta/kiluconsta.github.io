(function () {
  var root = document.getElementById('home-grid');
  if (!root) return;
  var META = window.COLLECTION_META;

  function fmtCount(n) { return n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'k' : String(n); }
  function go(slug) { if (slug) window.location.href = '/pages/' + slug + '/'; }

  var favCount = window.Favourites ? window.Favourites.count() : 0;
  var hero = document.createElement('section');
  hero.className = 'home-hero';
  hero.dataset.slug = 'favourites';
  hero.dataset.label = 'favourites';
  hero.tabIndex = 0;
  hero.setAttribute('role', 'link');
  hero.setAttribute('aria-label', 'Favourites');
  hero.innerHTML =
    '<div class="hero-icon">\u2764\ufe0f</div>' +
    '<div class="hero-text">' +
      '<div class="hero-eyebrow">Collection</div>' +
      '<h1 class="hero-title">Favourites</h1>' +
      '<div class="hero-meta">' + (favCount === 1 ? '1 saved item' : fmtCount(favCount) + ' saved items') + '</div>' +
      '<button class="hero-btn" type="button"><svg viewBox="0 0 16 16"><path d="M3 1.8v12.4c0 .7.8 1.2 1.4.8l10-6.2c.6-.4.6-1.2 0-1.6l-10-6.2C3.8.6 3 1.1 3 1.8z"/></svg>Open</button>' +
    '</div>';
  root.appendChild(hero);

  function buildCard(slug, m) {
    var tile = document.createElement('div');
    tile.className = 'home-tile';
    tile.dataset.slug = slug;
    tile.dataset.type = m.type || '';
    tile.dataset.label = (m.label || '').toLowerCase();
    tile.style.setProperty('--accent', m.accent || '#d8622f');
    tile.tabIndex = 0;
    tile.setAttribute('role', 'link');
    tile.setAttribute('aria-label', m.label);
    tile.innerHTML =
      '<div class="tile-art"><span class="tile-icon">' + (m.icon || '') + '</span></div>' +
      '<div class="tile-label">' + m.label + '</div>' +
      '<div class="tile-meta">' +
        (m.type ? '<span class="tile-type">' + (m.type === 'video' ? 'Video' : 'Image') + '</span>' : '') +
        '<span class="tile-count">' + fmtCount(m.count || 0) + '</span>' +
      '</div>';
    return tile;
  }

  // ── Wrap the shelves into a grid ─────────────────────────
  // Collections used to sit in a horizontal scroller, so most of them were off
  // screen behind chevrons. There are only fourteen — they all fit.
  var gridStyle = document.createElement('style');
  gridStyle.textContent =
    '.shelf-scroller{display:grid!important;overflow-x:visible!important;'
    + 'grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px;}'
    + '.shelf-scroller > *{width:auto!important;min-width:0!important;max-width:none!important;'
    + 'flex:none!important;}'
    // The chevrons only make sense for a scroller.
    + '.shelf-nav{display:none!important;}'
    + '@media (max-width:520px){.shelf-scroller{'
    + 'grid-template-columns:repeat(auto-fill,minmax(140px,1fr));}}';
  document.head.appendChild(gridStyle);

  var CHEV_L = '<svg viewBox="0 0 16 16" fill="none"><path d="M10 3L5.5 8 10 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CHEV_R = '<svg viewBox="0 0 16 16" fill="none"><path d="M6 3l4.5 5L6 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function buildShelf(title) {
    var shelf = document.createElement('section');
    shelf.className = 'shelf';
    var h = document.createElement('h2'); h.className = 'shelf-title'; h.textContent = title;
    var scroller = document.createElement('div'); scroller.className = 'shelf-scroller';
    var prev = document.createElement('button'); prev.type = 'button'; prev.className = 'shelf-nav prev'; prev.innerHTML = CHEV_L;
    var next = document.createElement('button'); next.type = 'button'; next.className = 'shelf-nav next'; next.innerHTML = CHEV_R;
    prev.addEventListener('click', function (e) { e.stopPropagation(); scroller.scrollBy({ left: -scroller.clientWidth * 0.9, behavior: 'smooth' }); });
    next.addEventListener('click', function (e) { e.stopPropagation(); scroller.scrollBy({ left: scroller.clientWidth * 0.9, behavior: 'smooth' }); });
    shelf.append(h, scroller, prev, next);
    root.appendChild(shelf);
    return { shelf: shelf, scroller: scroller };
  }

  var totalItems = 0;
  Object.keys(META).forEach(function (slug) { totalItems += META[slug].count || 0; });

  var videoShelf = buildShelf('Videos');
  var imageShelf = buildShelf('Images');
  // Live counts self-heal into localStorage as pages are visited; prefer them.
  var liveCounts = {};
  try { liveCounts = JSON.parse(localStorage.getItem('vault-counts') || '{}'); } catch (e) {}

  Object.keys(META).forEach(function (slug) {
    var m = META[slug];
    // An empty collection is noise on the home page. Tragic Dee starts empty
    // and only earns a card once something has been salvaged into it.
    var n = liveCounts[slug] !== undefined ? liveCounts[slug] : (m.count || 0);
    if (!n) return;
    var target = m.type === 'image' ? imageShelf : videoShelf;
    target.scroller.appendChild(buildCard(slug, m));
  });

  var stat = document.getElementById('home-stat');
  if (stat) stat.textContent = Object.keys(META).length + ' collections \u00b7 ' + fmtCount(totalItems) + ' items';

  root.querySelectorAll('.shelf-scroller').forEach(function (sc) {
    Array.prototype.forEach.call(sc.children, function (c, i) { c.style.animationDelay = Math.min(i * 0.03, 0.3) + 's'; });
  });

  root.addEventListener('click', function (e) {
    var t = e.target.closest('.home-tile, .home-hero');
    if (t) go(t.dataset.slug);
  });
  root.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var t = e.target.closest('.home-tile, .home-hero');
    if (t) { e.preventDefault(); go(t.dataset.slug); }
  });

  var searchInput = document.getElementById('vault-search');
  var searchWrap = document.getElementById('home-search');
  var clearBtn = document.getElementById('vault-search-clear');
  var emptyEl = document.getElementById('home-empty');
  var filterBar = document.getElementById('home-filter');
  var query = '', typeFilter = 'all';

  function applyFilter() {
    var shownTotal = 0;
    var heroVisible = typeFilter === 'all' && (!query || 'favourites'.indexOf(query) !== -1);
    hero.classList.toggle('hidden', !heroVisible);
    if (heroVisible) shownTotal++;
    root.querySelectorAll('.shelf').forEach(function (shelf) {
      var shown = 0;
      shelf.querySelectorAll('.home-tile').forEach(function (t) {
        var matchesType = typeFilter === 'all' || t.dataset.type === typeFilter;
        var matchesQuery = !query || t.dataset.label.indexOf(query) !== -1;
        var visible = matchesType && matchesQuery;
        t.classList.toggle('hidden', !visible);
        if (visible) shown++;
      });
      shelf.classList.toggle('hidden', shown === 0);
      shownTotal += shown;
    });
    if (emptyEl) emptyEl.classList.toggle('show', shownTotal === 0);
  }

  if (searchInput) searchInput.addEventListener('input', function () {
    query = searchInput.value.trim().toLowerCase();
    if (searchWrap) searchWrap.classList.toggle('has-text', query.length > 0);
    applyFilter();
  });
  if (clearBtn) clearBtn.addEventListener('click', function () {
    searchInput.value = ''; query = '';
    if (searchWrap) searchWrap.classList.remove('has-text');
    applyFilter(); searchInput.focus();
  });
  if (filterBar) filterBar.addEventListener('click', function (e) {
    var btn = e.target.closest('.home-filter-btn'); if (!btn) return;
    typeFilter = btn.dataset.filter;
    filterBar.querySelectorAll('.home-filter-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
    applyFilter();
  });
  document.addEventListener('keydown', function (e) {
    var typing = document.activeElement === searchInput;
    if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
      e.preventDefault(); if (searchInput) searchInput.focus();
    } else if (e.key === 'Escape' && typing && searchInput.value) {
      searchInput.value = ''; query = '';
      if (searchWrap) searchWrap.classList.remove('has-text');
      applyFilter();
    }
  });
})();
