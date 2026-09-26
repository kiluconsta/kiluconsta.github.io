// ════════════════════════════════════════════════════════════
// THE VAULT — "Spatial" theme, the two parts CSS cannot do
//
// Everything else lives in /vault-spatial.css. This file only:
//   1. builds the floating ornament rail, which has no markup
//      anywhere in the built output, and
//   2. MOVES existing controls into a floating bar at the bottom.
//
// It moves nodes, never rebuilds them, so every listener the
// engines attached keeps working. That is also why this script
// must load LAST on the page — after vault-home.js and the video
// and image engines have created and wired their own controls.
//
// Nothing here is required for the site to function: if it does
// not run, the CSS alone still themes the page and the controls
// simply stay where the engines put them.
// ════════════════════════════════════════════════════════════
(function () {
  if (!document.documentElement.classList.contains('sp')) return;

  var path = location.pathname;

  // ── 1. The ornament rail ──────────────────────────────────
  var ICON = {
    home: '<path d="M4 11.2 12 4l8 7.2V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" '
        + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    heart: '<path d="M12 21s-7.5-4.7-9.4-9.1C1.1 8.3 3 5 6.3 5c2 0 3.4 1.1 4.2 2.3l.5.8.5-.8'
        + 'C12.3 6.1 13.7 5 15.7 5 19 5 20.9 8.3 21.4 11.9 19.5 16.3 12 21 12 21z" fill="currentColor"/>',
    pulse: '<path d="M3 12h4l2-5 3 10 2.5-5H21" stroke="currentColor" stroke-width="2" '
        + 'stroke-linecap="round" stroke-linejoin="round"/>'
  };

  var DESTS = [
    { href: '/', label: 'Home', icon: ICON.home, cls: '' },
    { href: '/pages/favourites/', label: 'Favourites', icon: ICON.heart, cls: ' sp-fav' },
    { href: '/pages/health/', label: 'Health and dead links', icon: ICON.pulse, cls: '' }
  ];

  var rail = document.createElement('nav');
  rail.className = 'sp-rail';
  rail.setAttribute('aria-label', 'The Vault');
  rail.innerHTML = DESTS.map(function (d) {
    // Only "/" needs an exact match; the others are directories.
    var here = d.href === '/' ? (path === '/' || path === '/index.html')
                              : path.indexOf(d.href) === 0;
    return '<a class="sp-rail-btn' + d.cls + '" href="' + d.href + '"'
      + ' aria-label="' + d.label + '"' + (here ? ' aria-current="page"' : '')
      + '><svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' + d.icon + '</svg></a>';
  }).join('');
  document.body.appendChild(rail);

  // ── 2. The ornament bar ───────────────────────────────────
  // Which controls exist depends on the page: the home page has a
  // collection search and a type filter, a collection page has the
  // engine's filter bar (search + match count + tile density).
  var moving = [];
  var homeSearch = document.getElementById('home-search');
  var homeFilter = document.getElementById('home-filter');
  if (homeSearch) moving.push(homeSearch);
  if (homeFilter) moving.push(homeFilter);
  var csFilter = document.querySelector('.cs-filter');
  if (csFilter) moving.push(csFilter);

  if (moving.length) {
    var orn = document.createElement('div');
    orn.className = 'sp-orn';
    moving.forEach(function (el) { orn.appendChild(el); });
    document.body.appendChild(orn);
  }

  // ── 3. Collapsible search on narrow screens ───────────────
  // The bar carries a search field plus two segmented controls. On a
  // phone that wraps to two rows and eats the bottom of the grid, so
  // below 900px it shrinks to a single round button until asked for.
  var orn = document.querySelector('.sp-orn');
  if (orn) {
    var MOBILE = window.matchMedia('(max-width: 900px)');
    var field = orn.querySelector('input');
    if (!orn.id) orn.id = 'sp-orn';

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'sp-orn-toggle';
    toggle.setAttribute('aria-controls', orn.id);
    toggle.innerHTML =
      '<svg class="sp-i-search" viewBox="0 0 24 24" fill="none" aria-hidden="true">'
      + '<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"></circle>'
      + '<path d="M21 21l-4.3-4.3" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>'
      + '<svg class="sp-i-close" viewBox="0 0 24 24" fill="none" aria-hidden="true">'
      + '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>';
    orn.insertBefore(toggle, orn.firstChild);

    // A typed filter is still being applied to the grid, so the bar
    // must never hide itself while one is active.
    var filtering = function () { return !!(field && field.value.trim()); };

    var setOpen = function (open) {
      orn.classList.toggle('sp-collapsed', !open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label',
        open ? 'Hide search and filters' : 'Show search and filters');
    };
    // Above 900px the CSS hides the toggle and the bar is always open.
    var sync = function () { setOpen(!MOBILE.matches || filtering()); };
    sync();
    if (MOBILE.addEventListener) MOBILE.addEventListener('change', sync);

    toggle.addEventListener('click', function () {
      var opening = orn.classList.contains('sp-collapsed');
      setOpen(opening);
      if (opening && field) field.focus();
    });

    if (field) field.addEventListener('input', function () {
      orn.classList.toggle('sp-has-query', filtering());
    });

    document.addEventListener('pointerdown', function (e) {
      if (!MOBILE.matches || orn.classList.contains('sp-collapsed')) return;
      if (orn.contains(e.target) || filtering()) return;
      setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !MOBILE.matches) return;
      if (orn.classList.contains('sp-collapsed') || filtering()) return;
      setOpen(false);
    });
  }

  // ── 4. A header for collection pages ──────────────────────
  // The built output gives a collection page no title at all — only
  // a back button and the document title. The sheet needs one.
  var section = document.querySelector('[data-vault-video], [data-vault-image]');
  if (section) {
    var slug = section.getAttribute('data-vault-video')
            || section.getAttribute('data-vault-image');
    var meta = (window.COLLECTION_META || {})[slug] || {};

    // Prefer the live count the engines write as they render, since
    // COLLECTION_META is baked at build time and drifts.
    var n = meta.count || 0;
    try {
      var live = JSON.parse(localStorage.getItem('vault-counts') || '{}');
      if (typeof live[slug] === 'number') n = live[slug];
    } catch (e) {}

    var kind = meta.type === 'image' ? 'images' : 'videos';
    var head = document.createElement('div');
    head.className = 'sp-head home-topbar';
    head.innerHTML = '<span class="sp-brand">THE<em>VAULT</em></span>'
      + '<h1 class="sp-title"></h1>'
      + '<span class="sp-count"></span>';
    // Labels come from data, so set them as text — never as HTML.
    head.querySelector('.sp-title').textContent = meta.label || slug || 'Collection';
    head.querySelector('.sp-count').textContent = n
      ? n.toLocaleString() + ' ' + kind
      : kind;
    section.insertBefore(head, section.firstChild);
  }
})();
