import * as readline from 'node:readline/promises';

export interface Choice<T extends string> {
  value: T;
  label: string;
}

/** Questions interactives minimales (sans dépendance). Valeur par défaut = Entrée. */
export class Prompter {
  private rl: readline.Interface | undefined;

  private get iface(): readline.Interface {
    this.rl ??= readline.createInterface({ input: process.stdin, output: process.stdout });
    return this.rl;
  }

  async choose<T extends string>(question: string, choices: Choice<T>[], defaultValue: T, hint?: string): Promise<T> {
    const lines = choices.map((c, i) => `   ${i + 1}) ${c.label}${c.value === defaultValue ? '  ← recommandé' : ''}`);
    const header = `\n? ${question}${hint ? `\n  ${hint}` : ''}\n${lines.join('\n')}\n  Choix [${choices.findIndex((c) => c.value === defaultValue) + 1}] : `;
    for (;;) {
      const answer = (await this.iface.question(header)).trim();
      if (!answer) return defaultValue;
      const idx = Number.parseInt(answer, 10);
      if (Number.isInteger(idx) && idx >= 1 && idx <= choices.length) return choices[idx - 1]!.value;
      const byValue = choices.find((c) => c.value === answer);
      if (byValue) return byValue.value;
      process.stdout.write('  Réponse invalide.\n');
    }
  }

  async text(question: string, defaultValue = ''): Promise<string> {
    const answer = (await this.iface.question(`\n? ${question}${defaultValue ? ` [${defaultValue}]` : ''} : `)).trim();
    return answer || defaultValue;
  }

  async confirm(question: string, defaultValue = true): Promise<boolean> {
    const answer = (await this.iface.question(`\n? ${question} [${defaultValue ? 'O/n' : 'o/N'}] : `)).trim().toLowerCase();
    if (!answer) return defaultValue;
    return ['o', 'oui', 'y', 'yes'].includes(answer);
  }

  close(): void {
    this.rl?.close();
    this.rl = undefined;
  }
}
