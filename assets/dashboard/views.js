/* Vues : chaque carte = { id, cls, title, hint, dim, sig(state, tick), body(state), after(el, state) }.
   `sig` résume ce dont la carte dépend : elle n'est redessinée que si cette signature change (la page bouge à chaque action,
   mais seules les cartes concernées se redessinent). `tick` (compteur de 30 s) rafraîchit les durées relatives.
   `dim` : clé du bouton 2D / 3D de la carte. */
var SOURCE = { approval: 'Approbation', decision: 'Décision', task: 'Tâche bloquée', escalation: 'Escalade' };
var ACTIVE_MS = 6 * 3600 * 1000;
var VIEW_TITLES = { overview: 'Synthèse', board: 'Tableau scrum', planning: 'Planning', backlog: 'Backlog', team: "Équipe d'agents", quality: 'Qualité', costs: 'Coûts (jetons)', decisions: 'Décisions et tâches' };
/* Réglages de l'interface (filtres, 2D/3D) : propres au navigateur, jamais écrits sur le disque. */
var ui = { dim: {}, gantt: { mode: 'active', group: '' }, burn: { group: '' }, board: { q: '' }, tasks: { q: '', status: '' } };
var prevBoard = null;

function tbl(heads, rows, empty) {
  return rows.length ? '<div class="wrap"><table><thead><tr>' + heads.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' : '<p class="empty">' + empty + '</p>';
}
function canvas3d(label) { return '<canvas class="iso" tabindex="0" role="img" aria-label="' + esc(label) + '"></canvas><p class="hint3d">Glisse pour tourner · survole un bloc · flèches ← →</p>'; }
function is3d(key) { return ui.dim[key] === '3d'; }
function mount3d(id, el, scene) { var cv = el.querySelector('canvas.iso'); if (cv && scene) isoMount(id, cv, scene, TIP); }

function waitingRow(i) {
  return '<div class="wait"><div class="lv"><b class="' + (i.level === 'blocking' ? 'b' : '') + '">' + (i.level === 'blocking' ? 'Bloquant' : 'À confirmer') + '</b><br>' + (SOURCE[i.source] || esc(i.source)) + '</div><div class="tx" title="' + plain(i.question) + '">' + md(i.question) + '</div></div>';
}

function delta(now, before) {
  if (!before && !now) return '<span class="d">aucune sur 14 jours</span>';
  if (!before) return '<span class="d up">nouveau vs 7 j précédents</span>';
  var p = Math.round((now - before) / before * 100);
  return '<span class="d ' + (p >= 0 ? 'up' : 'down') + '">' + (p >= 0 ? '↑ ' : '↓ ') + Math.abs(p) + ' % vs 7 j précédents</span>';
}
function kpi(label, value, sub, href) {
  return '<' + (href ? 'a href="' + href + '" data-go="decisions"' : 'div') + ' class="card kpi"><div class="l">' + label + '</div><div class="v">' + value + '</div>' + sub + '</' + (href ? 'a' : 'div') + '>';
}

/* Tableau scrum : une carte par tâche, une colonne par état ; les cartes qui viennent de changer de colonne clignotent. */
function boardHtml(s) {
  var q = ui.board.q.toLowerCase(), cols = [['pending', 'À faire', 'var(--wait)'], ['in_progress', 'En cours', 'var(--prog)'], ['blocked', 'Bloquées / en échec', 'var(--block)'], ['done', 'Terminées', 'var(--done)']];
  var now = {}, html = cols.map(function (c) {
    var cards = s.board[c[0]].filter(function (t) { return !q || (t.id + ' ' + t.title + ' ' + t.kind).toLowerCase().indexOf(q) >= 0; });
    var more = s.board.hidden[c[0]] || 0;
    return '<div class="col" style="--c:' + c[2] + '"><h3><span>' + c[1] + '</span><span>' + (s.counts[c[0]] + (c[0] === 'blocked' ? s.counts.failed : 0)) + '</span></h3><div class="cards">' + cards.map(function (t) {
      now[t.id] = c[0];
      var moved = prevBoard && prevBoard[t.id] && prevBoard[t.id] !== c[0];
      return '<div class="tcard' + (moved ? ' moved' : '') + '" style="--c:' + (STATUS_VAR[t.status] || c[2]) + '" data-tip="' + plain(t.id + ' · ' + t.title) + '"><div class="id">' + esc(t.id) + (t.status === 'failed' ? ' · en échec' : '') + '</div><div class="t">' + esc(t.title) + '</div><div class="ft"><span class="chip">' + esc(t.kind) + '</span>' + (t.model ? '<span class="chip">' + t.model + '</span>' : '') + (t.attempts ? '<span class="chip">' + plural(t.attempts, 'essai', 'essais') + '</span>' : '') + '</div>' + (t.reason ? '<div class="why">' + esc(trunc(t.reason, 120)) + '</div>' : '') + '</div>';
    }).join('') + (cards.length ? '' : '<div class="more">Aucune</div>') + (more ? '<div class="more">+ ' + more + ' de plus</div>' : '') + '</div></div>';
  }).join('');
  prevBoard = now;
  return '<div class="board">' + html + '</div>';
}

function ganttTools(s) {
  var groups = {}; s.bars.forEach(function (b) { groups[b.group] = 1; });
  return '<div class="tools"><select id="g-mode" aria-label="Tâches affichées">' + [['active', 'Tâches actives (non terminées)'], ['recent', 'Actives + terminées sur 14 jours'], ['all', 'Toutes']].map(function (o) { return '<option value="' + o[0] + '"' + (ui.gantt.mode === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'
    + '<select id="g-group" aria-label="Chantier"><option value="">Tous les ' + (s.groups.by === 'chantier' ? 'chantiers' : 'types') + '</option>' + Object.keys(groups).sort().map(function (g) { return '<option' + (ui.gantt.group === g ? ' selected' : '') + '>' + esc(g) + '</option>'; }).join('') + '</select></div>';
}

function activeRow(a, old) {
  return '<div class="act"><b>' + esc(a.id) + '</b><div><div class="t" title="' + plain(a.title) + '">' + esc(a.title) + '</div><small>' + esc(a.kind) + (a.model ? ' · ' + a.model : '') + '</small></div><span class="age' + (old ? ' old' : '') + '">' + ago(a.since).replace('il y a ', '') + '</span></div>';
}
function feedList(items, n) {
  return items.length ? '<ul class="list">' + items.slice(0, n).map(function (f) { return '<li class="f ' + f.tone + '" data-key="' + esc(f.ts + f.text) + '"><i></i><div>' + esc(f.text) + '<small>' + ago(f.ts) + '</small></div></li>'; }).join('') + '</ul>' : '<p class="empty">Aucune activité enregistrée.</p>';
}
function backlogTable(items, withWaiting) {
  return tbl(['Id', 'Titre', 'Chantier', withWaiting ? 'Attend' : 'Raison', 'Débloque'], items.map(function (i) {
    return '<tr><td class="n">' + esc(i.id) + '</td><td>' + esc(i.title) + '</td><td>' + esc(i.group) + '</td><td>' + (withWaiting ? i.waitingFor.map(function (w) { return '<code>' + esc(w) + '</code>'; }).join(' ') : esc(trunc(i.reason || '', 90))) + '</td><td class="n">' + (i.unlocks || '') + '</td></tr>';
  }), 'Rien dans cette bande.');
}
function taskRows(s) {
  var q = ui.tasks.q.toLowerCase();
  var rows = s.tasks.filter(function (t) { return (!ui.tasks.status || t.status === ui.tasks.status) && (!q || (t.id + ' ' + t.title + ' ' + t.kind).toLowerCase().indexOf(q) >= 0); });
  return rows.map(function (t) { return '<tr><td class="n">' + esc(t.id) + '</td><td>' + esc(t.title) + '</td><td>' + esc(t.kind) + '</td><td><span class="dot st-' + t.status + '"></span>' + (STATUS[t.status] ? STATUS[t.status].one : esc(t.status)) + '</td><td class="n">' + t.attempts + '</td></tr>'; }).join('')
    || '<tr><td colspan="5" class="empty">Aucune tâche ne correspond.</td></tr>';
}

var VIEWS = {
  overview: [
    { id: 'kpis', bare: true, sig: function (s) { return [s.metrics, s.waiting.total, s.waiting.blocking]; },
      body: function (s) {
        var m = s.metrics;
        return kpi('Terminées (7 jours)', m.doneLast7, delta(m.doneLast7, m.donePrev7))
          + kpi('Débit', m.perWeek + '<span class="l"> / sem.</span>', '<span class="d">moyenne sur 28 jours</span>')
          + kpi('Durée médiane', m.cycleMedianHours === undefined ? '—' : m.cycleMedianHours < 24 ? m.cycleMedianHours + '<span class="l"> h</span>' : Math.round(m.cycleMedianHours / 2.4) / 10 + '<span class="l"> j</span>', '<span class="d">premier essai → fin</span>')
          + kpi('En cours (WIP)', m.wip, '<span class="d">' + plural(m.blocked, 'bloquée', 'bloquées') + '</span>')
          + kpi('Reste à faire', m.open, m.forecast ? '<span class="d">fin prévue ' + fullDay(m.forecast.date) + ' (dans ' + m.forecast.days + ' j)</span>' : '<span class="d">rythme trop faible pour prévoir</span>')
          + kpi('À décider', s.waiting.total, '<span class="d ' + (s.waiting.blocking ? 'down' : '') + '">' + plural(s.waiting.blocking, 'bloquante', 'bloquantes') + '</span>', '#decisions');
      } },
    { id: 'burndown', cls: 'c8', title: 'Burndown : reste à faire', dim: 'burndown', hint: 'Tâches non terminées jour après jour ; pointillés = projection au rythme des 28 derniers jours',
      sig: function (s) { return [s.daily.slice(-30), s.metrics.forecast, s.groupSeries, ui.dim.burndown]; },
      body: function (s) {
        if (is3d('burndown')) return s.groupSeries.length ? canvas3d('Surface du reste à faire : jours par chantier') : '<p class="empty">Pas de chantier à afficher.</p>';
        var d = s.daily.slice(-30);
        return burndown(d.map(function (x) { return x.day; }), d.map(function (x) { return x.createdCum - x.doneCum; }), s.metrics.forecast);
      },
      after: function (el, s) { if (is3d('burndown')) mount3d('burndown', el, surfaceScene(s.seriesDays, s.groupSeries)); } },
    { id: 'split', cls: 'c4', title: 'Répartition des tâches', sig: function (s) { return s.counts; }, body: function (s) { return donut(s.counts); } },
    { id: 'velocity', cls: 'c6', title: 'Vélocité', hint: 'Terminées et créées par semaine', sig: function (s) { return s.daily; }, body: function (s) { return velocity(s.daily); } },
    { id: 'funnel', cls: 'c6', title: 'Entonnoir de livraison', hint: '« Sans dérogation » : terminées sans contrôle en échec ni dérogation', sig: function (s) { return s.funnel; }, body: function (s) { return funnel(s.funnel); } },
    { id: 'now', cls: 'c6', title: 'En cours maintenant', hint: 'Activité des six dernières heures', sig: function (s, tick) { return [s.active, tick]; },
      body: function (s) {
        var t = Date.now(), recent = s.active.filter(function (a) { return t - Date.parse(a.since) < ACTIVE_MS; }), stale = s.active.filter(function (a) { return t - Date.parse(a.since) >= ACTIVE_MS; });
        return (recent.length ? recent.slice(0, 6).map(function (a) { return activeRow(a, false); }).join('') : '<p class="empty">Personne ne travaille en ce moment.</p>')
          + (stale.length ? '<details><summary>' + plural(stale.length, 'tâche démarrée sans activité récente', 'tâches démarrées sans activité récente') + '</summary>' + stale.map(function (a) { return activeRow(a, true); }).join('') + '</details>' : '');
      } },
    { id: 'feed', cls: 'c6', title: 'Activité récente', sig: function (s, tick) { return [s.feed, tick]; }, body: function (s) { return feedList(s.feed, 8); } }
  ],
  board: [
    { id: 'board', cls: 'c12', title: 'Tableau scrum', dim: 'board', hint: 'À faire → en cours → terminées ; les cartes bougent en direct', sig: function (s) { return [s.board, s.counts, ui.dim.board]; },
      body: function (s) {
        return '<div class="tools"><input type="search" id="b-q" placeholder="Filtrer les cartes…" aria-label="Filtrer les cartes" value="' + esc(ui.board.q) + '"></div>' + (is3d('board') ? canvas3d('Tableau scrum en perspective') : boardHtml(s));
      },
      after: function (el, s) { if (is3d('board')) mount3d('board', el, boardScene(s.board)); } }
  ],
  planning: [
    { id: 'gantt', cls: 'c12', title: 'Diagramme de Gantt', dim: 'gantt', hint: 'Du premier essai à la fin, par chantier ; flèches = dépendances', sig: function (s, tick) { return [s.bars, ui.dim.gantt, ui.gantt, tick]; },
      body: function (s) { return ganttTools(s) + (is3d('gantt') ? canvas3d('Gantt en relief') : gantt(s.bars, ui.gantt)); },
      after: function (el, s) { if (is3d('gantt')) mount3d('gantt', el, ganttScene(s.bars, ui.gantt)); } },
    { id: 'incr', cls: 'c6', title: 'Burndown par incrément', hint: 'Un incrément = un chantier ; « clôturé » après `ceng increment close`', sig: function (s) { return [s.seriesDays, s.groupSeries, s.closedIncrements, ui.burn]; },
      body: function (s) {
        if (!s.groupSeries.length) return '<p class="empty">Pas de chantier à afficher.</p>';
        var cur = s.groupSeries.filter(function (g) { return g.name === ui.burn.group; })[0] || s.groupSeries[0], closed = s.closedIncrements.indexOf(cur.name.replace(/[^\w.-]+/g, '-')) >= 0;
        return '<div class="tools"><select id="burn-g" aria-label="Incrément">' + s.groupSeries.map(function (g) { return '<option' + (g.name === cur.name ? ' selected' : '') + '>' + esc(g.name) + '</option>'; }).join('') + '</select>' + (closed ? '<span class="chip">clôturé</span>' : '') + '</div>' + burndown(s.seriesDays, cur.remaining, undefined, cur.name);
      } },
    { id: 'cfd', cls: 'c6', title: 'Flux cumulé', hint: 'Une bande qui s\'épaissit signale un goulot', sig: function (s) { return s.cfd; }, body: function (s) { return cfdChart(s.cfd); } },
    { id: 'slow', cls: 'c12', title: 'Ce qui a ralenti', sig: function (s) { return s.slow; },
      body: function (s) {
        var stuck = tbl(['Id', 'Titre', 'État', 'À l\'arrêt', 'Raison'], s.slow.stuck.map(function (t) { return '<tr><td class="n">' + esc(t.id) + '</td><td>' + esc(t.title) + '</td><td>' + (STATUS[t.status] ? STATUS[t.status].one : esc(t.status)) + '</td><td class="n">' + plural(t.days, 'jour', 'jours') + '</td><td>' + esc(trunc(t.reason || '', 100)) + '</td></tr>'; }), 'Aucune tâche à l\'arrêt.');
        var gates = s.slow.gates.length ? '<div class="legend" style="margin-top:8px">Contrôles qui échouent le plus : ' + s.slow.gates.map(function (g) { return '<span><b>' + esc(g.gate) + '</b> ' + g.fail + '/' + g.total + '</span>'; }).join('') + '</div>' : '';
        return stuck + gates;
      } }
  ],
  backlog: [
    { id: 'bl-now', cls: 'c6', title: 'Maintenant', hint: 'En cours', sig: function (s) { return s.backlog.now; }, body: function (s) { return backlogTable(s.backlog.now, true); } },
    { id: 'bl-next', cls: 'c6', title: 'Ensuite', hint: 'Prêtes à démarrer : celles qui en débloquent le plus d\'abord', sig: function (s) { return s.backlog.next; }, body: function (s) { return backlogTable(s.backlog.next, true); } },
    { id: 'bl-later', cls: 'c12', title: 'Plus tard', hint: 'Attendent la fin d\'une autre tâche', sig: function (s) { return s.backlog.later; }, body: function (s) { return backlogTable(s.backlog.later, true); } },
    { id: 'bl-human', cls: 'c12', title: 'Attendent un humain', hint: 'Bloquées ou en échec : approbation, secret, décision', sig: function (s) { return s.backlog.human; }, body: function (s) { return backlogTable(s.backlog.human, false); } },
    { id: 'groups', cls: 'c12', title: 'Avancement par chantier', dim: 'groups', hint: 'Terminées sur total', sig: function (s) { return [s.groups, ui.dim.groups]; },
      body: function (s) { return is3d('groups') ? canvas3d('Relief des chantiers') : hbars(s.groups.rows.slice(0, 14).map(function (g) { return { label: g.group, value: g.done, max: g.total, text: g.done + '/' + g.total, color: 'var(--done)', tip: g.group + ' : ' + g.done + ' terminées sur ' + g.total }; })); },
      after: function (el, s) { if (is3d('groups')) mount3d('groups', el, reliefScene(s.groups.rows)); } }
  ],
  team: [
    { id: 'agents', cls: 'c6', title: 'Agents en ce moment', hint: 'Lancés et pas encore arrêtés (moins de six heures)', sig: function (s, tick) { return [s.agents.running, tick]; },
      body: function (s) { return s.agents.running.length ? s.agents.running.map(function (a) { return '<div class="act"><b>' + esc(a.type) + '</b><div>' + (a.taskId ? esc(a.taskId) : '<small>sans tâche</small>') + '<small>' + (a.model ? esc(a.model) : '') + '</small></div><span class="age">' + ago(a.since).replace('il y a ', '') + '</span></div>'; }).join('') : '<p class="empty">Aucun agent n\'est lancé.</p>'; } },
    { id: 'agent-stats', cls: 'c6', title: 'Bilan par agent', hint: 'Lancements et jetons (entrée + sortie)', sig: function (s) { return s.agents.stats; },
      body: function (s) { var m = Math.max(1, Math.max.apply(null, s.agents.stats.map(function (a) { return a.tokens; }))); return hbars(s.agents.stats.slice(0, 10).map(function (a) { return { label: a.type, value: a.tokens, max: m, text: fmtTokens(a.tokens), tip: a.type + ' : ' + plural(a.runs, 'lancement', 'lancements') + ', ' + fmtTokens(a.tokens) + ' jetons' }; })); } },
    { id: 'feed2', cls: 'c12', title: 'Journal d\'activité', sig: function (s, tick) { return [s.feed, tick]; }, body: function (s) { return feedList(s.feed, 25); } }
  ],
  quality: [
    { id: 'gates', cls: 'c12', title: 'Contrôles qualité', sig: function (s) { return s.gates; },
      body: function (s) {
        return tbl(['Contrôle', 'Réussis', 'Échecs', 'Dispensés', 'Autres', 'Taux de réussite'], s.gates.map(function (g) {
          var t = g.pass + g.fail + g.waived + g.other;
          return '<tr><td>' + esc(g.gate) + '</td><td class="n">' + g.pass + '</td><td class="n' + (g.fail ? ' down' : '') + '">' + g.fail + '</td><td class="n">' + g.waived + '</td><td class="n">' + g.other + '</td><td style="width:34%"><div class="row" style="grid-template-columns:1fr auto"><span class="track"><i class="st-done" style="width:' + pct(g.pass, t) + '%"></i></span><span class="val">' + pct(g.pass, t) + ' %</span></div></td></tr>';
        }), 'Aucun contrôle enregistré.');
      } },
    { id: 'models', cls: 'c6', title: 'Tentatives par modèle', sig: function (s) { return s.models; },
      body: function (s) { var m = Math.max(1, s.models.opus, s.models.sonnet, s.models.haiku); return hbars(['opus', 'sonnet', 'haiku'].map(function (k, i) { return { label: k, value: s.models[k], max: m, text: s.models[k], color: SERIES[i] }; })); } },
    { id: 'types', cls: 'c6', title: 'Tâches par type', hint: 'Terminées sur total', sig: function (s) { return s.groups; },
      body: function (s) { return hbars(s.groups.rows.slice(0, 10).map(function (g) { return { label: g.group, value: g.done, max: g.total, text: g.done + '/' + g.total, color: 'var(--done)' }; })); } }
  ],
  costs: [
    { id: 'usage', cls: 'c8', title: 'Jetons par jour', hint: '30 derniers jours, par modèle (entrée + sortie), mesurés dans la transcription de chaque sous-agent', sig: function (s) { return s.usage.days; }, body: function (s) { return usageBars(s.usage.days); } },
    { id: 'totals', cls: 'c4', title: 'Totaux sur 30 jours', sig: function (s) { return s.usage.totals; },
      body: function (s) {
        var t = s.usage.totals;
        return tbl(['Type', 'Jetons'], [['Entrée', t.input], ['Sortie', t.output], ['Cache lu', t.cacheRead], ['Cache écrit', t.cacheWrite]].map(function (r) { return '<tr><td>' + r[0] + '</td><td class="n">' + fmtTokens(r[1]) + '</td></tr>'; }), '') + '<p class="hint3d">Le cache lu est facturé bien moins cher que l\'entrée : un total élevé n\'est pas un coût élevé.</p>';
      } }
  ],
  decisions: [
    { id: 'waiting', cls: 'c6', title: 'Ce qui t\'attend', sig: function (s) { return s.waiting; },
      body: function (s) {
        var w = s.waiting;
        if (!w.total) return '<p class="empty">Rien n\'attend ta décision.</p>';
        var chips = Object.keys(w.bySource).map(function (k) { return '<span class="chip">' + (SOURCE[k] || esc(k)) + ' <b>' + w.bySource[k] + '</b></span>'; }).join(' '), rest = w.items.slice(5);
        return '<div class="tools">' + chips + '</div>' + w.items.slice(0, 5).map(waitingRow).join('') + (rest.length ? '<details><summary>Voir les ' + (w.total - 5) + ' autres' + (w.total > w.items.length ? ' (' + w.items.length + ' montrées)' : '') + '</summary>' + rest.map(waitingRow).join('') + '</details>' : '');
      } },
    { id: 'features', cls: 'c6', title: 'Fonctionnalités et cahier des charges', sig: function (s) { return [s.features, s.spec]; },
      body: function (s) {
        var L = { decided: 'décidées', in_progress: 'en cours', delivered: 'livrées', rejected: 'écartées', replaced: 'remplacées' }, keys = Object.keys(s.features);
        var feat = keys.length ? '<div class="tools">' + keys.map(function (k) { return '<span class="chip"><b>' + s.features[k] + '</b> ' + (L[k] || esc(k)) + '</span>'; }).join(' ') + '</div>' : '<p class="empty">Aucune fonctionnalité enregistrée.</p>';
        var spec = s.spec ? '<div class="legend" style="margin-top:10px">Cahier des charges : <b>' + (s.spec.total - s.spec.open) + '</b> exigences sur ' + s.spec.total + ' rattachées à une tâche</div><div class="stack">' + (s.spec.total - s.spec.open ? '<i class="st-done" style="flex:' + (s.spec.total - s.spec.open) + '"></i>' : '') + (s.spec.open ? '<i class="st-blocked" style="flex:' + s.spec.open + '"></i>' : '') + '</div>' : '';
        return feat + spec;
      } },
    { id: 'table', cls: 'c12', title: 'Toutes les tâches', sig: function (s) { return s.tasks; },
      body: function (s) {
        var chips = [''].concat(STATUS_ORDER).map(function (k) { return '<button class="pill' + (ui.tasks.status === k ? ' on' : '') + '" data-status="' + k + '">' + (k ? STATUS[k].label : 'Toutes') + '</button>'; }).join('');
        return '<div class="tools"><input type="search" id="t-q" placeholder="Rechercher une tâche…" aria-label="Rechercher une tâche" value="' + esc(ui.tasks.q) + '">' + chips + '</div><div class="wrap"><table><thead><tr><th>Id</th><th>Titre</th><th>Type</th><th>État</th><th>Essais</th></tr></thead><tbody id="t-body">' + taskRows(s) + '</tbody></table></div>';
      } },
    { id: 'shots', cls: 'c12', title: 'Captures d\'écran', sig: function (s) { return s.shots; },
      body: function (s) {
        var base = SHOTS_BASE, keys = Object.keys(s.shots);
        if (!keys.length) return '<p class="empty">Aucune capture pour l\'instant.</p>';
        return keys.map(function (t) { return '<details><summary>' + esc(t) + ' (' + s.shots[t].length + ')</summary><div class="shots">' + s.shots[t].map(function (f) { return '<a href="' + base + encodeURI(f) + '"><img loading="lazy" src="' + base + encodeURI(f) + '" alt="' + esc(f) + '"></a>'; }).join('') + '</div></details>'; }).join('');
      } }
  ]
};
