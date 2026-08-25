// Pattern lock gate — 3x3 grid, phone-keypad numbering (1 2 3 / 4 5 6 / 7 8 9).
//
// NOTE: this is a UI gate, not access control. The site is a public static host;
// data/*.js, thumbs/ and every media URL stay directly fetchable regardless of
// this screen. The digest below only keeps the pattern out of plain view-source —
// a 9-dot keyspace is small enough to brute-force offline, so treat this as the
// same class of thing as the age gate.
//
// To change the pattern, recompute the digest from the dot sequence:
//   printf '%s' 'vault:8-5-2-6-4' | shasum -a 256
(function () {
  var KEY = 'vault-unlocked';
  var SALT = 'vault:';
  var HASH = '751e4236b2857cd34845f3ce756b27e8420aa311a638f05a7104be507c0faca3';
  var MIN_NODES = 4;

  try { if (sessionStorage.getItem(KEY) === '1') return; } catch (e) {}

  // ── Styles (self-contained so no stylesheet needs touching) ────────────
  var css = ''
    + '#vault-lock{position:fixed;inset:0;z-index:1000000;background:#07070a;'
    + 'display:flex;align-items:center;justify-content:center;flex-direction:column;'
    + 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
    + '-webkit-user-select:none;user-select:none;touch-action:none;}'
    + '#vault-lock.vl-out{opacity:0;transition:opacity .38s ease;pointer-events:none;}'
    + '#vl-title{color:#fff;font-size:1.05rem;font-weight:600;letter-spacing:.02em;margin:0 0 .4rem;}'
    + '#vl-hint{color:rgba(255,255,255,.42);font-size:.82rem;margin:0 0 1.8rem;min-height:1.2em;'
    + 'transition:color .2s ease;}'
    + '#vl-hint.vl-bad{color:#ff4d5e;}'
    + '#vl-grid{position:relative;width:264px;height:264px;touch-action:none;}'
    + '#vl-grid.vl-shake{animation:vl-shake .42s cubic-bezier(.36,.07,.19,.97);}'
    + '@keyframes vl-shake{10%,90%{transform:translateX(-2px)}20%,80%{transform:translateX(4px)}'
    + '30%,50%,70%{transform:translateX(-7px)}40%,60%{transform:translateX(7px)}}'
    + '#vl-svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;}'
    + '.vl-dot{position:absolute;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;'
    + 'background:rgba(255,255,255,.16);transition:transform .16s ease,background .16s ease;}'
    + '.vl-dot.vl-on{background:#fff;transform:scale(1.35);}'
    + '#vl-grid.vl-err .vl-dot.vl-on{background:#ff4d5e;}'
    + '@media (prefers-reduced-motion:reduce){#vl-grid.vl-shake{animation:none}'
    + '.vl-dot{transition:none}#vault-lock.vl-out{transition:none}}';
  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  (document.head || document.documentElement).appendChild(styleEl);

  var prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';

  // ── Markup ─────────────────────────────────────────────────────────────
  var root = document.createElement('div');
  root.id = 'vault-lock';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Pattern lock');
  root.innerHTML = ''
    + '<h1 id="vl-title">The Vault</h1>'
    + '<p id="vl-hint">Draw your pattern to unlock</p>'
    + '<div id="vl-grid"><svg id="vl-svg" viewBox="0 0 264 264" aria-hidden="true">'
    + '<polyline id="vl-path" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="3" '
    + 'stroke-linecap="round" stroke-linejoin="round"/>'
    + '<line id="vl-live" stroke="rgba(255,255,255,.45)" stroke-width="3" stroke-linecap="round"/>'
    + '</svg></div>';

  function mount() { document.body.appendChild(root); }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);

  var grid = root.querySelector('#vl-grid');
  var svg = root.querySelector('#vl-svg');
  var pathEl = root.querySelector('#vl-path');
  var liveEl = root.querySelector('#vl-live');
  var hint = root.querySelector('#vl-hint');

  // Dots are laid out on a 3x3 lattice; index 0..8 maps to keypad number 1..9.
  var PAD = 32, STEP = 100; // 32 + 100*2 + 32 = 264
  var dots = [];
  for (var i = 0; i < 9; i++) {
    var d = document.createElement('div');
    d.className = 'vl-dot';
    d.style.left = (PAD + (i % 3) * STEP) + 'px';
    d.style.top = (PAD + Math.floor(i / 3) * STEP) + 'px';
    grid.appendChild(d);
    dots.push(d);
  }
  function centerOf(n) { // n is 1..9
    var i = n - 1;
    return { x: PAD + (i % 3) * STEP, y: PAD + Math.floor(i / 3) * STEP };
  }

  // A straight drag across a full row, column or main diagonal passes over the
  // dot in the middle — standard pattern-lock behaviour picks it up on the way.
  function between(a, b) {
    var ar = Math.floor((a - 1) / 3), ac = (a - 1) % 3;
    var br = Math.floor((b - 1) / 3), bc = (b - 1) % 3;
    var dr = br - ar, dc = bc - ac;
    if (Math.abs(dr) === 2 && dc === 0) return a + (dr > 0 ? 3 : -3);
    if (Math.abs(dc) === 2 && dr === 0) return a + (dc > 0 ? 1 : -1);
    if (Math.abs(dr) === 2 && Math.abs(dc) === 2) return 5;
    return 0;
  }

  var seq = [];
  var drawing = false;

  function redraw() {
    var pts = seq.map(function (n) { var c = centerOf(n); return c.x + ',' + c.y; });
    pathEl.setAttribute('points', pts.join(' '));
  }
  function clearLive() { liveEl.removeAttribute('x1'); liveEl.removeAttribute('x2'); }

  function reset() {
    seq = [];
    pathEl.removeAttribute('points');
    clearLive();
    grid.classList.remove('vl-err');
    dots.forEach(function (d) { d.classList.remove('vl-on'); });
  }

  // Map a client point into the grid's 264x264 coordinate space.
  function toLocal(ev) {
    var r = grid.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left) * (264 / r.width),
      y: (ev.clientY - r.top) * (264 / r.height)
    };
  }

  function hitTest(p) {
    for (var n = 1; n <= 9; n++) {
      var c = centerOf(n);
      var dx = p.x - c.x, dy = p.y - c.y;
      if (dx * dx + dy * dy <= 30 * 30) return n;
    }
    return 0;
  }

  function visit(n) {
    if (!n || seq.indexOf(n) !== -1) return;
    if (seq.length) {
      var mid = between(seq[seq.length - 1], n);
      // Skip the midpoint if it was already used — it is not re-added.
      if (mid && seq.indexOf(mid) === -1) {
        seq.push(mid);
        dots[mid - 1].classList.add('vl-on');
      }
    }
    seq.push(n);
    dots[n - 1].classList.add('vl-on');
    redraw();
  }

  function sha256Hex(str) {
    if (!(window.crypto && window.crypto.subtle)) return Promise.resolve(null);
    var buf = new TextEncoder().encode(str);
    return window.crypto.subtle.digest('SHA-256', buf).then(function (h) {
      return [].map.call(new Uint8Array(h), function (b) {
        return ('0' + b.toString(16)).slice(-2);
      }).join('');
    }).catch(function () { return null; });
  }

  function unlock() {
    try { sessionStorage.setItem(KEY, '1'); } catch (e) {}
    // The age gate sets its own scroll lock after this script runs. If it is
    // still up it owns the lock and clears it on "enter" — don't undo it here.
    var gate = document.getElementById('age-gate');
    var gateUp = gate && getComputedStyle(gate).display !== 'none';
    if (!gateUp) document.documentElement.style.overflow = prevOverflow;
    root.classList.add('vl-out');
    setTimeout(function () { root.remove(); styleEl.remove(); }, 400);
    document.dispatchEvent(new CustomEvent('vault-unlocked'));
  }

  // ── Attempt throttling ─────────────────────────────────────────────────
  // A 9-dot grid is small enough to grind by hand, so back off after a few
  // misses. State lives in localStorage, not sessionStorage — otherwise a
  // reload or a new tab resets the counter and the throttle means nothing.
  var F_KEY = 'vault-lock-fails', U_KEY = 'vault-lock-until';
  var BACKOFF = [0, 0, 5, 15, 30, 60, 120, 300]; // seconds, by failure count
  var cooldownTimer = null;

  function readNum(k) {
    try { return Number(localStorage.getItem(k)) || 0; } catch (e) { return 0; }
  }
  function writeNum(k, v) {
    try { localStorage.setItem(k, String(v)); } catch (e) {}
  }
  function lockedFor() {
    return Math.max(0, Math.ceil((readNum(U_KEY) - Date.now()) / 1000));
  }

  function tickCooldown() {
    var left = lockedFor();
    if (left > 0) {
      hint.classList.add('vl-bad');
      hint.textContent = 'Too many attempts — wait ' + left + 's';
      cooldownTimer = setTimeout(tickCooldown, 500);
    } else {
      cooldownTimer = null;
      hint.classList.remove('vl-bad');
      hint.textContent = 'Draw your pattern to unlock';
    }
  }
  if (lockedFor() > 0) tickCooldown();

  function fail() {
    var n = readNum(F_KEY) + 1;
    writeNum(F_KEY, n);
    var wait = BACKOFF[Math.min(n, BACKOFF.length - 1)];
    if (wait) writeNum(U_KEY, Date.now() + wait * 1000);

    grid.classList.add('vl-err', 'vl-shake');
    hint.classList.add('vl-bad');
    hint.textContent = 'Wrong pattern — try again';
    setTimeout(function () {
      grid.classList.remove('vl-shake');
      reset();
      if (lockedFor() > 0) { if (!cooldownTimer) tickCooldown(); return; }
      hint.classList.remove('vl-bad');
      hint.textContent = 'Draw your pattern to unlock';
    }, 700);
  }

  function submit() {
    if (seq.length < MIN_NODES) { reset(); return; }
    if (lockedFor() > 0) { reset(); if (!cooldownTimer) tickCooldown(); return; }
    var candidate = seq.join('-');
    sha256Hex(SALT + candidate).then(function (hex) {
      if (hex === null) { fail(); return; } // no crypto.subtle → refuse rather than fall back
      if (hex === HASH) {
        try { localStorage.removeItem(F_KEY); localStorage.removeItem(U_KEY); } catch (e) {}
        unlock();
      } else fail();
    });
  }

  grid.addEventListener('pointerdown', function (ev) {
    ev.preventDefault();
    if (lockedFor() > 0) { if (!cooldownTimer) tickCooldown(); return; }
    reset();
    drawing = true;
    try { grid.setPointerCapture(ev.pointerId); } catch (e) {}
    visit(hitTest(toLocal(ev)));
  });

  grid.addEventListener('pointermove', function (ev) {
    if (!drawing) return;
    ev.preventDefault();
    var p = toLocal(ev);
    visit(hitTest(p));
    if (seq.length) {
      var c = centerOf(seq[seq.length - 1]);
      liveEl.setAttribute('x1', c.x); liveEl.setAttribute('y1', c.y);
      liveEl.setAttribute('x2', p.x); liveEl.setAttribute('y2', p.y);
    }
  });

  function end(ev) {
    if (!drawing) return;
    if (ev) ev.preventDefault();
    drawing = false;
    clearLive();
    submit();
  }
  grid.addEventListener('pointerup', end);
  grid.addEventListener('pointercancel', end);
  grid.addEventListener('lostpointercapture', function () { if (drawing) end(null); });
})();
