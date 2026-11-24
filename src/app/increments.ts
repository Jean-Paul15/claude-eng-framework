import * as path from 'node:path';
import { inboxItems } from './inbox.js';
import { runShell } from '../infra/exec.js';
import { writeTextAtomic } from '../infra/fs.js';
import type { BrainStore } from '../brain/store.js';

/**
 * Clôture d'incrément : un groupe de tâches (`task add --group`) n'est « livré » que si tout est prouvé. Écrit le rapport
 * d'incrément (ce qui est livré, preuves, captures, décisions à confirmer) puis rappelle la rétro (`ceng adapt`, `ceng learn add`).
 */

export interface IncrementCheck {
  title: string;
  status: 'pass' | 'fail' | 'skipped';
  detail: string;
}

export function closeIncrement(store: BrainStore, group: string): { ok: boolean; checks: IncrementCheck[]; file?: string } {
  const tasks = store.tasks().filter((t) => t.group === group && t.status !== 'cancelled');
  const checks: IncrementCheck[] = [];
  if (!tasks.length) return { ok: false, checks: [{ title: 'Tâches du groupe', status: 'fail', detail: `aucune tâche dans le groupe « ${group} » (task add --group ${group})` }] };

  const open = tasks.filter((t) => t.status !== 'done');
  checks.push({ title: 'Toutes les tâches sont terminées', status: open.length ? 'fail' : 'pass', detail: open.length ? open.map((t) => `${t.id} (${t.status})`).join(', ') : `${tasks.length} tâche(s)` });

  const waivers = tasks.filter((t) => t.waiver);
  checks.push({ title: 'Dérogations justifiées', status: waivers.some((t) => (t.waiver ?? '').trim().length < 10) ? 'fail' : 'pass', detail: waivers.length ? waivers.map((t) => `${t.id} : ${t.waiver}`).join(' | ') : 'aucune' });

  const ui = tasks.filter((t) => t.kind === 'ui' || t.kind === 'design' || t.domains.includes('frontend'));
  const unseen = ui.filter((t) => {
    const g = t.gates.find((x) => x.gate === 'visual');
    return !(g && (g.status === 'pass' || g.status === 'waived'));
  });
  checks.push({ title: 'Parcours capturés et relus (interfaces)', status: unseen.length ? 'fail' : ui.length ? 'pass' : 'skipped', detail: unseen.length ? `gate visual absente : ${unseen.map((t) => t.id).join(', ')}` : ui.length ? `${ui.length} tâche(s) d'interface vue(s)` : 'aucune interface' });

  const commands = store.config().commands as Record<string, string | undefined>;
  for (const [key, title] of [['unit', 'Suite de tests complète'], ['e2e', 'Parcours de bout en bout'], ['migration', 'Migrations rejouables']] as const) {
    const cmd = commands[key];
    if (!cmd) {
      checks.push({ title, status: 'skipped', detail: `aucune commande ${key}` });
      continue;
    }
    const r = runShell(cmd, { cwd: store.paths.root, timeoutMs: store.config().gateTimeoutMinutes * 60_000 });
    checks.push({ title, status: r.code === 0 ? 'pass' : 'fail', detail: `${cmd} → exit ${r.code}` });
  }

  const ok = checks.every((c) => c.status !== 'fail');
  if (!ok) return { ok, checks };
  const confirm = inboxItems(store).filter((i) => i.level === 'confirm');
  const file = path.join(store.paths.brain, 'increments', `${group.replace(/[^\w.-]+/g, '-')}.md`);
  writeTextAtomic(file, [
    `# Incrément « ${group} » — livré le ${new Date().toISOString().slice(0, 10)}`,
    '',
    '## Livré',
    ...tasks.map((t) => `- ${t.id} ${t.title} — ${t.evidence ?? ''}${t.waiver ? ` [dérogation : ${t.waiver}]` : ''}`),
    '',
    '## Contrôles',
    ...checks.map((c) => `- ${c.status === 'pass' ? '✔' : '–'} ${c.title} : ${c.detail}`),
    ...(ui.length ? ['', `## Captures`, ...ui.map((t) => `- ${t.id} : .ceng/shots/${t.id}/`)] : []),
    ...(confirm.length ? ['', '## Décisions à confirmer par l\'humain', ...confirm.map((i) => `- ${i.question} (${i.default})`)] : []),
    '',
    'Suite : `ceng adapt` (rétro express), `ceng learn add` (leçons), puis l\'incrément suivant.',
    '',
  ].join('\n'));
  store.log({ type: 'task.done', data: { increment: group, tasks: tasks.map((t) => t.id) } });
  return { ok, checks, file: store.paths.rel(file) };
}
