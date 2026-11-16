import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { runDiagramsGate } from '../src/app/gates.js';
import { diagramsIn, requiredDiagrams } from '../src/domain/diagrams.js';
import { rm, task } from './helpers.js';

const dirs: string[] = [];
after(() => dirs.forEach(rm));

describe('diagrammes UML obligatoires quand ils sont pertinents', () => {
  it('déclenchés par les domaines de la tâche, jamais pour la forme', () => {
    assert.deepEqual(requiredDiagrams(task('T-0001', { kind: 'feature', domains: ['lifecycle', 'payments'] })).map((d) => d.kind), ['state', 'sequence']);
    assert.deepEqual(requiredDiagrams(task('T-0002', { kind: 'feature', domains: ['frontend'] })), []);
    assert.deepEqual(requiredDiagrams(task('T-0003', { kind: 'docs', domains: ['lifecycle'] })), []);
  });

  it('reconnaît les diagrammes Mermaid par type', () => {
    const md = '# Commande\n```mermaid\nstateDiagram-v2\n  [*] --> payee\n```\n```mermaid\nsequenceDiagram\n  App->>Stripe: intent\n```\n';
    assert.deepEqual([...diagramsIn(md)].sort(), ['sequence', 'state']);
    assert.ok(diagramsIn('```mermaid\nflowchart LR\n  web --> api\n```', false, 'docs/architecture.md').has('deployment'));
    assert.ok(!diagramsIn('```mermaid\nflowchart LR\n  a --> b\n```', false, 'docs/parcours.md').has('deployment'));
  });

  it('gate : présent et modifié → vert ; absent ou non mis à jour → rouge avec la marche à suivre', () => {
    const root = fs.mkdtempSync(path.join(fs.realpathSync(process.env['TEMP'] ?? '/tmp'), 'ceng-diag-'));
    dirs.push(root);
    const t = task('T-0007', { kind: 'feature', domains: ['lifecycle'] });
    fs.mkdirSync(path.join(root, 'docs', 'diagrams'), { recursive: true });
    assert.equal(runDiagramsGate(root, t, []).status, 'fail');
    assert.match(runDiagramsGate(root, t, []).detail, /manquant/);
    fs.writeFileSync(path.join(root, 'docs', 'diagrams', 'commande.md'), '```mermaid\nstateDiagram-v2\n  [*] --> creee\n```\n');
    assert.equal(runDiagramsGate(root, t, ['docs/diagrams/commande.md']).status, 'pass');
    const stale = runDiagramsGate(root, t, ['src/order.ts']);
    assert.equal(stale.status, 'fail');
    assert.match(stale.detail, /n'a pas été mis à jour[\s\S]*|gate record T-0007 diagrams pass/);
  });
});
