import type { Project, Repository } from '@crewdeck/contracts';
import { pickerView, projetsView } from './projets.js';

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
    releaseBranch: 'main',
    integrationBranch: 'develop',
    hasCode: true,
    inventoryState: 'pending',
    accessLost: false,
    followedAt: AT,
  };
};

const repository = (id: string, fullName: string, extra: Partial<Repository> = {}): Repository => {
  const [owner = '', name = ''] = fullName.split('/');
  return { id, owner, name, fullName, private: true, defaultBranch: 'main', hasCode: false, followed: false, ...extra };
};

describe('projetsView', () => {
  it('lists every Projet by name, then by Dépôt GitHub, with what the page shows of it', () => {
    const view = projetsView([project('b', 'tennis-manager', 'maxime/tennis-manager'), project('a', 'Personal OS', 'maxime/personal-os'), project('c', 'tennis-manager', 'club/tennis-manager')]);

    expect(view).toEqual({
      projects: [
        { id: 'a', displayName: 'Personal OS', fullName: 'maxime/personal-os' },
        { id: 'c', displayName: 'tennis-manager', fullName: 'club/tennis-manager' },
        { id: 'b', displayName: 'tennis-manager', fullName: 'maxime/tennis-manager' },
      ],
    });
  });

  it('is empty without a Projet', () => {
    expect(projetsView([])).toEqual({ projects: [] });
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
    });
  });

  it('carries its context, the link once known and the follow in flight', () => {
    expect(pickerView({ context: 'demarrage', repositories: [], installUrl: null, busy: true })).toEqual({
      context: 'demarrage',
      repositories: [],
      installUrl: null,
      busy: true,
    });
  });
});
