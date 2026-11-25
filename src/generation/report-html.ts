import type { InboxItem } from '../app/inbox.js';
import type { Feature } from '../app/features.js';
import type { Task } from '../domain/types.js';
import { attemptsByModel, doneOverTime, gateTallies, groupProgress, statusCounts } from '../domain/report-stats.js';
import { columns, donut, esc, gateBars, groupBars, inline, modelBars, plain, STATUS_LABEL, statusStack } from './report-charts.js';
import { SCRIPT } from './report-script.js';
import { CSS } from './report-style.js';

/**
 * Tableau de bord de livraison : une page HTML autonome (aucune ressource externe), lisible sur téléphone, claire et sombre.
 * Du visuel d'abord : chiffres clés, relief 3D des chantiers, avancement, rythme, contrôles qualité. Ce qui attend l'humain et le détail
 * (tâches, fonctionnalités, captures) viennent après, repliés au-delà de quelques lignes.
 */

export interface ReportData {
  project: string;
  generatedAt: string;
  tasks: readonly Task[];
  features: readonly Feature[];
  inbox: readonly InboxItem[];
  /** Captures par tâche (chemins relatifs à `.ceng/report/`). */
  shots: Readonly<Record<string, readonly string[]>>;
  specCoverage?: { total: number; open: number };
}

const FEATURE = { decided: 'décidée', in_progress: 'en cours', delivered: 'livrée', rejected: 'écartée', replaced: 'remplacée' } as Record<string, string>;
const SOURCE = { approval: 'Approbation', decision: 'Décision', task: 'Tâche bloquée', escalation: 'Escalade' } as const;
/** Cartes d'attente montrées d'emblée ; le reste est replié. */
const VISIBLE = 5;
/** Tours du relief 3D : au-delà, les chantiers les moins chargés sont écartés (ils restent dans les barres 2D). */
const TOWERS = 16;

const kpi = (n: number, label: string, accent: string, href?: string) =>
  `<${href ? `a href="${href}"` : 'div'} class="card kpi" style="--accent:var(${accent})"><b data-count="${n}">${n}</b><span>${label}</span></${href ? 'a' : 'div'}>`;

function waitingCard(i: InboxItem): string {
  const blocking = i.level === 'blocking';
  return `<div class="wait"><div class="lv"><b>${blocking ? '● Bloquant' : '◐ À confirmer'}</b><br>${SOURCE[i.source]}</div><div class="tx" title="${plain(i.question)}">${inline(i.question)}</div></div>`;
}

function waiting(inbox: readonly InboxItem[]): string {
  if (!inbox.length) return '<p class="empty">Rien n\'attend ta décision.</p>';
  const chips = (Object.keys(SOURCE) as (keyof typeof SOURCE)[])
    .map((s) => [s, inbox.filter((i) => i.source === s).length] as const).filter(([, n]) => n > 0)
    .map(([s, n]) => `<span class="chip">${SOURCE[s]} <b>${n}</b></span>`).join('');
  const rest = inbox.slice(VISIBLE);
  return `<div class="chips">${chips}</div>${inbox.slice(0, VISIBLE).map(waitingCard).join('')}${rest.length ? `<details><summary>Voir les ${rest.length} autres</summary>${rest.map(waitingCard).join('')}</details>` : ''}`;
}

const table = (head: readonly string[], rows: readonly string[]): string =>
  `<div class="scroll"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

export function renderReport(d: ReportData): string {
  const live = d.tasks.filter((t) => t.status !== 'cancelled');
  const counts = statusCounts(d.tasks);
  const { by, rows: groups } = groupProgress(d.tasks);
  const groupTitle = by === 'chantier' ? 'Chantiers' : 'Types de tâches';
  const time = doneOverTime(d.tasks);
  const towers = groups.slice(0, TOWERS).map((g) => ({ n: g.group, d: g.done, t: g.total }));
  const shown = groups.slice(0, 8);
  const hiddenGroups = groups.slice(8);
  const taskRows = live.map((t) => `<tr><td class="n">${esc(t.id)}</td><td>${esc(t.title)}</td><td>${esc(t.kind)}</td><td><span class="pill">${STATUS_LABEL[t.status as keyof typeof STATUS_LABEL] ?? esc(t.status)}</span></td><td class="n">${t.attempts.length}</td></tr>`);
  const featureRows = d.features.map((f) => `<tr><td class="n">${esc(f.id)}</td><td>${esc(f.name)}</td><td><span class="pill">${FEATURE[f.status] ?? esc(f.status)}</span></td><td>${f.reason ? esc(f.reason) : ''}</td></tr>`);
  const shots = Object.entries(d.shots).filter(([, f]) => f.length).map(([task, files]) => `<details><summary>Captures ${esc(task)} (${files.length})</summary><div class="shots">${files.slice(0, 24).map((f) => `<a href="${esc(f)}"><img loading="lazy" src="${esc(f)}" alt="${esc(f)}"></a>`).join('')}</div></details>`).join('');
  const models = attemptsByModel(d.tasks);
  const spec = d.specCoverage;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Livraison ${esc(d.project)}</title><style>${CSS}</style></head><body><main>
<header><h1>${esc(d.project)}</h1><span class="sub">État au ${esc(d.generatedAt.slice(0, 16).replace('T', ' '))} UTC</span></header>
<div class="grid kpis">${kpi(counts.done, 'terminées', '--good')}${kpi(counts.in_progress, 'en cours', '--s1')}${kpi(counts.blocked + counts.failed, 'bloquées ou en échec', '--warn')}${kpi(d.inbox.length, 'attendent ta décision', '--crit', '#attente')}</div>
<section class="card hero3d"><div class="head"><h2>Relief du projet</h2><span class="hint">Glisse pour tourner · survole une tour · ← →</span></div>
<canvas class="relief" tabindex="0" role="img" aria-label="Tours par ${by === 'chantier' ? 'chantier' : 'type de tâche'} : la partie verte est terminée, la grise reste à faire" data-towers="${esc(JSON.stringify(towers))}"></canvas>
<div class="legend" style="padding:0 16px 14px"><span><span class="dot done"></span>Terminé</span><span><span class="dot pending"></span>Reste à faire</span><span>Hauteur = nombre de tâches (${by === 'chantier' ? 'une tour par chantier' : 'une tour par type de tâche'})</span></div></section>
<div class="grid two">
<section class="card"><h2>Avancement</h2><div class="hero">${donut(counts.done, live.length)}<div>${statusStack(counts)}</div></div></section>
<section class="card"><h2>Terminées par ${time.unit}</h2>${columns(time.buckets, time.unit)}</section>
</div>
<div class="grid two">
<section class="card"><h2>${groupTitle}</h2>${groupBars(shown)}${hiddenGroups.length ? `<details><summary>Voir les ${hiddenGroups.length} autres</summary>${groupBars(hiddenGroups)}</details>` : ''}</section>
<section class="card"><h2>Contrôles qualité</h2>${gateBars(gateTallies(d.tasks).slice(0, 12))}</section>
</div>
<div class="grid two">
<section class="card" id="attente"><h2>Ce qui t'attend</h2>${waiting(d.inbox)}</section>
<div class="grid" style="margin:0;align-content:start">
<section class="card"><h2>Tentatives par modèle</h2>${modelBars(models)}</section>
${spec ? `<section class="card"><h2>Cahier des charges</h2><div class="stack">${spec.total - spec.open ? `<i class="done" style="flex:${spec.total - spec.open}" data-tip="Rattachées à une tâche : ${spec.total - spec.open}"></i>` : ''}${spec.open ? `<i class="blocked" style="flex:${spec.open}" data-tip="Sans tâche : ${spec.open}"></i>` : ''}</div><div class="legend"><span><span class="dot done"></span>Rattachées <b>${spec.total - spec.open}</b></span><span><span class="dot blocked"></span>Sans tâche <b>${spec.open}</b></span></div></section>` : ''}
</div></div>
${d.features.length ? `<details class="card"><summary>Fonctionnalités (${d.features.length})</summary>${table(['Id', 'Nom', 'État', 'Raison'], featureRows)}</details>` : ''}
<details class="card"><summary>Toutes les tâches (${live.length})</summary>${table(['Id', 'Titre', 'Type', 'État', 'Essais'], taskRows)}</details>${shots}
</main><script>${SCRIPT}</script></body></html>`;
}
