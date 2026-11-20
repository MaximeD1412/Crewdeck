import type { ProcessDefinition, ProjectProcess } from '@crewdeck/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { attachedToText, mcpAttachmentsOf } from './mcp-attachments.js';

const FIXTURES = join(import.meta.dirname, '../../../../packages/contracts/fixtures/process');
const GITHUB = (JSON.parse(readFileSync(join(FIXTURES, 'crewdeck-github.json'), 'utf8')) as { definition: ProcessDefinition }).definition;

/** The definition with `name` attached to the Étapes `stepIds`. */
const attaching = (name: string, ...stepIds: string[]): ProcessDefinition => ({
  ...GITHUB,
  steps: GITHUB.steps.map((step) => (stepIds.includes(step.id) ? { ...step, tools: [...step.tools, { kind: 'mcp', name }] } : step)),
});

const SOURCES: ProjectProcess['sources'] = {
  ticket: { source: 'github', migration: null },
  code: { source: 'github', migration: null },
} as unknown as ProjectProcess['sources'];

const view = (id: string, active: ProcessDefinition | null, draft: ProcessDefinition | null): ProjectProcess =>
  ({
    id,
    active: active && { number: 3, definition: active, activatedAt: '2026-11-04T10:00:00.000Z' },
    draft: draft && { revision: 2, definition: draft },
    sources: SOURCES,
    running: [],
  }) as unknown as ProjectProcess;

const NAMES: Readonly<Record<string, string>> = { mairie: 'Site mairie', os: 'Personal OS', crew: 'Crewdeck' };
const projectName = (id: string) => NAMES[id] ?? id;

describe('mcpAttachmentsOf', () => {
  it('groups the Étapes attaching each server by their name, with their Projets', () => {
    const attachments = mcpAttachmentsOf([view('mairie', attaching('stitch', 'st-maquettes'), null), view('os', attaching('stitch', 'st-maquettes'), null)], projectName);
    expect(attachments.get('stitch')).toEqual([{ step: 'Maquettes', projects: ['Personal OS', 'Site mairie'] }]);
    expect(attachedToText(attachments.get('stitch'))).toBe('attaché à « Maquettes » · Personal OS, Site mairie');
  });

  it('counts a name attached only in a draft, a Projet once for its version and its draft', () => {
    const attachments = mcpAttachmentsOf(
      [view('mairie', attaching('stitch', 'st-maquettes'), attaching('stitch', 'st-maquettes')), view('os', GITHUB, attaching('stitch', 'st-maquettes', 'st-code'))],
      projectName,
    );
    expect(attachments.get('stitch')).toEqual([
      { step: 'Code', projects: ['Personal OS'] },
      { step: 'Maquettes', projects: ['Personal OS', 'Site mairie'] },
    ]);
    expect(attachedToText(attachments.get('stitch'))).toBe('attaché à « Code » · Personal OS ; « Maquettes » · Personal OS, Site mairie');
  });

  it('says « attaché à aucune Étape » for a name attached nowhere', () => {
    const attachments = mcpAttachmentsOf([view('mairie', GITHUB, null)], projectName);
    expect(attachments.get('figma')).toBeUndefined();
    expect(attachedToText(attachments.get('figma'))).toBe('attaché à aucune Étape');
  });
});
