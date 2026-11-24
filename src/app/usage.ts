import * as fs from 'node:fs';

/**
 * Usage réel d'un sous-agent, lu dans sa transcription (`agent_transcript_path` du hook SubagentStop) : jetons d'entrée, de sortie,
 * de cache lu et écrit, par modèle. Remplace l'estimation `costIndex` du routage par une mesure. Chaque message de l'API n'est compté
 * qu'une fois (une même réponse peut s'écrire sur plusieurs lignes de la transcription).
 */

export interface Usage {
  model: string;
  messages: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const MAX_BYTES = 40 * 1024 * 1024;

export function readUsage(transcriptPath: string): Usage | undefined {
  let text: string;
  try {
    if (fs.statSync(transcriptPath).size > MAX_BYTES) return undefined;
    text = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return undefined;
  }
  const byMessage = new Map<string, { model?: string; u: Record<string, number> }>();
  let anon = 0;
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue;
    try {
      const m = (JSON.parse(line) as { message?: { id?: string; model?: string; usage?: Record<string, number> } }).message;
      if (m?.usage) byMessage.set(m.id ?? `anon-${anon++}`, { ...(m.model ? { model: m.model } : {}), u: m.usage });
    } catch {
      /* ligne illisible : ignorée */
    }
  }
  if (!byMessage.size) return undefined;
  const total: Usage = { model: '', messages: byMessage.size, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const { model, u } of byMessage.values()) {
    if (model && !total.model) total.model = model;
    total.input += u['input_tokens'] ?? 0;
    total.output += u['output_tokens'] ?? 0;
    total.cacheRead += u['cache_read_input_tokens'] ?? 0;
    total.cacheWrite += u['cache_creation_input_tokens'] ?? 0;
  }
  return total;
}

/** Famille du modèle (`claude-haiku-5-5` → `haiku`) pour regrouper les totaux. */
export const familyOf = (model: string): string => /(fable|opus|sonnet|haiku)/.exec(model)?.[1] ?? (model || 'inconnu');
