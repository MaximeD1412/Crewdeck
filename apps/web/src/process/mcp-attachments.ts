import type { ProjectProcess } from '@crewdeck/contracts';
import { t } from '@crewdeck/sdk';

/** The Étapes of a name attaching a server, and their Projets. */
export interface McpAttachment {
  readonly step: string;
  readonly projects: readonly string[];
}

const byName = (a: string, b: string): number => a.localeCompare(b, 'fr');

/**
 * Where each Serveur MCP is attached (pure, US-73): the Étapes of every
 * Projet's active version and draft that attach it by name, grouped by the
 * Étape's name with their Projets, both in alphabetical order. The server's
 * `mcp_servers` know nothing of the Process (ADR 0013): the page computes it.
 */
export const mcpAttachmentsOf = (processes: Iterable<ProjectProcess>, projectName: (projectId: string) => string): ReadonlyMap<string, readonly McpAttachment[]> => {
  const found = new Map<string, Map<string, Set<string>>>();
  for (const view of processes) {
    const project = projectName(view.id);
    for (const definition of [view.active?.definition, view.draft?.definition]) {
      for (const step of definition?.steps ?? []) {
        for (const tool of step.tools) {
          if (tool.kind !== 'mcp') continue;
          const steps = found.get(tool.name) ?? new Map<string, Set<string>>();
          found.set(tool.name, steps);
          const projects = steps.get(step.name) ?? new Set<string>();
          steps.set(step.name, projects);
          projects.add(project);
        }
      }
    }
  }
  return new Map(
    [...found].map(([name, steps]) => [
      name,
      [...steps].sort(([a], [b]) => byName(a, b)).map(([step, projects]) => ({ step, projects: [...projects].sort(byName) })),
    ]),
  );
};

/** « attaché à « Maquettes » · Site mairie, Personal OS », or « attaché à aucune Étape ». */
export const attachedToText = (attachments: readonly McpAttachment[] | undefined): string =>
  attachments && attachments.length > 0
    ? t('runner.mcp.attachedTo', { list: attachments.map(({ step, projects }) => t('runner.mcp.attachedTo.step', { step, projects: projects.join(', ') })).join(' ; ') })
    : t('runner.mcp.attachedToNone');
