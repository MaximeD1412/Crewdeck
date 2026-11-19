import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

/** The address the email flow signs up, the scenarios' (`apps/server/src/testing/scenarios/connexion.ts`). */
const ADDRESS = 'pilote@example.com';

/** Fills the sign-in page's field with `email` and sends the form: the sent state. */
const requestLink = async (page: Page, email = ADDRESS): Promise<void> => {
  const connexion = page.locator('cd-page-connexion');
  await connexion.getByRole('textbox', { name: 'Ton adresse e-mail' }).fill(email);
  await connexion.getByRole('button', { name: 'Recevoir un lien' }).click();
  await expect(connexion.getByText(`Lien envoyé à ${email}`)).toBeVisible();
};

/** The path and fragment of the last link the fake mailer holds for `email` (`GET /api/testing/mails`). */
const lastLink = async (page: Page, email = ADDRESS): Promise<string> => {
  const response = await page.request.get(`/api/testing/mails?${new URLSearchParams({ to: email })}`);
  expect(response.status()).toBe(200);
  const { items } = (await response.json()) as { items: { text: string }[] };
  const link = /https?:\/\/\S+\/connexion\/lien#[\w-]{43}/.exec(items[0]?.text ?? '')?.[0];
  expect(link, 'le lien du dernier e-mail').toBeDefined();
  const url = new URL(link ?? '');
  return `${url.pathname}${url.hash}`;
};

/** Opens `/connexion` signed out and signs in with « Continuer avec Google » (the fake Google's account): the Pilote's id. */
const signInWithGoogle = async (page: Page): Promise<string> => {
  await page.context().clearCookies();
  await page.goto('/connexion');
  await page.locator('cd-page-connexion').getByRole('button', { name: 'Continuer avec Google' }).click();
  await expect(page).toHaveURL(/\/(demarrage|a-toi)$/);
  return ((await (await page.request.get('/api/me')).json()) as { id: string }).id;
};

/** Signs in by a link sent to the scenarios' address, from `/connexion` signed out: the Pilote's id. */
const signInByLink = async (page: Page): Promise<string> => {
  await page.context().clearCookies();
  await page.goto('/connexion');
  await requestLink(page);
  await page.goto(await lastLink(page));
  await page.locator('cd-page-connexion-lien').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/(demarrage|a-toi)$/);
  return ((await (await page.request.get('/api/me')).json()) as { id: string }).id;
};

const identitiesOf = async (page: Page): Promise<unknown> => ((await (await page.request.get('/api/me')).json()) as { identities: unknown }).identities;

test.describe('the sign-in (US-1)', () => {
  test('a page signed out lands on /connexion, whose « Continuer avec GitHub » signs in through GitHub and comes back to it', async ({
    page,
    scenario,
    expectAccessible,
  }) => {
    await scenario('connexion');
    await page.goto('/a-toi');

    await expect(page).toHaveURL('/connexion?next=%2Fa-toi');
    const connexion = page.locator('cd-page-connexion');
    await expect(connexion.getByRole('heading', { level: 1, name: 'Bienvenue sur Crewdeck' })).toBeVisible();
    await expect(page.locator('cd-cadre').getByRole('navigation')).toHaveCount(0);
    await expectAccessible(page);

    await connexion.getByRole('button', { name: 'Continuer avec GitHub' }).click();

    // Back on « À toi », which a new Pilote leaves for their « Premiers pas » (US-2).
    await expect(page).toHaveURL('/demarrage');
    const cookies = await page.context().cookies();
    expect(cookies.find((cookie) => cookie.name === 'crewdeck_session')).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    const me = await page.request.get('/api/me');
    expect(me.status()).toBe(200);
    expect(await me.json()).toMatchObject({ displayName: 'octocat', timeZone: 'Europe/Paris', identities: [{ provider: 'github', label: 'octocat' }] });

    // Signed in, /connexion leads to « À toi », hence to « Premiers pas » until they are done.
    await page.goto('/connexion');
    await expect(page).toHaveURL('/demarrage');
  });

  test('a failed sign-in shows why above the button', async ({ page, scenario, expectAccessible }) => {
    await scenario('connexion-erreur');

    await expect(page.getByRole('alert')).toContainText('La connexion n’a pas abouti, recommence.');
    await expect(page.getByRole('button', { name: 'Continuer avec GitHub' })).toBeVisible();
    await expectAccessible(page);
  });

  test('a refused authorization comes back to /connexion with its banner', async ({ page, scenario }) => {
    await scenario('connexion');
    await page.goto('/api/auth/github/callback?error=access_denied&state=x');

    await expect(page).toHaveURL('/connexion?erreur=denied');
    await expect(page.getByRole('alert')).toContainText('Tu as refusé l’accès : Crewdeck en a besoin pour te connecter.');
  });

  test('« Continuer avec Google » signs a new account up, on « Premiers pas »; signed in again, the same Pilote; then a link to its address, the same Pilote still', async ({
    page,
    scenario,
  }) => {
    await scenario('connexion');
    await page.goto('/a-toi');
    await expect(page).toHaveURL('/connexion?next=%2Fa-toi');

    await page.locator('cd-page-connexion').getByRole('button', { name: 'Continuer avec Google' }).click();

    await expect(page).toHaveURL('/demarrage');
    const cookies = await page.context().cookies();
    expect(cookies.find((cookie) => cookie.name === 'crewdeck_session')).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    const me = (await (await page.request.get('/api/me')).json()) as { id: string };
    expect(me).toMatchObject({ displayName: 'pilote', avatarUrl: null, identities: [{ provider: 'google', label: ADDRESS }] });

    expect(await signInWithGoogle(page)).toBe(me.id);
    expect(await signInByLink(page)).toBe(me.id);
    expect(await identitiesOf(page)).toEqual(
      expect.arrayContaining([
        { provider: 'google', label: ADDRESS },
        { provider: 'email', label: ADDRESS },
      ]),
    );
  });

  test('a Pilote signed up by a link who signs in with Google on the same address is the same Pilote, with two Identités', async ({ page, scenario }) => {
    await scenario('connexion');

    const pilotId = await signInByLink(page);
    expect(await signInWithGoogle(page)).toBe(pilotId);

    const identities = await identitiesOf(page);
    expect(identities).toHaveLength(2);
    expect(identities).toEqual(
      expect.arrayContaining([
        { provider: 'email', label: ADDRESS },
        { provider: 'google', label: ADDRESS },
      ]),
    );
  });

  test('a Google address not verified comes back to /connexion with its banner, nobody signed in', async ({ page, scenario, expectAccessible }) => {
    await scenario('connexion-google-non-verifiee');

    await page.locator('cd-page-connexion').getByRole('button', { name: 'Continuer avec Google' }).click();

    await expect(page).toHaveURL('/connexion?erreur=google-unverified');
    await expect(page.getByRole('alert')).toContainText('Ton adresse Google n’est pas vérifiée : vérifie-la chez Google, ou reçois un lien par e-mail.');
    expect((await page.request.get('/api/me')).status()).toBe(401);
    await expectAccessible(page);
  });

  test('a link by email: sent, opened, then « Se connecter » signs a new address up, on « Premiers pas »', async ({ page, scenario, expectAccessible, capture }) => {
    await scenario('connexion');
    await page.goto('/a-toi');
    await expect(page).toHaveURL('/connexion?next=%2Fa-toi');

    await requestLink(page);
    await expectAccessible(page);
    await capture(page, 'connexion-lien-envoye');

    const link = await lastLink(page);
    await page.goto(link);

    // The token leaves the address bar, and opening the link signs nobody in.
    await expect(page).toHaveURL('/connexion/lien');
    const lien = page.locator('cd-page-connexion-lien');
    await expect(lien.getByRole('heading', { level: 1, name: 'Connexion à Crewdeck' })).toBeVisible();
    expect((await page.request.get('/api/me')).status()).toBe(401);
    await expectAccessible(page);
    await capture(page, 'connexion-lien');

    await lien.getByRole('button', { name: 'Se connecter' }).click();

    await expect(page).toHaveURL('/demarrage');
    const me = await page.request.get('/api/me');
    expect(await me.json()).toMatchObject({ displayName: 'pilote', identities: [{ provider: 'email', label: ADDRESS }] });

    // A link serves once: opened again, it asks for a new one.
    await page.context().clearCookies();
    await page.goto(link);
    await page.locator('cd-page-connexion-lien').getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByRole('alert')).toContainText('Ce lien de connexion n’est plus valable : demande-en un nouveau.');
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Recevoir un nouveau lien' }).click();
    await expect(page).toHaveURL(/\/connexion(\?|$)/);
  });

  test('« Changer d’adresse » brings the field back, and a link goes to the new address', async ({ page, scenario }) => {
    await scenario('connexion-lien-envoye');
    await requestLink(page, 'premiere@example.com');

    await page.getByRole('button', { name: 'Changer d’adresse' }).click();
    await requestLink(page, ADDRESS);

    expect(await lastLink(page)).toMatch(/^\/connexion\/lien#[\w-]{43}$/);
  });

  test('the page of a link drawn by the scenario, without violations', async ({ page, scenario, expectAccessible }) => {
    await scenario('connexion-lien');

    await expect(page).toHaveURL('/connexion/lien');
    await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
    await expectAccessible(page);
  });
});
