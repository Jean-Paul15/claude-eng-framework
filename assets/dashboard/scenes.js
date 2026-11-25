/* Scènes 3D : transforment les données du tableau de bord en boîtes pour iso.js. Les dimensions sont en « unités de scène »
   (le moteur met l'ensemble à l'échelle). Chaque boîte porte son infobulle. */
function box(x, y, z, w, d, h, color, tip) { return { x: x, y: y, z: z, w: w, d: d, h: h, color: cssColor(color), tip: tip }; }

/* Gantt en relief : le temps va de gauche à droite, une tâche par rangée vers le fond (les 16 premières du filtre : au-delà, la
   vue 3D devient illisible), ligne rouge = aujourd'hui. */
function ganttScene(bars, f) {
  var tasks = ganttRows(bars, f).rows.filter(function (r) { return r.bar; }).map(function (r) { return r.bar; }).slice(0, 16);
  if (!tasks.length) return null;
  var now = Date.now(), t0 = Math.min.apply(null, tasks.map(function (b) { return Date.parse(b.start); })), t1 = Math.max(now, Math.max.apply(null, tasks.map(function (b) { return Date.parse(b.end); }))) + DAY_MS;
  var WX = 16, RH = 1.1, boxes = [], labels = [];
  function X(t) { return (t - t0) / (t1 - t0) * WX; }
  tasks.forEach(function (b, i) {
    var x = X(Date.parse(b.start)), w = Math.max(0.15, X(Date.parse(b.end)) - x), pend = b.status === 'pending';
    boxes.push(box(x, i * RH, 0, w, 0.55, pend ? 0.18 : 0.5, STATUS_VAR[b.status], b.id + ' · ' + b.title + ' — ' + dur(Date.parse(b.end) - Date.parse(b.start)) + ' (' + STATUS[b.status].one.toLowerCase() + ')'));
    labels.push({ x: -0.25, y: i * RH + 0.3, text: b.id, align: 'right' });
  });
  boxes.push(box(X(now), -0.1, 0, 0.07, tasks.length * RH, 1.5, 'var(--fail)', "Aujourd'hui"));
  return { boxes: boxes, ext: { w: WX, d: tasks.length * RH }, maxH: 1.5, labels: labels };
}

/* Tableau scrum en perspective : quatre couloirs, chaque carte est une dalle empilée. */
function boardScene(board) {
  var cols = [['pending', 'À faire'], ['in_progress', 'En cours'], ['blocked', 'Bloquées'], ['done', 'Terminées']], boxes = [], labels = [], maxStack = 1;
  cols.forEach(function (c, j) {
    var cards = board[c[0]].slice(0, 24);
    maxStack = Math.max(maxStack, cards.length);
    cards.forEach(function (card, k) { boxes.push(box(j * 2.6, 0, k * 0.34, 2, 2, 0.28, STATUS_VAR[card.status] || STATUS_VAR[c[0]], card.id + ' · ' + card.title)); });
    labels.push({ x: j * 2.6 + 1, y: 2.5, text: c[1] + ' (' + (board[c[0]].length + (board.hidden[c[0]] || 0)) + ')' });
  });
  return { boxes: boxes, ext: { w: 4 * 2.6 - 0.6, d: 2 }, maxH: maxStack * 0.34, labels: labels };
}

/* Relief des chantiers : une tour par chantier, vert = terminé, gris = reste à faire, hauteur = nombre de tâches. */
function reliefScene(groups) {
  var rows = groups.slice(0, 16);
  if (!rows.length) return null;
  var n = Math.ceil(Math.sqrt(rows.length)), gap = 1.6, max = Math.max.apply(null, rows.map(function (g) { return g.total; })), boxes = [];
  rows.forEach(function (g, i) {
    var x = (i % n) * gap, y = Math.floor(i / n) * gap, hAll = Math.max(0.25, g.total / max * 5), hDone = hAll * (g.total ? g.done / g.total : 0), tip = g.group + ' : ' + g.done + ' terminées sur ' + g.total;
    if (hDone > 0) boxes.push(box(x, y, 0, 1, 1, hDone, 'var(--done)', tip));
    if (hAll - hDone > 0.001) boxes.push(box(x, y, hDone, 1, 1, hAll - hDone, 'var(--idle)', tip));
  });
  return { boxes: boxes, ext: { w: n * gap, d: Math.ceil(rows.length / n) * gap }, maxH: 5, labels: [] };
}

/* Surface de burndown : jours (gauche → droite) × chantiers (vers le fond), hauteur = tâches restantes. */
function surfaceScene(days, series) {
  if (!series.length || !days.length) return null;
  var max = Math.max(1, Math.max.apply(null, series.map(function (s) { return Math.max.apply(null, s.remaining); }))), boxes = [], labels = [], cw = 0.42, rh = 1.1;
  series.forEach(function (s, j) {
    s.remaining.forEach(function (v, i) { if (v > 0) boxes.push(box(i * cw, j * rh, 0, cw * 0.9, 0.8, v / max * 4, SERIES[j % SERIES.length], s.name + ' · ' + dayLabel(days[i]) + ' · ' + plural(v, 'tâche restante', 'tâches restantes'))); });
    labels.push({ x: -0.2, y: j * rh + 0.4, text: trunc(s.name, 14), align: 'right' });
  });
  labels.push({ x: 0, y: series.length * rh + 0.2, text: dayLabel(days[0]), align: 'left' }, { x: days.length * cw, y: series.length * rh + 0.2, text: dayLabel(days[days.length - 1]), align: 'right' });
  return { boxes: boxes, ext: { w: days.length * cw, d: series.length * rh }, maxH: 4, labels: labels };
}
