/// <reference types="vite/client" />
import './tokens.css';
import './document.css';
import { COMPOSANTS, LINK_ERRORS, t, type ComposantData } from '@crewdeck/sdk';
import { actionsOf, defineSkin, inside, render } from './testing/dom.js';

beforeAll(defineSkin);

afterEach(() => document.body.replaceChildren());

type Data = ComposantData<typeof COMPOSANTS.AccountIdentities>;
const EMAIL = { provider: 'email', label: 'pilote@example.com', reconnect: false } as const;
const GITHUB = { provider: 'github', label: 'octocat', reconnect: false } as const;

const rowsOf = (el: Element) =>
  [...(inside(el, 'cd-card').querySelectorAll('cd-list-row') as NodeListOf<HTMLElement & { data: { title: string; meta?: string } }>)].map(
    (row) => ({ title: row.data.title, meta: row.data.meta, button: (row.querySelector('cd-button') as (HTMLElement & { data: { label: string; variant: string } }) | null)?.data }),
  );

describe('AccountIdentities', () => {
  it('shows a Card « Connexion » with one row per Identité, then GitHub not linked with « Relier GitHub »', async () => {
    const el = await render(COMPOSANTS.AccountIdentities, { identities: [EMAIL], error: null } satisfies Data);
    expect((inside(el, 'cd-card') as HTMLElement & { data: { title: string } }).data.title).toBe('Connexion');
    expect(rowsOf(el)).toEqual([
      { title: 'E-mail', meta: 'pilote@example.com', button: undefined },
      { title: 'GitHub', meta: 'pas relié · pour suivre tes Dépôts GitHub', button: expect.objectContaining({ label: 'Relier GitHub', variant: 'secondary' }) },
    ]);
    expect(el.shadowRoot?.querySelector('cd-banner')).toBeNull();
    // Every row has its icon, so their titles line up.
    const icons = [...(el.shadowRoot?.querySelectorAll('cd-list-row') ?? [])].map((row) => (row as HTMLElement & { data: { icon?: string } }).data.icon);
    expect(icons).toEqual(['inbox', 'github']);
  });

  it('shows a linked GitHub by its login, with nothing to do', async () => {
    const el = await render(COMPOSANTS.AccountIdentities, {
      identities: [{ provider: 'google', label: 'pilote@example.com', reconnect: false }, GITHUB],
      error: null,
    } satisfies Data);
    expect(rowsOf(el)).toEqual([
      { title: 'Google', meta: 'pilote@example.com', button: undefined },
      { title: 'GitHub', meta: 'octocat', button: undefined },
    ]);
  });

  it('offers « Reconnecter GitHub » for a GitHub whose tokens are gone', async () => {
    const el = await render(COMPOSANTS.AccountIdentities, { identities: [EMAIL, { ...GITHUB, reconnect: true }], error: null } satisfies Data);
    expect(rowsOf(el)[1]).toEqual({
      title: 'GitHub',
      meta: 'à reconnecter',
      button: expect.objectContaining({ label: 'Reconnecter GitHub', variant: 'secondary' }),
    });
  });

  it.each([
    ['github-already-linked', 'Ce compte GitHub est déjà relié à un autre compte Crewdeck.'],
    ['github-other-account', 'Ton compte Crewdeck est déjà relié à un autre compte GitHub.'],
    ['denied', t('parametres.identities.error.denied')],
    ['github-unavailable', t('parametres.identities.error.github-unavailable')],
  ] as const)('says why a link failed (%s) in a halt Banner above the rows', async (error, title) => {
    const el = await render(COMPOSANTS.AccountIdentities, { identities: [EMAIL], error } satisfies Data);
    const banner = inside(el, 'cd-banner') as HTMLElement & { data: { tone: string; title: string } };
    expect(banner.data).toMatchObject({ tone: 'halt', title });
    expect(title).not.toMatch(/^parametres\./);
    expect(banner.compareDocumentPosition(inside(el, 'cd-card')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('has a message for every case', () => {
    for (const error of LINK_ERRORS) expect(t(`parametres.identities.error.${error}`)).not.toMatch(/^parametres\./);
  });

  it.each([
    ['Relier GitHub', [EMAIL]],
    ['Reconnecter GitHub', [EMAIL, { ...GITHUB, reconnect: true }]],
  ] as const)('emits linkGitHub from « %s »', async (_label, identities) => {
    const el = await render(COMPOSANTS.AccountIdentities, { identities: [...identities], error: null } satisfies Data);
    expect(await actionsOf(() => inside(el, 'cd-button.link', 'button').click())).toEqual([{ composant: 'AccountIdentities', action: 'linkGitHub', payload: {} }]);
  });

});
