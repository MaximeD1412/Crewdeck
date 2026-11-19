import type { Project, ProjectProcess, Repository } from '@crewdeck/contracts';
import { firstTab, folderFormView, pickerView, projetView, projetsView } from './projets.js';

const AT = '2026-11-12T09:00:00.000Z';

const project = (id: string, displayName: string, fullName: string): Project => {
  const [owner = '', name = ''] = fullName.split('/');
  return {
    id,
    repositoryId: `${id}-repo`,
    owner,
    name,
    fullName,
    displayName,
    nameSealed: null,
    folder: null,
    releaseBranch: 'main',
    integrationBranch: 'develop',
    hasCode: true,
    inventoryState: 'pending',
    accessLost: false,
    followedAt: AT,
    readiness: null,
  };
};

const SEALED = { key: 'A'.repeat(80), ciphertext: 'B'.repeat(40) };

const local = (id: string, folder: Project['folder'] = 'present'): Project => ({
  ...project(id, 'x', 'x/x'),
  repositoryId: null,
  owner: null,
  name: null,
  fullName: null,
  displayName: null,
  nameSealed: SEALED,
  folder,
});

/** The names the page opened: a Local Projet's by id. */
const OPENED: Record<string, string> = { l1: 'Recettes', l2: 'Atelier' };
const name = (p: Project) => p.displayName ?? OPENED[p.id] ?? 'Projet local';
const READINESS = { roleName: (roleId: string) => roleId, fixing: null };

const repository = (id: string, fullName: string, extra: Partial<Repository> = {}): Repository => {
  const [owner = '', name = ''] = fullName.split('/');
  return { id, owner, name, fullName, private: true, defaultBranch: 'main', hasCode: false, followed: false, ...extra };
};

describe('projetsView', () => {
  it('lists every Projet by name, then by Dépôt GitHub, with what the page shows of it', () => {
    const view = projetsView([project('b', 'tennis-manager', 'maxime/tennis-manager'), project('a', 'Personal OS', 'maxime/personal-os'), project('c', 'tennis-manager', 'club/tennis-manager')], {
      name,
      machine: 'atelier-pc',
    });

    expect(view).toEqual({
      projects: [
        { id: 'a', name: 'Personal OS', meta: 'maxime/personal-os', tone: 'neutral', badge: 'en cours' },
        { id: 'c', name: 'tennis-manager', meta: 'club/tennis-manager', tone: 'neutral', badge: 'en cours' },
        { id: 'b', name: 'tennis-manager', meta: 'maxime/tennis-manager', tone: 'neutral', badge: 'en cours' },
      ],
    });
  });

  it('names a Local Projet by its opened name, its meta the Runner’s machine, or its folder missing', () => {
    const view = projetsView([local('l1'), local('l2', 'missing'), local('l3', 'pending'), project('a', 'Personal OS', 'maxime/personal-os')], { name, machine: 'atelier-pc' });

    expect(view.projects).toEqual([
      { id: 'l2', name: 'Atelier', meta: 'Local · dossier introuvable', tone: 'neutral', badge: 'en cours' },
      { id: 'a', name: 'Personal OS', meta: 'maxime/personal-os', tone: 'neutral', badge: 'en cours' },
      { id: 'l3', name: 'Projet local', meta: 'Local · sur atelier-pc', tone: 'neutral', badge: 'en cours' },
      { id: 'l1', name: 'Recettes', meta: 'Local · sur atelier-pc', tone: 'neutral', badge: 'en cours' },
    ]);
    expect(projetsView([local('l1')], { name, machine: null }).projects[0]?.meta).toBe('Local · sur ta machine');
  });

  it('shows each Projet’s readiness as its badge, the point to fix in its meta', () => {
    const ready = { ...project('a', 'Personal OS', 'maxime/personal-os'), readiness: { ready: true, computedAt: AT, checks: [] } };
    const missing = {
      ...project('b', 'Site mairie', 'maxime/site-mairie'),
      readiness: { ready: false, computedAt: AT, checks: [{ id: 'labels' as const, state: 'missing' as const, facts: { missing: 2 }, fix: 'auto' as const }] },
    };
    expect(projetsView([missing, ready], { name, machine: null }).projects).toEqual([
      { id: 'a', name: 'Personal OS', meta: 'maxime/personal-os', tone: 'go', badge: 'prêt' },
      { id: 'b', name: 'Site mairie', meta: '1 point à régler : labels absents', tone: 'caution', badge: 'à régler' },
    ]);
  });

  it('is empty without a Projet', () => {
    expect(projetsView([], { name, machine: null })).toEqual({ projects: [] });
  });
});

describe('projetView', () => {
  const processOf = (ticket: 'local' | 'github' | null, code: 'local' | 'github' | null): ProjectProcess =>
    ({ id: 'l1', active: null, draft: null, sources: { ticket: { source: ticket }, code: { source: code } } }) as unknown as ProjectProcess;

  it('shows a Local Projet’s folder on the Runner’s machine, never its path, and no Connecteur when every group is Local', () => {
    expect(projetView(local('l1', 'pending'), { name, machine: 'atelier-pc', process: processOf('local', 'local'), ...READINESS })).toEqual({
      id: 'l1',
      name: 'Recettes',
      fullName: null,
      folder: { state: 'pending', machine: 'atelier-pc' },
      connectors: [],
      followedAt: AT,
      readiness: { count: 'en attente', blocked: null, rows: [], fixing: null },
    });
  });

  it('lists the Sources other than Local as Connecteurs; a Dépôt GitHub without its Process yet has GitHub', () => {
    expect(projetView(local('l1'), { name, machine: 'atelier-pc', process: processOf('github', 'local'), ...READINESS }).connectors).toEqual(['github']);
    expect(projetView(project('a', 'Personal OS', 'maxime/personal-os'), { name, machine: null, process: undefined, ...READINESS })).toMatchObject({
      name: 'Personal OS',
      fullName: 'maxime/personal-os',
      folder: null,
      connectors: ['github'],
    });
  });
});

describe('folderFormView', () => {
  it('carries the form’s state with « Process Crewdeck » as the only Modèle', () => {
    expect(
      folderFormView({ context: 'projets', path: '~/projets/recettes', check: { state: 'ready', hasCode: true }, name: 'recettes', busy: false, vaultLocked: false, machine: 'atelier-pc' }),
    ).toEqual({
      context: 'projets',
      path: '~/projets/recettes',
      check: { state: 'ready', hasCode: true },
      name: 'recettes',
      templates: [{ id: 'process-crewdeck', label: 'Process Crewdeck' }],
      templateId: 'process-crewdeck',
      busy: false,
      vaultLocked: false,
      machine: 'atelier-pc',
    });
  });
});

describe('firstTab', () => {
  it('opens on « Dépôt GitHub » when the Pilote has one, else on the folder', () => {
    expect(firstTab([repository('1', 'maxime/site-mairie', { followed: true })])).toBe('github');
    expect(firstTab([])).toBe('dossier');
  });
});

describe('pickerView', () => {
  it('offers the Dépôts GitHub not followed, by name then owner, saying which have code', () => {
    const view = pickerView({
      context: 'projets',
      repositories: [
        repository('3', 'maxime/site-mairie', { hasCode: true }),
        repository('1', 'maxime/personal-os', { followed: true }),
        repository('4', 'club/site-mairie'),
        repository('2', 'maxime/sandbox-vue3'),
      ],
      installUrl: 'https://github.example/apps/crewdeck/installations/new?state=projets',
      busy: false,
    });

    expect(view).toEqual({
      context: 'projets',
      repositories: [
        { id: '2', fullName: 'maxime/sandbox-vue3', hasCode: false },
        { id: '4', fullName: 'club/site-mairie', hasCode: false },
        { id: '3', fullName: 'maxime/site-mairie', hasCode: true },
      ],
      installUrl: 'https://github.example/apps/crewdeck/installations/new?state=projets',
      busy: false,
      templates: [{ id: 'process-crewdeck', label: 'Process Crewdeck' }],
      templateId: 'process-crewdeck',
    });
  });

  it('carries its context, the link once known and the follow in flight', () => {
    expect(pickerView({ context: 'demarrage', repositories: [], installUrl: null, busy: true })).toEqual({
      context: 'demarrage',
      repositories: [],
      installUrl: null,
      busy: true,
      templates: [{ id: 'process-crewdeck', label: 'Process Crewdeck' }],
      templateId: 'process-crewdeck',
    });
  });
});
