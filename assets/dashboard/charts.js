/* Graphiques 2D, sobres : chacun renvoie une chaîne HTML/SVG ; chaque marque porte son data-tip (survol et clavier). */
var SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
var STATUS_VAR = { done: 'var(--done)', in_progress: 'var(--prog)', pending: 'var(--wait)', blocked: 'var(--block)', failed: 'var(--fail)' };

function grid3(L, R, Y, top, fmt) {
  return [0, 0.5, 1].map(function (f) { return '<line class="' + (f ? 'g' : 'ax') + '" x1="' + L + '" x2="' + R + '" y1="' + Y(top * f) + '" y2="' + Y(top * f) + '"/><text x="' + (L - 6) + '" y="' + (Y(top * f) + 3) + '" text-anchor="end">' + (fmt ? fmt(top * f) : Math.round(top * f)) + '</text>'; }).join('');
}
/* Au-delà, la projection du burndown n'est pas dessinée (elle écraserait les trente jours observés). */
var PROJECTION_MAX_DAYS = 90;
function fmtTokens(n) { return n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + ' M' : n >= 1e3 ? Math.round(n / 1e3) + ' k' : String(Math.round(n)); }

/* Anneau avec total au centre et légende chiffrée à droite (état des tâches). */
function donut(counts) {
  var total = sum(STATUS_ORDER.map(function (k) { return counts[k] || 0; }));
  if (!total) return '<p class="empty">Pas encore de tâches.</p>';
  var r = 46, c = 60, circ = 2 * Math.PI * r, off = 0, arcs = '';
  STATUS_ORDER.forEach(function (k) {
    var n = counts[k] || 0; if (!n) return;
    var len = n / total * circ;
    arcs += '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="' + STATUS_VAR[k] + '" stroke-width="16" stroke-dasharray="' + Math.max(0, len - 1.5) + ' ' + (circ - Math.max(0, len - 1.5)) + '" stroke-dashoffset="' + (-off) + '" transform="rotate(-90 ' + c + ' ' + c + ')" data-tip="' + STATUS[k].label + ' : ' + n + ' (' + pct(n, total) + ' %)"/>';
    off += len;
  });
  var rows = STATUS_ORDER.filter(function (k) { return counts[k] > 0; }).map(function (k) { return '<tr><td><span class="dot st-' + k + '"></span>' + STATUS[k].label + '</td><td class="n"><b>' + counts[k] + '</b></td><td class="n">' + pct(counts[k], total) + ' %</td></tr>'; }).join('');
  return '<div class="donut"><svg viewBox="0 0 120 120" width="124" height="124" role="img" aria-label="Répartition des tâches par état">' + arcs + '<text x="60" y="58" text-anchor="middle" style="fill:var(--ink);font-size:20px;font-weight:600">' + total + '</text><text x="60" y="73" text-anchor="middle" style="font-size:9.5px">tâches</text></svg><table><tbody>' + rows + '</tbody></table></div>';
}

/* Burndown : reste à faire jour après jour, et projection en pointillés jusqu'à la fin prévue (au rythme des 28 derniers jours). */
function burndown(days, values, forecast, label) {
  var n = days.length;
  if (!n || !Math.max.apply(null, values)) return '<p class="empty">Rien à faire pour ce périmètre.</p>';
  var W = 640, H = 190, L = 34, R = 18, T = 10, B = 22, near = forecast && forecast.days <= PROJECTION_MAX_DAYS, extra = near ? forecast.days : 0, total = n - 1 + extra;
  var top = niceMax(Math.max.apply(null, values)), step = (W - L - R) / Math.max(1, total);
  function X(i) { return L + i * step; }
  function Y(v) { return T + (H - T - B) * (1 - v / top); }
  var pts = values.map(function (v, i) { return X(i) + ',' + Y(v); }).join(' ');
  var last = values[n - 1], hv = days.map(function (d, i) {
    return '<g class="hv" data-tip="' + dayLabel(d) + ' · ' + plural(values[i], 'tâche restante', 'tâches restantes') + '"><rect class="hit" x="' + (X(i) - step / 2) + '" y="' + T + '" width="' + step + '" height="' + (H - T - B) + '"/><line class="xh" x1="' + X(i) + '" x2="' + X(i) + '" y1="' + T + '" y2="' + (H - B) + '"/><circle cx="' + X(i) + '" cy="' + Y(values[i]) + '" r="4" fill="var(--s1)"/></g>';
  }).join('');
  var proj = near ? '<line x1="' + X(n - 1) + '" y1="' + Y(last) + '" x2="' + X(total) + '" y2="' + Y(0) + '" stroke="var(--s2)" stroke-width="1.8" stroke-dasharray="5 4"/><circle cx="' + X(total) + '" cy="' + Y(0) + '" r="4" fill="var(--s2)"/><text class="lab" x="' + X(total) + '" y="' + (Y(0) - 8) + '" text-anchor="end">fin prévue ' + dayLabel(forecast.date) + '</text>' : '';
  var ticks = [0, Math.floor((n - 1) / 2), n - 1].map(function (i) { return '<text x="' + X(i) + '" y="' + (H - 6) + '" text-anchor="' + (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle') + '">' + dayLabel(days[i]) + '</text>'; }).join('');
  return '<div class="legend"><span><span class="dot" style="background:var(--s1)"></span>' + esc(label || 'Reste à faire') + ' <b>' + last + '</b></span>' + (near ? '<span><span class="dot" style="background:var(--s2)"></span>Projection au rythme actuel</span>' : forecast ? '<span>Fin prévue le <b>' + fullDay(forecast.date) + '</b> (dans ' + forecast.days + ' j) : trop loin pour le graphique</span>' : '<span>Pas assez de rythme pour prévoir une fin</span>') + '</div>'
    + '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Burndown sur ' + n + ' jours">' + grid3(L, W - R, Y, top) + '<polyline points="' + pts + '" fill="none" stroke="var(--s1)" stroke-width="2.2" stroke-linejoin="round"/>' + proj + ticks + hv + '</svg>';
}

/* Vélocité : tâches terminées et créées par semaine (lundi → dimanche), dix dernières semaines, moyenne en pointillés. */
function velocity(daily) {
  var weeks = [], cur = null;
  daily.forEach(function (d) {
    var dt = new Date(d.day + 'T00:00:00Z'), mon = new Date(dt.getTime() - ((dt.getUTCDay() + 6) % 7) * DAY_MS).toISOString().slice(0, 10);
    if (!cur || cur.start !== mon) { cur = { start: mon, done: 0, created: 0 }; weeks.push(cur); }
    cur.done += d.done; cur.created += d.created;
  });
  weeks = weeks.slice(-10);
  var W = 460, H = 190, L = 30, T = 10, B = 22, top = niceMax(Math.max(1, Math.max.apply(null, weeks.map(function (w) { return Math.max(w.done, w.created); }))));
  if (!weeks.some(function (w) { return w.done || w.created; })) return '<p class="empty">Rien de terminé ni de créé sur dix semaines.</p>';
  var step = (W - L) / weeks.length, bw = Math.max(5, Math.min(18, (step - 8) / 2));
  function Y(v) { return T + (H - T - B) * (1 - v / top); }
  var avg = sum(weeks.map(function (w) { return w.done; })) / weeks.length;
  var cols = weeks.map(function (w, i) {
    var x0 = L + i * step + (step - 2 * bw - 2) / 2, base = Y(0);
    return '<g class="col" data-tip="Semaine du ' + dayLabel(w.start) + ' · ' + w.done + ' terminées · ' + w.created + ' créées" tabindex="0"><path class="bar" fill="var(--s1)" d="' + barPath(x0, base, bw, base - Y(w.done), 3) + '"/><path class="bar" fill="var(--wait)" d="' + barPath(x0 + bw + 2, base, bw, base - Y(w.created), 3) + '"/><rect class="hit" x="' + (L + i * step) + '" y="' + T + '" width="' + step + '" height="' + (H - T - B) + '"/></g><text x="' + (L + i * step + step / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + dayLabel(w.start) + '</text>';
  }).join('');
  return '<div class="legend"><span><span class="dot" style="background:var(--s1)"></span>Terminées</span><span><span class="dot" style="background:var(--wait)"></span>Créées</span><span>Moyenne <b>' + (Math.round(avg * 10) / 10) + '</b> / semaine</span></div>'
    + '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Vélocité par semaine">' + grid3(L, W, Y, top) + cols + '<line x1="' + L + '" x2="' + W + '" y1="' + Y(avg) + '" y2="' + Y(avg) + '" stroke="var(--s2)" stroke-width="1.5" stroke-dasharray="5 4"/></svg>';
}

/* Entonnoir de livraison : créées → démarrées → terminées → terminées sans dérogation. */
function funnel(f) {
  if (!f.created) return '<p class="empty">Pas encore de tâches.</p>';
  var stages = [['Créées', f.created], ['Démarrées', f.started], ['Terminées', f.done], ['Sans dérogation', f.clean]], W = 460, H = 150, LW = 110, RW = 90, PW = W - LW - RW;
  return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Entonnoir de livraison">' + stages.map(function (s, i) {
    var w = Math.max(3, PW * s[1] / f.created), y = i * 36 + 4, prev = i ? stages[i - 1][1] : s[1];
    return '<g data-tip="' + s[0] + ' : ' + s[1] + (i ? ' (' + pct(s[1], prev) + ' % de l\'étape précédente)' : '') + '" tabindex="0"><text x="0" y="' + (y + 18) + '" style="fill:var(--ink2);font-size:11.5px">' + s[0] + '</text><rect x="' + (LW + (PW - w) / 2) + '" y="' + y + '" width="' + w + '" height="28" rx="3" fill="var(--s1)" fill-opacity="' + [0.28, 0.5, 0.75, 1][i] + '"/><text class="lab" x="' + (W - RW + 8) + '" y="' + (y + 18) + '">' + s[1] + (i ? '  ' + pct(s[1], f.created) + ' %' : '') + '</text></g>';
  }).join('') + '</svg>';
}

/* Barres horizontales : une ligne par entrée { label, value, max, text, color, tip }. */
function hbars(rows, color) {
  if (!rows.length) return '<p class="empty">Rien à afficher.</p>';
  return '<div class="rows">' + rows.map(function (r) {
    return '<div class="row" data-tip="' + esc(r.tip || r.label + ' : ' + r.text) + '" tabindex="0"><span class="lab">' + esc(r.label) + '</span><span class="track"><i style="width:' + pct(r.value, r.max) + '%;background:' + (r.color || color || 'var(--s1)') + '"></i></span><span class="val">' + esc(r.text) + '</span></div>';
  }).join('') + '</div>';
}

/* Barre empilée unique avec légende chiffrée. */
function statusStack(counts) {
  var total = sum(STATUS_ORDER.map(function (k) { return counts[k] || 0; })), parts = STATUS_ORDER.filter(function (k) { return counts[k] > 0; });
  return '<div class="stack" role="img" aria-label="Répartition par état">' + parts.map(function (k) { return '<i class="st-' + k + '" style="flex:' + counts[k] + '" data-tip="' + STATUS[k].label + ' : ' + counts[k] + ' (' + pct(counts[k], total) + ' %)"></i>'; }).join('') + '</div>'
    + '<div class="legend" style="margin:8px 0 0">' + parts.map(function (k) { return '<span><span class="dot st-' + k + '"></span>' + STATUS[k].label + ' <b>' + counts[k] + '</b></span>'; }).join('') + '</div>';
}

/* Diagramme de flux cumulé : états empilés au fil des jours (une bande qui s'épaissit = un goulot). */
function cfdChart(cfd) {
  if (!cfd.length || !cfd[cfd.length - 1] || !(cfd[cfd.length - 1].done + cfd[cfd.length - 1].pending + cfd[cfd.length - 1].in_progress + cfd[cfd.length - 1].blocked + cfd[cfd.length - 1].failed)) return '<p class="empty">Pas encore d\'historique.</p>';
  var layers = ['done', 'in_progress', 'blocked', 'failed', 'pending'], n = cfd.length, W = 640, H = 190, L = 34, R = 8, T = 8, B = 22;
  var tot = function (p) { return sum(layers.map(function (k) { return p[k]; })); }, top = niceMax(Math.max.apply(null, cfd.map(tot))), step = (W - L - R) / Math.max(1, n - 1);
  function X(i) { return L + i * step; }
  function Y(v) { return T + (H - T - B) * (1 - v / top); }
  var below = cfd.map(function () { return 0; }), areas = layers.map(function (k) {
    var up = cfd.map(function (p, i) { return below[i] + p[k]; }), path = 'M' + up.map(function (v, i) { return X(i) + ',' + Y(v); }).join(' L') + ' L' + below.slice().reverse().map(function (v, j) { return X(n - 1 - j) + ',' + Y(v); }).join(' L') + 'Z';
    below = up;
    return '<path d="' + path + '" fill="' + STATUS_VAR[k] + '" fill-opacity=".85"/>';
  }).join('');
  var hv = cfd.map(function (p, i) { return '<g class="hv" data-tip="' + dayLabel(p.day) + ' · ' + layers.map(function (k) { return STATUS[k].label + ' ' + p[k]; }).join(' · ') + '"><rect class="hit" x="' + (X(i) - step / 2) + '" y="' + T + '" width="' + step + '" height="' + (H - T - B) + '"/><line class="xh" x1="' + X(i) + '" x2="' + X(i) + '" y1="' + T + '" y2="' + (H - B) + '"/></g>'; }).join('');
  var ticks = [0, Math.floor((n - 1) / 2), n - 1].map(function (i) { return '<text x="' + X(i) + '" y="' + (H - 6) + '" text-anchor="' + (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle') + '">' + dayLabel(cfd[i].day) + '</text>'; }).join('');
  return '<div class="legend">' + layers.map(function (k) { return '<span><span class="dot st-' + k + '"></span>' + STATUS[k].label + '</span>'; }).join('') + '</div><svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Flux cumulé sur ' + n + ' jours">' + grid3(L, W - R, Y, top) + areas + ticks + hv + '</svg>';
}

/* Jetons par jour, empilés par modèle (entrée + sortie ; le cache est compté à part). */
function usageBars(days) {
  var keys = ['opus', 'sonnet', 'haiku', 'other'], names = { opus: 'opus', sonnet: 'sonnet', haiku: 'haiku', other: 'autre' }, tot = function (d) { return sum(keys.map(function (k) { return d[k]; })); };
  var max = Math.max.apply(null, days.map(tot));
  if (!max) return '<p class="empty">Aucune consommation mesurée sur 30 jours (elle est lue dans la transcription de chaque sous-agent).</p>';
  var W = 640, H = 190, L = 40, T = 8, B = 22, top = niceMax(max), step = (W - L) / days.length, bw = Math.max(4, step - 3);
  function Y(v) { return T + (H - T - B) * (1 - v / top); }
  var cols = days.map(function (d, i) {
    var base = Y(0), acc = 0, parts = keys.map(function (k, j) {
      if (!d[k]) return '';
      var y1 = Y(acc), y2 = Y(acc + d[k]); acc += d[k];
      return '<rect x="' + (L + i * step + (step - bw) / 2) + '" y="' + y2 + '" width="' + bw + '" height="' + Math.max(1, y1 - y2 - 1) + '" fill="' + SERIES[j] + '"/>';
    }).join('');
    return '<g class="col" data-tip="' + dayLabel(d.day) + ' · ' + keys.filter(function (k) { return d[k]; }).map(function (k) { return names[k] + ' ' + fmtTokens(d[k]); }).join(' · ') + (tot(d) ? '' : 'aucune consommation') + '" tabindex="0">' + parts + '<rect class="hit" x="' + (L + i * step) + '" y="' + T + '" width="' + step + '" height="' + (base - T) + '"/></g>';
  }).join('');
  var ticks = [0, Math.floor((days.length - 1) / 2), days.length - 1].map(function (i) { return '<text x="' + (L + i * step + step / 2) + '" y="' + (H - 6) + '" text-anchor="' + (i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle') + '">' + dayLabel(days[i].day) + '</text>'; }).join('');
  return '<div class="legend">' + keys.map(function (k, j) { return '<span><span class="dot" style="background:' + SERIES[j] + '"></span>' + names[k] + '</span>'; }).join('') + '</div><svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Jetons par jour et par modèle">' + grid3(L, W, Y, top, fmtTokens) + cols + ticks + '</svg>';
}

/* Gantt : une ligne par tâche, groupées par chantier ; du premier essai à la fin ; flèches de dépendance ; ligne « aujourd'hui ».
   Une tâche en attente est dessinée en pointillés (de sa création à maintenant : elle n'a pas de date planifiée). */
function ganttRows(bars, f) {
  var now = Date.now(), keep = bars.filter(function (b) {
    if (f.group && b.group !== f.group) return false;
    if (f.mode === 'active') return b.status !== 'done';
    if (f.mode === 'recent') return b.status !== 'done' || now - Date.parse(b.end) < 14 * DAY_MS;
    return true;
  }), groups = {}, order = [];
  keep.forEach(function (b) { if (!groups[b.group]) { groups[b.group] = []; order.push(b.group); } groups[b.group].push(b); });
  var rows = [], left = 80;
  order.forEach(function (g) { rows.push({ group: g, count: groups[g].length }); groups[g].slice(0, left).forEach(function (b) { rows.push({ bar: b }); }); left = Math.max(0, left - groups[g].length); });
  return { rows: rows, shown: keep.length };
}

function gantt(bars, f) {
  var g = ganttRows(bars, f), rows = g.rows;
  if (!rows.length) return '<p class="empty">Aucune tâche pour ce filtre.</p>';
  var now = Date.now(), tasks = rows.filter(function (r) { return r.bar; }).map(function (r) { return r.bar; });
  var t0 = Math.min.apply(null, tasks.map(function (b) { return Date.parse(b.start); })), t1 = Math.max(now, Math.max.apply(null, tasks.map(function (b) { return Date.parse(b.end); }))) + DAY_MS;
  var W = 1000, LW = 220, RH = 24, PW = W - LW - 12, H = rows.length * RH + 6;
  function X(t) { return LW + (t - t0) / (t1 - t0) * PW; }
  var yOf = {}; rows.forEach(function (r, i) { if (r.bar) yOf[r.bar.id] = i * RH; });
  var span = (t1 - t0) / DAY_MS, stepD = span > 120 ? 28 : span > 45 ? 14 : span > 14 ? 7 : 1, ticks = [], d0 = new Date(t0), mon = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate()) - ((d0.getUTCDay() + 6) % 7) * DAY_MS;
  for (var t = mon; t < t1; t += stepD * DAY_MS) if (t >= t0) ticks.push(t);
  var head = '<svg class="chart gh" viewBox="0 0 ' + W + ' 30" role="img" aria-label="Échelle de temps">' + ticks.map(function (t) { return '<line class="g" x1="' + X(t) + '" x2="' + X(t) + '" y1="18" y2="30"/><text x="' + (X(t) + 3) + '" y="14">' + dayLabel(new Date(t).toISOString()) + '</text>'; }).join('') + '<text class="lab" x="' + X(now) + '" y="26" text-anchor="middle" style="fill:var(--fail)">aujourd\'hui</text></svg>';
  var lines = ticks.map(function (t) { return '<line class="g" x1="' + X(t) + '" x2="' + X(t) + '" y1="0" y2="' + H + '"/>'; }).join('');
  var body = rows.map(function (r, i) {
    var y = i * RH;
    if (r.group !== undefined) return '<rect x="0" y="' + y + '" width="' + W + '" height="' + RH + '" fill="var(--grid)"/><text x="6" y="' + (y + 16) + '" style="fill:var(--ink);font-weight:600;font-size:11.5px">' + esc(trunc(r.group, 30)) + ' (' + r.count + ')</text>';
    var b = r.bar, x = X(Date.parse(b.start)), w = Math.max(6, X(Date.parse(b.end)) - x), pend = b.status === 'pending';
    return '<g data-tip="' + plain(b.id + ' · ' + b.title) + ' — ' + (pend ? 'en attente depuis ' : '') + dur(Date.parse(b.end) - Date.parse(b.start)) + ' (' + STATUS[b.status].one.toLowerCase() + ')" tabindex="0"><text x="14" y="' + (y + 16) + '" style="fill:var(--ink2);font-size:11px">' + esc(b.id + ' ' + trunc(b.title, 26)) + '</text><rect class="st-' + b.status + '" x="' + x + '" y="' + (y + 5) + '" width="' + w + '" height="14" rx="3"' + (pend ? ' fill-opacity=".25" stroke="var(--wait)" stroke-dasharray="3 2"' : '') + '/></g>';
  }).join('');
  var deps = '';
  tasks.forEach(function (b) {
    b.deps.forEach(function (d) {
      var dep = tasks.filter(function (x) { return x.id === d; })[0];
      if (!dep) return;
      var x1 = X(Date.parse(dep.end)), y1 = yOf[d] + RH / 2, x2 = X(Date.parse(b.start)), y2 = yOf[b.id] + RH / 2, xm = Math.max(x1 + 6, Math.min(x2 - 6, (x1 + x2) / 2));
      deps += '<path class="dep" d="M' + x1 + ',' + y1 + ' H' + xm + ' V' + y2 + ' H' + (x2 - 4) + '"/><path d="M' + (x2 - 5) + ',' + (y2 - 3) + ' L' + x2 + ',' + y2 + ' L' + (x2 - 5) + ',' + (y2 + 3) + 'Z" fill="var(--muted)"/>';
    });
  });
  var bodySvg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Diagramme de Gantt">' + lines + body + deps + '<line class="today" x1="' + X(now) + '" x2="' + X(now) + '" y1="0" y2="' + H + '"/></svg>';
  return '<div class="legend">' + ['done', 'in_progress', 'blocked', 'failed', 'pending'].map(function (k) { return '<span><span class="dot st-' + k + '"></span>' + STATUS[k].label + (k === 'pending' ? ' (pointillés : attente depuis la création)' : '') + '</span>'; }).join('') + '<span>Flèche = dépendance</span></div>'
    + '<div class="wrap">' + head + bodySvg + '</div>' + (g.shown > tasks.length ? '<div class="more">' + (g.shown - tasks.length) + ' tâches de plus : affiner le filtre.</div>' : '');
}
