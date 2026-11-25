/* Application : construit la barre latérale et les cartes, met tout à jour à chaque nouvel état (poussé en direct par le serveur
   local), et gère thème, plein écran, export, impression et notifications. Mode `snapshot` : la même page, figée à un instant. */
var TIP = setupTooltip();
var LIVE = document.body.dataset.mode === 'live';
var SHOTS_BASE = LIVE ? 'shots/' : '../shots/';
var state = JSON.parse($('#state').textContent);
var sigs = {}, seenFeed = {}, tick = 0, rendered = false, lastWaiting = null, unseen = false, currentView = 'overview', tvTimer = null;

function store(key, value) { try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch (e) { /* stockage indisponible : réglage non retenu */ } return null; }

function build() {
  Object.keys(VIEWS).forEach(function (view) {
    $('#v-' + view).innerHTML = VIEWS[view].map(function (c) {
      if (c.bare) return '<section id="c-' + c.id + '" class="kpis"><div class="body" style="display:contents"></div></section>';
      var seg = c.dim ? '<div class="seg" data-dim-for="' + c.dim + '"><button data-dim="2d" class="on">2D</button><button data-dim="3d">3D</button></div>' : '';
      return '<section class="card ' + c.cls + '" id="c-' + c.id + '"><div class="card-h"><h2>' + esc(c.title) + '</h2>' + seg + '</div>' + (c.hint ? '<p class="hint">' + md(c.hint) + '</p>' : '') + '<div class="body"></div></section>';
    }).join('');
  });
}

/* L'utilisateur tape ou choisit dans un champ de la carte : on ne la redessine pas sous ses doigts (reprise à la sortie du champ). */
function busy(card) { var a = document.activeElement; return card.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT'); }

function markFresh(body) {
  [].forEach.call(body.querySelectorAll('li[data-key]'), function (li) {
    var k = li.dataset.key;
    if (rendered && !seenFeed[k]) li.classList.add('fresh');
    seenFeed[k] = 1;
  });
}

function renderChrome() {
  var w = state.waiting.total, badge = $('#wait-badge');
  badge.hidden = !w; badge.textContent = w;
  document.title = (unseen ? '● ' : '') + state.project + ' · ' + pct(state.counts.done, state.total) + ' %';
  $('#title').textContent = VIEW_TITLES[currentView];
  var last = LIVE ? (state.activity && state.activity.last ? 'dernière action ' + ago(state.activity.last) + ' · ' + plural(state.activity.total, 'action enregistrée', 'actions enregistrées') : 'aucune action enregistrée') : 'instantané du ' + state.generatedAt.slice(0, 16).replace('T', ' ') + ' UTC';
  $('#sub').textContent = state.project + ' · ' + last;
}

function notifyIfNew() {
  if (lastWaiting !== null && state.waiting.total > lastWaiting && document.hidden) {
    unseen = true;
    if ('Notification' in window && Notification.permission === 'granted') new Notification(state.project + ' : une décision attend', { body: plural(state.waiting.total - lastWaiting, 'nouvelle décision', 'nouvelles décisions') + ' (' + state.waiting.blocking + ' bloquante(s) au total)' });
  }
  lastWaiting = state.waiting.total;
}

function update(next) {
  state = next;
  notifyIfNew();
  Object.keys(VIEWS).forEach(function (view) {
    VIEWS[view].forEach(function (c) {
      var sig = JSON.stringify(c.sig(state, tick));
      if (sigs[c.id] === sig) return;
      var card = $('#c-' + c.id);
      if (busy(card)) return;
      var body = $('.body', card);
      body.innerHTML = c.body(state);
      markFresh(body);
      if (c.dim) [].forEach.call(card.querySelectorAll('.seg button'), function (b) { b.classList.toggle('on', b.dataset.dim === (ui.dim[c.dim] || '2d')); });
      if (c.after) c.after(card, state);
      sigs[c.id] = sig;
    });
  });
  renderChrome();
  rendered = true;
}

function refresh(id) { delete sigs[id]; update(state); }

function show(view) {
  if (!VIEWS[view]) view = 'overview';
  currentView = view;
  [].forEach.call(document.querySelectorAll('.view'), function (v) { v.classList.toggle('on', v.id === 'v-' + view); });
  [].forEach.call(document.querySelectorAll('.nav[data-view]'), function (b) { b.classList.toggle('on', b.dataset.view === view); });
  renderChrome();
}

function setTheme(t) {
  if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
  store('ceng-theme', t || 'light');
}

function setMini(on) { $('#app').classList.toggle('mini', on); store('ceng-mini', on ? '1' : '0'); }

/* Plein écran pour un second écran : gros chiffres, les vues principales défilent toutes les 25 secondes. */
function tvMode(on) {
  document.body.classList.toggle('tv', on);
  clearInterval(tvTimer);
  if (on) {
    var order = ['overview', 'board', 'planning', 'backlog'], i = 0;
    tvTimer = setInterval(function () { i = (i + 1) % order.length; show(order[i]); }, 25000);
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () { /* plein écran refusé : le mode reste actif */ });
  } else if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();
}

/* Exporte la page telle qu'elle est, figée : un seul fichier HTML à envoyer. */
function exportHtml() {
  var c = document.documentElement.cloneNode(true), b = c.querySelector('body');
  b.setAttribute('data-mode', 'snapshot'); b.classList.remove('tv');
  c.querySelector('#state').textContent = JSON.stringify(state).replace(/</g, '\\u003c');
  var html = '<!doctype html>' + c.outerHTML, a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  a.download = 'tableau-de-bord-' + state.project.replace(/[^\w.-]+/g, '-') + '-' + state.generatedAt.slice(0, 10) + '.html';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
}

function wire() {
  document.addEventListener('click', function (e) {
    var t = e.target, nav = t.closest('[data-view]'), go = t.closest('[data-go]'), dim = t.closest('[data-dim]'), st = t.closest('[data-status]');
    if (nav || go) { var v = (nav || go).dataset.view || (nav || go).dataset.go; location.hash = v; show(v); }
    if (dim) { ui.dim[dim.closest('[data-dim-for]').dataset.dimFor] = dim.dataset.dim; refresh(dim.closest('.card').id.slice(2)); }
    if (st) { ui.tasks.status = st.dataset.status; [].forEach.call(document.querySelectorAll('[data-status]'), function (b) { b.classList.toggle('on', b === st); }); $('#t-body').innerHTML = taskRows(state); }
    if (t.closest('#theme')) setTheme((document.documentElement.getAttribute('data-theme') || 'light') === 'dark' ? 'light' : 'dark');
    if (t.closest('#fold')) setMini(!$('#app').classList.contains('mini'));
    if (t.closest('#tv')) tvMode(!document.body.classList.contains('tv'));
    if (t.closest('#export')) exportHtml();
    if (t.closest('#print')) window.print();
    if (t.closest('#notify') && 'Notification' in window) Notification.requestPermission().then(setNotifyLabel);
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 't-q') { ui.tasks.q = e.target.value; $('#t-body').innerHTML = taskRows(state); }
    if (e.target.id === 'b-q') { ui.board.q = e.target.value; var b = $('#c-board .board'); if (b) b.outerHTML = boardHtml(state); }
  });
  document.addEventListener('change', function (e) {
    var id = e.target.id;
    if (id === 'g-mode') { ui.gantt.mode = e.target.value; refresh('gantt'); }
    if (id === 'g-group') { ui.gantt.group = e.target.value; refresh('gantt'); }
    if (id === 'burn-g') { ui.burn.group = e.target.value; refresh('incr'); }
  });
  /* Une carte laissée en plan pendant la saisie se met à jour dès que le champ perd le focus. */
  document.addEventListener('focusout', function () { setTimeout(function () { update(state); }, 0); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { unseen = false; renderChrome(); } });
  addEventListener('hashchange', function () { show(location.hash.slice(1)); });
  document.addEventListener('fullscreenchange', function () { if (!document.fullscreenElement && document.body.classList.contains('tv')) tvMode(false); });
}

function setNotifyLabel() {
  var b = $('#notify');
  if (!('Notification' in window)) { b.hidden = true; return; }
  $('.tx', b).textContent = Notification.permission === 'granted' ? 'Notifications : activées' : Notification.permission === 'denied' ? 'Notifications : refusées' : 'Activer les notifications';
}

function setLive(kind, text) { var el = $('#live'); el.className = 'live' + (kind === 'on' ? '' : ' ' + kind); $('span', el).textContent = text; }

function connect() {
  var es = new EventSource('events');
  es.onopen = function () { setLive('on', 'En direct'); };
  es.onmessage = function (e) { try { update(JSON.parse(e.data)); } catch (err) { /* message illisible : ignoré */ } };
  es.onerror = function () {
    setLive('lost', 'Reconnexion…');
    if (es.readyState === 2) { es.close(); setTimeout(connect, 3000); }
  };
}

build();
wire();
if (store('ceng-theme') === 'dark') setTheme('dark');
if (store('ceng-mini') === '1') setMini(true);
if (location.pathname.indexOf('/p/') === 0) $('#all-link').hidden = false;
setNotifyLabel();
update(state);
show(location.hash.slice(1) || 'overview');
setLive(LIVE ? 'lost' : 'off', LIVE ? 'Connexion…' : 'Instantané');
if (LIVE) connect();
setInterval(function () { tick += 1; update(state); }, 30000);
setInterval(renderChrome, 1000);
