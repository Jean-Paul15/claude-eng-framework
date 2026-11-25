/* Utilitaires partagés : texte sûr, dates relatives, échelles, infobulle. Aucune dépendance. */
var STATUS = {
  done: { label: 'Terminées', one: 'Terminée' },
  in_progress: { label: 'En cours', one: 'En cours' },
  pending: { label: 'À faire', one: 'À faire' },
  blocked: { label: 'Bloquées', one: 'Bloquée' },
  failed: { label: 'En échec', one: 'En échec' }
};
var STATUS_ORDER = ['done', 'in_progress', 'blocked', 'failed', 'pending'];
var DAY_MS = 86400000;

function $(sel, root) { return (root || document).querySelector(sel); }
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
/* Les notes du cerveau sont en Markdown : `code` et **gras**, sur du texte déjà échappé. */
function md(s) { return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'); }
function plain(s) { return esc(String(s).replace(/\*\*|`/g, '')); }
function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }
function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }
function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function trunc(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function ago(iso, now) {
  var s = Math.max(0, ((now || Date.now()) - Date.parse(iso)) / 1000);
  if (!isFinite(s)) return '';
  if (s < 45) return "à l'instant";
  if (s < 3600) return 'il y a ' + Math.round(s / 60) + ' min';
  if (s < 86400) return 'il y a ' + Math.round(s / 3600) + ' h';
  return 'il y a ' + Math.round(s / 86400) + ' j';
}
function dur(ms) {
  var m = Math.round(ms / 60000);
  if (m < 1) return "moins d'une minute";
  if (m < 60) return m + ' min';
  if (m < 1440) return Math.round(m / 60) + ' h';
  return Math.round(m / 1440) + ' j';
}
function dayLabel(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }
function fullDay(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4); }
function plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }

/* Plus petit « bon » maximum (1, 2, 5 × 10^k) au-dessus de la valeur : repères de grille ronds. */
function niceMax(v) {
  var base = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1))));
  var m = [1, 2, 5, 10].map(function (k) { return k * base; }).filter(function (c) { return c >= v; })[0];
  return m || v;
}

/* Barre à sommet arrondi (4 px), ancrée sur la ligne de base. */
function barPath(x, base, w, h, r) {
  r = Math.min(r, w / 2, h);
  if (h <= 0) return '';
  return 'M' + x + ',' + base + 'v' + (-(h - r)) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + (-r) + 'h' + (w - 2 * r) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r + 'v' + (h - r) + 'z';
}

/* Infobulle unique : survol (souris) et focus (clavier) lisent data-tip ; les canevas 3D l'appellent à la main. */
function setupTooltip() {
  var tip = $('#tip');
  function show(text, x, y) {
    tip.textContent = text; tip.style.opacity = 1;
    tip.style.left = Math.max(4, Math.min(x + 12, innerWidth - tip.offsetWidth - 8)) + 'px';
    tip.style.top = Math.max(y - tip.offsetHeight - 10, 4) + 'px';
  }
  document.addEventListener('pointermove', function (e) {
    var el = e.target.closest && e.target.closest('[data-tip]');
    if (el) show(el.getAttribute('data-tip'), e.clientX, e.clientY);
    else if (!e.target.closest || !e.target.closest('canvas.iso')) tip.style.opacity = 0;
  });
  document.addEventListener('focusin', function (e) {
    var el = e.target.closest && e.target.closest('[data-tip]');
    if (el) { var r = el.getBoundingClientRect(); show(el.getAttribute('data-tip'), r.left, r.top); }
  });
  document.addEventListener('focusout', function () { tip.style.opacity = 0; });
  return { show: show, hide: function () { tip.style.opacity = 0; } };
}
