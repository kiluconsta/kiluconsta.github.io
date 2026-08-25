// Add-a-link UI — posts to the vault-admin worker, which commits the new entry
// into data/<slug>.js on your behalf. The GitHub token lives in the worker, not
// here; the only thing stored in this browser is VAULT_KEY, which can do nothing
// except append a link to one of the known data files.
//
// SETUP: deploy tools/vault-admin-worker.js, then put its URL here.
(function () {
  var ADMIN_URL = 'https://vault-admin.kiluconsta.workers.dev';
  var KEY_STORE = 'vault-admin-key';

  var mount = document.querySelector('[data-vault-video], [data-vault-image]');
  if (!mount) return;
  var isVideo = mount.hasAttribute('data-vault-video');
  var slug = mount.getAttribute(isVideo ? 'data-vault-video' : 'data-vault-image');
  var labels = (typeof DIV_LABELS !== 'undefined' && Array.isArray(DIV_LABELS)) ? DIV_LABELS : [];

  var css = ''
    + '#va-fab{position:fixed;left:18px;bottom:18px;z-index:940;width:46px;height:46px;border:0;'
    + 'border-radius:50%;background:rgba(255,255,255,.1);color:#fff;font-size:26px;line-height:1;'
    + 'cursor:pointer;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);'
    + 'box-shadow:0 4px 18px rgba(0,0,0,.45);transition:background .18s ease,transform .18s ease;}'
    + '#va-fab:hover{background:rgba(255,255,255,.2);transform:translateY(-2px);}'
    + '#va-modal{position:fixed;inset:0;z-index:960;display:none;align-items:center;'
    + 'justify-content:center;background:rgba(0,0,0,.72);padding:20px;'
    + 'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);}'
    + '#va-modal.va-open{display:flex;}'
    + '#va-card{width:100%;max-width:440px;background:#111116;border:1px solid rgba(255,255,255,.1);'
    + 'border-radius:16px;padding:22px;color:#fff;'
    + 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
    + 'max-height:90vh;overflow-y:auto;}'
    + '#va-card h2{margin:0 0 16px;font-size:1.05rem;font-weight:600;}'
    + '.va-field{margin-bottom:13px;}'
    + '.va-field label{display:block;font-size:.76rem;text-transform:uppercase;letter-spacing:.06em;'
    + 'color:rgba(255,255,255,.45);margin-bottom:5px;}'
    + '.va-field input,.va-field select,.va-field textarea{width:100%;box-sizing:border-box;'
    + 'padding:9px 11px;background:rgba(255,255,255,.06);'
    + 'border:1px solid rgba(255,255,255,.12);border-radius:8px;'
    + 'color:#fff;font-size:.9rem;font-family:inherit;}'
    + '.va-field textarea{min-height:76px;resize:vertical;line-height:1.45;'
    + 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.78rem;white-space:pre;}'
    + '.va-field input:focus,.va-field select:focus,.va-field textarea:focus{outline:none;'
    + 'border-color:rgba(255,255,255,.4);}'
    + '.va-hint{font-size:.72rem;color:rgba(255,255,255,.35);margin-top:5px;}'
    + '#va-trim.va-hidden{display:none;}'
    + '.va-field select option{background:#111116;}'
    + '.va-row{display:flex;gap:10px;}.va-row .va-field{flex:1;}'
    + '#va-actions{display:flex;gap:10px;margin-top:18px;}'
    + '#va-actions button{flex:1;padding:10px;border-radius:9px;font-size:.88rem;font-family:inherit;'
    + 'cursor:pointer;border:1px solid rgba(255,255,255,.14);background:transparent;color:#fff;}'
    + '#va-save{background:#fff!important;color:#000!important;font-weight:600;border-color:#fff!important;}'
    + '#va-save:disabled{opacity:.5;cursor:not-allowed;}'
    + '#va-msg{margin-top:13px;font-size:.82rem;min-height:1.2em;color:rgba(255,255,255,.5);}'
    + '#va-msg.va-ok{color:#3ddc84;}#va-msg.va-err{color:#ff4d5e;}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var fab = document.createElement('button');
  fab.id = 'va-fab';
  fab.type = 'button';
  fab.title = 'Add a link to this collection';
  fab.setAttribute('aria-label', 'Add a link to this collection');
  fab.textContent = '+';

  var sectionField = '';
  if (isVideo && labels.length) {
    var opts = labels.map(function (l, i) {
      return '<option value="' + i + '">' + String(l).replace(/[<>&]/g, '') + '</option>';
    }).join('');
    sectionField = '<div class="va-field"><label for="va-section">Section</label>'
      + '<select id="va-section">' + opts + '</select></div>';
  }
  // Trim seconds describe a single clip, so this row hides as soon as the box
  // holds more than one URL.
  var trimField = isVideo
    ? '<div class="va-row" id="va-trim">'
      + '<div class="va-field"><label for="va-start">Start (s, optional)</label>'
      + '<input id="va-start" type="number" min="0" step="1" placeholder="—"></div>'
      + '<div class="va-field"><label for="va-end">End (s, optional)</label>'
      + '<input id="va-end" type="number" min="0" step="1" placeholder="—"></div></div>'
    : '';

  var modal = document.createElement('div');
  modal.id = 'va-modal';
  modal.innerHTML = '<div id="va-card" role="dialog" aria-modal="true" aria-label="Add a link">'
    + '<h2>Add to ' + slug + '</h2>'
    + '<div class="va-field"><label for="va-url">Media URL<span id="va-count"></span></label>'
    + '<textarea id="va-url" rows="3" placeholder="https://…&#10;https://…" '
    + 'autocomplete="off" spellcheck="false" autocapitalize="off"></textarea>'
    + '<div class="va-hint">One URL per line — paste as many as you like.</div></div>'
    + sectionField + trimField
    + '<div class="va-field"><label for="va-key">Vault key</label>'
    + '<input id="va-key" type="password" placeholder="saved after first use" autocomplete="off"></div>'
    + '<div id="va-actions"><button type="button" id="va-cancel">Cancel</button>'
    + '<button type="button" id="va-save">Commit</button></div>'
    + '<div id="va-msg"></div></div>';

  document.body.append(fab, modal);

  // ── Remove a link ────────────────────────────────────────
  // Adding was possible from the site while deleting still meant hand-editing
  // a data file. Alt/long-press a tile to drop it from the collection.
  var rmStyle = document.createElement('style');
  rmStyle.textContent = '.va-removing{opacity:.35;filter:grayscale(1);transition:opacity .2s ease;}';
  document.head.appendChild(rmStyle);

  function removeUrl(url, tile) {
    var key;
    try { key = localStorage.getItem(KEY_STORE) || ''; } catch (e) { key = ''; }
    if (!ADMIN_URL) { alert('ADMIN_URL is not set in /vault-additions.js yet.'); return; }
    if (!key) { alert('Add a link once first so the vault key is saved.'); return; }
    if (!confirm('Remove this from ' + slug + '?\n\n' + url.slice(0, 90) + '…')) return;

    tile.classList.add('va-removing');
    fetch(ADMIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Vault-Key': key },
      body: JSON.stringify({ slug: slug, action: 'remove', urls: [url] })
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, data: d }; });
    }).then(function (res) {
      if (!res.ok) {
        tile.classList.remove('va-removing');
        alert(res.data.error || 'Remove failed.');
        return;
      }
      tile.remove(); // gone from the file; drop it from the grid too
    }).catch(function () {
      tile.classList.remove('va-removing');
      alert('Could not reach the worker.');
    });
  }

  // Alt-click on desktop, long-press on touch — both deliberate enough not to
  // fire by accident while browsing.
  document.addEventListener('click', function (e) {
    if (!e.altKey) return;
    var tile = e.target.closest('.vs-tile, .is-tile');
    if (!tile || !tile.dataset.favUrl) return;
    e.preventDefault(); e.stopPropagation();
    removeUrl(tile.dataset.favUrl, tile);
  }, true);

  var pressTimer = null, pressTile = null;
  document.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'touch') return;
    var tile = e.target.closest('.vs-tile, .is-tile');
    if (!tile || !tile.dataset.favUrl) return;
    pressTile = tile;
    pressTimer = setTimeout(function () {
      pressTimer = null;
      removeUrl(tile.dataset.favUrl, tile);
    }, 700);
  }, true);
  function cancelPress() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    pressTile = null;
  }
  ['pointerup', 'pointercancel', 'pointermove', 'scroll'].forEach(function (ev) {
    document.addEventListener(ev, cancelPress, true);
  });

  var urlIn = modal.querySelector('#va-url');
  var keyIn = modal.querySelector('#va-key');
  var startIn = modal.querySelector('#va-start');
  var endIn = modal.querySelector('#va-end');
  var sectionIn = modal.querySelector('#va-section');
  var saveBtn = modal.querySelector('#va-save');
  var msg = modal.querySelector('#va-msg');
  var countEl = modal.querySelector('#va-count');
  var trimRow = modal.querySelector('#va-trim');

  function say(text, cls) {
    msg.textContent = text;
    msg.className = cls || '';
  }
  // Split on newlines; also tolerate URLs separated by spaces on one line.
  function urlList() {
    return urlIn.value.split(/[\r\n\s]+/).map(function (s) { return s.trim(); })
      .filter(Boolean);
  }
  function refresh() {
    var n = urlList().length;
    countEl.textContent = n > 1 ? ' — ' + n + ' links' : '';
    // Trim seconds only apply to a single clip.
    if (trimRow) trimRow.classList.toggle('va-hidden', n > 1);
  }
  urlIn.addEventListener('input', refresh);

  function open() {
    modal.classList.add('va-open');
    try { keyIn.value = localStorage.getItem(KEY_STORE) || ''; } catch (e) {}
    say('');
    refresh();
    urlIn.focus();
  }
  function close() {
    modal.classList.remove('va-open');
    urlIn.value = '';
    if (startIn) startIn.value = '';
    if (endIn) endIn.value = '';
    refresh();
    say('');
  }

  fab.addEventListener('click', open);
  modal.querySelector('#va-cancel').addEventListener('click', close);
  modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal.classList.contains('va-open')) close();
  });

  saveBtn.addEventListener('click', function () {
    var urls = urlList();
    if (!urls.length) { say('Enter at least one URL.', 'va-err'); return; }
    for (var i = 0; i < urls.length; i++) {
      if (!/^https?:\/\/\S+$/i.test(urls[i])) {
        say('Line ' + (i + 1) + ' is not a valid http(s) URL.', 'va-err');
        return;
      }
    }
    var key = keyIn.value.trim();
    if (!key) { say('Vault key required.', 'va-err'); return; }
    if (!ADMIN_URL) {
      say('ADMIN_URL is not set in /vault-additions.js yet.', 'va-err');
      return;
    }

    var payload = { slug: slug, urls: urls };
    if (isVideo) {
      // A batch has no single clip to trim, so start/end are sent only for one.
      if (urls.length === 1) {
        if (startIn && startIn.value !== '') payload.start = Number(startIn.value);
        if (endIn && endIn.value !== '') payload.end = Number(endIn.value);
      }
      if (sectionIn) payload.section = Number(sectionIn.value);
    }

    saveBtn.disabled = true;
    say(urls.length > 1 ? 'Committing ' + urls.length + ' links…' : 'Committing…');

    fetch(ADMIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Vault-Key': key },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, data: d }; });
    }).then(function (res) {
      saveBtn.disabled = false;
      if (!res.ok) { say(res.data.error || 'Commit failed.', 'va-err'); return; }
      try { localStorage.setItem(KEY_STORE, key); } catch (e) {}
      var sha = (res.data.commit || '').slice(0, 7);
      var n = res.data.added || urls.length;
      say('Committed ' + sha + ' (' + n + (n === 1 ? ' link' : ' links')
        + ') — live once Pages redeploys (~1 min).', 'va-ok');
      urlIn.value = '';
      if (startIn) startIn.value = '';
      if (endIn) endIn.value = '';
      refresh();
    }).catch(function () {
      saveBtn.disabled = false;
      say('Could not reach the worker.', 'va-err');
    });
  });
})();
