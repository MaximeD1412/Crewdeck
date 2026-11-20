import { CATALOGUE, STEP_KINDS, type ProcessDefinition, type ToolKind } from '@crewdeck/contracts';
import { t, type ComposantData, type Menu } from '@crewdeck/sdk';
import { takesTool, type AttachedTool } from './edit.js';

type MenuData = ComposantData<typeof Menu>;
type MenuGroup = MenuData['groups'][number];
type MenuItem = MenuGroup['items'][number];

/** What the Menu reads beside the definition: the Rôles with their Moteur and model, the Runner's Serveurs MCP and machine, the Projet's repository. */
export interface AttachContext {
  readonly roles: readonly { readonly id: string; readonly name: string; readonly detail: string | null }[];
  /** The names the Runner declares (RUNNER-16). */
  readonly mcpServers: readonly string[];
  readonly machine: string;
  /** The Dépôt GitHub's `fullName`, `null` for a Local Projet. */
  readonly repository: string | null;
}

/** Whether the « Commande » group is shown: once PROCESS-12 seals a Commande's text. */
export interface AttachOptions {
  readonly commands: boolean;
}

/** An item's Outil, `null` for « Déclarer un Serveur MCP », which leads to the Runner's page. */
export interface AttachChoice {
  readonly id: string;
  readonly tool: AttachedTool | null;
}

export interface AttachMenu {
  readonly menu: MenuData;
  readonly choices: readonly AttachChoice[];
}

/** The id of « Déclarer un Serveur MCP ». */
export const DECLARE_MCP = 'mcp-declare';

/** The official Skills, embedded in the Runner (ADR 0004): those of the catalogue, in its order. */
const OFFICIAL_SKILLS: readonly string[] = [...new Set(STEP_KINDS.flatMap((kind) => (CATALOGUE[kind].skill === null ? [] : [CATALOGUE[kind].skill])))];

const item = (id: string, label: string, icon: MenuItem['icon'], detail: string | null, more: Partial<MenuItem> = {}): MenuItem => ({
  id,
  label,
  icon,
  detail,
  selected: false,
  disabled: false,
  ...more,
});

/**
 * « Attacher un Outil » (pure, US-93, US-73): the Menu « Attacher à
 * « {Étape} » » with only the groups the Étape takes, each item with the
 * Outil it attaches; `null` for an Étape that takes none (a gate, the
 * Merge) or none shown.
 */
export const attachMenuOf = (definition: ProcessDefinition, stepId: string, context: AttachContext, options: AttachOptions = { commands: false }): AttachMenu | null => {
  const step = definition.steps.find((candidate) => candidate.id === stepId);
  if (!step) return null;
  const groups: MenuGroup[] = [];
  const choices: AttachChoice[] = [];
  const takes = (kind: ToolKind) => takesTool(step.kind, kind);
  const add = (label: string, items: readonly (readonly [MenuItem, AttachedTool | null])[]) => {
    groups.push({ label, items: items.map(([entry]) => entry) });
    for (const [entry, tool] of items) choices.push({ id: entry.id, tool });
  };

  if (takes('role')) {
    const held = step.tools.find((tool) => tool.kind === 'role')?.roleId;
    add(
      t('process.tools.attach.roles'),
      context.roles.map((role) => [item(`role:${role.id}`, role.name, 'user', role.detail, { selected: role.id === held }), { kind: 'role', roleId: role.id }] as const),
    );
  }
  if (takes('skill')) {
    const held = step.tools.find((tool) => tool.kind === 'skill')?.skillId;
    add(
      t('process.tools.attach.skills'),
      OFFICIAL_SKILLS.map((skillId) => [item(`skill:${skillId}`, skillId, 'spark', t('process.tool.skill.official'), { selected: skillId === held }), { kind: 'skill', skillId }] as const),
    );
  }
  if (takes('mcp')) {
    const held = new Set(step.tools.flatMap((tool) => (tool.kind === 'mcp' ? [tool.name] : [])));
    add(t('process.tools.attach.mcp', { machine: context.machine }), [
      ...context.mcpServers.map(
        (name) =>
          [
            held.has(name)
              ? item(`mcp:${name}`, name, 'layers', t('process.tools.attach.mcp.attached'), { disabled: true })
              : item(`mcp:${name}`, name, 'layers', t('process.tools.attach.mcp.detail')),
            { kind: 'mcp', name },
          ] as const,
      ),
      [item(DECLARE_MCP, t('process.tools.attach.mcp.declare'), 'plus', t('process.tools.attach.mcp.declare.detail')), null] as const,
    ]);
  }
  if (takes('command') && options.commands) {
    add(t('process.tools.attach.commands', { machine: context.machine }), [
      [item('command', t('process.tools.attach.command'), 'terminal', t('process.tools.attach.command.detail')), { kind: 'command' }] as const,
    ]);
  }
  if (takes('connector') && context.repository !== null) {
    const held = step.tools.some((tool) => tool.kind === 'connector');
    add(t('process.tools.attach.connector'), [
      [
        held
          ? item('connector:github', t('process.tool.connector.github'), 'plug', t('process.tools.attach.mcp.attached'), { disabled: true })
          : item('connector:github', t('process.tool.connector.github'), 'plug', context.repository),
        { kind: 'connector', connector: 'github' },
      ] as const,
    ]);
  }
  if (groups.length === 0) return null;
  return { menu: { title: t('process.tools.attach.title', { name: step.name }), groups }, choices };
};
