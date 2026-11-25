/* Moteur 3D isométrique sur canevas, sans bibliothèque. Une « scène » = { boxes, ext: {w, d}, maxH, labels } décrite par scenes.js ;
   chaque carte 3D garde son angle de vue d'une mise à jour à l'autre (les données arrivent en direct sans réinitialiser la rotation).
   Glisser = tourner, survol = détail, flèches ← → au clavier. Le 2D reste la lecture de référence : la 3D est une vue en plus. */
var REDUCE = matchMedia('(prefers-reduced-motion:reduce)').matches;
var ISO = {};
var isoRunning = false;

function cssColor(v) { return /^var\(/.test(v) ? css(v.slice(4, -1)) : v; }

function isoMount(id, canvas, scene, tip) {
  var s = ISO[id] || (ISO[id] = { angle: -0.6, auto: !REDUCE, hover: -1, grow: REDUCE ? 1 : 0, t0: performance.now(), drag: null, polys: [] });
  s.scene = scene; s.tip = tip;
  if (s.canvas !== canvas) { s.canvas = canvas; s.ctx = canvas.getContext('2d'); isoBind(s); }
  if (!isoRunning) { isoRunning = true; requestAnimationFrame(isoLoop); }
}

function isoBind(s) {
  var cv = s.canvas;
  cv.addEventListener('pointerdown', function (e) { s.drag = { x: e.clientX, a: s.angle }; s.auto = false; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointerup', function () { s.drag = null; });
  cv.addEventListener('pointercancel', function () { s.drag = null; });
  cv.addEventListener('pointermove', function (e) {
    var r = cv.getBoundingClientRect();
    if (s.drag) { s.angle = s.drag.a + (e.clientX - s.drag.x) * 0.01; s.tip.hide(); return; }
    var h = isoPick(s, e.clientX - r.left, e.clientY - r.top);
    s.hover = h ? h.idx : -1;
    if (h) s.tip.show(h.tip, e.clientX, e.clientY); else s.tip.hide();
  });
  cv.addEventListener('pointerleave', function () { s.hover = -1; s.tip.hide(); });
  cv.addEventListener('keydown', function (e) { if (e.key === 'ArrowLeft') { s.angle -= 0.15; s.auto = false; } if (e.key === 'ArrowRight') { s.angle += 0.15; s.auto = false; } });
}

function polyPath(c, p) { c.beginPath(); c.moveTo(p[0][0], p[0][1]); for (var i = 1; i < p.length; i++) c.lineTo(p[i][0], p[i][1]); c.closePath(); }
function inside(pts, x, y) { var o = false; for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) { var a = pts[i], b = pts[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) o = !o; } return o; }
function isoPick(s, x, y) { for (var i = s.polys.length - 1; i >= 0; i--) if (inside(s.polys[i].pts, x, y)) return s.polys[i]; return null; }

var FACES = [[[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], 0, -1], [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1], 0, 1], [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1], -1, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1], 1, 0]];

function isoDraw(s, now) {
  var cv = s.canvas, c = s.ctx, W = cv.clientWidth, H = cv.clientHeight, dpr = Math.min(devicePixelRatio || 1, 2), sc = s.scene;
  if (!W || !H || !sc) return;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
  var k = REDUCE ? 1 : Math.min(1, (now - s.t0) / 800); s.grow = 1 - Math.pow(1 - k, 3);
  var ca = Math.cos(s.angle), sa = Math.sin(s.angle), span = Math.max(sc.ext.w, sc.ext.d, 1), maxH = Math.max(sc.maxH, 0.5);
  var scale = Math.min(W / (span * 1.4), H / (span * 0.75 + maxH * 0.95)), cx = W / 2, cy = H * 0.5 + maxH * 0.9 * scale * 0.5 - span * 0.04 * scale;
  function P(x, y, z) { var X = x - sc.ext.w / 2, Y = y - sc.ext.d / 2, rx = X * ca - Y * sa, ry = X * sa + Y * ca; return [cx + rx * scale, cy + ry * scale * 0.5 - z * scale * 0.9 * s.grow, ry]; }
  s.polys = [];
  var fl = [P(-0.3, -0.3, 0), P(sc.ext.w + 0.3, -0.3, 0), P(sc.ext.w + 0.3, sc.ext.d + 0.3, 0), P(-0.3, sc.ext.d + 0.3, 0)];
  polyPath(c, fl); c.fillStyle = css('--card'); c.fill(); c.strokeStyle = css('--line'); c.lineWidth = 1; c.stroke();
  var boxes = sc.boxes.map(function (b, i) { b.i = i; b.depth = P(b.x + b.w / 2, b.y + b.d / 2, 0)[2]; return b; }).sort(function (a, b) { return a.depth - b.depth || a.z - b.z; });
  boxes.forEach(function (b) {
    var lit = b.i === s.hover;
    FACES.forEach(function (f) {
      if (f[4] * sa + f[5] * ca <= 0) return;
      var pts = f.slice(0, 4).map(function (v) { return P(b.x + v[0] * b.w, b.y + v[1] * b.d, b.z + v[2] * b.h); });
      polyPath(c, pts); c.fillStyle = b.color; c.fill(); c.fillStyle = 'rgba(0,0,0,' + (Math.abs(f[4] * ca - f[5] * sa) > 0.7 ? 0.3 : 0.16) + ')'; c.fill();
      if (lit) { c.fillStyle = 'rgba(255,255,255,.2)'; c.fill(); }
      s.polys.push({ pts: pts, idx: b.i, tip: b.tip });
    });
    var top = [P(b.x, b.y, b.z + b.h), P(b.x + b.w, b.y, b.z + b.h), P(b.x + b.w, b.y + b.d, b.z + b.h), P(b.x, b.y + b.d, b.z + b.h)];
    polyPath(c, top); c.fillStyle = b.color; c.fill(); c.fillStyle = 'rgba(255,255,255,' + (lit ? 0.38 : 0.16) + ')'; c.fill();
    s.polys.push({ pts: top, idx: b.i, tip: b.tip });
  });
  c.font = '600 11px ' + css('--font'); c.fillStyle = css('--ink2');
  (sc.labels || []).forEach(function (l) { var p = P(l.x, l.y, l.z || 0); c.textAlign = l.align || 'center'; c.fillText(l.text, p[0], p[1] + 4); });
}

function isoLoop(now) {
  Object.keys(ISO).forEach(function (id) {
    var s = ISO[id];
    if (!s.canvas || !s.canvas.isConnected || !s.canvas.offsetParent) return;
    if (s.auto && !s.drag) s.angle += 0.0025;
    isoDraw(s, now);
  });
  requestAnimationFrame(isoLoop);
}
