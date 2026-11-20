import type { ProcessDefinition } from '@crewdeck/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { attachMenuOf, type AttachContext } from './attach-menu.js';

const FIXTURES = join(import.meta.dirname, '../../../../packages/contracts/fixtures/process');
const fixture = (name: string): ProcessDefinition =>
  (JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as { definition: ProcessDefinition }).definition;
const GITHUB = fixture('crewdeck-github');

const CONTEXT: AttachContext = {
  roles: [
    { id: 'idea', name: 'Idée', detail: 'Claude Code · Opus 5.5' },
    { id: 'review', name: 'Review', detail: 'Codex · gpt-5.5' },
  ],
  mcpServers: ['figma', 'stitch'],
  machine: 'atelier-pc',
  repository: 'MaximeD1412/site-mairie',
};

const labels = (menu: ReturnType<typeof attachMenuOf>) => menu?.menu.groups.map((group) => group.label);

describe('attachMenuOf', () => {
  it('lists, for the Review, its Rôle selected, the official Skills, the declared Serveurs MCP then « Déclarer », and GitHub', () => {
    const attach = attachMenuOf(GITHUB, 'st-review', CONTEXT)!;
    expect(attach.menu.title).toBe('Attacher à « Review »');
    expect(labels(attach)).toEqual(['Rôle (un seul)', 'Skill (une seule)', 'Serveur MCP, déclaré sur atelier-pc', 'Connecteur']);
    const [roles, skills, mcp, connector] = attach.menu.groups;
    expect(roles!.items).toEqual([
      { id: 'role:idea', label: 'Idée', icon: 'user', detail: 'Claude Code · Opus 5.5', selected: false, disabled: false },
      { id: 'role:review', label: 'Review', icon: 'user', detail: 'Codex · gpt-5.5', selected: true, disabled: false },
    ]);
    expect(skills!.items.find((item) => item.selected)).toEqual({ id: 'skill:review', label: 'review', icon: 'spark', detail: 'officielle', selected: true, disabled: false });
    expect(skills!.items.map((item) => item.label)).toContain('visual-design');
    expect(mcp!.items).toEqual([
      { id: 'mcp:figma', label: 'figma', icon: 'layers', detail: 'donne ses outils aux agents de l’Étape', selected: false, disabled: false },
      { id: 'mcp:stitch', label: 'stitch', icon: 'layers', detail: 'donne ses outils aux agents de l’Étape', selected: false, disabled: false },
      { id: 'mcp-declare', label: 'Déclarer un Serveur MCP', icon: 'plus', detail: 'sur la page Runner et Comptes IA', selected: false, disabled: false },
    ]);
    expect(connector!.items).toEqual([{ id: 'connector:github', label: 'GitHub', icon: 'plug', detail: 'MaximeD1412/site-mairie', selected: false, disabled: false }]);
  });

  it('gives each item its Outil, « Déclarer un Serveur MCP » none: it leads to the Runner’s page', () => {
    const { choices } = attachMenuOf(GITHUB, 'st-review', CONTEXT)!;
    expect(choices).toContainEqual({ id: 'role:idea', tool: { kind: 'role', roleId: 'idea' } });
    expect(choices).toContainEqual({ id: 'skill:review', tool: { kind: 'skill', skillId: 'review' } });
    expect(choices).toContainEqual({ id: 'mcp:stitch', tool: { kind: 'mcp', name: 'stitch' } });
    expect(choices).toContainEqual({ id: 'connector:github', tool: { kind: 'connector', connector: 'github' } });
    expect(choices).toContainEqual({ id: 'mcp-declare', tool: null });
  });

  it('disables a Serveur MCP already attached, « déjà attaché »', () => {
    const definition = {
      ...GITHUB,
      steps: GITHUB.steps.map((step) => (step.id === 'st-review' ? { ...step, tools: [...step.tools, { kind: 'mcp' as const, name: 'stitch' }] } : step)),
    };
    const mcp = attachMenuOf(definition, 'st-review', CONTEXT)!.menu.groups[2]!;
    expect(mcp.items[1]).toMatchObject({ id: 'mcp:stitch', detail: 'déjà attaché', disabled: true });
  });

  it('with no Serveur MCP declared, holds only « Déclarer un Serveur MCP » in its group', () => {
    const mcp = attachMenuOf(GITHUB, 'st-review', { ...CONTEXT, mcpServers: [] })!.menu.groups[2]!;
    expect(mcp.items.map((item) => item.id)).toEqual(['mcp-declare']);
  });

  it('has no Connecteur for a Projet without a repository', () => {
    expect(labels(attachMenuOf(GITHUB, 'st-review', { ...CONTEXT, repository: null }))).not.toContain('Connecteur');
  });

  it('shows the Commandes only once asked (PROCESS-12): the Checks then take a Connecteur or a Commande', () => {
    expect(labels(attachMenuOf(GITHUB, 'st-checks', CONTEXT))).toEqual(['Connecteur']);
    const attach = attachMenuOf(GITHUB, 'st-checks', CONTEXT, { commands: true })!;
    expect(labels(attach)).toEqual(['Commande, sur atelier-pc', 'Connecteur']);
    expect(attach.menu.groups[0]!.items).toEqual([
      { id: 'command', label: 'Nouvelle Commande', icon: 'terminal', detail: 'une commande de ton choix', selected: false, disabled: false },
    ]);
    expect(attach.choices).toContainEqual({ id: 'command', tool: { kind: 'command' } });
  });

  it('is none for a gate, the Merge, or a Commande Étape until the Commandes are shown', () => {
    expect(attachMenuOf(GITHUB, 'st-rv', CONTEXT)).toBeNull();
    expect(attachMenuOf(GITHUB, 'st-merge', CONTEXT)).toBeNull();
    const e2e = fixture('capability-missing-command');
    expect(attachMenuOf(e2e, 'st-e2e', CONTEXT)).toBeNull();
    expect(labels(attachMenuOf(e2e, 'st-e2e', CONTEXT, { commands: true }))).toEqual(['Commande, sur atelier-pc']);
  });
});
