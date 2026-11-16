import { randomBytes } from 'node:crypto';
import { LINK_CODE_TTL_SECONDS, PROCESS_CREWDECK, PROCESS_CREWDECK_NAME } from '@crewdeck/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { newId } from '../../ids.js';
import { drawShortId } from '../../runners/link/runner-links.service.js';
import { base32, generatePrivateKey, publicKeyOf } from '../smoke-keys.js';
import { defineScenario } from './define.js';
import { signInPilot } from './sign-in.js';

/** The Projet of the smoke test: the Runner clones `smoke/depot` from its `--github-url`, a folder of bare repositories. */
export const SMOKE_REPOSITORY = { owner: 'smoke', name: 'depot', branch: 'main' } as const;

/** The PR the Contrat check of the smoke test reads, on the fake GitHub. */
export const SMOKE_PULL_REQUEST = { head: 'feat/1-smoke', body: 'Le smoke test du Runner compilé.\n\nCloses #1\n', labels: ['conception'] } as const;

/**
 * The smoke test of the compiled Runner (RUNNER-14, `apps/runner/smoke/`): a
 * Pilote, a Projet on `smoke/depot` and a link code drawn as the page draws
 * it, its secret and its Appareil's key kept by the fake (`fakes.smoke`) for
 * `/api/testing/smoke/*`. The Projet has no Dépôt GitHub row: the Miroir
 * follows nothing, the Runner never calls GitHub. The fake GitHub holds its
 * PR #1, which the example Contrat's `pr` rule reads at `/fake-github`.
 */
export const smoke = defineScenario({
  name: 'smoke',
  path: '/',
  seed: async (ctx) => {
    const seed = await signInPilot(ctx);
    const { pilotId } = seed;
    const { owner, name, branch } = SMOKE_REPOSITORY;
    const projectId = newId();
    await ctx.prisma.unscoped.project.create({
      data: {
        id: projectId,
        pilotId,
        repositoryId: newId(),
        githubRepoId: BigInt(73000001),
        owner,
        name,
        fullName: `${owner}/${name}`,
        displayName: 'Smoke test',
        releaseBranch: branch,
        integrationBranch: branch,
        hasCode: true,
        inventoryState: 'not_needed',
      },
    });
    await ctx.prisma.unscoped.artifactSource.createMany({
      data: (['ticket', 'code'] as const).map((group) => ({ id: newId(), pilotId, projectId, group, source: 'github' as const, since: new Date() })),
    });
    await ctx.prisma.unscoped.processVersion.create({
      data: {
        id: newId(),
        pilotId,
        projectId,
        number: 1,
        definition: PROCESS_CREWDECK as unknown as Prisma.InputJsonValue,
        sealed: Prisma.DbNull,
        activatedAt: new Date(),
        activatedBy: 'creation',
        templateName: PROCESS_CREWDECK_NAME,
      },
    });

    const repo = ctx.fakes.github.seedRepo({ owner, name, defaultBranch: branch, files: { 'README.md': '# Dépôt du smoke test\n' } });
    await ctx.fakes.github.pushCommit(repo, SMOKE_PULL_REQUEST.head, { 'src/index.ts': '// smoke\n' });
    const pr = await ctx.fakes.github.createPullRequest(repo, { head: SMOKE_PULL_REQUEST.head, base: branch, title: 'Smoke test', draft: false });
    ctx.fakes.github.describePullRequest(repo, pr.number, { body: SMOKE_PULL_REQUEST.body });
    await ctx.fakes.github.addLabels(repo, pr.number, [...SMOKE_PULL_REQUEST.labels]);

    // The page's code: its Appareil's key pair and the secret of the command, drawn on its side.
    const devicePrivateKey = generatePrivateKey();
    const devicePublicKey = publicKeyOf(devicePrivateKey);
    const secret = randomBytes(16);
    const now = new Date();
    const deviceId = newId();
    await ctx.prisma.unscoped.device.create({ data: { id: deviceId, pilotId, name: 'Smoke test', publicKey: new Uint8Array(devicePublicKey), createdAt: now } });
    const linkCodeId = newId();
    const shortId = drawShortId();
    await ctx.prisma.unscoped.runnerLinkCode.create({
      data: {
        id: linkCodeId,
        pilotId,
        shortId,
        deviceId,
        browserPairing: { devicePublicKey: devicePublicKey.toString('base64url'), deviceName: 'Smoke test' },
        expiresAt: new Date(now.getTime() + LINK_CODE_TTL_SECONDS * 1000),
        createdAt: now,
      },
    });
    const confirmToken = randomBytes(24).toString('base64url');
    ctx.fakes.smoke.keep({ confirmToken, pilotId, projectId, linkCodeId, shortId, secret, deviceId, devicePrivateKey });
    return { ...seed, runnerLink: { code: `${shortId}-${base32(secret)}`, confirmToken } };
  },
});
