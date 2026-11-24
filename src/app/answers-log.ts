import { redact } from '../domain/secrets.js';
import { appendLine, exists } from '../infra/fs.js';
import type { BrainStore } from '../brain/store.js';

/**
 * Réponses de l'humain à l'invite de questions, conservées dans `.ceng/brain/answers.md` : après une compaction ou dans une
 * nouvelle session, une décision de direction déjà prise n'est pas reposée (le rappel la retrouve). Les demandes de
 * permission du framework (identifiants R-xxxx) n'y figurent pas : elles ont leur propre journal.
 */
export function logAnswers(store: BrainStore, toolResponse: unknown, taskId?: string): number {
  const answers = toolResponse && typeof toolResponse === 'object' && 'answers' in toolResponse ? (toolResponse as { answers: unknown }).answers : undefined;
  if (!answers || typeof answers !== 'object') return 0;
  const file = `${store.paths.brain}/answers.md`;
  if (!exists(file)) appendLine(file, "# Réponses de l'humain\n\n_Questions posées par l'invite et réponses données : à consulter avant de reposer une question._\n");
  let n = 0;
  for (const [question, answer] of Object.entries(answers as Record<string, unknown>)) {
    const a = String(answer ?? '').trim();
    if (!a || /R-\d{4}/.test(question) || /R-\d{4}/.test(a)) continue;
    appendLine(file, `- ${new Date().toISOString().slice(0, 10)}${taskId ? ` · ${taskId}` : ''} · « ${redact(question).replace(/\s+/g, ' ').slice(0, 140)} » → ${redact(a).replace(/\s+/g, ' ').slice(0, 140)}`);
    n++;
  }
  return n;
}
