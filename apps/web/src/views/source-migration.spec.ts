import { PROCESS_CREWDECK, type PhaseRun, type SourceMigration } from '@crewdeck/contracts';
import { migrationBanner, migrationConfirmation, migrationMeta, type SourceMigrationReads } from './source-migration.js';

const PROJECT = { id: 'p1', displayName: 'Site mairie', fullName: 'MaximeD1412/site-mairie', hasCode: true };

const MIGRATION: SourceMigration = {
  id: 'sm1',
  projectId: 'p1',
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

type Run = Pick<PhaseRun, 'projectId' | 'phaseId' | 'state' | 'waitingOn'>;
const run = (phaseId: string, state: Run['state'] = 'running', waitingOn: Run['waitingOn'] = null): Run => ({ projectId: 'p1', phaseId, state, waitingOn });

const readsOf = (overrides: Partial<SourceMigrationReads> = {}): SourceMigrationReads => ({
  project: PROJECT,
  definition: PROCESS_CREWDECK,
  migrations: [],
  phaseRuns: [run('ph-dev'), run('ph-dev'), run('ph-dev', 'waiting', 'queue'), run('ph-idee'), { ...run('ph-dev'), projectId: 'p2' }],
  tickets: [...Array.from({ length: 30 }, () => ({ projectId: 'p1' })), { projectId: 'p2' }],
  codeChanges: [],
  machine: 'atelier-pc',
  ...overrides,
});

describe('migrationConfirmation', () => {
  it('asks to move the Tickets: what holds, what is copied, what is archived, and that a type never has two Sources', () => {
    expect(migrationConfirmation(readsOf(), 'ticket', 'local', 'github')).toEqual({
      title: 'Passer les Tickets de Site mairie sur GitHub ?',
      confirmLabel: 'Migrer les Tickets',
      icon: 'github',
      tone: 'primary',
      consequences: {
        lead: 'Local → GitHub, MaximeD1412/site-mairie.',
        items: [
          { strong: '', text: 'Aucun nouveau Ticket ne démarre pendant la migration ; les 2 Tickets en cours finissent sur Local.' },
          { strong: '', text: 'Puis les 30 Tickets du dossier tickets/ deviennent 30 issues, d’un coup, avec leur état et leur historique.' },
          { strong: '', text: 'Le dossier tickets/ est archivé, figé : plus rien ne s’y écrit.' },
        ],
        note: 'Un Type d’artefact n’a jamais deux Sources, même un instant.',
      },
    });
  });

  it('says there is nothing to copy for a group that holds nothing, and nothing to finish when nothing runs', () => {
    const dialog = migrationConfirmation(readsOf({ tickets: [], phaseRuns: [] }), 'ticket', 'local', 'github');

    expect(dialog.consequences?.items?.map((item) => item.text)).toEqual([
      'Aucun nouveau Ticket ne démarre pendant la migration.',
      'Rien à copier : la Source change tout de suite.',
      'Le dossier tickets/ est archivé, figé : plus rien ne s’y écrit.',
    ]);
  });

  it('asks to bring the issues back as files of tickets/, the issues archived without being closed (SOURCE-8)', () => {
    const dialog = migrationConfirmation(readsOf(), 'ticket', 'github', 'local');

    expect(dialog.consequences?.items?.slice(1).map((item) => item.text)).toEqual([
      'Puis les 30 issues deviennent 30 fichiers du dossier tickets/, d’un coup, avec leur état et leur historique.',
      'Les issues sont archivées : étiquetées crewdeck:archive et verrouillées, sans être fermées.',
    ]);
  });

  it('asks to move the code to Local, into the Projet’s folder on the Runner’s machine', () => {
    const dialog = migrationConfirmation(readsOf(), 'code', 'github', 'local');

    expect(dialog.title).toBe('Passer les changements de code de Site mairie sur Local ?');
    expect(dialog.confirmLabel).toBe('Migrer les changements de code');
    expect(dialog.icon).toBe('folder');
    expect(dialog.consequences?.lead).toBe('GitHub → Local, dossier du Projet, sur atelier-pc.');
  });

  const change = (source: 'github' | 'local', state: 'draft' | 'open' | 'merged' | 'closed', projectId = 'p1') => ({ projectId, source, state });
  const codeChanges = [change('local', 'open'), change('local', 'draft'), change('local', 'merged'), change('local', 'open', 'p2'), change('github', 'open')];

  it('pushes the folder’s branches to the repository, the open local changes becoming PRs, the documents following and the folder left as it is (SOURCE-9)', () => {
    const dialog = migrationConfirmation(readsOf({ codeChanges }), 'code', 'local', 'github', { repository: 'MaximeD1412/recettes' });

    expect(dialog.consequences?.lead).toBe('Local → GitHub, MaximeD1412/recettes.');
    expect(dialog.consequences?.items?.slice(1).map((item) => item.text)).toEqual([
      'Puis les branches du dossier sont poussées sur MaximeD1412/recettes et les 2 changements ouverts deviennent des PR, d’un coup.',
      'Les documents (PRD, Maquettes, Conception technique, Inventaire) suivent : ce sont des fichiers du code.',
      'Le dossier reste tel quel : c’est ton checkout.',
    ]);
  });

  it('names the repository neutrally until one is picked, and counts one open change in the singular (SOURCE-9)', () => {
    const dialog = migrationConfirmation(readsOf({ codeChanges: [change('local', 'open')], project: { ...PROJECT, fullName: null } }), 'code', 'local', 'github', { repository: null });

    expect(dialog.consequences?.lead).toBe('Local → GitHub, le dépôt choisi.');
    expect(dialog.consequences?.items?.[1]?.text).toBe('Puis les branches du dossier sont poussées sur le dépôt choisi et le changement ouvert devient une PR, d’un coup.');
  });

  it('clones the repository into the folder typed, its open PRs becoming local changes, GitHub written no more and unfollowed with the Tickets Local (SOURCE-9)', () => {
    const reads = readsOf({ codeChanges: [change('github', 'open'), change('github', 'draft'), change('github', 'closed'), change('local', 'open')] });
    const dialog = migrationConfirmation(reads, 'code', 'github', 'local', { folder: '~/projets/mairie', ticketSource: 'local' });

    expect(dialog.consequences?.items?.slice(1).map((item) => item.text)).toEqual([
      'Puis MaximeD1412/site-mairie est cloné dans ~/projets/mairie, toutes ses branches, et les 2 PR ouvertes deviennent des changements locaux.',
      'Les documents (PRD, Maquettes, Conception technique, Inventaire) suivent : ce sont des fichiers du code.',
      'Crewdeck n’écrit plus rien sur GitHub.',
    ]);
  });

  it('keeps the repository followed while the Tickets are on GitHub, and names the folder neutrally until one is typed (SOURCE-9)', () => {
    const dialog = migrationConfirmation(readsOf(), 'code', 'github', 'local', { folder: null, ticketSource: 'github' });

    expect(dialog.consequences?.items?.slice(1).map((item) => item.text)).toEqual([
      'Puis MaximeD1412/site-mairie est cloné dans le dossier choisi, toutes ses branches.',
      'Les documents (PRD, Maquettes, Conception technique, Inventaire) suivent : ce sont des fichiers du code.',
      'Crewdeck n’écrit plus rien sur GitHub ; le dépôt reste suivi tant que les Tickets y sont.',
    ]);
  });
});

describe('a migration running', () => {
  it('says what it waits for while it drains, the Tickets it moves from the page’s count', () => {
    expect(migrationMeta(MIGRATION)).toBe('migration en cours · 2 Tickets à finir sur Local');
    expect(migrationBanner(MIGRATION, readsOf())).toEqual({
      title: 'Migration des Tickets vers GitHub',
      text: 'Aucun nouveau Ticket ne démarre. #12 et #14 finissent sur Local, puis les 30 Tickets passent sur GitHub d’un coup.',
    });
  });

  it('follows its states: the copy counted by the Runner, the check, the switch', () => {
    expect(migrationMeta({ ...MIGRATION, state: 'copying', total: 30, copied: 12, waitingItems: [] })).toBe('copie : 12 sur 30');
    expect(migrationMeta({ ...MIGRATION, state: 'verifying', waitingItems: [] })).toBe('vérification');
    expect(migrationMeta({ ...MIGRATION, state: 'switched', waitingItems: [] })).toBe('bascule faite, on archive l’ancienne place');
  });
});
