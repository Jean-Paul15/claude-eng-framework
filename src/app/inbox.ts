import { listDecisions } from './decisions.js';
import { exists, readText } from '../infra/fs.js';
import type { BrainStore } from '../brain/store.js';

/**
 * Boîte de décisions : tout ce qui attend l'humain, au même endroit, trié par impact — action à approbation refusée la nuit,
 * décision forte en attente, tâche bloquée, escalade ouverte (bloquant) ; décision provisoire prise à sa place (à confirmer).
 * Sans réponse, les tâches dépendantes attendent et tout le reste avance ; une décision provisoire tient.
 */

export type InboxLevel = 'blocking' | 'confirm';

export interface InboxItem {
  level: InboxLevel;
  source: 'approval' | 'decision' | 'task' | 'escalation';
  question: string;
  /** Valeur retenue en attendant (décision provisoire) ou conséquence de l'attente. */
  default: string;
  ref: string;
}

/** Coupe à la limite sur une frontière de mot (jamais « Exi ») et le signale par une ellipse. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max / 2))}…`;
}

export function inboxItems(store: BrainStore): InboxItem[] {
  const items: InboxItem[] = [];
  const approvals = readText(`${store.paths.brain}/pending-approvals.md`) ?? '';
  for (const l of approvals.split(/\r?\n/).filter((x) => x.startsWith('- [ ]'))) {
    items.push({ level: 'blocking', source: 'approval', question: clip(l.replace(/^- \[ \]\s*/, ''), 400), default: 'action non exécutée, tâche bloquée', ref: 'pending-approvals.md' });
  }
  for (const d of listDecisions(store)) {
    const head = d.text.slice(0, 500);
    const strong = /impact d'un changement : fort/i.test(head);
    if (/EN ATTENTE/i.test(head)) items.push({ level: strong ? 'blocking' : 'confirm', source: 'decision', question: d.title, default: strong ? 'les tâches qui en dépendent attendent' : 'recommandation appliquée en attendant', ref: d.file });
    else if (/PROVISOIRE/i.test(head)) items.push({ level: 'confirm', source: 'decision', question: d.title, default: 'choix provisoire en vigueur', ref: d.file });
  }
  for (const t of store.tasks().filter((x) => x.status === 'blocked')) {
    items.push({ level: 'blocking', source: 'task', question: `${t.id} ${t.title} — ${t.blockedReason ?? 'bloquée'}`, default: 'tâche à l\'arrêt', ref: t.id });
  }
  const dir = store.paths.escalations;
  if (exists(dir)) {
    for (const f of store.listDir(dir).filter((x) => !/status:\s*resolved/i.test(readText(`${dir}/${x}`) ?? ''))) {
      items.push({ level: 'blocking', source: 'escalation', question: `Escalade ouverte ${f.replace(/\.md$/, '')}`, default: 'en cours de traitement par ceng-principal', ref: `escalations/${f}` });
    }
  }
  return items.sort((a, b) => (a.level === b.level ? 0 : a.level === 'blocking' ? -1 : 1));
}

export function inboxSummary(items: readonly InboxItem[]): string {
  const b = items.filter((i) => i.level === 'blocking').length;
  const c = items.length - b;
  return `${b} décision(s) bloquante(s), ${c} à confirmer`;
}
