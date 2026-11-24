import {
  DEFAULT_ACCOUNT_SETTINGS,
  PROCESS_CREWDECK,
  PROCESS_CREWDECK_NAME,
  type AiAccount,
  type ProcessDefinition,
  type ProcessGap,
  type Project,
  type ProcessRunningWork,
  type ProjectProcess,
  type Runner,
  type SourceMigration,
} from '@crewdeck/contracts';
import { PageProcessEditor, t } from '@crewdeck/sdk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEditorUi } from '../process/editor-ui.js';
import { gapRowOf, NO_EDITS, processEditorView, type EditorEdits, type ProcessEditorState } from './process-editor.js';

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
  nameSealed: null,
  folder: null,
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

const PROCESS: ProjectProcess = { id: ID, active: VERSION_3, draft: null, sources: { ticket: github, code: github }, running: [] };

/** A PhaseRun still at work: a Ticket of « Développement », or an Idée of another Phase. */
const work = (n: number, versionNumber: number, phaseId: string, ticketNumber: number | null): ProcessRunningWork => ({
  phaseRunId: `019a6f00-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`,
  versionNumber,
  phaseId,
  itemType: ticketNumber === null ? 'idea' : 'ticket',
  itemId: `019a6f00-0000-7000-8000-0000000002${String(n).padStart(2, '0')}`,
  ticketNumber,
});
/** Tickets #53 and #57 on the v3, a Conception on the v2: what the mockup shows. */
const RUNNING = [work(1, 2, 'ph-conception', null), work(2, 3, 'ph-dev', 53), work(3, 3, 'ph-dev', 57)];

/** « Process Crewdeck » with Stitch and Figma attached to « Maquettes », and the Review's Retour at 5. */
const THREE_CHANGES: ProcessDefinition = (() => {
  const draft = structuredClone(PROCESS_CREWDECK);
  draft.steps.find((step) => step.id === 'st-maquettes')!.tools.push({ kind: 'mcp', name: 'Stitch' }, { kind: 'mcp', name: 'Figma' });
  draft.loopBacks.find((loopBack) => loopBack.from === 'st-review')!.max = 5;
  return draft;
})();

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
  connection: 'live',
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

const view = (state: ProcessEditorState, query: Record<string, string> = {}, edits: Partial<EditorEdits> = {}) =>
  processEditorView(state, ID, createEditorUi().view(ID, query), { ...NO_EDITS, ...edits });
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
    expect(data.canvas).toMatchObject({ editable: true, zoom: 90, pan: { x: 0, y: 0 }, focus: null });
    expect(data.tab).toBe('gaps');
    expect(data.gaps).toEqual([]);
    expect(data.step).toBeNull();
    expect(data.phase).toBeNull();
    expect(data.footer).toEqual({ changes: 'Aucun changement depuis la v3.', versions: 'v3 active depuis le 4 nov. · aucun travail en cours' });
    expect(data.activate).toEqual({ label: 'Activer la v4', revision: null, disabledReason: 'Aucun changement' });
    expect(data.toast).toBeNull();
  });

  it('counts the draft’s changes in the header, lists them at the foot with the work in progress by version, and lets activate it as the v4', () => {
    const data = view(stateOf({ ...PROCESS, draft: draftOf(THREE_CHANGES), running: RUNNING }));

    expect(data.title.count).toBe('brouillon · 3 changements');
    expect(data.footer).toEqual({
      changes:
        '3 changements depuis la v3 : Serveur MCP « Stitch » attaché à « Maquettes » ; Serveur MCP « Figma » attaché à « Maquettes » ; Retour de « Review » vers « Code » : 5 fois au plus, au lieu de 3.',
      versions: 'v3 active depuis le 4 nov. · 2 Tickets en cours finissent sur la v3 · 1 Conception en cours finit sur la v2',
    });
    expect(data.activate).toEqual({ label: 'Activer la v4', revision: 2, disabledReason: null });
  });

  it('names the work in progress by its kind: a Ticket, an Idée, a Conception, another item', () => {
    const running = [work(1, 3, 'ph-dev', 53), work(2, 3, 'ph-idee', null), work(3, 3, 'ph-idee', null), work(4, 3, 'ph-gone', null)];
    expect(view(stateOf({ ...PROCESS, running })).footer.versions).toBe(
      'v3 active depuis le 4 nov. · 1 Ticket en cours finit sur la v3 · 2 Idées en cours finissent sur la v3 · 1 autre travail en cours finit sur la v3',
    );
  });

  it('disables « Activer » for a draft that changes nothing, and during the Resynchronisation', () => {
    const unchanged = view(stateOf({ ...PROCESS, draft: draftOf(PROCESS_CREWDECK) }));
    expect(unchanged.footer.changes).toBe('Aucun changement depuis la v3.');
    expect(unchanged.activate).toEqual({ label: 'Activer la v4', revision: 2, disabledReason: 'Aucun changement' });

    const resync = view({ ...stateOf({ ...PROCESS, draft: draftOf(THREE_CHANGES) }), connection: 'resync' });
    expect(resync.activate).toEqual({ label: 'Activer la v4', revision: 2, disabledReason: t('resync.sensitiveUnavailable') });
  });

  describe('« Enregistrer comme Modèle de process » (PROCESS-14)', () => {
    const SEALED = { key: 'a2V5', ciphertext: 'Y2lwaGVy' };
    const opened = (state: ProcessEditorState, open: { name: string | null; error: string | null; replaceId: string | null }) => {
      const ui = createEditorUi();
      ui.saveTemplate(ID, open);
      return processEditorView(state, ID, ui.view(ID, {})).saveTemplate;
    };
    const FRESH = { name: null, error: null, replaceId: null };

    it('stays closed until the page opens it', () => {
      expect(view(stateOf()).saveTemplate).toBeNull();
    });

    it('opens on « Process {Projet} », the active version, no draft, nothing to approve', () => {
      expect(opened(stateOf(), FRESH)).toEqual({
        name: `Process ${PROJECT.displayName}`,
        error: null,
        replaceId: null,
        versionNumber: 3,
        draft: false,
        locked: false,
      });
    });

    it('keeps the name submitted, its refusal and the Modèle to replace; says a draft stays out', () => {
      const withDraft: ProjectProcess = { ...PROCESS, draft: draftOf(THREE_CHANGES) };
      const refused = { name: 'Process web', error: 'Un Modèle de process porte déjà ce nom.', replaceId: '019a6f00-0000-7000-8000-0000000000a1' };
      expect(opened(stateOf(withDraft), refused)).toEqual({ ...refused, versionNumber: 3, draft: true, locked: false });
    });

    it('waits for this Appareil when the version holds Commandes and the vault is not open', () => {
      const withCommands: ProjectProcess = { ...PROCESS, active: { ...VERSION_3, sealed: SEALED } };
      expect(opened({ ...stateOf(withCommands), vaultState: 'locked' }, FRESH)?.locked).toBe(true);
      expect(opened({ ...stateOf(withCommands), vaultState: 'unlocked' }, FRESH)?.locked).toBe(false);
      expect(opened({ ...stateOf(), vaultState: 'locked' }, FRESH)?.locked).toBe(false);
    });

    it('has nothing to save without an active version', () => {
      expect(opened(stateOf({ ...PROCESS, active: null, draft: draftOf(THREE_CHANGES, 0) }), FRESH)).toBeNull();
    });
  });

  it('shows the Toast of the page’s own state', () => {
    const ui = createEditorUi();
    ui.toast(ID, { tone: 'go', icon: 'check', text: 'Version 4 active.' });
    expect(processEditorView(stateOf(), ID, ui.view(ID, {})).toast).toEqual({ tone: 'go', icon: 'check', text: 'Version 4 active.' });
  });

  it('shows the draft when there is one, its Manques listed with their meta and block, counted in the header', () => {
    const { definition, gaps } = fixture('gaps-every-kind');
    const data = view(stateOf({ ...PROCESS, draft: draftOf(definition) }));

    expect(stepsOf(data).map((step) => step.id)).toContain('st-e2e');
    expect(data.title.count).toBe('brouillon · 3 changements · 5 Manques');
    expect(data.activate).toEqual({ label: 'Activer la v4', revision: 2, disabledReason: 'Règle les Manques pour activer.' });
    expect(data.gaps).toEqual([
      { label: gaps[0]!.label, meta: 'Analyse de l’Idée · Idée', target: { kind: 'step', id: 'st-analyse' } },
      { label: gaps[1]!.label, meta: 'Merge · Développement', target: { kind: 'step', id: 'st-merge' } },
      { label: gaps[2]!.label, meta: 'Merge · Développement', target: { kind: 'step', id: 'st-merge' } },
      { label: gaps[3]!.label, meta: 'Merge · Développement', target: { kind: 'step', id: 'st-merge' } },
      { label: gaps[4]!.label, meta: 'Tests de bout en bout · Développement', target: { kind: 'step', id: 'st-e2e' } },
    ]);
    expect(data.canvas.phases.map((phase) => phase.gaps)).toEqual([1, 0, 4]);
    expect(stepsOf(data).find((step) => step.id === 'st-merge')?.ports.find((port) => port.id === 'v-review')?.state).toBe('unfed');
    expect(data.footer.versions).toBe('v3 active depuis le 4 nov. · aucun travail en cours');
  });

  it('says « brouillon » for a draft without Manque nor change', () => {
    expect(view(stateOf({ ...PROCESS, draft: draftOf(PROCESS_CREWDECK) })).title.count).toBe('brouillon');
  });

  it('shows the Review chosen: its kind and Phase, its Retour, where its Entrées come from and its Sortie goes, its Outils with the Paramètres’ model', () => {
    const data = view(stateOf(), { etape: 'st-review' });

    expect(data.tab).toBe('selection');
    expect(stepsOf(data).filter((step) => step.selected).map((step) => step.id)).toEqual(['st-review']);
    expect(data.canvas.focus).toEqual({ id: 'st-review', at: 0 });
    expect(data.step).toEqual({
      id: 'st-review',
      phaseId: 'ph-dev',
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
      phases: [
        { value: 'ph-idee', label: 'Idée' },
        { value: 'ph-conception', label: 'Conception' },
        { value: 'ph-dev', label: 'Développement' },
      ],
      removeReason: 'La Review ne se retire pas : son Rôle se change.',
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

  it('shows the Phase chosen: its name, its Étapes, its Retours, « Répéter » and its help, why it does not go', () => {
    const dev = view(stateOf(), { phase: 'ph-dev' });
    expect(dev.tab).toBe('selection');
    expect(dev.step).toBeNull();
    expect(dev.phase).toEqual({
      id: 'ph-dev',
      name: 'Développement',
      count: '5 Étapes · 2 Retours',
      repeat: [
        { forEach: null, label: 'Une fois', checked: false },
        { forEach: 'idea.noted', label: 'Pour chaque Idée notée', checked: false },
        { forEach: 'idea.retained', label: 'Pour chaque Idée retenue', checked: false },
        { forEach: 'ticket.ready', label: 'Pour chaque Ticket prêt', checked: true },
      ],
      help: 'Chaque Ticket prêt parcourt la Phase : c’est la Boucle.',
      removeReason: 'Elle tient la Review et le Merge, qui ne se retirent pas.',
      nameError: null,
      focusName: null,
    });
    expect(dev.canvas.phases.map((phase) => [phase.target, phase.selected])).toEqual([[false, false], [false, false], [true, false]]);

    const definition = structuredClone(PROCESS_CREWDECK);
    definition.phases.find((phase) => phase.id === 'ph-dev')!.forEach = null;
    const once = view(stateOf({ ...PROCESS, draft: draftOf(definition) }), { phase: 'ph-dev' }).phase;
    expect(once?.repeat.filter((choice) => choice.checked).map((choice) => choice.label)).toEqual(['Une fois']);
    expect(once?.help).toBe('La Phase tourne à chaque Artefact reçu par ses premières Entrées, un à la fois, dans l’ordre.');
    expect(view(stateOf(), { phase: 'ph-conception' }).phase).toMatchObject({ help: 'Chaque Idée retenue parcourt la Phase : c’est sa Conception.', removeReason: null });
    expect(view(stateOf(), { phase: 'ph-idee' }).phase?.help).toBe('Chaque Idée notée parcourt la Phase.');
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

  it('reads a Local Projet’s Sources without a Select: it has no Dépôt GitHub to migrate to (PROJET-6)', () => {
    const folder = { ...PROJECT, repositoryId: null, owner: null, name: null, fullName: null, displayName: null };
    const data = view(stateOf({ ...PROCESS, sources: { ticket: local, code: local } }, folder), { onglet: 'sources' });

    expect(data.sources.rows.map((row) => row.select)).toEqual([null, null, null]);
    expect(data.sources.rows.slice(0, 2).map((row) => row.value)).toEqual(['Local', 'Local']);
    expect(data.sources.lead).toBe('Une Source par Type d’artefact : elle gagne toujours.');
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
    expect(data.title.count).toBe('brouillon · première version · 1 Manque');
    expect(data.gaps.map((gap) => gap.target)).toEqual([{ kind: 'step', id: 'st-checks' }]);
    expect(data.footer).toEqual({ changes: 'Ce brouillon deviendra la v1.', versions: 'aucune version active' });
    expect(data.activate).toEqual({ label: 'Activer la v1', revision: 2, disabledReason: 'Règle les Manques pour activer.' });

    const fixed = view(stateOf({ ...PROCESS, active: null, draft: draftOf(PROCESS_CREWDECK, 0) }));
    expect(fixed.title.count).toBe('brouillon · première version');
    expect(fixed.activate).toEqual({ label: 'Activer la v1', revision: 2, disabledReason: null });
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

describe('processEditorView, editing (PROCESS-8)', () => {
  it('shows the edits’ view in place of the store’s', () => {
    const definition = structuredClone(PROCESS_CREWDECK);
    definition.phases[2]!.name = 'Livraison';
    const data = view(stateOf(), {}, { shown: { ...PROCESS, draft: draftOf(definition) } });
    expect(data.canvas.phases.map((phase) => phase.name)).toEqual(['Idée', 'Conception', 'Livraison']);
    // PROCESS-10: the header counts the changes since the active version, the edits shown included.
    expect(data.title.count).toBe('brouillon · 1 changement');
  });

  it('disables « Activer » without a revision while an edit is being saved, the first one of a Projet without a draft included', () => {
    const definition = structuredClone(PROCESS_CREWDECK);
    definition.phases[2]!.name = 'Livraison';
    // The first edit of a Process without a draft: shown at once on revision 0, its PUT in flight.
    const data = view(stateOf(), {}, { shown: { ...PROCESS, draft: { ...draftOf(definition), revision: 0 } }, saving: true });
    expect(data.activate).toEqual({ label: 'Activer la v4', revision: null, disabledReason: 'Enregistrement du brouillon…' });
    expect(PageProcessEditor.data.safeParse(data).success).toBe(true);

    expect(view(stateOf(), {}, { shown: { ...PROCESS, draft: draftOf(definition) }, saving: false }).activate).toEqual({ label: 'Activer la v4', revision: 2, disabledReason: null });
  });

  it('outlines the target Phase: the selected one, else the selected Étape’s, else the last one', () => {
    const targets = (query: Record<string, string>) => view(stateOf(), query).canvas.phases.filter((phase) => phase.target).map((phase) => phase.id);
    expect(targets({ phase: 'ph-idee' })).toEqual(['ph-idee']);
    expect(targets({ etape: 'st-prd' })).toEqual(['ph-conception']);
    expect(targets({})).toEqual(['ph-dev']);
  });

  it('opens the catalogue on the target Phase', () => {
    expect(view(stateOf(), { phase: 'ph-dev' }).catalogue).toBeNull();
    const catalogue = view(stateOf(), { phase: 'ph-dev' }, { catalogue: true }).catalogue;
    expect(catalogue?.title).toBe('Ajouter dans « Développement »');
    expect(catalogue?.groups).toHaveLength(3);
  });

  it('says why the Checks and the Merge do not go, and lets an added Review go', () => {
    expect(view(stateOf(), { etape: 'st-checks' }).step?.removeReason).toBe('Les Checks ne se retirent pas : leurs Outils se changent.');
    expect(view(stateOf(), { etape: 'st-merge' }).step?.removeReason).toBe('Le Merge ne se retire pas : c’est une Étape du produit.');
    expect(view(stateOf(), { etape: 'st-code' }).step?.removeReason).toBeNull();
    const definition = structuredClone(PROCESS_CREWDECK);
    definition.steps.push({ ...definition.steps.find((step) => step.id === 'st-review')!, id: 'st-review-2', col: 5, row: 1 });
    expect(view(stateOf({ ...PROCESS, draft: draftOf(definition) }), { etape: 'st-review' }).step?.removeReason).toBeNull();
  });

  it('names the Checks alone held by a Phase, plural', () => {
    const definition = structuredClone(PROCESS_CREWDECK);
    definition.phases.push({ id: 'ph-ci', name: 'CI', col: 1, row: 4, forEach: null });
    definition.steps.find((step) => step.id === 'st-checks')!.phaseId = 'ph-ci';
    expect(view(stateOf({ ...PROCESS, draft: draftOf(definition) }), { phase: 'ph-ci' }).phase?.removeReason).toBe(
      'Elle tient les Checks, qui ne se retirent pas.',
    );
  });

  it('shows a refusal in a halt Toast', () => {
    expect(view(stateOf()).toast).toBeNull();
    expect(view(stateOf(), {}, { toast: 'Refusé.' }).toast).toEqual({ tone: 'halt', icon: 'block', text: 'Refusé.' });
  });

  it('asks the Dialog naming the Étapes of the Phase to remove', () => {
    expect(view(stateOf(), { phase: 'ph-idee' }, { removingPhase: 'ph-idee' }).removePhase).toEqual({
      phaseId: 'ph-idee',
      title: 'Retirer la Phase « Idée » ?',
      body: 'Ses 2 Étapes partent avec elle : Analyse de l’Idée, Tri de l’Idée. Le changement va dans le brouillon.',
    });
    expect(view(stateOf(), {}, { removingPhase: 'ph-ailleurs' }).removePhase).toBeNull();
  });

  it('gives the Phase its name’s refusal and the ask to focus it', () => {
    const phase = view(stateOf(), { phase: 'ph-dev' }, { nameError: { phaseId: 'ph-dev', text: 'Une Phase porte déjà ce nom.' }, focusName: { phaseId: 'ph-dev', at: 2 } }).phase;
    expect(phase).toMatchObject({ nameError: 'Une Phase porte déjà ce nom.', focusName: 2 });
    expect(view(stateOf(), { phase: 'ph-idee' }, { nameError: { phaseId: 'ph-dev', text: 'x' } }).phase).toMatchObject({ nameError: null, focusName: null });
  });
});
