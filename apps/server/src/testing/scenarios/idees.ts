import { ideaItemAad, vaultWrapAad, type IdeaState, type ScenarioDevice } from '@crewdeck/contracts';
import { randomBytes } from 'node:crypto';
import { ideaStateRow } from '../../ideas/idea.view.js';
import { triageLabel } from '../../ideas/triage-decision.js';
import { newId } from '../../ids.js';
import { publicKeyFor, sealItem, sealWrap } from '../vault.js';
import { defineScenario, type ScenarioContext } from './define.js';
import { seedRepositories } from './projets.js';
import { signInPilot } from './sign-in.js';

const MINUTE = 60_000;
const VAULT_WRAP_INFO = 'crewdeck/v1/vault-wrap';

/**
 * The Pilote's first Appareil, trusted, its vault key of version 1 wrapped
 * for itself as a first link leaves it (E2E-2). Its keys are drawn at each
 * run: the browser of the test installs them, nothing else knows them.
 */
export const seedTrustedDevice = async (ctx: ScenarioContext, pilotId: string): Promise<{ device: ScenarioDevice; vaultKey: Buffer }> => {
  const privateKey = randomBytes(32);
  const publicKey = publicKeyFor(privateKey);
  const vaultKey = randomBytes(32);
  const deviceId = newId();
  const now = new Date();
  await ctx.prisma.unscoped.device.create({ data: { id: deviceId, pilotId, name: 'Chrome sur Linux', publicKey: new Uint8Array(publicKey), state: 'trusted', approvedAt: now, lastSeenAt: now } });
  const wrap = sealWrap(privateKey, publicKey, vaultKey, VAULT_WRAP_INFO, vaultWrapAad(deviceId, 1));
  await ctx.prisma.unscoped.vaultKeyWrap.create({ data: { id: newId(), pilotId, holderType: 'device', holderId: deviceId, vaultKeyVersion: 1, enc: new Uint8Array(wrap.enc), ciphertext: new Uint8Array(wrap.ciphertext), tag: new Uint8Array(wrap.tag), createdAt: now } });
  await ctx.prisma.unscoped.pilot.update({ where: { id: pilotId }, data: { vaultKeyVersion: 1 } });
  return { device: { deviceId, privateKey: privateKey.toString('base64url'), publicKey: publicKey.toString('base64url') }, vaultKey };
};

interface SeededIdea {
  readonly number: number;
  readonly project: string | null;
  readonly state: IdeaState;
  readonly text: string;
  /** How long ago it was noted, in minutes. */
  readonly age: number;
}

/**
 * The Idées of `design/screens/crewdeck/idees.html`: #61 to #64 to triage,
 * and some already triaged for the other tabs; #52, rejected 120 days ago,
 * is beyond the snapshot's 90 days, for « Rejetées » to read it from
 * `GET /api/ideas`.
 */
const MOCKUP: readonly SeededIdea[] = [
  { number: 52, project: 'Tennis Manager', state: 'rejected', text: 'Un classement par âge des joueurs', age: 120 * 24 * 60 },
  { number: 55, project: 'Site mairie', state: 'rejected', text: 'Un thème sombre pour le site de la mairie', age: 12 * 24 * 60 },
  { number: 57, project: 'Personal OS', state: 'merged', text: 'Envoyer le planning par e-mail', age: 9 * 24 * 60 },
  { number: 58, project: 'Personal OS', state: 'retained', text: 'Imprimer le planning de la semaine', age: 7 * 24 * 60 },
  { number: 60, project: 'Tennis Manager', state: 'retained', text: 'Classer les joueurs par niveau', age: 5 * 24 * 60 },
  {
    number: 61,
    project: 'Personal OS',
    state: 'to-triage',
    text: 'Chercher dans les recettes par ingrédient\nUne recherche des recettes qui contiennent un ingrédient donné.',
    age: 3 * 24 * 60,
  },
  {
    number: 62,
    project: 'Site mairie',
    state: 'to-triage',
    text: 'Corriger la date des actualités sur le téléphone\nLa date des actualités s’affiche en anglais sur le téléphone.',
    age: 24 * 60 + 60,
  },
  {
    number: 63,
    project: 'Personal OS',
    state: 'to-triage',
    text: 'Exporter le planning en PDF pour le client\nUn bouton qui produit le planning de la semaine en PDF, à envoyer au client.',
    age: 120,
  },
  { number: 64, project: 'Crewdeck', state: 'to-triage', text: 'Prévenir quand une Planification démarre la Boucle', age: 5 },
];

/** The mockup's four Projets, as « Projets » follows them. */
const seedProjects = async (ctx: ScenarioContext, pilotId: string): Promise<Map<string, string>> => {
  await seedRepositories(ctx, pilotId, [
    { name: 'crewdeck', hasCode: true, project: 'Crewdeck' },
    { name: 'personal-os', hasCode: true, project: 'Personal OS' },
    { name: 'site-mairie', hasCode: true, project: 'Site mairie' },
    { name: 'tennis-manager', hasCode: true, project: 'Tennis Manager' },
  ]);
  const projects = await ctx.prisma.unscoped.project.findMany({ where: { pilotId }, select: { id: true, displayName: true } });
  return new Map(projects.map((project) => [project.displayName, project.id]));
};

/**
 * The Pilote's Idées sealed under the vault key as the page seals them
 * (`"<id>:text"`), the count of Idées noted their last number, and the
 * Décision « N Idées à trier » as `syncIdeasToTriage` leaves it.
 */
const seedIdeas = async (ctx: ScenarioContext, pilotId: string, vaultKey: Buffer, projects: Map<string, string>, ideas: readonly SeededIdea[]): Promise<void> => {
  const now = Date.now();
  for (const { number, project, state, text, age } of ideas) {
    const id = newId();
    const at = new Date(now - age * MINUTE);
    const triaged = state !== 'to-triage';
    await ctx.prisma.unscoped.idea.create({
      data: {
        id,
        pilotId,
        number,
        projectId: project === null ? null : (projects.get(project) ?? null),
        state: ideaStateRow(state),
        text: { ...sealItem(vaultKey, text, ideaItemAad(id, 'text')) },
        notedFrom: number % 2 === 0 ? 'telephone' : 'pc',
        createdAt: at,
        updatedAt: triaged ? new Date(at.getTime() + 60 * MINUTE) : at,
        triagedAt: triaged ? new Date(at.getTime() + 60 * MINUTE) : null,
      },
    });
  }
  await ctx.prisma.unscoped.pilot.update({ where: { id: pilotId }, data: { ideaSeq: Math.max(0, ...ideas.map((idea) => idea.number)) } });
  const toTriage = ideas.filter((idea) => idea.state === 'to-triage').length;
  if (toTriage === 0) return;
  await ctx.prisma.unscoped.decision.create({
    data: {
      id: newId(),
      pilotId,
      kind: 'ideas-to-triage',
      projectId: null,
      projectName: null,
      subjectType: 'pilot',
      subjectId: pilotId,
      label: triageLabel(toTriage),
      metaParts: [],
      tone: 'accent',
      link: '/idees',
      params: { count: toTriage },
      createdAt: new Date(now - 5 * MINUTE),
    },
  });
};

const seedIdees = async (ctx: ScenarioContext, ideas: readonly SeededIdea[]) => {
  const seed = await signInPilot(ctx);
  const projects = await seedProjects(ctx, seed.pilotId);
  const { device, vaultKey } = await seedTrustedDevice(ctx, seed.pilotId);
  await seedIdeas(ctx, seed.pilotId, vaultKey, projects, ideas);
  return { ...seed, device };
};

/** « Idées » (`design/screens.json`: `idees`): four Idées to triage over three Projets, others retained, merged, rejected. */
export const idees = defineScenario({ name: 'idees', path: '/idees', seed: (ctx) => seedIdees(ctx, MOCKUP) });

/** « Noter une Idée » (`idees`, state `nouvelle`): the same Idées, the Dialog opened by the test. */
export const ideesNouvelle = defineScenario({ name: 'idees-nouvelle', path: '/idees', seed: (ctx) => seedIdees(ctx, MOCKUP) });

/** No Idée yet (`idees`, state `vide`): « Aucune Idée pour l’instant », the Projets followed and the Appareil trusted. */
export const ideesVide = defineScenario({ name: 'idees-vide', path: '/idees', seed: (ctx) => seedIdees(ctx, []) });
