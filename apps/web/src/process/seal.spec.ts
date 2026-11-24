import { processSealAad, templateSealAad } from '@crewdeck/contracts';
import { fakeSealed, fakeVault } from '../projects/testing.js';
import { withOpenedProcess } from './seal.js';

const PROJECT = '019a6f00-0000-7000-8000-000000000011';
const TEMPLATE = '019a6f00-0000-7000-8000-0000000000a1';
const OTHER = '019a6f00-0000-7000-8000-000000000012';
const COMMANDS = JSON.stringify({ e2e: 'pnpm exec playwright test' });

describe('withOpenedProcess', () => {
  it('opens the part under process:<projectId> once, and seals it under each additional data asked, and back', async () => {
    const vault = fakeVault();
    const sealed = await fakeSealed(COMMANDS, processSealAad(PROJECT));
    const opened = vi.spyOn(vault, 'openItem');

    const [forTemplate, forOther] = await withOpenedProcess(vault, sealed, processSealAad(PROJECT), async (sealUnder) => [await sealUnder(templateSealAad(TEMPLATE)), await sealUnder(processSealAad(OTHER))]);

    expect(opened).toHaveBeenCalledTimes(1);
    expect(forTemplate).toEqual({ sealed: await fakeSealed(COMMANDS, templateSealAad(TEMPLATE)), vaultKeyVersion: 1 });
    expect(forOther?.sealed).toEqual(await fakeSealed(COMMANDS, processSealAad(OTHER)));
    expect(await withOpenedProcess(vault, forTemplate!.sealed, templateSealAad(TEMPLATE), async (sealUnder) => (await sealUnder(processSealAad(PROJECT)))?.sealed)).toEqual(sealed);
  });

  it('says the version of the vault key each seal was under, for the write to carry (E2E-4)', async () => {
    const vault = fakeVault();
    const sealed = await fakeSealed(COMMANDS, processSealAad(PROJECT));

    const versions = await withOpenedProcess(vault, sealed, processSealAad(PROJECT), async (sealUnder) => {
      const before = (await sealUnder(templateSealAad(TEMPLATE)))?.vaultKeyVersion;
      vault.version = 2;
      return [before, (await sealUnder(templateSealAad(TEMPLATE)))?.vaultKeyVersion];
    });

    expect(versions).toEqual([1, 2]);
  });

  it('overwrites the plaintext once done, even refused', async () => {
    const vault = fakeVault();
    let plaintext: Uint8Array | undefined;
    vi.spyOn(vault, 'sealItem').mockImplementation(async (bytes) => {
      plaintext = bytes;
      throw new Error('refused');
    });

    await expect(withOpenedProcess(vault, await fakeSealed(COMMANDS, processSealAad(PROJECT)), processSealAad(PROJECT), (sealUnder) => sealUnder(templateSealAad(TEMPLATE)))).rejects.toThrow('refused');
    expect(plaintext?.every((byte) => byte === 0)).toBe(true);
  });

  it('keeps null for a Process without Commande', async () => {
    expect(await withOpenedProcess(fakeVault(), null, processSealAad(PROJECT), (sealUnder) => sealUnder(templateSealAad(TEMPLATE)))).toBeNull();
  });

  it('throws for a part that does not open under the additional data given', async () => {
    const sealed = await fakeSealed(COMMANDS, templateSealAad(TEMPLATE));

    await expect(withOpenedProcess(fakeVault(), sealed, processSealAad(PROJECT), (sealUnder) => sealUnder(templateSealAad(TEMPLATE)))).rejects.toThrow();
  });
});
