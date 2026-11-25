import { redact } from '../domain/secrets.js';
import type { Bucket, GateTally, GroupProgress, LiveStatus } from '../domain/report-stats.js';

/** Briques graphiques du tableau de bord : du HTML et du SVG en chaînes, sans dépendance. Chaque marque porte son `data-tip` (survol). */

export const esc = (s: string): string => redact(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** Texte échappé puis mis en forme : `code` et **gras** (les notes du cerveau sont écrites en Markdown). */
export const inline = (s: string): string => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

/** Le même texte sans balisage Markdown, pour les attributs `title` (qui n'affichent pas de mise en forme). */
export const plain = (s: string): string => esc(s.replace(/\*\*|`/g, ''));

export const STATUS_LABEL: Record<LiveStatus, string> = { done: 'Terminées', in_progress: 'En cours', pending: 'À faire', blocked: 'Bloquées', failed: 'Échec' };
const pct = (n: number, total: number): number => (total ? Math.round((n / total) * 100) : 0);

/** Anneau d'avancement : part des tâches terminées, balayé à l'ouverture. */
export function donut(done: number, total: number): string {
  const p = pct(done, total);
  return `<svg class="donut" viewBox="0 0 120 120" role="img" aria-label="${p} % des tâches terminées"><circle class="t" cx="60" cy="60" r="50" fill="none" stroke-width="12"/><circle class="v" cx="60" cy="60" r="50" fill="none" stroke-width="12" pathLength="100" stroke-dasharray="${p} ${100 - p}" transform="rotate(-90 60 60)"/><text x="60" y="68" data-count="${p}" data-suffix=" %">${p} %</text></svg>`;
}

/** Barre unique empilée des états, avec sa légende chiffrée (la couleur ne porte jamais seule le sens). */
export function statusStack(counts: Record<LiveStatus, number>): string {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const parts = (Object.keys(counts) as LiveStatus[]).filter((k) => counts[k] > 0);
  const bar = parts.map((k) => `<i class="${k}" style="flex:${counts[k]}" data-tip="${STATUS_LABEL[k]} : ${counts[k]} (${pct(counts[k], total)} %)" tabindex="0"></i>`).join('');
  const legend = parts.map((k) => `<span><span class="dot ${k}"></span>${STATUS_LABEL[k]} <b>${counts[k]}</b></span>`).join('');
  return `<div class="stack" role="img" aria-label="Répartition des tâches par état">${bar}</div><div class="legend">${legend}</div>`;
}

/** Plus petit « bon » maximum (1, 2, 5 × 10^k) au-dessus de la valeur, pour des repères de grille ronds. */
function niceMax(v: number): number {
  const base = 10 ** Math.floor(Math.log10(Math.max(v, 1)));
  return ([1, 2, 5, 10].map((m) => m * base).find((c) => c >= v) ?? v);
}

/** Histogramme des tâches terminées par jour ou par semaine : 2 px d'écart, bords arrondis, grille discrète, survol par colonne. */
export function columns(buckets: readonly Bucket[], unit: 'jour' | 'semaine'): string {
  if (!buckets.length) return '<p class="empty">Aucune tâche terminée pour l\'instant.</p>';
  const W = 640;
  const H = 210;
  const L = 30;
  const B = 24;
  const T = 8;
  const top = niceMax(Math.max(...buckets.map((b) => b.count)));
  const step = (W - L) / buckets.length;
  const bw = Math.max(2, Math.min(30, step - 2));
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const grid = [0, 0.5, 1].map((f) => `<line class="${f === 0 ? 'ax' : 'g'}" x1="${L}" x2="${W}" y1="${y(top * f)}" y2="${y(top * f)}"/><text x="${L - 6}" y="${y(top * f) + 4}" text-anchor="end">${Math.round(top * f)}</text>`).join('');
  const cols = buckets.map((b, i) => {
    const x = L + i * step + (step - bw) / 2;
    const h = (H - T - B) * (b.count / top);
    const r = Math.min(4, bw / 2, h);
    const bar = b.count ? `<path class="bar" d="M${x},${y(0)}v${-(h - r)}a${r},${r} 0 0 1 ${r},${-r}h${bw - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - r}z"/>` : '';
    const label = `${unit === 'semaine' ? 'Semaine du ' : ''}${b.start} : ${b.count} tâche${b.count > 1 ? 's' : ''} terminée${b.count > 1 ? 's' : ''}`;
    return `<g class="col" data-tip="${esc(label)}" tabindex="0">${bar}<rect class="hit" x="${L + i * step}" y="${T}" width="${step}" height="${H - T - B}"/></g>`;
  }).join('');
  const ticks = [0, Math.floor((buckets.length - 1) / 2), buckets.length - 1].filter((v, i, a) => a.indexOf(v) === i)
    .map((i) => `<text x="${L + i * step + step / 2}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === buckets.length - 1 ? 'end' : 'middle'}">${esc(buckets[i]!.start)}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tâches terminées par ${unit}">${grid}${cols}${ticks}</svg>`;
}

/** Une barre de progression par chantier : terminées sur total. */
export function groupBars(groups: readonly GroupProgress[]): string {
  return `<div class="rows">${groups.map((g) => `<div class="row" data-tip="${esc(g.group)} : ${g.done} terminées sur ${g.total}" tabindex="0"><span class="lab">${esc(g.group)}</span><span class="track"><i style="width:${pct(g.done, g.total)}%"></i></span><span class="val">${g.done}/${g.total}</span></div>`).join('')}</div>`;
}

const GATE_PARTS = [['pass', 'Réussi'], ['fail', 'Échec'], ['waived', 'Dispensé'], ['other', 'Autre']] as const;

/** Une barre empilée par contrôle qualité : réussi, échec, dispensé, autre — avec le détail en clair à droite. */
export function gateBars(rows: readonly GateTally[]): string {
  if (!rows.length) return '<p class="empty">Aucun contrôle enregistré.</p>';
  const legend = `<div class="legend" style="margin-bottom:10px">${GATE_PARTS.map(([k, l]) => `<span><span class="dot ${k}"></span>${l}</span>`).join('')}</div>`;
  const body = rows.map((r) => {
    const total = r.pass + r.fail + r.waived + r.other;
    const segs = GATE_PARTS.filter(([k]) => r[k] > 0).map(([k, l]) => `<i class="seg ${k}" style="flex:${r[k]}" data-tip="${esc(r.gate)} · ${l} : ${r[k]}"></i>`).join('');
    return `<div class="row"><span class="lab">${esc(r.gate)}</span><span class="track bare" style="background:none">${segs}</span><span class="val">${r.pass}/${total}</span></div>`;
  }).join('');
  return `${legend}<div class="rows">${body}</div>`;
}

/** Tentatives par modèle : trois séries de la palette catégorielle, valeur écrite à côté de chaque barre. */
export function modelBars(counts: Readonly<Record<'opus' | 'sonnet' | 'haiku', number>>): string {
  const max = Math.max(1, ...Object.values(counts));
  const slot = { opus: 's1', sonnet: 's2', haiku: 's3' } as const;
  return `<div class="rows">${(Object.keys(counts) as (keyof typeof counts)[]).map((m) => `<div class="row" data-tip="${m} : ${counts[m]} tentative(s)" tabindex="0"><span class="lab">${m}</span><span class="track"><i class="${slot[m]}" style="width:${pct(counts[m], max)}%"></i></span><span class="val">${counts[m]}</span></div>`).join('')}</div>`;
}
