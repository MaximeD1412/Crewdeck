import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  folderCheckAad,
  folderCheckedAad,
  projectFolderAad,
  projectNameAad,
  zClientMessage,
  zFolderCheck,
  zFolderCheckResult,
  zProjectsFolders,
  zRunnerToServer,
  zServerMessage,
  zServerToRunner,
} from '../index.js';

const FIXTURES = join(import.meta.dirname, '../../fixtures/runner');
const TAB_FIXTURES = join(FIXTURES, 'folders');
const fixture = (dir: string, name: string): Record<string, unknown> => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));

const REQUEST_ID = '019a6f00-0000-7000-8000-0000000000f1';
const PROJECT_ID = '019a6f00-0000-7000-8000-000000000021';

describe('the folders of a Local Projet, on the Runner protocol', () => {
  it.each(['folder.checked', 'projects.folders'])('accepts %s, Runner to server', (name) => {
    expect(zRunnerToServer.parse(fixture(FIXTURES, name))).toEqual(fixture(FIXTURES, name));
  });

  it.each(['folder.check', 'project.folder.attach', 'project.folder.pick', 'project.folder.drop'])('accepts %s, server to Runner', (name) => {
    expect(zServerToRunner.parse(fixture(FIXTURES, name))).toEqual(fixture(FIXTURES, name));
  });

  it('has the tab frames beside them: folder.check up, folder.checked and folder.error down', () => {
    expect(readdirSync(TAB_FIXTURES).sort()).toEqual(['tab.folder.check.json', 'tab.folder.checked.json', 'tab.folder.error.json']);
    expect(zClientMessage.parse(fixture(TAB_FIXTURES, 'tab.folder.check'))).toEqual(fixture(TAB_FIXTURES, 'tab.folder.check'));
    for (const name of ['tab.folder.checked', 'tab.folder.error']) expect(zServerMessage.parse(fixture(TAB_FIXTURES, name))).toEqual(fixture(TAB_FIXTURES, name));
  });

  it('carries the path sealed only: a frame with a path in clear is refused', () => {
    const check = fixture(FIXTURES, 'folder.check');
    expect(zServerToRunner.safeParse({ ...check, sealed: { path: '/home/pilote/projets/recettes' } }).success).toBe(false);
    expect(zClientMessage.safeParse({ ...fixture(TAB_FIXTURES, 'tab.folder.check'), sealed: undefined }).success).toBe(false);
    expect(zServerMessage.safeParse({ ...fixture(TAB_FIXTURES, 'tab.folder.error'), code: 'session.not-found' }).success).toBe(false);
  });

  it('lists the Projets whose folder is present by their ids only', () => {
    const folders = fixture(FIXTURES, 'projects.folders');
    expect(zProjectsFolders.parse({ ...folders, present: [] }).present).toEqual([]);
    expect(zProjectsFolders.safeParse({ ...folders, present: ['/home/pilote/projets/recettes'] }).success).toBe(false);
  });

  it('says the pending folders picked for a migration by ids only, absent from an older Runner (SOURCE-9)', () => {
    const folders = fixture(FIXTURES, 'projects.folders');
    expect(zProjectsFolders.parse(folders).pending).toEqual(['019a6f00-0000-7000-8000-000000000022']);
    expect(zProjectsFolders.parse({ ...folders, pending: undefined }).pending).toBeUndefined();
    expect(zProjectsFolders.safeParse({ ...folders, pending: ['~/projets/recettes'] }).success).toBe(false);
  });

  it('picks a folder for a group, sealed only (SOURCE-9)', () => {
    const pick = fixture(FIXTURES, 'project.folder.pick');
    expect(zServerToRunner.safeParse({ ...pick, group: 'idea' }).success).toBe(false);
    expect(zServerToRunner.safeParse({ ...pick, sealed: { path: '/home/pilote/projets/recettes' } }).success).toBe(false);
  });
});

describe('the plaintexts of a folder', () => {
  it('checks a path of 1 to 4096 characters', () => {
    expect(zFolderCheck.parse({ path: '~/projets/recettes' })).toEqual({ path: '~/projets/recettes' });
    expect(zFolderCheck.safeParse({ path: '' }).success).toBe(false);
    // Choosing a Projet's folder again: the check names the Projet, whose own folder is not taken.
    const projectId = '019a6f00-0000-7000-8000-0000000000a1';
    expect(zFolderCheck.parse({ path: '~/projets/recettes', projectId })).toEqual({ path: '~/projets/recettes', projectId });
    expect(zFolderCheck.safeParse({ path: '~/projets/recettes', projectId: 'recettes' }).success).toBe(false);
    expect(zFolderCheck.safeParse({ path: 'a'.repeat(4097) }).success).toBe(false);
  });

  it('answers one of its states, whether it has code, its branch and its name', () => {
    const ready = { state: 'ready', hasCode: true, branch: 'main', name: 'recettes' };
    expect(zFolderCheckResult.parse(ready)).toEqual(ready);
    expect(zFolderCheckResult.parse({ state: 'not-git', hasCode: false, branch: null, name: 'recettes' }).branch).toBeNull();
    expect(zFolderCheckResult.safeParse({ ...ready, state: 'gone' }).success).toBe(false);
    // SOURCE-9: whether the folder holds nothing, absent from an older Runner.
    expect(zFolderCheckResult.parse({ state: 'not-git', hasCode: false, empty: true, branch: null, name: 'vide' }).empty).toBe(true);
  });

  it('binds each sealed item to its place by its additional data', () => {
    expect(folderCheckAad(REQUEST_ID)).toBe(`folder.check:${REQUEST_ID}`);
    expect(folderCheckedAad(REQUEST_ID)).toBe(`folder.checked:${REQUEST_ID}`);
    expect(projectFolderAad(PROJECT_ID)).toBe(`project:${PROJECT_ID}:folder`);
    expect(projectNameAad(PROJECT_ID)).toBe(`project:${PROJECT_ID}:name`);
  });
});
