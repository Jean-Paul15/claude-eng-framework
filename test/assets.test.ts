import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { AGENTS, SKILLS } from '../src/generation/catalog.js';
import { renderProjectSkill, type ProjectSkillTemplate } from '../src/generation/project-skills.js';
import { FRAMEWORK_ROOT } from './helpers.js';

const CORE = path.join(FRAMEWORK_ROOT, 'core');

/** Frontmatter minimal : lignes `clé: valeur` de premier niveau. */
function frontmatter(file: string): Record<string, string> {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, `${file} : frontmatter absent`);
  const out: Record<string, string> = {};
  for (const line of m[1]!.split('\n')) {
    const kv = line.match(/^([a-zA-Z-]+):\s?(.*)$/);
    if (kv) out[kv[1]!] = kv[2]!;
  }
  return out;
}

/** Un scalaire YAML non quoté ne peut contenir ni « : » ni « # » précédé d'un espace (sinon YAML invalide). */
function assertYamlSafe(file: string, key: string, value: string): void {
  if (/^["']/.test(value)) return;
  assert.ok(!/: /.test(value), `${file} : « ${key} » contient « : » non quoté (YAML invalide → skill ignorée)`);
  assert.ok(!/ #/.test(value), `${file} : « ${key} » contient « # » non quoté`);
}

describe('assets du cœur', () => {
  it('chaque skill du catalogue existe, a un frontmatter valide et un nom cohérent', () => {
    for (const s of SKILLS) {
      const file = path.join(CORE, 'skills', s.name, 'SKILL.md');
      assert.ok(fs.existsSync(file), file);
      const fm = frontmatter(file);
      assert.equal(fm['name'], s.name);
      assert.ok((fm['description'] ?? '').length > 40, `${s.name} : description trop courte`);
      assert.ok((fm['description'] ?? '').length <= 1024, `${s.name} : description > 1024 caractères (spécification Agent Skills)`);
      assertYamlSafe(file, 'description', fm['description']!);
      const lines = fs.readFileSync(file, 'utf8').split('\n').length;
      assert.ok(lines < 500, `${s.name} : SKILL.md > 500 lignes`);
    }
  });

  it('toutes les skills de core/ (y compris hors catalogue) ont un frontmatter valide', () => {
    for (const dir of fs.readdirSync(path.join(CORE, 'skills'))) {
      const file = path.join(CORE, 'skills', dir, 'SKILL.md');
      const fm = frontmatter(file);
      assert.equal(fm['name'], dir);
      assertYamlSafe(file, 'description', fm['description']!);
    }
  });

  it('aucune skill ne masque une commande intégrée de Claude Code', () => {
    for (const s of SKILLS) assert.ok(!['code-review', 'security-review', 'init', 'simplify', 'review'].includes(s.name), s.name);
  });

  it('chaque agent existe, déclare modèle et effort, n\'a pas l\'outil Agent et exige un CENG_REPORT', () => {
    for (const a of AGENTS) {
      const file = path.join(CORE, 'agents', `${a.name}.md`);
      const fm = frontmatter(file);
      assert.equal(fm['name'], a.name);
      assert.ok(['haiku', 'sonnet', 'opus'].includes(fm['model'] ?? ''), `${a.name} : model`);
      assert.ok(['low', 'medium', 'high', 'xhigh'].includes(fm['effort'] ?? ''), `${a.name} : effort`);
      assert.match(fm['disallowedTools'] ?? '', /\bAgent\b/, `${a.name} : les workers ne délèguent pas`);
      assertYamlSafe(file, 'description', fm['description']!);
      assert.match(fs.readFileSync(file, 'utf8'), /CENG_REPORT/);
    }
  });

  it('les skills projet générées ont un frontmatter valide même avec des caractères spéciaux', () => {
    const templates = JSON.parse(fs.readFileSync(path.join(CORE, 'project-skills.json'), 'utf8')) as ProjectSkillTemplate[];
    const tricky = { ...templates[0]!, description: 'Paiements : webhooks # idempotence "quotes"' };
    const profile = JSON.parse(JSON.stringify({ services: ['stripe'], frameworks: [], databases: [], projectTypes: [], versions: {}, commands: {} }));
    const rendered = renderProjectSkill(tricky, profile, '2026-01-01');
    const desc = rendered.match(/^description: (.*)$/m)![1]!;
    assert.equal(JSON.parse(desc), tricky.description);
  });
});
