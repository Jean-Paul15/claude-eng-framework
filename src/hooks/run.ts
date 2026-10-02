#!/usr/bin/env node
import * as path from 'node:path';
import { BrainStore } from '../brain/store.js';
import { HANDLERS, type HookInput, type HookOutput } from './handlers.js';

/**
 * Point d'entrée des hooks : `node .ceng/runtime/hooks/run.js <événement>` (JSON sur stdin).
 * Politique d'échec : fail-open. Un bug du framework ne doit jamais bloquer la session ;
 * les permissions natives de Claude Code restent actives dans tous les cas.
 */

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export async function runHook(event: string, rawInput: string, projectRoot?: string): Promise<HookOutput> {
  const handler = HANDLERS[event];
  if (!handler) return { exitCode: 0, stderr: `[ceng] hook inconnu : ${event}` };
  let input: HookInput = {};
  try {
    input = rawInput.trim() ? (JSON.parse(rawInput) as HookInput) : {};
  } catch {
    return { exitCode: 0, stderr: '[ceng] entrée de hook illisible (ignorée)' };
  }
  const root = projectRoot ?? process.env['CLAUDE_PROJECT_DIR'] ?? input.cwd ?? process.cwd();
  const store = new BrainStore(path.resolve(root));
  if (!store.isInitialized()) return { exitCode: 0 };
  try {
    return handler(store, input);
  } catch (err) {
    return { exitCode: 0, stderr: `[ceng] hook ${event} en erreur (ignoré) : ${(err as Error).message}` };
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).replace(/\\/g, '/').endsWith('/hooks/run.js');
if (isMain) {
  const event = process.argv[2] ?? '';
  readStdin()
    .then((raw) => runHook(event, raw))
    .then((out) => {
      if (out.json) process.stdout.write(JSON.stringify(out.json));
      if (out.stderr) process.stderr.write(`${out.stderr}\n`);
      process.exitCode = out.exitCode;
    })
    .catch((err: unknown) => {
      process.stderr.write(`[ceng] ${(err as Error).message}\n`);
      process.exitCode = 0;
    });
}
