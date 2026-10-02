import * as path from 'node:path';

/** Arborescence du Project Brain. Un seul endroit pour les chemins : jamais de chaîne en dur ailleurs. */
export class BrainPaths {
  readonly root: string;
  readonly ceng: string;

  constructor(projectRoot: string) {
    this.root = path.resolve(projectRoot);
    this.ceng = path.join(this.root, '.ceng');
  }

  get config() { return path.join(this.ceng, 'config.json'); }
  get profile() { return path.join(this.ceng, 'profile.json'); }
  get manifest() { return path.join(this.ceng, 'manifest.json'); }
  get adaptive() { return path.join(this.ceng, 'adaptive.json'); }
  get runtime() { return path.join(this.ceng, 'runtime'); }
  get backups() { return path.join(this.ceng, 'backups'); }
  get logs() { return path.join(this.ceng, 'logs'); }
  get events() { return path.join(this.logs, 'events.jsonl'); }
  get gateLogs() { return path.join(this.logs, 'gates'); }
  get brain() { return path.join(this.ceng, 'brain'); }
  get index() { return path.join(this.brain, 'INDEX.md'); }
  get project() { return path.join(this.brain, 'project.md'); }
  get objective() { return path.join(this.brain, 'objective.md'); }
  get architecture() { return path.join(this.brain, 'architecture.md'); }
  get assumptions() { return path.join(this.brain, 'assumptions.md'); }
  get knownIssues() { return path.join(this.brain, 'known-issues.md'); }
  get tasks() { return path.join(this.brain, 'tasks.json'); }
  get tasksLock() { return path.join(this.brain, 'tasks.json.lock'); }
  get state() { return path.join(this.brain, 'state.json'); }
  get stateLock() { return path.join(this.brain, 'state.json.lock'); }
  get checkpoints() { return path.join(this.brain, 'checkpoints.jsonl'); }
  get learnings() { return path.join(this.brain, 'learnings.jsonl'); }
  get decisions() { return path.join(this.brain, 'decisions'); }
  get reports() { return path.join(this.brain, 'reports'); }
  get escalations() { return path.join(this.brain, 'escalations'); }
  get research() { return path.join(this.brain, 'research'); }
  get teams() { return path.join(this.brain, 'teams'); }

  report(taskId: string) { return path.join(this.reports, `${taskId}.md`); }
  escalation(id: string) { return path.join(this.escalations, `${id}.md`); }

  /** Chemin relatif POSIX (pour les messages destinés aux agents). */
  rel(p: string): string {
    return path.relative(this.root, p).replace(/\\/g, '/');
  }
}

export const CLI_INVOCATION = 'node .ceng/runtime/cli.js';
