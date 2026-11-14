import type { DecisionKind, DecisionTone } from '@crewdeck/contracts';
import { newId } from '../../ids.js';
import { defineScenario, type ScenarioContext } from './define.js';
import { signInPilot } from './sign-in.js';

const MINUTE = 60_000;

/** The Projets of the mockup: their table is PROJET-2's, a Décision only names one. */
export const PROJECTS = {
  crewdeck: { projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a01', projectName: 'Crewdeck' },
  personalOs: { projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a02', projectName: 'Personal OS' },
  siteMairie: { projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a03', projectName: 'Site mairie' },
  tennisManager: { projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a04', projectName: 'Tennis Manager' },
} as const;

interface Seeded {
  readonly kind: DecisionKind;
  readonly project: (typeof PROJECTS)[keyof typeof PROJECTS];
  readonly subjectType: string;
  readonly subjectId: string;
  readonly label: string;
  readonly metaParts: readonly string[];
  readonly tone: DecisionTone;
  readonly link: string;
  /** How long it has waited, in minutes. */
  readonly age: number;
}

/** The nine Décisions of `design/screens/crewdeck/a-toi.html`, one of each kind it shows, with their ages. */
const MOCKUP: readonly Seeded[] = [
  { kind: 'ticket-blocked', project: PROJECTS.crewdeck, subjectType: 'ticket', subjectId: '42', label: '#42 Connexion GitHub', metaParts: ['Code'], tone: 'halt', link: '/boucle?ticket=42', age: 4 },
  { kind: 'permission-requested', project: PROJECTS.crewdeck, subjectType: 'session', subjectId: 'session-44', label: 'Code · #44 Liste des Projets', metaParts: ['session'], tone: 'caution', link: '/boucle?ticket=44', age: 2 },
  { kind: 'agent-question', project: PROJECTS.personalOs, subjectType: 'session', subjectId: 'session-agenda', label: 'Concevoir · Agenda partagé', metaParts: ['session'], tone: 'accent', link: '/conceptions', age: 3 },
  { kind: 'limit-reached', project: PROJECTS.personalOs, subjectType: 'ai-account', subjectId: 'claude-5h', label: 'Claude · fenêtre de 5 h', metaParts: ['#51 arrêté'], tone: 'caution', link: '/runner', age: 12 },
  { kind: 'visual-review', project: PROJECTS.personalOs, subjectType: 'ticket', subjectId: '38', label: '#38 Page Planning', metaParts: ['4 captures'], tone: 'accent', link: '/boucle?ticket=38', age: 20 },
  { kind: 'document-review', project: PROJECTS.personalOs, subjectType: 'design', subjectId: 'agenda-partage', label: 'PRD « Agenda partagé »', metaParts: ['Conception'], tone: 'accent', link: '/conceptions', age: 60 },
  { kind: 'ticket-interrupted', project: PROJECTS.siteMairie, subjectType: 'ticket', subjectId: '47', label: '#47 Actualités en page d’accueil', metaParts: ['Code'], tone: 'caution', link: '/boucle?ticket=47', age: 120 },
  { kind: 'inventory-review', project: PROJECTS.tennisManager, subjectType: 'project', subjectId: 'tennis-manager', label: 'Tennis Manager', metaParts: ['Projet existant'], tone: 'accent', link: '/projets', age: 180 },
  { kind: 'contract-incomplete', project: PROJECTS.siteMairie, subjectType: 'design', subjectId: 'actualites', label: 'Découpage « Actualités »', metaParts: ['Tickets'], tone: 'caution', link: '/conceptions', age: 24 * 60 + 60 },
];

/** The Pilote signed in, and the mockup's Décisions open for them, as their modules would have raised them. */
export const seedDecisions = async (ctx: ScenarioContext) => {
  const seed = await signInPilot(ctx);
  const now = Date.now();
  await ctx.prisma.unscoped.decision.createMany({
    data: MOCKUP.map(({ project, age, metaParts, ...decision }) => ({
      id: newId(),
      pilotId: seed.pilotId,
      ...decision,
      ...project,
      metaParts: [...metaParts],
      params: {},
      createdAt: new Date(now - age * MINUTE),
    })),
  });
  return seed;
};

/** « À toi » (`design/screens.json`: `a-toi`): nine open Décisions of four Projets. */
export const aToi = defineScenario({ name: 'a-toi', path: '/a-toi', seed: seedDecisions });

/** « À toi » with nothing waiting (`a-toi`, state `vide`): « Rien ne t’attend ». */
export const aToiVide = defineScenario({ name: 'a-toi-vide', path: '/a-toi', seed: signInPilot });
