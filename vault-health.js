// Health page — renders the three machine-managed files under /health as
// something you can act on, instead of raw logs in the repo.
//
//   removed-links.log     TSV: date, file.js, "line N", reason, "url",
//   thumbs-failures.log   TSV: url, reason
//   link-strikes.json     { url: { count, last, reason } }
//
// Nothing here writes to health/ — restoring a link goes through the same
// vault-admin worker the + button uses.
(function () {
  var root = document.getElementById('health-root');
  if (!root) return;

  var ADMIN_URL = 'https://vault-admin.kiluconsta.workers.dev';
  var KEY_STORE = 'vault-admin-key';

  var css = ''
    + '.hz-loading{color:rgba(255,255,255,.4);}'
    + '.hz-tabs{display:flex;gap:8px;margin:0 0 18px;flex-wrap:wrap;}'
    + '.hz-tab{padding:7px 13px;border-radius:8px;cursor:pointer;font:inherit;'
    + 'font-size:.86rem;color:rgba(255,255,255,.7);background:rgba(255,255,255,.05);'
    + 'border:1px solid rgba(255,255,255,.1);}'
    + '.hz-tab.on{background:#fff;color:#000;border-color:#fff;font-weight:600;}'
    + '.hz-tab .n{opacity:.6;font-variant-numeric:tabular-nums;}'
    + '.hz-tab.on .n{opacity:.55;}'
    + '.hz-panel{display:none;} .hz-panel.on{display:block;}'
    + '.hz-filter{width:100%;box-sizing:border-box;padding:9px 12px;margin:0 0 14px;'
    + 'border-radius:9px;background:rgba(255,255,255,.06);'
    + 'border:1px solid rgba(255,255,255,.12);color:#fff;font:inherit;font-size:.9rem;}'
    + '.hz-filter:focus{outline:none;border-color:rgba(255,255,255,.4);}'
    + '.hz-row{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:start;'
    + 'padding:11px 0;border-top:1px solid rgba(255,255,255,.07);}'
    + '.hz-url{word-break:break-all;font-size:.8rem;line-height:1.45;'
    + 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:rgba(255,255,255,.8);}'
    + '.hz-meta{margin-top:4px;font-size:.72rem;color:rgba(255,255,255,.38);'
    + 'display:flex;gap:10px;flex-wrap:wrap;}'
    + '.hz-badge{padding:1px 6px;border-radius:4px;background:rgba(255,255,255,.07);}'
    + '.hz-badge.bad{color:#ff8d97;background:rgba(255,77,94,.13);}'
    + '.hz-badge.warn{color:#e0b84a;background:rgba(224,184,74,.13);}'
    + '.hz-btn{padding:6px 12px;border-radius:7px;cursor:pointer;font:inherit;'
    + 'font-size:.78rem;color:#fff;background:rgba(255,255,255,.1);'
    + 'border:1px solid rgba(255,255,255,.2);white-space:nowrap;}'
    + '.hz-btn:hover{background:rgba(255,255,255,.2);}'
    + '.hz-btn:disabled{opacity:.45;cursor:default;}'
    + '.hz-empty{color:rgba(255,255,255,.4);padding:26px 0;font-size:.9rem;}'
    + '.hz-note{color:rgba(255,255,255,.4);font-size:.82rem;margin:0 0 14px;}'
    + '.hz-more{margin-top:16px;}'
    + '.hz-hosts{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 16px;font-size:.72rem;}'
    + '.hz-hosts .hz-badge b{color:rgba(255,255,255,.7);font-variant-numeric:tabular-nums;}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function text(path) {
    return fetch(path, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .catch(function () { return ''; });
  }

  // The log stores the raw data-file line, so the URL arrives quoted with a
  // trailing comma. Pull the bare URL back out.
  function unquote(raw) {
    var m = String(raw).match(/"(https?:\/\/[^"]+)"/);
    return m ? m[1] : String(raw).trim().replace(/^"|",?$/g, '');
  }

  function parseRemoved(txt) {
    return txt.split('\n').filter(Boolean).map(function (line) {
      var c = line.split('\t');
      return {
        date: c[0] || '', file: c[1] || '', where: c[2] || '',
        reason: c[3] || '', url: unquote(c[4] || '')
      };
    }).filter(function (r) { return /^https?:/.test(r.url); }).reverse();
  }
  function parseFailures(txt) {
    return txt.split('\n').filter(Boolean).map(function (line) {
      var c = line.split('\t');
      return { url: c[0] || '', reason: (c[1] || '').slice(0, 160) };
    }).filter(function (r) { return /^https?:/.test(r.url); });
  }

  Promise.all([
    text('/health/removed-links.log'),
    text('/health/thumbs-failures.log'),
    text('/health/link-strikes.json')
  ]).then(function (out) {
    var removed = parseRemoved(out[0]);
    var failures = parseFailures(out[1]);
    var strikes = [];
    try {
      var obj = JSON.parse(out[2] || '{}');
      strikes = Object.keys(obj).map(function (u) {
        return { url: u, count: obj[u].count, last: obj[u].last, reason: obj[u].reason };
      }).sort(function (a, b) { return b.count - a.count; });
    } catch (e) {}
    render(removed, failures, strikes);
  });

  function render(removed, failures, strikes) {
    root.innerHTML = ''
      + '<div class="hz-tabs">'
      + tab('removed', 'Removed', removed.length, true)
      + tab('strikes', 'On strike', strikes.length, false)
      + tab('thumbs', 'No thumbnail', failures.length, false)
      + tab('dupes', 'Duplicates', '·', false)
      + '</div>'
      + '<div class="hz-panel on" id="hz-removed"></div>'
      + '<div class="hz-panel" id="hz-strikes"></div>'
      + '<div class="hz-panel" id="hz-thumbs"></div>'
      + '<div class="hz-panel" id="hz-dupes"></div>';

    root.querySelectorAll('.hz-tab').forEach(function (t) {
      t.addEventListener('click', function () {
        root.querySelectorAll('.hz-tab').forEach(function (x) { x.classList.remove('on'); });
        root.querySelectorAll('.hz-panel').forEach(function (x) { x.classList.remove('on'); });
        t.classList.add('on');
        document.getElementById('hz-' + t.dataset.k).classList.add('on');
        if (t.dataset.k === 'dupes') loadDupes(t);
      });
    });

    paintRemoved(removed);
    paintList('hz-strikes', strikes, function (s) {
      return '<span class="hz-badge warn">' + esc(s.count) + ' of 3 strikes</span>'
        + '<span>' + esc(s.reason) + '</span><span>last ' + esc(s.last) + '</span>';
    }, 'Nothing is on strike. Every link passed its last check.',
      'A link is dropped only after failing three weekly checks in a row.');
    paintList('hz-thumbs', failures, function (f) {
      return '<span class="hz-badge bad">no thumbnail</span><span>' + esc(f.reason) + '</span>';
    }, 'Every link produced a thumbnail.',
      'These still play — the site falls back to generating a poster in the browser.');
  }

  function tab(k, label, n, on) {
    return '<button type="button" class="hz-tab' + (on ? ' on' : '') + '" data-k="' + k + '">'
      + esc(label) + ' <span class="n">' + n + '</span></button>';
  }

  // Long lists render a page at a time — thumbs-failures alone is 100+ rows.
  function paginate(host, rows, rowHtml, emptyMsg) {
    var shown = 0, PAGE = 40;
    var list = document.createElement('div');
    var more = document.createElement('button');
    more.type = 'button'; more.className = 'hz-btn hz-more';
    host.append(list, more);

    function draw() {
      if (!rows.length) { list.innerHTML = '<p class="hz-empty">' + emptyMsg + '</p>'; more.remove(); return; }
      var next = rows.slice(shown, shown + PAGE);
      next.forEach(function (r) { list.insertAdjacentHTML('beforeend', rowHtml(r)); });
      shown += next.length;
      if (shown >= rows.length) more.remove();
      else more.textContent = 'Show ' + Math.min(PAGE, rows.length - shown) + ' more';
    }
    more.addEventListener('click', draw);
    draw();
    return list;
  }

  function paintList(id, rows, metaHtml, emptyMsg, note) {
    var host = document.getElementById(id);
    if (note) host.insertAdjacentHTML('beforeend', '<p class="hz-note">' + note + '</p>');
    paginate(host, rows, function (r) {
      return '<div class="hz-row"><div><div class="hz-url">' + esc(r.url) + '</div>'
        + '<div class="hz-meta">' + metaHtml(r) + '</div></div></div>';
    }, emptyMsg);
  }

  function paintRemoved(rows) {
    var host = document.getElementById('hz-removed');
    host.insertAdjacentHTML('beforeend',
      '<p class="hz-note">Links dropped after failing three weekly checks. '
      + 'Restore puts one straight back into its data file.</p>'
      + '<input class="hz-filter" id="hz-q" type="search" placeholder="Filter by collection or URL…" '
      + 'autocomplete="off" spellcheck="false">');

    var box = document.createElement('div');
    host.appendChild(box);

    function draw(filter) {
      box.innerHTML = '';
      var f = (filter || '').trim().toLowerCase();
      var use = f ? rows.filter(function (r) {
        return r.url.toLowerCase().indexOf(f) !== -1 || r.file.toLowerCase().indexOf(f) !== -1;
      }) : rows;
      paginate(box, use, function (r) {
        return '<div class="hz-row" data-url="' + esc(r.url) + '" data-slug="'
          + esc(r.file.replace(/\.js$/, '')) + '">'
          + '<div><div class="hz-url">' + esc(r.url) + '</div><div class="hz-meta">'
          + '<span class="hz-badge">' + esc(r.file.replace(/\.js$/, '')) + '</span>'
          + '<span class="hz-badge bad">' + esc(r.reason) + '</span>'
          + '<span>' + esc(r.date) + '</span></div></div>'
          + '<button type="button" class="hz-btn hz-restore">Restore</button></div>';
      }, 'Nothing has been removed.');
    }

    host.querySelector('#hz-q').addEventListener('input', function (e) { draw(e.target.value); });
    draw('');

    host.addEventListener('click', function (e) {
      var btn = e.target.closest('.hz-restore');
      if (!btn) return;
      var row = btn.closest('.hz-row');
      restore(row.dataset.slug, row.dataset.url, btn);
    });
  }

  // ── Duplicates across collections ────────────────────────
  // Loaded on demand: this reads every data file (~1MB), which is not worth
  // doing unless you actually open the tab.
  var SLUGS = [
    'animations', 'bluesky-likes', 'bomb-ass-dee', 'bomb-ass-dee-pt-2',
    'coomer', 'dropbox', 'meatsenpaii', 'x-likes-long', 'x-likes-short',
    'gifs', 'images', 'sandf', 'show-off', 'tumblr'
  ];
  var dupesLoaded = false;

  // Parse a data file the way the engines do, without executing it as script:
  // take only lines that are a whole entry, so the header comment's sample URL
  // is never mistaken for content.
  function urlsIn(src) {
    var out = [];
    src.split('\n').forEach(function (line) {
      var t = line.trim();
      if (!t || t.indexOf('//') === 0) return;
      if (!/^(\{.*\}|"[^"]*")\s*,?$/.test(t)) return;
      var m = t.match(/"(https?:\/\/[^"]+)"/);
      if (m) out.push(m[1]);
    });
    return out;
  }

  function loadDupes(tabBtn) {
    if (dupesLoaded) return;
    dupesLoaded = true;
    var host = document.getElementById('hz-dupes');
    host.innerHTML = '<p class="hz-loading">Reading every collection…</p>';

    Promise.all(SLUGS.map(function (s) {
      return text('/data/' + s + '.js').then(function (t) { return { slug: s, urls: urlsIn(t) }; });
    })).then(function (files) {
      var seen = {};   // url -> [slug, ...] with repeats
      var hosts = {};
      var total = 0;
      files.forEach(function (f) {
        f.urls.forEach(function (u) {
          total++;
          (seen[u] = seen[u] || []).push(f.slug);
          var h;
          try { h = new URL(u).hostname.replace(/^www\./, ''); } catch (e) { h = '?'; }
          hosts[h] = (hosts[h] || 0) + 1;
        });
      });

      var dupes = Object.keys(seen).filter(function (u) { return seen[u].length > 1; })
        .map(function (u) {
          var where = seen[u];
          var uniq = where.filter(function (s, i) { return where.indexOf(s) === i; });
          return { url: u, count: where.length, slugs: uniq, cross: uniq.length > 1 };
        })
        .sort(function (a, b) { return (b.cross - a.cross) || (b.count - a.count); });

      var topHosts = Object.keys(hosts).sort(function (a, b) { return hosts[b] - hosts[a]; }).slice(0, 12);
      if (tabBtn) tabBtn.querySelector('.n').textContent = dupes.length;

      host.innerHTML = '<p class="hz-note">'
        + total.toLocaleString() + ' links across ' + files.length + ' collections. '
        + dupes.length + ' appear more than once — '
        + dupes.filter(function (d) { return d.cross; }).length
        + ' of those span more than one collection.</p>'
        + '<div class="hz-hosts">' + topHosts.map(function (h) {
            return '<span class="hz-badge">' + esc(h) + ' <b>' + hosts[h] + '</b></span>';
          }).join('') + '</div>';

      var box = document.createElement('div');
      host.appendChild(box);
      paginate(box, dupes, function (d) {
        return '<div class="hz-row"><div><div class="hz-url">' + esc(d.url) + '</div>'
          + '<div class="hz-meta">'
          + '<span class="hz-badge ' + (d.cross ? 'warn' : '') + '">'
          + esc(d.count) + '×</span>'
          + d.slugs.map(function (s) { return '<span class="hz-badge">' + esc(s) + '</span>'; }).join('')
          + '</div></div></div>';
      }, 'No duplicates anywhere. Every link is unique.');
    });
  }

  function restore(slug, url, btn) {
    var key;
    try { key = localStorage.getItem(KEY_STORE) || ''; } catch (e) { key = ''; }
    if (!key) { alert('Add a link from a collection page once so the vault key is saved.'); return; }
    btn.disabled = true;
    btn.textContent = 'Restoring…';
    fetch(ADMIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Vault-Key': key },
      body: JSON.stringify({ slug: slug, urls: [url] })
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, data: d }; });
    }).then(function (res) {
      if (!res.ok) { btn.disabled = false; btn.textContent = 'Restore'; alert(res.data.error || 'Restore failed.'); return; }
      // Already present counts as restored — the goal is that it is back.
      btn.textContent = res.data.added ? 'Restored' : 'Already there';
    }).catch(function () {
      btn.disabled = false; btn.textContent = 'Restore';
      alert('Could not reach the worker.');
    });
  }
})();
