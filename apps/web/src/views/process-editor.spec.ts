import {
  DEFAULT_ACCOUNT_SETTINGS,
  PROCESS_CREWDECK,
  PROCESS_CREWDECK_NAME,
  type AiAccount,
  type ProcessDefinition,
  type ProcessGap,
  type Project,
  type ProjectProcess,
  type Runner,
  type SourceMigration,
} from '@crewdeck/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEditorUi } from '../process/editor-ui.js';
import { gapRowOf, processEditorView, type ProcessEditorState } from './process-editor.js';

const FIXTURES = join(import.meta.dirname, '../../../../packages/contracts/fixtures/process');
/** A case of the canvas's rules (PROCESS-2), as the server's tests read it. */
const fixture = (name: string): { definition: ProcessDefinition; gaps: ProcessGap[] } =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as { definition: ProcessDefinition; gaps: ProcessGap[] };

const ID = '019a6f00-0000-7000-8000-000000000011';
const SETTINGS = { ...DEFAULT_ACCOUNT_SETTINGS, timeZone: 'Europe/Paris' };
const SINCE = '2026-11-01T08:00:00.000Z';
/** Noon, so that the day holds in any time zone. */
const ACTIVATED = '2026-11-04T12:00:00.000Z';

const PROJECT: Project = {
  id: ID,
  repositoryId: '019a6f00-0000-7000-8000-000000000021',
  owner: 'MaximeD1412',
  name: 'site-mairie',
  fullName: 'MaximeD1412/site-mairie',
  displayName: 'Site mairie',
  releaseBranch: 'main',
  integrationBranch: 'develop',
  hasCode: true,
  inventoryState: 'approved',
  accessLost: false,
  followedAt: SINCE,
};

const VERSION_3: NonNullable<ProjectProcess['active']> = {
  number: 3,
  definition: PROCESS_CREWDECK,
  sealed: null,
  activatedAt: ACTIVATED,
  activatedBy: 'pilot',
  templateName: PROCESS_CREWDECK_NAME,
};

const github = { source: 'github', since: SINCE } as const;
const local = { source: 'local', since: SINCE } as const;

const PROCESS: ProjectProcess = { id: ID, active: VERSION_3, draft: null, sources: { ticket: github, code: github } };

const draftOf = (definition: ProcessDefinition, baseVersion = 3): NonNullable<ProjectProcess['draft']> => ({
  definition,
  sealed: null,
  revision: 2,
  baseVersion,
  updatedAt: '2026-11-15T09:00:00.000Z',
});

const CLAUDE: AiAccount = {
  id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6b01',
  engine: 'claude-code',
  installed: true,
  version: '1.0.0',
  knownVersion: true,
  kind: 'subscription',
  state: 'connected',
  models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5', usable: true }],
  reportedAt: '2026-11-11T08:30:00.000Z',
};

const RUNNER: Runner = {
  id: '019a6f00-0000-7000-8000-000000000031',
  machine: 'atelier-pc',
  os: 'linux',
  arch: 'amd64',
  wsl: false,
  runnerVersion: '1.0.0',
  state: 'online',
  lastSeenAt: SINCE,
  linkedAt: SINCE,
};

const stateOf = (process: ProjectProcess | null = PROCESS, project: Project | null = PROJECT): ProcessEditorState => ({
  slices: {
    project: new Map(project ? [[project.id, project]] : []),
    process: new Map(process ? [[process.id, process]] : []),
    settings: SETTINGS,
    runner: RUNNER,
    'ai-account': new Map([[CLAUDE.id, CLAUDE]]),
  },
});

const KINDS = [
  { value: 'local', label: 'Local' },
  { value: 'github', label: 'GitHub' },
];

const MIGRATION: SourceMigration = {
  id: '019a6f00-0000-7000-8000-000000000031',
  projectId: ID,
  group: 'ticket',
  from: 'local',
  to: 'github',
  state: 'draining',
  total: 0,
  copied: 0,
  waitingItems: [
    { itemType: 'ticket', number: 12 },
    { itemType: 'ticket', number: 14 },
  ],
  errorCode: null,
  attempt: 1,
  createdAt: '2026-11-19T09:00:00.000Z',
  switchedAt: null,
  endedAt: null,
};

const withSlices = (state: ProcessEditorState, slices: Record<string, unknown>): ProcessEditorState =>
  ({ slices: { ...state.slices, ...slices } }) as ProcessEditorState;

const view = (state: ProcessEditorState, query: Record<string, string> = {}) => processEditorView(state, ID, createEditorUi().view(ID, query));
const stepsOf = (data: ReturnType<typeof view>) => data.canvas.phases.flatMap((phase) => phase.steps);

describe('processEditorView', () => {
  it('shows the active version without a draft: « v3 active », its canvas, « Aucun Manque » on « Manques », its versions at the foot', () => {
    const data = view(stateOf());

    expect(data.found).toBe(true);
    expect(data.title).toEqual({ projectName: 'Site mairie', backHref: '/projets', count: 'v3 active' });
    expect(data.hasVersion).toBe(true);
    expect(data.canvas.phases.map((phase) => phase.name)).toEqual(['Idée', 'Conception', 'Développement']);
    expect(stepsOf(data)).toHaveLength(17);
    expect(data.canvas.arrows).toHaveLength(25);
    expect(data.canvas).toMatchObject({ editable: false, zoom: 90, pan: { x: 0, y: 0 }, focus: null });
    expect(data.tab).toBe('gaps');
    expect(data.gaps).toEqual([]);
    expect(data.step).toBeNull();
    expect(data.phase).toBeNull();
    expect(data.footer).toEqual({ changes: 'Aucun changement depuis la v3.', versions: 'v3 active depuis le 4 nov.' });
  });

  it('shows the draft when there is one, its Manques listed with their meta and block, counted in the header', () => {
    const { definition, gaps } = fixture('gaps-every-kind');
    const data = view(stateOf({ ...PROCESS, draft: draftOf(definition) }));

    expect(stepsOf(data).map((step) => step.id)).toContain('st-e2e');
    expect(data.title.count).toBe('brouillon · 5 Manques');
    expect(data.gaps).toEqual([
      { label: gaps[0]!.label, meta: 'Analyse de l’Idée · Idée', target: { kind: 'step', id: 'st-analyse' } },
      { label: gaps[1]!.label, meta: 'Merge · Développement', target: { kind: 'step', id: 'st-merge' } },
      { label: gaps[2]!.label, meta: 'Merge · Développement', target: { kind: 'step', id: 'st-merge' } },
      { label: gaps[3]!.label, meta: 'Merge · Développement', target: { kind: 'step', id: 'st-merge' } },
      { label: gaps[4]!.label, meta: 'Tests de bout en bout · Développement', target: { kind: 'step', id: 'st-e2e' } },
    ]);
    expect(data.canvas.phases.map((phase) => phase.gaps)).toEqual([1, 0, 4]);
    expect(stepsOf(data).find((step) => step.id === 'st-merge')?.ports.find((port) => port.id === 'v-review')?.state).toBe('unfed');
    expect(data.footer).toEqual({ changes: 'Brouillon en cours sur la v3.', versions: 'v3 active depuis le 4 nov.' });
  });

  it('says « brouillon » for a draft without Manque', () => {
    expect(view(stateOf({ ...PROCESS, draft: draftOf(PROCESS_CREWDECK) })).title.count).toBe('brouillon');
  });

  it('shows the Review chosen: its kind and Phase, its Retour, where its Entrées come from and its Sortie goes, its Outils with the Paramètres’ model', () => {
    const data = view(stateOf(), { etape: 'st-review' });

    expect(data.tab).toBe('selection');
    expect(stepsOf(data).filter((step) => step.selected).map((step) => step.id)).toEqual(['st-review']);
    expect(data.canvas.focus).toEqual({ id: 'st-review', at: 0 });
    expect(data.step).toEqual({
      name: 'Review',
      kindLabel: 'Agent',
      phaseName: 'Développement',
      loopBack: 'Vers « Code », tant que « Review » demande des changements, 3 fois au plus. Au-delà, une Décision t’attend.',
      inputs: [
        { label: 'Changement de code', from: '← Code', fed: true },
        { label: 'Verdict des checks', from: '← Checks', fed: true },
      ],
      outputs: [{ label: 'Verdict', to: '→ Merge' }],
      tools: [
        { icon: 'user', label: 'Rôle Review', detail: 'Claude Code · Opus 5.5' },
        { icon: 'spark', label: 'Skill review', detail: 'officielle' },
      ],
    });
    expect(data.phase).toBeNull();
  });

  it('says « pour chaque … » of an Entrée its Phase feeds, « rien » of an unfed one, and « aucune Étape » of a Sortie going nowhere', () => {
    const { definition } = fixture('gaps-every-kind');
    const byItem = fixture('input-fed-by-for-each');
    const code = view(stateOf({ ...PROCESS, draft: draftOf(byItem.definition) }), { etape: 'st-code' }).step;
    const merge = view(stateOf({ ...PROCESS, draft: draftOf(definition) }), { etape: 'st-merge' }).step;
    const e2e = view(stateOf({ ...PROCESS, draft: draftOf(definition) }), { etape: 'st-e2e' }).step;

    expect(code?.inputs[0]).toEqual({ label: 'Ticket', from: '← pour chaque Ticket prêt', fed: true });
    expect(code?.loopBack).toBeNull();
    expect(merge?.inputs.find((input) => input.label === 'Verdict de la Review')).toEqual({ label: 'Verdict de la Review', from: '← rien', fed: false });
    expect(e2e?.outputs.every((output) => output.to === '→ aucune Étape')).toBe(true);
    expect(e2e?.kindLabel).toBe('Commande');
  });

  it('names each Outil: the Connecteur with the repository, a Serveur MCP, a Commande, a Rôle of the Pilote’s', () => {
    const definition = structuredClone(PROCESS_CREWDECK);
    const step = (id: string) => definition.steps.find((candidate) => candidate.id === id)!;
    step('st-maquettes').tools.push({ kind: 'mcp', name: 'stitch' });
    step('st-code').tools[0] = { kind: 'role', roleId: 'r-0000front' };
    step('st-checks').tools.push({ kind: 'command', commandId: 'tests' });
    definition.commands.push({ id: 'tests' });
    const state = stateOf({ ...PROCESS, draft: draftOf(definition) });
    const settings = { ...SETTINGS, customRoles: [{ id: 'r-0000front', name: 'Front', createdAt: SINCE }] };
    const withRole: ProcessEditorState = { slices: { ...state.slices, settings } };

    expect(view(withRole, { etape: 'st-checks' }).step?.tools).toEqual([
      { icon: 'plug', label: 'Connecteur GitHub', detail: 'MaximeD1412/site-mairie' },
      { icon: 'terminal', label: 'Commande', detail: null },
    ]);
    expect(view(withRole, { etape: 'st-maquettes' }).step?.tools[2]).toEqual({ icon: 'layers', label: 'Serveur MCP stitch', detail: null });
    expect(view(withRole, { etape: 'st-code' }).step?.tools[0]).toMatchObject({ icon: 'user', label: 'Rôle Front' });
  });

  it('shows the Phase chosen: its Étapes, its Retours, what it repeats for', () => {
    const dev = view(stateOf(), { phase: 'ph-dev' });
    expect(dev.tab).toBe('selection');
    expect(dev.step).toBeNull();
    expect(dev.phase).toEqual({ name: 'Développement', count: '5 Étapes · 2 Retours', repeat: 'pour chaque Ticket prêt' });
    expect(dev.canvas.phases.map((phase) => phase.selected)).toEqual([false, false, true]);

    const definition = structuredClone(PROCESS_CREWDECK);
    definition.phases.find((phase) => phase.id === 'ph-dev')!.forEach = null;
    expect(view(stateOf({ ...PROCESS, draft: draftOf(definition) }), { phase: 'ph-dev' }).phase?.repeat).toBe('une fois');
  });

  it('forgets a selection the definition does not have', () => {
    const data = view(stateOf(), { etape: 'st-ailleurs' });
    expect(data.step).toBeNull();
    expect(stepsOf(data).some((step) => step.selected)).toBe(false);
  });

  it('reads the Sources by group: the Tickets Local on the Runner’s machine, the code on GitHub with the types it holds, the Idée in Crewdeck', () => {
    const data = view(stateOf({ ...PROCESS, sources: { ticket: local, code: github } }), { onglet: 'sources' });

    expect(data.tab).toBe('sources');
    expect(data.sources).toEqual({
      lead: 'Une Source par Type d’artefact : elle gagne toujours. Changer de Source migre tout ce qu’elle tient. GitHub : MaximeD1412/site-mairie.',
      banner: null,
      rows: [
        {
          icon: 'folder',
          label: 'Tickets',
          value: 'Local',
          detail: 'dossier tickets/ du Projet, sur atelier-pc',
          select: { group: 'ticket', label: 'Source des Tickets', value: 'local', options: KINDS, disabled: false },
          migration: null,
        },
        {
          icon: 'github',
          label: 'Code et documents',
          value: 'GitHub',
          detail: 'MaximeD1412/site-mairie · Changement de code, Verdict, PRD, Maquettes, Conception technique ; Inventaire non utilisé',
          select: { group: 'code', label: 'Source du code et des documents', value: 'github', options: KINDS, disabled: false },
          migration: null,
        },
        { icon: 'bulb', label: 'Idée', value: 'Crewdeck', detail: null, select: null, migration: null },
      ],
    });
  });

  it('shows the Source the Pilote picked in its Select, and that it waits for confirmation, while its migration is asked', () => {
    const ui = createEditorUi();
    ui.choose(ID, { group: 'ticket', to: 'github' });
    const data = processEditorView(stateOf({ ...PROCESS, sources: { ticket: local, code: github } }), ID, ui.view(ID, { onglet: 'sources' }));

    expect(data.sources.rows.map((row) => row.select?.value ?? null)).toEqual(['github', 'github', null]);
    expect(data.sources.rows[0]?.value).toBe('Local');
    expect(data.sources.rows[0]?.detail).toBe('choisi : GitHub, à confirmer');
  });

  it('shows a migration draining: its Banner, the group’s badge and meta in place of its Select, the other Select disabled', () => {
    const state = withSlices(stateOf({ ...PROCESS, sources: { ticket: local, code: github } }), {
      'source-migration': new Map([[MIGRATION.id, MIGRATION]]),
      ticket: new Map(Array.from({ length: 30 }, (_, i) => [`t${i}`, { projectId: ID }] as const)),
    });
    const data = view(state, { onglet: 'sources' });

    expect(data.sources.banner).toEqual({
      title: 'Migration des Tickets vers GitHub',
      text: 'Aucun nouveau Ticket ne démarre. #12 et #14 finissent sur Local, puis les 30 Tickets passent sur GitHub d’un coup.',
    });
    expect(data.sources.rows[0]).toEqual({
      icon: 'refresh',
      label: 'Tickets',
      value: 'Local',
      detail: 'migration en cours · 2 Tickets à finir sur Local',
      select: null,
      migration: 'Local → GitHub',
    });
    expect(data.sources.rows[1]?.select?.disabled).toBe(true);
  });

  it('follows the migration as it goes: copying with the Runner’s count, then done, its group saying where it came from', () => {
    const copying = { ...MIGRATION, state: 'copying', total: 30, copied: 12, waitingItems: [] } as const;
    const running = view(withSlices(stateOf({ ...PROCESS, sources: { ticket: local, code: github } }), { 'source-migration': new Map([[MIGRATION.id, copying]]) }), { onglet: 'sources' });
    expect(running.sources.rows[0]?.detail).toBe('copie : 12 sur 30');

    const done = { ...copying, state: 'done', copied: 30, switchedAt: '2026-11-19T10:00:00.000Z', endedAt: '2026-11-19T10:05:00.000Z' } as const;
    const after = view(withSlices(stateOf({ ...PROCESS, sources: { ticket: github, code: github } }), { 'source-migration': new Map([[MIGRATION.id, done]]) }), { onglet: 'sources' });
    expect(after.sources.banner).toBeNull();
    expect(after.sources.rows[0]).toMatchObject({ icon: 'github', value: 'GitHub', migration: null, select: { value: 'github', disabled: false } });
    expect(after.sources.rows[0]?.detail).toMatch(/^MaximeD1412\/site-mairie · depuis le .+ \(migré de Local\)$/);
  });

  it('shows a Local Projet Local for both groups, without GitHub, and the Livraison its Phase passes', () => {
    const definition = structuredClone(PROCESS_CREWDECK);
    definition.phases.push({ id: 'ph-livraison', name: 'Livraison', col: 2, row: 3, forEach: null });
    definition.steps.push({
      id: 'st-lancer',
      phaseId: 'ph-livraison',
      kind: 'command',
      name: 'Lancer',
      col: 1,
      row: 1,
      inputs: [{ id: 'changement', type: 'code-change', note: 'mergé' }],
      outputs: [{ id: 'livraison', type: 'delivery' }],
      tools: [{ kind: 'command', commandId: 'lancer' }],
    });
    definition.commands.push({ id: 'lancer' });
    const data = view(stateOf({ ...PROCESS, draft: draftOf(definition), sources: { ticket: local, code: local } }));

    expect(data.sources.rows.map((row) => [row.icon, row.label, row.value])).toEqual([
      ['folder', 'Tickets', 'Local'],
      ['folder', 'Code et documents', 'Local'],
      ['bulb', 'Idée', 'Crewdeck'],
      ['send', 'Livraison', 'aucune Source'],
    ]);
    expect(data.sources.rows[1]?.detail).toBe('dossier du Projet, sur atelier-pc · Changement de code, Verdict, PRD, Maquettes, Conception technique ; Inventaire non utilisé');
    expect(data.sources.rows[3]?.detail).toBe('le résultat d’une Commande');
  });

  it('shows the draft of a Projet without an active version, and says it will be the v1', () => {
    const data = view(stateOf({ ...PROCESS, active: null, draft: draftOf(PROCESS_CREWDECK, 0), sources: { ticket: local, code: local } }));

    expect(data.hasVersion).toBe(false);
    expect(data.title.count).toBe('brouillon · pas encore de version active');
    expect(data.gaps.map((gap) => gap.target)).toEqual([{ kind: 'step', id: 'st-checks' }]);
    expect(data.footer).toEqual({ changes: 'Ce brouillon deviendra la v1.', versions: 'aucune version active' });
  });

  it('says « Ce Projet n’existe pas » of a Projet the Pilote has not, once the snapshot came', () => {
    expect(view(stateOf(null, null)).found).toBe(false);
    expect(view(stateOf(null)).found).toBe(false);
    expect(view({ slices: {} }).found).toBe(true);
  });
});

describe('gapRowOf', () => {
  it('leads a Manque of the Sources to « Sources », with the Étape that passes its type', () => {
    const shown = PROCESS_CREWDECK;
    expect(gapRowOf({ kind: 'source.missing', target: 'sources.prd', label: 'PRD : aucune Source' }, shown)).toEqual({
      label: 'PRD : aucune Source',
      meta: 'Sources · produit par « PRD »',
      target: { kind: 'sources', id: 'prd' },
    });
    expect(gapRowOf({ kind: 'source.missing', target: 'sources.ticket', label: 'Ticket : aucune Source' }, shown).meta).toBe(
      'Sources · produit par « Découpage en Tickets »',
    );
  });
});
