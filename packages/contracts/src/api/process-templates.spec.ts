import {
  eventPayloadSchema,
  isReservedProcessTemplateName,
  processTemplateNameKey,
  RESOURCES,
  STATE_SLICES,
  zProcessTemplate,
  zRenameProcessTemplateInput,
  zSaveProcessTemplateInput,
} from '../index.js';

const SEALED = { key: 'A'.repeat(80), ciphertext: 'B'.repeat(43) };

const TEMPLATE = {
  id: '019a6f00-0000-7000-8000-0000000000a1',
  name: 'Process Site mairie',
  fromProjectId: '019a6f00-0000-7000-8000-000000000011',
  fromVersionNumber: 3,
  sealed: SEALED,
  commandCount: 1,
  revision: 1,
  createdAt: '2026-11-12T08:30:00.000Z',
  updatedAt: '2026-11-12T08:30:00.000Z',
};

describe('zProcessTemplate', () => {
  it('is an item of the processTemplates slice, the payload of process-template.upserted and .removed', () => {
    expect(RESOURCES).toContain('process-template');
    expect(STATE_SLICES.processTemplates.parse([TEMPLATE])).toEqual([TEMPLATE]);
    expect(eventPayloadSchema('process-template.upserted')?.parse(TEMPLATE)).toEqual(TEMPLATE);
    expect(eventPayloadSchema('process-template.removed')?.parse({ id: TEMPLATE.id })).toEqual({ id: TEMPLATE.id });
  });

  it('keeps no definition, and its Projet null once deleted', () => {
    expect(Object.keys(zProcessTemplate.parse({ ...TEMPLATE, definition: {} }))).not.toContain('definition');
    expect(zProcessTemplate.parse({ ...TEMPLATE, fromProjectId: null }).fromProjectId).toBeNull();
  });
});

describe('zSaveProcessTemplateInput and zRenameProcessTemplateInput', () => {
  const SAVE = { id: TEMPLATE.id, name: 'Process Site mairie', projectId: TEMPLATE.fromProjectId, versionNumber: 3, sealed: SEALED, vaultKeyVersion: 2, replace: false };

  it('saves a version under a page-drawn id and a name of 1 to 80 characters, trimmed', () => {
    expect(zSaveProcessTemplateInput.parse(SAVE)).toEqual(SAVE);
    expect(zSaveProcessTemplateInput.parse({ ...SAVE, name: '  Mon process  ' }).name).toBe('Mon process');
    expect(zSaveProcessTemplateInput.safeParse({ ...SAVE, name: '   ' }).success).toBe(false);
    expect(zSaveProcessTemplateInput.safeParse({ ...SAVE, name: 'x'.repeat(81) }).success).toBe(false);
    expect(zSaveProcessTemplateInput.safeParse({ ...SAVE, id: 'modele' }).success).toBe(false);
    expect(zSaveProcessTemplateInput.safeParse({ ...SAVE, versionNumber: 0 }).success).toBe(false);
    expect(zSaveProcessTemplateInput.safeParse({ ...SAVE, replace: undefined }).success).toBe(false);
    expect(zSaveProcessTemplateInput.parse({ ...SAVE, sealed: null }).sealed).toBeNull();
  });

  it('carries the version of the vault key its sealed part was sealed under, required with one', () => {
    expect(zSaveProcessTemplateInput.safeParse({ ...SAVE, vaultKeyVersion: undefined }).success).toBe(false);
    expect(zSaveProcessTemplateInput.safeParse({ ...SAVE, vaultKeyVersion: 0 }).success).toBe(false);
    expect(zSaveProcessTemplateInput.parse({ ...SAVE, sealed: null, vaultKeyVersion: undefined }).vaultKeyVersion).toBeUndefined();
  });

  it('counts a Modèle’s contents by its revision, from 1', () => {
    expect(zProcessTemplate.safeParse({ ...TEMPLATE, revision: 0 }).success).toBe(false);
    expect(zProcessTemplate.safeParse({ ...TEMPLATE, revision: undefined }).success).toBe(false);
  });

  it('renames under the same rules', () => {
    expect(zRenameProcessTemplateInput.parse({ name: ' Autre ' })).toEqual({ name: 'Autre' });
    expect(zRenameProcessTemplateInput.safeParse({ name: '' }).success).toBe(false);
  });

  it('compares names regardless of case and outer spaces, « Process Crewdeck » being the release’s', () => {
    expect(processTemplateNameKey('  Process SITE Mairie ')).toBe('process site mairie');
    expect(isReservedProcessTemplateName(' process crewdeck ')).toBe(true);
    expect(isReservedProcessTemplateName('Process Crewdeck 2')).toBe(false);
  });
});
