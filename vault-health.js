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
    + '.hz-hosts .hz-badge b{color:rgba(255,255,255,.7);font-variant-numeric:tabular-nums;}'
    + '.hz-h{font-size:.95rem;font-weight:600;margin:26px 0 8px;color:#fff;}'
    + '.hz-h:first-of-type{margin-top:8px;}'
    + '#hz-clean-log{margin-top:14px;min-height:1.2em;}'
    + '.hz-rowmsg{font-size:.78rem;color:#3ddc84;padding:2px 0 8px;}'
    + '.hz-rowmsg.bad{color:#ff8d97;}'
    + '.hz-keyrow{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 16px;'
    + 'padding:12px;border:1px solid rgba(255,255,255,.12);border-radius:10px;'
    + 'background:rgba(255,255,255,.04);}'
    + '.hz-keyrow label{font-size:.78rem;color:rgba(255,255,255,.5);}'
    + '.hz-keyrow input{flex:1;min-width:160px;padding:7px 10px;border-radius:7px;'
    + 'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);'
    + 'color:#fff;font:inherit;font-size:.85rem;}'
    + '.hz-keyrow input:focus{outline:none;border-color:rgba(255,255,255,.4);}';
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
      + tab('clean', 'Cleanup', '·', false)
      + '</div>'
      + '<div class="hz-panel on" id="hz-removed"></div>'
      + '<div class="hz-panel" id="hz-strikes"></div>'
      + '<div class="hz-panel" id="hz-thumbs"></div>'
      + '<div class="hz-panel" id="hz-dupes"></div>'
      + '<div class="hz-panel" id="hz-clean"></div>';

    root.querySelectorAll('.hz-tab').forEach(function (t) {
      t.addEventListener('click', function () {
        root.querySelectorAll('.hz-tab').forEach(function (x) { x.classList.remove('on'); });
        root.querySelectorAll('.hz-panel').forEach(function (x) { x.classList.remove('on'); });
        t.classList.add('on');
        document.getElementById('hz-' + t.dataset.k).classList.add('on');
        if (t.dataset.k === 'dupes') loadDupes(t);
        if (t.dataset.k === 'clean') loadCleanup(t, strikes);
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
    'gifs', 'images', 'sandf', 'show-off', 'tumblr',
    'tragic-dee'
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

  // ── Cleanup ──────────────────────────────────────────────
  // Two destructive operations, both preview-then-confirm because they rewrite
  // hand-curated data files.
  //
  //   Dedupe   drop repeats of the same URL inside one collection, keeping
  //            the first occurrence.
  //   Salvage  when dead links leave a section with 3 or fewer survivors, move
  //            those survivors into "Tragic Dee", grouped by host.
  //
  // "Dead" means the weekly checker's verdict — link-strikes.json — NOT the
  // thumbnail-failure log. Those links still play; treating them as dead would
  // delete working videos.
  function storedKey() {
    try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; }
  }

  var SALVAGE_SLUG = 'tragic-dee';
  var SALVAGE_MAX = 3;
  var cleanLoaded = false;

  // Sections of a data file, as arrays of entry URLs.
  function sectionsIn(src) {
    var secs = [], cur = [], started = false, labels = [];
    var lm = src.match(/var\s+DIV_LABELS\s*=\s*\[(.*)\];/);
    if (lm) labels = (lm[1].match(/"(?:[^"\\]|\\.)*"/g) || []).map(function (s) {
      try { return JSON.parse(s); } catch (e) { return s; }
    });
    src.split('\n').forEach(function (line) {
      if (!started) { if (/var\s+(SOURCES|IMGS)\s*=\s*\[/.test(line)) started = true; return; }
      if (/^\s*\];\s*$/.test(line)) { started = false; return; }
      if (/^\s*null\s*,?\s*$/.test(line)) { secs.push(cur); cur = []; return; }
      var u = entryUrlOf(line);
      if (u) cur.push(u);
    });
    secs.push(cur);
    return { sections: secs, labels: labels };
  }
  function entryUrlOf(line) {
    var t = line.trim();
    if (!t || t.indexOf('//') === 0) return null;
    if (!/^(\{.*\}|"[^"]*")\s*,?$/.test(t)) return null;
    var m = t.match(/"(https?:\/\/[^"]+)"/);
    return m ? m[1] : null;
  }
  function hostOf(u) {
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return 'unknown'; }
  }

  function loadCleanup(tabBtn, strikes) {
    if (cleanLoaded) return;
    cleanLoaded = true;
    var host = document.getElementById('hz-clean');
    host.innerHTML = '<p class="hz-loading">Reading every collection…</p>';
    var dead = {};
    (strikes || []).forEach(function (s) { dead[s.url] = true; });

    Promise.all(SLUGS.map(function (s) {
      return text('/data/' + s + '.js').then(function (t) { return { slug: s, src: t }; });
    })).then(function (files) {
      var dupPlan = [], salvagePlan = [];
      files.forEach(function (f) {
        if (f.slug === SALVAGE_SLUG) return;
        var parsed = sectionsIn(f.src);
        // duplicates across the whole collection
        var seen = {}, dups = 0;
        parsed.sections.forEach(function (sec) {
          sec.forEach(function (u) {
            if (seen[u]) dups++; else seen[u] = true;
          });
        });
        if (dups) dupPlan.push({ slug: f.slug, dups: dups, total: Object.keys(seen).length + dups });
        // gutted sections
        parsed.sections.forEach(function (sec, i) {
          if (!sec.length) return;
          var alive = sec.filter(function (u) { return !dead[u]; });
          var deadCount = sec.length - alive.length;
          if (alive.length > 0 && alive.length <= SALVAGE_MAX && deadCount > 0) {
            salvagePlan.push({
              slug: f.slug, section: i,
              label: parsed.labels[i] || ('Part ' + (i + 1)),
              survivors: alive, deadCount: deadCount
            });
          }
        });
      });

      var totalDups = dupPlan.reduce(function (a, d) { return a + d.dups; }, 0);
      if (tabBtn) tabBtn.querySelector('.n').textContent = totalDups;
      paintCleanup(host, dupPlan, totalDups, salvagePlan, Object.keys(dead).length);
    });
  }

  function keyRowHtml() {
    return '<div class="hz-keyrow"><label for="hz-key">Vault key</label>'
      + '<input id="hz-key" type="password" placeholder="the key the + button uses" '
      + 'autocomplete="off"><button type="button" class="hz-btn" id="hz-key-save">Save</button>'
      + '</div>';
  }

  function paintCleanup(host, dupPlan, totalDups, salvagePlan, deadCount) {
    host.innerHTML =
      (storedKey() ? '' : keyRowHtml())
      + '<p class="hz-note">Both actions rewrite data files and commit. Nothing runs '
      + 'until you confirm. <b>Dead</b> here means the weekly checker\'s verdict ('
      + deadCount + ' link' + (deadCount === 1 ? '' : 's') + ' on strike) — not the '
      + 'thumbnail-failure list, whose links still play.</p>'

      + '<h3 class="hz-h">Duplicates within a collection</h3>'
      + (totalDups
          ? '<p class="hz-note">' + totalDups + ' repeated link'
            + (totalDups === 1 ? '' : 's') + ' across ' + dupPlan.length
            + ' collection' + (dupPlan.length === 1 ? '' : 's') + '. The first copy is kept.</p>'
            + '<div id="hz-dup-plan">' + dupPlan.map(function (d) {
                return '<div class="hz-row" data-slug="' + esc(d.slug) + '">'
                  + '<div><div class="hz-url">' + esc(d.slug) + '</div>'
                  + '<div class="hz-meta"><span class="hz-badge warn">' + d.dups
                  + ' duplicate' + (d.dups === 1 ? '' : 's') + '</span>'
                  + '<span>of ' + d.total + ' entries</span></div></div>'
                  + '<button type="button" class="hz-btn hz-dedupe">Remove</button></div>';
              }).join('') + '</div>'
            + '<button type="button" class="hz-btn hz-more" id="hz-dedupe-all">Remove all '
            + totalDups + ' duplicates</button>'
          : '<p class="hz-empty">No collection repeats a link.</p>')

      + '<h3 class="hz-h">Gutted sections → Tragic Dee</h3>'
      + (salvagePlan.length
          ? '<p class="hz-note">' + salvagePlan.length + ' section'
            + (salvagePlan.length === 1 ? '' : 's') + ' left with ' + SALVAGE_MAX
            + ' or fewer working links. Survivors move to <b>Tragic Dee</b>, '
            + 'in sections named after their host.</p>'
            + '<div id="hz-salv-plan">' + salvagePlan.map(function (p, i) {
                var hosts = {};
                p.survivors.forEach(function (u) { hosts[hostOf(u)] = true; });
                return '<div class="hz-row" data-i="' + i + '">'
                  + '<div><div class="hz-url">' + esc(p.slug) + ' · ' + esc(p.label) + '</div>'
                  + '<div class="hz-meta">'
                  + '<span class="hz-badge warn">' + p.survivors.length + ' left</span>'
                  + '<span class="hz-badge bad">' + p.deadCount + ' dead</span>'
                  + '<span>→ ' + esc(Object.keys(hosts).join(', ')) + '</span>'
                  + '</div></div>'
                  + '<button type="button" class="hz-btn hz-salvage">Move</button></div>';
              }).join('') + '</div>'
          : '<p class="hz-empty">Nothing is gutted. Every section still has more than '
            + SALVAGE_MAX + ' working links, so there is nothing to salvage.</p>')
      + '<div id="hz-clean-log" class="hz-note"></div>';

    var log = host.querySelector('#hz-clean-log');
    function say(m) { log.textContent = m; }

    function wireKeyRow() {
      var keyInput = host.querySelector('#hz-key');
      if (!keyInput) return;
      var saveKey = function () {
        var v = keyInput.value.trim();
        if (!v) return;
        try { localStorage.setItem(KEY_STORE, v); } catch (e) {}
        var r = host.querySelector('.hz-keyrow');
        if (r) r.remove();
      };
      host.querySelector('#hz-key-save').addEventListener('click', saveKey);
      keyInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') saveKey(); });
    }
    wireKeyRow();

    host.querySelectorAll('.hz-dedupe').forEach(function (b) {
      b.addEventListener('click', function () {
        var slug = b.closest('.hz-row').dataset.slug;
        if (!requireKey(b)) return;
        if (!confirm('Remove duplicate links from ' + slug + '?\n\nThe first copy of each is kept.')) return;
        runDedupe(slug, b, say);
      });
    });
    function requireKey(btn) {
      if (storedKey()) return true;
      // The field is removed once a key is saved, so put it back if the key
      // was cleared since this panel rendered — otherwise the message below
      // points at something that is not on screen.
      var f = host.querySelector('#hz-key');
      if (!f) { host.insertAdjacentHTML('afterbegin', keyRowHtml()); wireKeyRow(); f = host.querySelector('#hz-key'); }
      rowSay(btn, 'Enter your vault key at the top of this panel first.', true);
      if (f) { f.focus(); f.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      return false;
    }

    var all = host.querySelector('#hz-dedupe-all');
    if (all) all.addEventListener('click', function () {
      if (!storedKey()) {
        say('Enter your vault key at the top of this panel first.');
        var f = host.querySelector('#hz-key');
        if (f) { f.focus(); f.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        return;
      }
      if (!confirm('Remove all ' + totalDups + ' duplicates across '
        + dupPlan.length + ' collections?\n\nEach collection commits separately.')) return;
      all.disabled = true;
      var queue = dupPlan.slice();
      (function next() {
        if (!queue.length) { say('Done. All collections deduplicated.'); return; }
        var d = queue.shift();
        var btn = host.querySelector('.hz-row[data-slug="' + d.slug + '"] .hz-dedupe');
        runDedupe(d.slug, btn, say, next);
      })();
    });

    host.querySelectorAll('.hz-salvage').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = salvagePlan[Number(b.closest('.hz-row').dataset.i)];
        if (!requireKey(b)) return;
        if (!confirm('Move ' + p.survivors.length + ' link'
          + (p.survivors.length === 1 ? '' : 's') + ' from ' + p.slug + ' · ' + p.label
          + ' into Tragic Dee?')) return;
        runSalvage(p, b, say);
      });
    });
  }

  // Status belongs beside the control that was pressed. A shared log at the
  // foot of the panel is off-screen when you click a row near the top, which
  // makes a real failure look like nothing happening at all.
  function rowSay(btn, msg, bad) {
    var row = btn && btn.closest('.hz-row');
    if (!row) return;
    var el = row.nextElementSibling;
    if (!el || !el.classList.contains('hz-rowmsg')) {
      el = document.createElement('div');
      el.className = 'hz-rowmsg';
      row.parentNode.insertBefore(el, row.nextSibling);
    }
    el.textContent = msg;
    el.classList.toggle('bad', !!bad);
  }

  function post(payload) {
    var key = storedKey();
    if (!key) return Promise.reject(new Error('Enter your vault key above first.'));
    return fetch(ADMIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Vault-Key': key },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.error || ('failed (' + r.status + ')'));
        return d;
      });
    });
  }

  function runDedupe(slug, btn, say, done) {
    if (btn) { btn.disabled = true; btn.textContent = 'Removing…'; }
    say('Deduplicating ' + slug + '…');
    post({ slug: slug, action: 'dedupe' }).then(function (d) {
      if (btn) btn.textContent = d.removed ? 'Removed ' + d.removed : 'None';
      rowSay(btn, 'Removed ' + (d.removed || 0) + '.', false);
      say(slug + ': removed ' + (d.removed || 0) + '.');
      if (done) setTimeout(done, 700); // stay clear of the worker's rate limit
    }).catch(function (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Failed'; btn.title = e.message; }
      rowSay(btn, e.message, true);
      say(slug + ': ' + e.message);
      if (done) setTimeout(done, 700);
    });
  }

  // Add to Tragic Dee first, remove from the source second. If the run dies in
  // between you get a duplicate, not a hole — the safe direction to fail.
  function runSalvage(p, btn, say) {
    btn.disabled = true; btn.textContent = 'Moving…';
    var byHost = {};
    p.survivors.forEach(function (u) { (byHost[hostOf(u)] = byHost[hostOf(u)] || []).push(u); });
    var hosts = Object.keys(byHost);

    text('/data/' + SALVAGE_SLUG + '.js').then(function (src) {
      var existing = src ? (sectionsIn(src).labels || []) : [];
      var chain = Promise.resolve();
      hosts.forEach(function (h) {
        chain = chain.then(function () {
          var idx = existing.indexOf(h);
          if (idx !== -1) return idx;
          say('Creating section ' + h + '…');
          return post({ slug: SALVAGE_SLUG, action: 'add-section', label: h })
            .then(function () { existing.push(h); return existing.length - 1; });
        }).then(function (idx) {
          say('Moving ' + byHost[h].length + ' from ' + h + '…');
          return post({ slug: SALVAGE_SLUG, urls: byHost[h], section: idx });
        }).then(function () {
          return post({ slug: p.slug, action: 'remove', urls: byHost[h] });
        });
      });
      return chain;
    }).then(function () {
      btn.textContent = 'Moved';
      say('Moved ' + p.survivors.length + ' link(s) into Tragic Dee.');
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = 'Failed'; btn.title = e.message;
      rowSay(btn, e.message, true);
      say('Failed: ' + e.message);
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
