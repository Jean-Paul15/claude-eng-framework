import { readyTasks } from '../domain/taskgraph.js';
import type { Task } from '../domain/types.js';
import { exists, readText } from '../infra/fs.js';
import { CLI_INVOCATION } from './paths.js';
import type { BrainStore } from './store.js';

/**
 * Vues compactes du Project Brain (progressive disclosure) :
 *  - INDEX.md : la porte d'entrée (≈ 60 lignes max), avec des pointeurs plutôt que du contenu ;
 *  - brief de reprise : injecté par le hook SessionStart, borné en taille.
 */

const MAX_BRIEF_CHARS = 6000;

function firstLines(text: string | undefined, n: number): string {
  if (!text) return '';
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith('#') && !l.startsWith('<!--'))
    .slice(0, n)
    .join('\n');
}

function line(t: Task): string {
  const route = t.route ? ` · ${t.route.implementer.agent}/${t.route.implementer.model}` : '';
  return `- ${t.id} [${t.kind}] ${t.title}${route}`;
}

export function statusCounts(tasks: readonly Task[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const t of tasks) c[t.status] = (c[t.status] ?? 0) + 1;
  return c;
}

export function renderIndex(store: BrainStore): string {
  const p = store.paths;
  const tasks = store.tasks();
  const state = store.state();
  const counts = statusCounts(tasks);
  const ready = readyTasks(tasks).slice(0, 5);
  const blocked = tasks.filter((t) => t.status === 'blocked' || t.status === 'failed');
  const recent = tasks.filter((t) => t.status === 'done').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
  const openEsc = store.listDir(p.escalations).filter((f) => !/status:\s*resolved/i.test(readText(`${p.escalations}/${f}`) ?? ''));
  const current = state.currentTask ? tasks.find((t) => t.id === state.currentTask) : undefined;
  const objective = firstLines(readText(p.objective), 4) || '_Objectif non défini : lancer /ceng-orchestrate pour le bootstrap._';
  const out = [
    '# Project Brain — index',
    '<!-- Généré par ceng (ne pas éditer à la main : `ceng status` le régénère). -->',
    '',
    '## Objectif',
    objective,
    '',
    `## État — ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'aucune tâche'}`,
    current ? `**Tâche en cours** : ${current.id} — ${current.title} (${current.status})` : '**Tâche en cours** : aucune',
    state.lastCheckpoint ? `**Dernier checkpoint** ${state.lastCheckpoint.id} (${state.lastCheckpoint.at}) — prochaine étape : ${state.lastCheckpoint.next}` : '',
    state.interruption ? `**Interruption précédente** : ${state.interruption.type} à ${state.interruption.at}` : '',
    '',
    '## Prochaines tâches prêtes',
    ...(ready.length ? ready.map(line) : ['_aucune_']),
    '',
    '## Blocages / échecs',
    ...(blocked.length ? blocked.map((t) => `- ${t.id} ${t.title} — ${t.blockedReason ?? t.attempts.at(-1)?.reason ?? t.status}`) : ['_aucun_']),
    ...(openEsc.length ? ['', `## Escalades ouvertes`, ...openEsc.map((f) => `- escalations/${f}`)] : []),
    ...(exists(`${p.brain}/pending-approvals.md`) && /- \[ \]/.test(readText(`${p.brain}/pending-approvals.md`) ?? '') ? ['', '## En attente de validation humaine', '- `pending-approvals.md` (actions refusées pendant un travail sans humain)'] : []),
    '',
    '## Récemment terminé',
    ...(recent.length ? recent.map((t) => `- ${t.id} ${t.title}`) : ['_rien encore_']),
    '',
    '## Où trouver le reste (charger seulement si nécessaire)',
    '- `project.md` profil technique détecté · `architecture.md` · `objective.md`',
    '- `decisions/` ADR · `reports/<tâche>.md` rapports d\'agents · `research/` notes de recherche',
    '- `assumptions.md` · `known-issues.md` · `escalations/` · `teams/` chartes d\'équipe',
    `- État machine : \`${CLI_INVOCATION} task list\`, \`${CLI_INVOCATION} resume\``,
  ];
  return out.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n') + '\n';
}

/** Brief injecté à chaque (re)démarrage de session : suffisant pour reprendre sans l'historique. */
export function resumeBrief(store: BrainStore, source: string): string {
  const p = store.paths;
  const tasks = store.tasks();
  const state = store.state();
  const current = state.currentTask ? tasks.find((t) => t.id === state.currentTask) : undefined;
  const parts: string[] = [];
  parts.push(`[ceng] Framework d'ingénierie actif (session ${source}). Mémoire projet : .ceng/brain/INDEX.md. Protocole : skill ceng-orchestrate.`);
  if (state.interruption) parts.push(`⚠ La session précédente a été interrompue (${state.interruption.type}${state.interruption.detail ? ` : ${state.interruption.detail}` : ''}) à ${state.interruption.at}. Reprendre depuis le dernier checkpoint, ne pas recommencer l'analyse.`);
  if (current) {
    parts.push(`Tâche en cours : ${current.id} — ${current.title} [${current.kind}, statut ${current.status}, tentatives ${current.attempts.length}].`);
    if (current.acceptance.length) parts.push(`Critères d'acceptation : ${current.acceptance.join(' ; ')}`);
    const lastFail = [...current.attempts].reverse().find((a) => a.outcome === 'failure');
    if (lastFail) parts.push(`Dernier échec (${lastFail.agent}/${lastFail.model}) : ${lastFail.reason ?? 'raison non consignée'}.`);
    if (exists(p.report(current.id))) parts.push(`Rapport existant : .ceng/brain/reports/${current.id}.md`);
  }
  const cp = state.lastCheckpoint;
  if (cp) parts.push(`Dernier checkpoint ${cp.id} (${cp.at}) — fait : ${cp.done} | prochaine étape : ${cp.next}${cp.failed ? ` | échec : ${cp.failed}` : ''}`);
  if (state.editsSinceCheckpoint > 0) parts.push(`${state.editsSinceCheckpoint} modification(s) de fichiers depuis ce checkpoint : vérifier \`git status\`/\`git diff\` avant de continuer.`);
  const ready = readyTasks(tasks);
  if (!current && ready.length) parts.push(`Tâches prêtes : ${ready.slice(0, 5).map((t) => `${t.id} ${t.title}`).join(' ; ')}.`);
  const blocked = tasks.filter((t) => t.status === 'blocked');
  if (blocked.length) parts.push(`Bloquées : ${blocked.map((t) => `${t.id} (${t.blockedReason ?? '?'})`).join(' ; ')}.`);
  const pending = (readText(`${p.brain}/pending-approvals.md`) ?? '').split(/\r?\n/).filter((l) => l.startsWith('- [ ]')).length;
  if (pending) parts.push(`${pending} action(s) refusée(s) pendant un travail sans humain attendent une décision (.ceng/brain/pending-approvals.md) : dès que l'humain écrit, les lui poser avec l'outil de questions (AskUserQuestion), une décision par question, option recommandée en premier — pas de liste en texte.`);
  if (tasks.length === 0) parts.push('Aucune tâche : bootstrap nécessaire (objectif → architecture → graphe de tâches) via /ceng-orchestrate.');
  if (source === 'compact') parts.push('Le contexte vient d\'être compacté : relire le rapport de la tâche en cours avant d\'agir.');
  parts.push(`Commandes : \`${CLI_INVOCATION} resume\` (détail), \`task next\`, \`route <id>\`, \`checkpoint\`.`);
  const brief = parts.join('\n');
  return brief.length > MAX_BRIEF_CHARS ? `${brief.slice(0, MAX_BRIEF_CHARS - 40)}\n…[tronqué : voir INDEX.md]` : brief;
}
