(function () {
  'use strict';
  var root = document.documentElement;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var store = {
    get: function (k) { try { return window.localStorage.getItem('sll.' + k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem('sll.' + k, v); } catch (e) { /* storage may be blocked */ } }
  };
  var reduced = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var KO = window.I18N_KO || {};

  /* theme: auto = no attribute, light/dark = data-theme, neon = data-skin */
  var themeSel = $('#theme-select');
  function applyTheme(v) {
    root.removeAttribute('data-theme');
    root.removeAttribute('data-skin');
    if (v === 'light' || v === 'dark') root.setAttribute('data-theme', v);
    else if (v === 'neon') root.setAttribute('data-skin', 'neon');
    else v = 'auto';
    themeSel.value = v;
  }
  themeSel.addEventListener('change', function () { applyTheme(themeSel.value); store.set('theme', themeSel.value); });

  /* language: English is in the markup; Korean comes from the dictionary */
  function applyLang(l) {
    l = l === 'ko' ? 'ko' : 'en';
    root.setAttribute('lang', l);
    $$('[data-i18n]').forEach(function (el) {
      if (el.getAttribute('data-en') === null) el.setAttribute('data-en', el.innerHTML);
      var k = el.getAttribute('data-i18n');
      el.innerHTML = (l === 'ko' && KO[k] != null) ? KO[k] : el.getAttribute('data-en');
    });
    $$('[data-i18n-aria]').forEach(function (el) {
      if (el.getAttribute('data-en-aria') === null) el.setAttribute('data-en-aria', el.getAttribute('aria-label') || '');
      var k = el.getAttribute('data-i18n-aria');
      el.setAttribute('aria-label', (l === 'ko' && KO[k] != null) ? KO[k] : el.getAttribute('data-en-aria'));
    });
    store.set('lang', l);
  }
  $('#lang-toggle').addEventListener('click', function () { applyLang(root.getAttribute('lang') === 'ko' ? 'en' : 'ko'); });

  /* story mode: highlights the active step of the timeline and lineage figures while scrolling */
  var storyBtn = $('#story-toggle');
  var io = null;
  function activate(li) {
    var scope = li.closest('[data-story-root]');
    if (!scope) return;
    var n = li.getAttribute('data-step-li');
    $$('[data-step-li]', scope).forEach(function (x) { x.classList.toggle('is-active', x === li); });
    $$('[data-step]', scope).forEach(function (x) { x.classList.toggle('is-active', x.getAttribute('data-step') === n); });
  }
  function stopStory() {
    if (io) { io.disconnect(); io = null; }
    $$('.is-active').forEach(function (x) { if (x.hasAttribute('data-step') || x.hasAttribute('data-step-li')) x.classList.remove('is-active'); });
  }
  function setStory(on) {
    if (reduced.matches || !('IntersectionObserver' in window)) on = false;
    storyBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    stopStory();
    if (on) {
      root.setAttribute('data-story', 'on');
      $$('[data-story-root]').forEach(function (s) { var first = $('[data-step-li]', s); if (first) activate(first); });
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) activate(e.target); });
      }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
      $$('[data-step-li]').forEach(function (li) { io.observe(li); });
    } else {
      root.removeAttribute('data-story');
    }
    store.set('story', on ? 'on' : 'off');
  }
  function syncMotion() {
    storyBtn.disabled = !!reduced.matches;
    if (reduced.matches) { storyBtn.title = 'Disabled: reduced motion is on'; setStory(false); } else { storyBtn.removeAttribute('title'); }
  }
  storyBtn.addEventListener('click', function () { setStory(storyBtn.getAttribute('aria-pressed') !== 'true'); });
  if (reduced.addEventListener) reduced.addEventListener('change', syncMotion);

  /* timeline: move measured_at, see which state each join attaches */
  var slider = $('#timeline-slider');
  var DRAW = 520, FEED = 540, RUN = 4.5, SLA = 30, TESTED = 55; /* minutes since midnight and minutes */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function clock(m) { return pad(Math.floor(m / 60)) + ':' + pad(Math.floor(m % 60)); }
  function clockS(m) { var s = Math.round(m * 60); return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(s % 60); }
  function xOf(m) { return 150 + (m - 510) * 5; }
  function updateTimeline() {
    var m = +slider.value, runStart = m - RUN, hold = runStart - DRAW;
    var gap = m >= FEED, xm = xOf(m);
    var state = gap ? 'gap' : 'agree';
    var holdState = hold > TESTED ? 'over55' : (hold > SLA ? 'over30' : 'within');
    $('#tl-out').textContent = clock(m);
    slider.setAttribute('aria-valuetext', clock(m));
    $('#r-meas').textContent = clock(m);
    $('#r-run').textContent = clockS(runStart);
    $('#r-span').textContent = Math.round(m - DRAW) + ' min';
    $('#r-hold').textContent = hold.toFixed(1) + ' min';
    var jr = $('#join-result'), svg = $('#tl-svg');
    jr.setAttribute('data-state', state); jr.setAttribute('data-hold', holdState); svg.setAttribute('data-state', state);
    $('#tl-meas').setAttribute('transform', 'translate(' + (xm - 425) + ' 0)');
    $('#tl-join2').setAttribute('transform', 'translate(' + (xm - 425) + ' 0)');
    var lbl = $('#tl-meas-lbl'), lt = $('#tl-meas-t'), lx = xm > 600 ? 417 : 433;
    lt.textContent = clock(m);
    lbl.setAttribute('x', lx); lt.setAttribute('x', lx);
    lbl.setAttribute('text-anchor', xm > 600 ? 'end' : 'start');
    $('#tl-run').setAttribute('x', xm - RUN * 5);
    var wait = $('#tl-wait');
    wait.setAttribute('width', Math.max(0, xm - RUN * 5 - xOf(DRAW)));
    var flip = xm > 230; /* label sits left of the line so it stays inside the scrolled view */
    $$('#tl-svg .j2').forEach(function (t) { t.setAttribute('text-anchor', flip ? 'end' : 'start'); t.setAttribute('x', flip ? 419 : 431); });
  }
  function followMarker() { /* on narrow screens keep the moving measured_at marker and its label inside the scrolled view */
    var fs = $('#tl-svg').closest('.fig-scroll');
    if (!fs || fs.scrollWidth <= fs.clientWidth + 1) return;
    var k = fs.scrollWidth / 780, viewW = fs.clientWidth / k, xm = xOf(+slider.value);
    fs.scrollLeft = Math.max(0, xm + 120 - viewW) * k;
  }
  slider.addEventListener('input', function () { updateTimeline(); followMarker(); });

  /* architectures: the flags drive the outcome matrix (a design hypothesis, not a result); the last two drive no row of it, they act only with a contamination event */
  var FLAGS = ['system_issued_id', 'two_clocks', 'available_at', 'instrument_state_snapshot', 'append_only_versions', 'write_time_keys', 'ingest_idempotency', 'audit_trail', 'material_lot_links', 'equipment_links'];
  var PRESETS = { A: [], B: ['system_issued_id', 'ingest_idempotency', 'audit_trail', 'equipment_links'], C: FLAGS };
  var ROWS = { /* p = flags that prevent, d = flags that let a rule detect (design hypothesis) */
    label: { p: ['system_issued_id'], d: ['two_clocks'] },
    feed: { p: ['two_clocks'], d: [] },
    rekey: { p: ['write_time_keys'], d: ['two_clocks'] },
    clock: { p: [], d: ['two_clocks'] },
    dup: { p: ['ingest_idempotency'], d: [] },
    rerun: { p: ['append_only_versions'], d: ['audit_trail'] },
    instr: { p: [], d: ['instrument_state_snapshot'] },
    late: { p: ['available_at'], d: [] },
    attr: { p: ['audit_trail'], d: [] },
    tech: { p: [], d: ['two_clocks'] }
  };
  function flagOn(name) { var el = $('#flag-' + name); return !!(el && el.checked); }
  function any(list) { return list.some(flagOn); }
  function updateMatrix() {
    Object.keys(ROWS).forEach(function (key) {
      var tr = $('#outcome-matrix tr[data-err="' + key + '"]');
      if (!tr) return;
      var out = any(ROWS[key].p) ? 'prevented' : (any(ROWS[key].d) ? 'detected' : 'invisible');
      tr.setAttribute('data-outcome', out);
      $$('td[data-col]', tr).forEach(function (td) {
        var now = td.getAttribute('data-col') === out;
        td.classList.toggle('is-now', now);
        if (now) td.setAttribute('aria-current', 'true'); else td.removeAttribute('aria-current');
      });
    });
    var current = FLAGS.filter(flagOn).sort().join(',');
    var match = 'custom';
    Object.keys(PRESETS).forEach(function (p) { if (PRESETS[p].slice().sort().join(',') === current) match = p; });
    $('#preset-readout').setAttribute('data-now', match);
    $$('#flag-presets [data-preset]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-preset') === match ? 'true' : 'false'); });
  }
  $$('#flag-toggles input[type=checkbox]').forEach(function (cb) { cb.addEventListener('change', updateMatrix); });
  $$('#flag-presets [data-preset]').forEach(function (b) {
    b.addEventListener('click', function () {
      var on = PRESETS[b.getAttribute('data-preset')];
      FLAGS.forEach(function (f) { $('#flag-' + f).checked = on.indexOf(f) >= 0; });
      updateMatrix();
    });
  });

  /* scroll hint: shown above wide diagrams and tables only when they overflow */
  function checkOverflow() {
    $$('.scroll-hint').forEach(function (h) {
      var s = h.nextElementSibling;
      if (s && s.scrollWidth > s.clientWidth + 1) h.setAttribute('data-on', ''); else h.removeAttribute('data-on');
    });
  }
  window.addEventListener('resize', checkOverflow);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(checkOverflow);

  /* start-up: saved preferences, then the first paint of the interactive parts */
  applyTheme(store.get('theme') || 'auto');
  if (store.get('lang') === 'ko') applyLang('ko');
  syncMotion();
  if (!reduced.matches && store.get('story') === 'on') setStory(true);
  updateTimeline();
  updateMatrix();
  checkOverflow();
  followMarker();
})();
