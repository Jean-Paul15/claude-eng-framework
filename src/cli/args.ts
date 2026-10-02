import { parseArgs, type ParseArgsConfig } from 'node:util';

export type Options = NonNullable<ParseArgsConfig['options']>;

export interface Parsed {
  values: Record<string, string | boolean | string[] | undefined>;
  positionals: string[];
}

export function parse(argv: string[], options: Options): Parsed {
  const { values, positionals } = parseArgs({ args: argv, options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, ...options }, allowPositionals: true, strict: true });
  return { values: values as Parsed['values'], positionals };
}

export const str = (p: Parsed, k: string): string | undefined => {
  const v = p.values[k];
  return typeof v === 'string' ? v : undefined;
};

export const bool = (p: Parsed, k: string): boolean => p.values[k] === true;

export function requireStr(p: Parsed, k: string, hint?: string): string {
  const v = str(p, k);
  if (!v) throw new UsageError(`--${k} est requis${hint ? ` (${hint})` : ''}.`);
  return v;
}

export function requirePositional(p: Parsed, i: number, name: string): string {
  const v = p.positionals[i];
  if (!v) throw new UsageError(`Argument manquant : <${name}>.`);
  return v;
}

export class UsageError extends Error {}

export function out(p: Parsed, human: string, machine: unknown): void {
  process.stdout.write(bool(p, 'json') ? `${JSON.stringify(machine, null, 2)}\n` : `${human}\n`);
}
