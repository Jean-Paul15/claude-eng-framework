import * as fs from 'node:fs';
import type { FrameworkEvent } from '../domain/events.js';
import type { Learning } from '../domain/learning.js';
import { redactDeep } from '../domain/secrets.js';
import type { AdaptiveOverrides, EffectivePolicy, Preferences, Task } from '../domain/types.js';
import type { Commands, ProjectProfile } from '../discovery/profile.js';
import { appendLine, exists, readJson, readJsonLines, writeJsonAtomic } from '../infra/fs.js';
import { withLock } from '../infra/lock.js';
import { BrainPaths } from './paths.js';

export const SCHEMA_VERSION = 1;

export interface FrameworkConfig {
  schemaVersion: number;
  frameworkVersion: string;
  projectName: string;
  preferences: Preferences;
  policy: EffectivePolicy;
  commands: Commands;
  gateTimeoutMinutes: number;
  /** Graphe de code graphify maintenu automatiquement (mode code, sans LLM). */
  codeGraph?: { enabled: boolean };
  /** Absent après N minutes sans message (0 = jamais de bascule automatique). */
  presence?: { enabled: boolean };
  /** Fichiers de secrets que l'humain autorise l'agent à lire/écrire (clés de test ou de développement). */
  secrets?: { allow: string[] };
  installedSkills: string[];
  installedAgents: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CheckpointRecord {
  id: string;
  at: string;
  taskId?: string;
  done: string;
  next: string;
  failed?: string;
  notes?: string;
  head?: string;
  /** Commit d'instantané (refs/ceng/checkpoints/<id>) incluant le travail non commité. */
  snapshot?: string;
  auto: boolean;
}

export interface Interruption {
  type: string;
  at: string;
  detail?: string;
}

export interface BrainState {
  currentTask?: string;
  lastCheckpoint?: CheckpointRecord;
  interruption?: Interruption;
  editsSinceCheckpoint: number;
  /** Anti-boucle du hook Stop : un seul rappel par cycle de travail. */
  stopReminderAt?: string;
  sessions: number;
  lastSessionAt?: string;
  /** Délégations annoncées (hook PreToolUse/Agent) en attente d'un SubagentStart pour lier agent ↔ tâche. */
  pendingSpawns?: { taskId: string; agentType: string; model?: string; at: string }[];
  /** agent_id (fourni par Claude Code aux hooks) → tâche travaillée. */
  agentTasks?: Record<string, string>;
  /** Des fichiers ont changé depuis la dernière mise à jour du graphe de code. */
  graphDirty?: boolean;
  /** Mode sans humain : compteur de relances et détection d'absence de progression. */
  unattended?: { continues: number; lastSignature: string; stalls: number };
  /** Dernier message de l'humain (hook UserPromptSubmit) : base de la détection d'absence. */
  lastHumanAt?: string;
  /** Une question a expiré sans réponse après le dernier message : l'humain est absent. */
  humanAwaySignalAt?: string;
  /** Session dans laquelle l'orchestrateur a été lancé : elle continue seule si l'humain s'absente. */
  autopilotSessionId?: string;
  /** Demandes de validation ouvertes (posées via l'invite de questions). */
  approvalRequests?: { id: string; key: string; what: string; reason: string; at: string }[];
  /** Autorisations à usage unique issues des réponses de l'humain. */
  grants?: { requestId: string; key: string; expiresAt: string }[];
}

const EMPTY_STATE: BrainState = { editsSinceCheckpoint: 0, sessions: 0 };

/** Accès au Project Brain. Les écritures concurrentes (subagents parallèles) passent par des verrous. */
export class BrainStore {
  readonly paths: BrainPaths;

  constructor(projectRoot: string) {
    this.paths = new BrainPaths(projectRoot);
  }

  isInitialized(): boolean {
    return exists(this.paths.config);
  }

  requireInitialized(): void {
    if (!this.isInitialized()) throw new Error(`Framework non initialisé dans ${this.paths.root} : lancez \`ceng init\`.`);
  }

  // ---- config / profile
  config(): FrameworkConfig {
    const c = readJson<FrameworkConfig>(this.paths.config);
    if (!c) throw new Error('`.ceng/config.json` introuvable : lancez `ceng init`.');
    return c;
  }

  saveConfig(c: FrameworkConfig): void {
    writeJsonAtomic(this.paths.config, { ...c, updatedAt: new Date().toISOString() });
  }

  profile(): ProjectProfile | undefined {
    return readJson<ProjectProfile>(this.paths.profile);
  }

  saveProfile(p: ProjectProfile): void {
    writeJsonAtomic(this.paths.profile, p);
  }

  overrides(): AdaptiveOverrides | undefined {
    return readJson<AdaptiveOverrides>(this.paths.adaptive);
  }

  saveOverrides(o: AdaptiveOverrides): void {
    writeJsonAtomic(this.paths.adaptive, o);
  }

  // ---- tasks
  tasks(): Task[] {
    return readJson<{ tasks: Task[] }>(this.paths.tasks)?.tasks ?? [];
  }

  /** Lecture-modification-écriture atomique et verrouillée du graphe de tâches. */
  updateTasks<T>(fn: (tasks: Task[]) => T): T {
    return withLock(this.paths.tasksLock, () => {
      const tasks = this.tasks();
      const result = fn(tasks);
      writeJsonAtomic(this.paths.tasks, { schemaVersion: SCHEMA_VERSION, tasks });
      return result;
    });
  }

  task(id: string): Task {
    const t = this.tasks().find((x) => x.id === id.toUpperCase());
    if (!t) throw new Error(`Tâche ${id} introuvable (voir \`ceng task list\`).`);
    return t;
  }

  // ---- state
  state(): BrainState {
    return { ...EMPTY_STATE, ...(readJson<BrainState>(this.paths.state) ?? {}) };
  }

  updateState(fn: (s: BrainState) => void): BrainState {
    return withLock(this.paths.stateLock, () => {
      const s = this.state();
      fn(s);
      writeJsonAtomic(this.paths.state, s);
      return s;
    });
  }

  // ---- journaux append-only
  log(event: Omit<FrameworkEvent, 'ts'>): void {
    try {
      appendLine(this.paths.events, JSON.stringify(redactDeep({ ts: new Date().toISOString(), ...event })));
    } catch {
      // l'observabilité ne doit jamais faire échouer une action
    }
  }

  events(): FrameworkEvent[] {
    return readJsonLines<FrameworkEvent>(this.paths.events);
  }

  checkpoints(): CheckpointRecord[] {
    return readJsonLines<CheckpointRecord>(this.paths.checkpoints);
  }

  appendCheckpoint(cp: CheckpointRecord): void {
    appendLine(this.paths.checkpoints, JSON.stringify(redactDeep(cp)));
  }

  learnings(): Learning[] {
    return readJsonLines<Learning>(this.paths.learnings);
  }

  appendLearning(l: Learning): void {
    appendLine(this.paths.learnings, JSON.stringify(redactDeep(l)));
  }

  listDir(dir: string): string[] {
    try {
      return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
    } catch {
      return [];
    }
  }
}
