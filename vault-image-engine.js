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

  function thumbURL(url) {
    if (/googleusercontent\.com/.test(url)) return url.replace(/=[^/]+$/, '=w280-h280-c');
    return url;
  }

  var frag = document.createDocumentFragment();
  items.forEach(function (it, idx) {
    var tile = document.createElement('div');
    tile.className = 'is-tile';
    tile.dataset.favUrl = it.url;
    var img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = '';
    img.src = proxyUrl(thumbURL(it.url));
    tile.appendChild(img);
    tile.addEventListener('click', function () { openLightbox(idx); });
    frag.appendChild(tile);
  });
  body.insertBefore(frag, lightbox);

  var favApi = window.Favourites ? window.Favourites.initSection(mount, { type: 'image', platterEl: controls }) : null;
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
    lbImg.src = proxyUrl(it.url);
    lightbox.style.display = 'flex';
    if (favApi) favApi.setCurrent({ url: it.url, slug: slug, type: 'image' });
  }
  function closeLightbox() { stopSlideshow(); lightbox.style.display = 'none'; lbImg.removeAttribute('src'); }
  function step(delta) {
    if (current < 0) return;
    openLightbox((current + delta + items.length) % items.length);
  }

  lbClose.addEventListener('click', closeLightbox);
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
