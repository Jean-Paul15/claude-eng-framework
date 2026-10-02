import * as path from 'node:path';
import { GATE_KINDS } from '../domain/gates.js';
import { scanText } from '../domain/secrets.js';
import { isSecretPath } from '../domain/guardrails.js';
import type { GateId, GateResult, GateStatus, Task } from '../domain/types.js';
import { runShell, tail } from '../infra/exec.js';
import { exists, readJson, readText, writeTextAtomic } from '../infra/fs.js';
import { Git } from '../infra/git.js';
import { redact } from '../domain/secrets.js';
import type { BrainStore } from '../brain/store.js';
import type { Commands } from '../discovery/profile.js';

/** Exécution des quality gates : commandes du projet, contrôles intégrés, gates de revue (agents/humain). */

export interface GateRunOutcome {
  gate: GateId;
  status: GateStatus;
  required: boolean;
  detail: string;
  logFile?: string;
}

const MAX_SCAN_BYTES = 1_000_000;

export function changedFiles(root: string): string[] {
  const git = new Git(root);
  if (!git.isRepo()) return [];
  const head = git.head();
  return head ? git.filesChangedSince(head) : git.changedFiles();
}

export function runSecretsGate(root: string, files = changedFiles(root)): { status: GateStatus; detail: string } {
  const findings: string[] = [];
  for (const f of files) {
    if (isSecretPath(f)) {
      findings.push(`${f} : fichier de secrets suivi/ajouté (doit être ignoré par git)`);
      continue;
    }
    const text = readText(path.join(root, f));
    if (!text || text.length > MAX_SCAN_BYTES || text.includes('\u0000')) continue;
    for (const s of scanText(text)) findings.push(`${f}:${s.line} ${s.id} (${s.preview})`);
  }
  return findings.length
    ? { status: 'fail', detail: `Secrets potentiels :\n${findings.slice(0, 30).join('\n')}` }
    : { status: 'pass', detail: `${files.length} fichier(s) modifié(s) analysé(s), aucun secret.` };
}

const STRONG_COPYLEFT = /\b(AGPL|SSPL|GPL|EUPL|OSL|CC-BY-SA|BUSL)\b/i;
const WEAK_COPYLEFT = /\b(LGPL|MPL|EPL|CDDL)\b/i;

/** Contrôle légal minimal et vérifiable : licence du projet, licences des dépendances directes (npm). */
export function runComplianceGate(root: string, store: BrainStore, task: Task): { status: GateStatus; detail: string } {
  const profile = store.profile();
  const notes: string[] = [];
  let status: GateStatus = 'pass';
  const projectLicense = profile?.legal.license;
  if (!profile?.legal.licenseFile && !projectLicense) {
    notes.push('Aucune licence déclarée : décision humaine (propriétaire vs open source) à consigner.');
    if (task.domains.includes('licensing')) status = 'fail';
  }
  const pkg = readJson<{ dependencies?: Record<string, string> }>(path.join(root, 'package.json'));
  const problems: string[] = [];
  for (const dep of Object.keys(pkg?.dependencies ?? {})) {
    const meta = readJson<{ license?: string | { type?: string } }>(path.join(root, 'node_modules', dep, 'package.json'));
    const lic = typeof meta?.license === 'string' ? meta.license : meta?.license?.type;
    if (!lic) continue;
    if (STRONG_COPYLEFT.test(lic) && !(projectLicense && /GPL/i.test(projectLicense))) problems.push(`${dep} (${lic}) — copyleft fort incompatible avec une licence non-GPL`);
    else if (WEAK_COPYLEFT.test(lic)) notes.push(`${dep} (${lic}) — copyleft faible : vérifier les obligations (modifications, notices).`);
  }
  if (problems.length) {
    status = 'fail';
    notes.unshift(`Dépendances à licence problématique (approbation humaine requise) :\n- ${problems.join('\n- ')}`);
  }
  if (task.domains.some((d) => ['pii', 'health', 'analytics'].includes(d))) {
    notes.push('Données personnelles : vérifier minimisation, base légale/consentement, durée de conservation, sous-traitants (RGPD) — voir skill legal-governance.');
    if (!profile?.legal.privacyPolicy) notes.push('Aucune politique de confidentialité détectée dans le dépôt.');
  }
  if (task.domains.includes('ai-llm')) notes.push('Fonction IA : transparence envers l\'utilisateur, données envoyées au fournisseur, rétention (EU AI Act / conditions du fournisseur).');
  return { status, detail: notes.join('\n') || 'Aucune alerte de conformité.' };
}

function commandFor(gate: GateId, commands: Commands): string | undefined {
  return (commands as Record<string, string | undefined>)[gate];
}

export function runGates(store: BrainStore, taskId: string, only?: GateId[]): GateRunOutcome[] {
  const config = store.config();
  const task = store.task(taskId);
  const route = task.route;
  if (!route) throw new Error(`${task.id} n'a pas de décision de routage : lancer \`ceng route ${task.id}\`.`);
  const root = store.paths.root;
  const outcomes: GateRunOutcome[] = [];
  const timeoutMs = config.gateTimeoutMinutes * 60_000;
  const ran = new Map<string, GateRunOutcome>();

  for (const req of route.gates) {
    if (only && !only.includes(req.gate)) continue;
    const kind = GATE_KINDS[req.gate];
    let outcome: GateRunOutcome;
    if (kind === 'command') {
      const cmd = commandFor(req.gate, config.commands);
      if (!cmd) {
        outcome = { gate: req.gate, status: 'skipped', required: req.required, detail: 'Aucune commande détectée pour ce projet (configurer `.ceng/config.json` → commands si l\'outil existe).' };
      } else if (ran.has(cmd)) {
        // Même commande pour deux gates (ex. `flutter analyze` = lint + typecheck) : exécutée une seule fois.
        outcome = { ...ran.get(cmd)!, gate: req.gate, required: req.required };
      } else {
        const r = runShell(cmd, { cwd: root, timeoutMs });
        const logFile = path.join(store.paths.gateLogs, `${task.id}-${req.gate}.log`);
        writeTextAtomic(logFile, redact(`$ ${cmd}\n(exit ${r.code}, ${r.durationMs} ms${r.timedOut ? ', TIMEOUT' : ''})\n\n${r.stdout}\n${r.stderr}`));
        const status: GateStatus = r.code === 0 ? 'pass' : 'fail';
        outcome = { gate: req.gate, status, required: req.required, detail: `${cmd} → exit ${r.code}${r.timedOut ? ' (timeout)' : ''}${status === 'fail' ? `\n${redact(tail(`${r.stdout}\n${r.stderr}`.trim(), 25))}` : ''}`, logFile: store.paths.rel(logFile) };
        ran.set(cmd, outcome);
      }
    } else if (req.gate === 'secrets') {
      outcome = { gate: req.gate, required: req.required, ...runSecretsGate(root) };
    } else if (req.gate === 'compliance') {
      outcome = { gate: req.gate, required: req.required, ...runComplianceGate(root, store, task) };
    } else if (req.gate === 'report') {
      const ok = exists(store.paths.report(task.id));
      outcome = { gate: req.gate, status: ok ? 'pass' : 'fail', required: req.required, detail: ok ? 'Rapport présent.' : `Rapport absent : .ceng/brain/reports/${task.id}.md` };
    } else {
      const recorded = task.gates.find((g) => g.gate === req.gate);
      outcome = recorded && recorded.status !== 'pending'
        ? { gate: req.gate, status: recorded.status, required: req.required, detail: recorded.detail ?? 'enregistrée' }
        : { gate: req.gate, status: 'pending', required: req.required, detail: kind === 'human' ? 'Approbation humaine à obtenir puis enregistrer (`ceng gate record … human-approval pass --note "qui/quand"`).' : `Gate ${kind} : à réaliser par l'agent indiqué dans la route puis \`ceng gate record ${task.id} ${req.gate} pass|fail --note …\`.` };
    }
    outcomes.push(outcome);
  }
  recordOutcomes(store, task.id, outcomes);
  return outcomes;
}

export function recordOutcomes(store: BrainStore, taskId: string, outcomes: readonly Pick<GateRunOutcome, 'gate' | 'status' | 'required' | 'detail'>[]): void {
  const at = new Date().toISOString();
  store.updateTasks((tasks) => {
    const t = tasks.find((x) => x.id === taskId)!;
    for (const o of outcomes) {
      const result: GateResult = { gate: o.gate, status: o.status, required: o.required, at, detail: o.detail.slice(0, 2000) };
      const i = t.gates.findIndex((g) => g.gate === o.gate);
      if (i >= 0) t.gates[i] = result;
      else t.gates.push(result);
    }
    t.updatedAt = at;
  });
  for (const o of outcomes) {
    if (o.status !== 'pending') store.log({ type: 'gate.result', taskId, data: { gate: o.gate, status: o.status, required: o.required } });
  }
}
