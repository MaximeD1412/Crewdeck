import { expect, test } from './fixtures.js';

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

    await expect(page).toHaveURL('/a-toi');
    const cookies = await page.context().cookies();
    expect(cookies.find((cookie) => cookie.name === 'crewdeck_session')).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    const me = await page.request.get('/api/me');
    expect(me.status()).toBe(200);
    expect(await me.json()).toMatchObject({ login: 'octocat', timeZone: 'Europe/Paris' });

    // Signed in, /connexion leads to « À toi ».
    await page.goto('/connexion');
    await expect(page).toHaveURL('/a-toi');
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
    await expect(page.getByRole('alert')).toContainText('Tu as refusé l’accès à GitHub : Crewdeck en a besoin pour suivre tes Projets.');
  });
});
