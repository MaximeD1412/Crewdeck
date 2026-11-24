import { processSealAad, templateSealAad } from '@crewdeck/contracts';
import { fakeSealed, fakeVault } from '../projects/testing.js';
import { resealProcess } from './seal.js';

const PROJECT = '019a6f00-0000-7000-8000-000000000011';
const TEMPLATE = '019a6f00-0000-7000-8000-0000000000a1';
const COMMANDS = JSON.stringify({ e2e: 'pnpm exec playwright test' });

describe('resealProcess', () => {
  it('opens the part under process:<projectId> and seals it under template:<templateId>, and back', async () => {
    const vault = fakeVault();
    const sealed = await fakeSealed(COMMANDS, processSealAad(PROJECT));

    const forTemplate = await resealProcess(vault, sealed, processSealAad(PROJECT), templateSealAad(TEMPLATE));

    expect(forTemplate).toEqual(await fakeSealed(COMMANDS, templateSealAad(TEMPLATE)));
    expect(await resealProcess(vault, forTemplate, templateSealAad(TEMPLATE), processSealAad(PROJECT))).toEqual(sealed);
  });

  it('keeps null for a Process without Commande', async () => {
    expect(await resealProcess(fakeVault(), null, processSealAad(PROJECT), templateSealAad(TEMPLATE))).toBeNull();
  });

  it('throws for a part that does not open under the additional data given', async () => {
    const sealed = await fakeSealed(COMMANDS, templateSealAad(TEMPLATE));

    await expect(resealProcess(fakeVault(), sealed, processSealAad(PROJECT), templateSealAad(TEMPLATE))).rejects.toThrow();
  });
});
