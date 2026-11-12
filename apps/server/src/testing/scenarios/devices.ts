import { DEVICE_CODE_TTL_SECONDS } from '@crewdeck/contracts';
import { randomBytes } from 'node:crypto';
import { newId } from '../../ids.js';
import { defineScenario, type ScenarioContext } from './define.js';
import { signInPilot } from './sign-in.js';

/** The short id of the expired code the scenario `appareils` keeps: a trusted Appareil pasting it is refused. */
export const EXPIRED_DEVICE_SHORT_ID = '7K2Q';

/** The Pilote's first Appareil, trusted from another browser: this one has no Appareil, its vault closed. */
const withTrustedElsewhere = async (ctx: ScenarioContext) => {
  const seed = await signInPilot(ctx);
  const approvedAt = new Date('2026-11-03T09:00:00.000Z');
  await ctx.prisma.unscoped.device.create({
    data: { id: newId(), pilotId: seed.pilotId, name: 'Firefox sur Linux', publicKey: randomBytes(32), state: 'trusted', approvedAt, createdAt: approvedAt },
  });
  return seed;
};

/**
 * A new Appareil (E2E-3, US-60): the Pilote signed in from a browser that
 * holds no Appareil while another one is trusted. The Cadre's Banner offers
 * « Approuver cet Appareil »; the state `code` opens its dialog (QR code and
 * code).
 */
export const appareilAApprouver = defineScenario({ name: 'appareil-a-approuver', path: '/a-toi', seed: withTrustedElsewhere });
export const appareilAApprouverCode = defineScenario({ name: 'appareil-a-approuver-code', path: '/a-toi', seed: withTrustedElsewhere });

/** The Pilote before their first Appareil, with the code of a new Appareil that expired before any approval. */
const beforeFirstAppareil = async (ctx: ScenarioContext) => {
  const seed = await signInPilot(ctx, { gettingStartedStep: 'runner' });
  const expiresAt = new Date(Date.now() - 60_000);
  await ctx.prisma.unscoped.device.create({
    data: {
      id: newId(),
      pilotId: seed.pilotId,
      name: 'Safari sur iOS',
      publicKey: randomBytes(32),
      shortId: EXPIRED_DEVICE_SHORT_ID,
      proof: randomBytes(32),
      expiresAt,
      createdAt: new Date(expiresAt.getTime() - DEVICE_CODE_TTL_SECONDS * 1000),
    },
  });
  return seed;
};

/**
 * The Appareils of the Paramètres (E2E-3): the Pilote at the Runner's step,
 * so that this browser becomes their first trusted Appareil by linking it,
 * its vault open (an Appareil is trusted only through a real key exchange,
 * never seeded into a page). The spec or the capture links it, then opens
 * `/parametres`: the « Appareils » card with its OPS-1 Banner; the state
 * `ajouter` opens « Ajouter un Appareil ». An expired code of a new Appareil
 * stays, `7K2Q`.
 */
export const appareils = defineScenario({ name: 'appareils', path: '/demarrage', seed: beforeFirstAppareil });
export const appareilsAjouter = defineScenario({ name: 'appareils-ajouter', path: '/demarrage', seed: beforeFirstAppareil });
