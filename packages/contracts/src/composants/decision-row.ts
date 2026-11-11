import { z } from 'zod';
import { zId } from '../values.js';
import { defineComposant } from './define.js';
import { zIconName } from './icons.js';
import { zTone } from './tone.js';

const button = (label: string, variant: 'primary' | 'secondary' = 'secondary') =>
  `<cd-button data='${JSON.stringify({ label, variant, size: 'sm' })}'></cd-button>`;

const row = (
  name: string,
  id: string,
  data: { kind: string; title: string; meta: string; context: string; tone: z.input<typeof zTone>; icon: z.input<typeof zIconName> },
  actions: string,
  badges?: string,
) => ({ name, data: { id, ...data }, slots: { actions, ...(badges ? { badges } : {}) } });

/**
 * A Décision of « À toi » (ATOI-1): its rail, its icon box and its kind carry
 * its state. `kind` is the kind's label, computed by the view from the
 * Décision's `kind` (the enum of the Décisions' API), so that a new kind needs
 * no new version of this Composant. Its buttons are the page's, in `actions`;
 * a click on the row outside them emits `open`.
 */
export const DecisionRow = defineComposant({
  name: 'DecisionRow',
  version: 1,
  tag: 'cd-decision-row',
  category: 'partie',
  description: 'Une Décision de « À toi » : son genre, son titre, son contexte et ses boutons.',
  data: z.object({
    id: zId,
    kind: z.string(),
    title: z.string(),
    meta: z.string(),
    context: z.string().nullable(),
    tone: zTone,
    icon: zIconName,
  }),
  actions: { open: z.object({ id: zId }) },
  slots: ['actions', 'badges'],
  examples: [
    row(
      'Ticket bloqué',
      '0193a4f2-7c1e-7a10-8b2c-000000000001',
      {
        kind: 'Ticket bloqué',
        title: '#42 Connexion GitHub',
        meta: 'Crewdeck · Code · il y a 4 min',
        context: 'L’agent ne trouve pas comment tester le renouvellement du jeton.',
        tone: 'halt',
        icon: 'block',
      },
      button('Ouvrir'),
    ),
    row(
      'Permission demandée',
      '0193a4f2-7c1e-7a10-8b2c-000000000002',
      {
        kind: 'Permission demandée',
        title: 'Code · #44 Liste des Projets',
        meta: 'Crewdeck · session · il y a 2 min',
        context: 'Bash : git push origin feat/44-liste-des-projets',
        tone: 'caution',
        icon: 'shield',
      },
      button('Ouvrir'),
    ),
    row(
      'Question de l’agent',
      '0193a4f2-7c1e-7a10-8b2c-000000000003',
      {
        kind: 'Question de l’agent',
        title: 'Concevoir · Agenda partagé',
        meta: 'Personal OS · session · il y a 3 min',
        context: 'Les membres de la famille voient-ils les agendas des autres en lecture seule ?',
        tone: 'accent',
        icon: 'info',
      },
      button('Répondre'),
    ),
    row(
      'Limite atteinte, deux boutons',
      '0193a4f2-7c1e-7a10-8b2c-000000000004',
      {
        kind: 'Limite atteinte',
        title: 'Claude · fenêtre de 5 h',
        meta: 'Personal OS · #51 arrêté · il y a 12 min',
        context: '#51 reprend à la réinitialisation, à 16:40. Sinon, passe le Rôle Code sur Codex.',
        tone: 'caution',
        icon: 'gauge',
      },
      button('Attendre 16:40') + button('Passer sur Codex'),
    ),
    row(
      'Revue visuelle, un signal',
      '0193a4f2-7c1e-7a10-8b2c-000000000005',
      {
        kind: 'Revue visuelle',
        title: '#38 Page Planning',
        meta: 'Personal OS · 4 captures · il y a 20 min',
        context: 'Review et checks passés ; la Boucle continue avec les Tickets qui n’en dépendent pas.',
        tone: 'accent',
        icon: 'eye',
      },
      button('Relire', 'primary'),
      `<cd-status-badge data='{"tone":"go","label":"checks passés"}'></cd-status-badge>`,
    ),
    row(
      'Conception à relire',
      '0193a4f2-7c1e-7a10-8b2c-000000000006',
      {
        kind: 'Conception à relire',
        title: 'PRD « Agenda partagé »',
        meta: 'Personal OS · Conception · il y a 1 h',
        context: '12 stories, 2 questions ouvertes.',
        tone: 'accent',
        icon: 'doc',
      },
      button('Relire'),
    ),
    row(
      'Ticket interrompu',
      '0193a4f2-7c1e-7a10-8b2c-000000000007',
      {
        kind: 'Ticket interrompu',
        title: '#47 Actualités en page d’accueil',
        meta: 'Site mairie · Code · il y a 2 h',
        context: 'Le Runner s’est arrêté pendant le Code.',
        tone: 'caution',
        icon: 'bolt',
      },
      button('Reprendre'),
    ),
    row(
      'Inventaire à approuver',
      '0193a4f2-7c1e-7a10-8b2c-000000000008',
      {
        kind: 'Inventaire à approuver',
        title: 'Tennis Manager',
        meta: 'Tennis Manager · Projet existant · il y a 3 h',
        context: 'Glossaire, choix techniques et inventaire rédigés depuis le code : à approuver avant le Process.',
        tone: 'accent',
        icon: 'folder',
      },
      button('Relire'),
    ),
    row(
      'Contrat incomplet',
      '0193a4f2-7c1e-7a10-8b2c-000000000009',
      {
        kind: 'Contrat incomplet',
        title: 'Découpage « Actualités »',
        meta: 'Site mairie · Tickets · hier',
        context: '2 Tickets sans critère d’acceptation.',
        tone: 'caution',
        icon: 'contract',
      },
      button('Voir'),
    ),
  ],
});
