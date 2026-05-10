/* Anchor — main.js (v2) */
(function () {
  'use strict';
  var rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Theme */
  (function () {
    var root = document.documentElement;
    var stored = localStorage.getItem('anchor-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', stored || (prefersDark ? 'dark' : 'light'));
    var btn = document.querySelector('.theme-toggle');
    function paint() {
      var t = root.getAttribute('data-theme');
      btn.setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
      var s = btn.querySelector('.icon-sun'), m = btn.querySelector('.icon-moon');
      if (s && m) { s.style.display = t === 'dark' ? 'block' : 'none'; m.style.display = t === 'dark' ? 'none' : 'block'; }
    }
    paint();
    btn && btn.addEventListener('click', function () {
      var n = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', n); localStorage.setItem('anchor-theme', n); paint();
    });
  }());

  /* Scroll progress */
  (function () {
    var bar = document.querySelector('.scroll-progress');
    if (!bar) return;
    function up() {
      var h = document.documentElement, max = h.scrollHeight - h.clientHeight;
      bar.style.setProperty('--p', (max > 0 ? (h.scrollTop / max) * 100 : 0) + '%');
    }
    document.addEventListener('scroll', up, { passive: true }); up();
  }());

  /* Nav compact */
  (function () {
    var nav = document.querySelector('.nav');
    function s() { nav.classList.toggle('compact', window.scrollY > 80); }
    document.addEventListener('scroll', s, { passive: true }); s();
  }());

  /* Hero typeset */
  (function () {
    var wm = document.querySelector('.wordmark');
    if (!wm) return;
    var letters = wm.querySelectorAll('.ch');
    if (rm) { wm.classList.add('in'); return; }
    letters.forEach(function (el, i) { el.style.animationDelay = (60 * i) + 'ms'; });
    requestAnimationFrame(function () { wm.classList.add('in'); });
  }());

  /* IO reveal */
  (function () {
    if (!('IntersectionObserver' in window) || rm) {
      document.querySelectorAll('.reveal, .fade-p, .split, .card, .arch, [data-counter]').forEach(function (el) { el.classList.add('in'); });
      var n = document.querySelector('[data-counter]');
      if (n) n.innerHTML = '97.6<span class="pct">%</span>';
      return;
    }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target;
        el.classList.add('in');
        if (el.classList.contains('fade-p-group')) el.querySelectorAll('.fade-p').forEach(function (p) { p.classList.add('in'); });
        if (el.matches('[data-counter]')) {
          countUp(el, 97.6, 1400);
          var q = document.querySelector('.qualifier'), f = document.querySelector('.footnote');
          setTimeout(function () { q && q.classList.add('in'); f && f.classList.add('in'); }, 1450);
        }
        if (el.matches('.split')) setTimeout(typeTerminal, 900);
        if (el.matches('.cards')) el.querySelectorAll('.card').forEach(function (c, i) { setTimeout(function () { c.classList.add('in'); }, i * 110); });
        if (el.matches('.arch')) startArchPulses();
        io.unobserve(el);
      });
    }, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.reveal, .fade-p-group, [data-counter], .split, .cards, .arch').forEach(function (el) { io.observe(el); });
  }());

  function countUp(el, target, dur) {
    var start = performance.now();
    function ease(t) { return 1 - Math.pow(1 - t, 3); }
    function frame(now) {
      var t = Math.min(1, (now - start) / dur), v = target * ease(t);
      el.innerHTML = v.toFixed(1) + '<span class="pct">%</span>';
      if (t < 1) requestAnimationFrame(frame); else el.innerHTML = '97.6<span class="pct">%</span>';
    }
    requestAnimationFrame(frame);
  }

  function typeTerminal() {
    var left = document.getElementById('term-cold');
    if (!left) return;
    var src = left.getAttribute('data-text') || '';
    if (rm) { left.textContent = src; return; }
    left.textContent = ''; var i = 0;
    function step() {
      if (i >= src.length) return;
      left.textContent += src.substr(i, 1); i++;
      setTimeout(step, 18);
    }
    step();
  }

  function startArchPulses() {
    if (rm) return;
    var paths = document.querySelectorAll('.arch path.conn:not(.dashed)');
    paths.forEach(function (p, idx) {
      if (!p.id) return;
      var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('r', '2.5'); dot.setAttribute('class', 'pulse-dot');
      var anim = document.createElementNS('http://www.w3.org/2000/svg', 'animateMotion');
      anim.setAttribute('dur', '5s'); anim.setAttribute('repeatCount', 'indefinite');
      anim.setAttribute('begin', (idx * 0.5) + 's');
      var mp = document.createElementNS('http://www.w3.org/2000/svg', 'mpath');
      mp.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#' + p.id);
      anim.appendChild(mp); dot.appendChild(anim);
      p.parentNode.appendChild(dot);
    });
  }

  /* Copy buttons */
  (function () {
    document.querySelectorAll('.cmd').forEach(function (cmd) {
      var line = cmd.querySelector('.cmd-line'), btn = cmd.querySelector('.cmd-copy');
      if (!btn || !line) return;
      btn.addEventListener('click', function () {
        var text = line.textContent.trim();
        try { navigator.clipboard.writeText(text); } catch (e) {
          var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); } catch (_) {} document.body.removeChild(ta);
        }
        var orig = btn.textContent;
        btn.textContent = 'Copied'; btn.classList.add('done');
        setTimeout(function () { btn.textContent = orig; btn.classList.remove('done'); }, 1500);
      });
    });
  }());

  /* Cmd/Ctrl + K */
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      var first = document.querySelector('#install .cmd');
      if (!first) return;
      first.scrollIntoView({ block: 'center', behavior: rm ? 'auto' : 'smooth' });
      first.classList.add('flash');
      var btn = first.querySelector('.cmd-copy'); btn && btn.focus();
      setTimeout(function () { first.classList.remove('flash'); }, 1200);
    }
  });

  /* Konami */
  (function () {
    var seq = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'], i = 0;
    document.addEventListener('keydown', function (e) {
      var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === seq[i]) { i++; if (i === seq.length) { var eg = document.querySelector('.easter-egg'); eg && eg.classList.add('on'); i = 0; } }
      else { i = k === seq[0] ? 1 : 0; }
    });
  }());
}());
