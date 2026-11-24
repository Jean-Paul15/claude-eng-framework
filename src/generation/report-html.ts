import { redact } from '../domain/secrets.js';
import type { InboxItem } from '../app/inbox.js';
import type { Feature } from '../app/features.js';
import type { Task } from '../domain/types.js';

/**
 * Tableau de bord de livraison : une page HTML autonome (aucune ressource externe), lisible sur téléphone, claire et sombre.
 * Révélation progressive : en haut trois chiffres et ce qui attend l'humain ; le détail (tâches, fonctionnalités, captures) est replié.
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

const esc = (s: string): string => redact(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const STATUS = { done: 'terminée', in_progress: 'en cours', pending: 'à faire', blocked: 'bloquée', failed: 'échec', cancelled: 'annulée' } as Record<string, string>;
const FEATURE = { decided: 'décidée', in_progress: 'en cours', delivered: 'livrée', rejected: 'écartée', replaced: 'remplacée' } as Record<string, string>;

const CSS = `:root{--bg:#f7f6f3;--fg:#1c1b19;--mut:#6b6860;--card:#fff;--line:#e4e1da;--acc:#2f5d50;--warn:#a4472b}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--fg:#ecebe6;--mut:#a09d94;--card:#201f1c;--line:#34322d;--acc:#7fb8a5;--warn:#e08a6c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 64px}h1{font-size:1.4rem;margin:0 0 4px}h2{font-size:1.05rem;margin:28px 0 10px}
.mut{color:var(--mut);font-size:.9rem}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}.stat b{display:block;font-size:1.6rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:8px 0;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.card.block{border-left:4px solid var(--warn)}.card.ok{border-left:4px solid var(--acc)}
details{background:var(--card);border:1px solid var(--line);border-radius:12px;margin:10px 0;padding:4px 14px}summary{cursor:pointer;padding:10px 0;font-weight:600}
li{margin:4px 0}.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin:8px 0}.shots img{width:100%;border-radius:8px;border:1px solid var(--line)}
.tag{display:inline-block;font-size:.78rem;padding:1px 8px;border-radius:99px;border:1px solid var(--line);color:var(--mut)}`;

export function renderReport(d: ReportData): string {
  const count = (s: string) => d.tasks.filter((t) => t.status === s).length;
  const blocking = d.inbox.filter((i) => i.level === 'blocking');
  const confirm = d.inbox.filter((i) => i.level === 'confirm');
  const waiting = [...blocking, ...confirm]
    .map((i) => `<div class="card ${i.level === 'blocking' ? 'block' : ''}"><strong>${i.level === 'blocking' ? 'Bloquant' : 'À confirmer'}</strong> — ${esc(i.question)}<div class="mut">Par défaut : ${esc(i.default)}</div></div>`)
    .join('');
  const features = d.features.map((f) => `<li><strong>${esc(f.id)}</strong> ${esc(f.name)} <span class="tag">${FEATURE[f.status] ?? f.status}</span>${f.reason ? ` <span class="mut">(${esc(f.reason)})</span>` : ''}</li>`).join('');
  const tasks = d.tasks.filter((t) => t.status !== 'cancelled').map((t) => `<li><strong>${esc(t.id)}</strong> ${esc(t.title)} <span class="tag">${STATUS[t.status] ?? t.status}</span></li>`).join('');
  const shots = Object.entries(d.shots).filter(([, f]) => f.length).map(([task, files]) => `<details><summary>Captures ${esc(task)} (${files.length})</summary><div class="shots">${files.slice(0, 24).map((f) => `<a href="${esc(f)}"><img loading="lazy" src="${esc(f)}" alt="${esc(f)}"></a>`).join('')}</div></details>`).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Livraison ${esc(d.project)}</title><style>${CSS}</style></head><body><main>
<h1>${esc(d.project)}</h1><div class="mut">État au ${esc(d.generatedAt.slice(0, 16).replace('T', ' '))} UTC</div>
<div class="stats"><div class="stat"><b>${count('done')}</b>terminées</div><div class="stat"><b>${count('in_progress')}</b>en cours</div><div class="stat"><b>${count('blocked') + count('failed')}</b>bloquées</div></div>
<h2>Ce qui t'attend</h2>${waiting || '<div class="card ok">Rien n\'attend ta décision.</div>'}
${d.specCoverage ? `<h2>Cahier des charges</h2><div class="card ${d.specCoverage.open ? 'block' : 'ok'}">${d.specCoverage.total - d.specCoverage.open} exigence(s) sur ${d.specCoverage.total} rattachée(s) à une tâche.</div>` : ''}
${d.features.length ? `<details><summary>Fonctionnalités (${d.features.length})</summary><ul>${features}</ul></details>` : ''}
<details><summary>Tâches (${d.tasks.filter((t) => t.status !== 'cancelled').length})</summary><ul>${tasks}</ul></details>${shots}
</main></body></html>`;
}
