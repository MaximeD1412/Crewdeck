import { z } from 'zod';
import { defineComposant } from './define.js';

/** The states of a Ticket as its row shows them, each with its badge (`ticketRow.state.<state>`). */
export const TICKET_ROW_STATES = [
  'pret',
  'en-cours',
  'en-review',
  'checks',
  'bloque',
  'revue-visuelle',
  'interrompu',
  'merge',
  'attente',
] as const;

type Data = {
  number: number;
  title: string;
  meta: string | null;
  state: (typeof TICKET_ROW_STATES)[number];
  label?: string | null;
  context?: string | null;
  href?: string | null;
};

const ticket = (name: string, data: Data, actions?: string) => ({
  name,
  data: { label: null, context: null, href: null, ...data },
  ...(actions ? { slots: { actions } } : {}),
});

/**
 * A Ticket in the Boucle, the planning or a Conception (BOUCLE-2,
 * PILOTAGE-1): `#<number>` in mono, its title, its state in a badge whose
 * label `label` may override (the Étape it is at). With `href` the row is a
 * link; its buttons (`actions`) are the page's.
 */
export const TicketRow = defineComposant({
  name: 'TicketRow',
  version: 1,
  tag: 'cd-ticket-row',
  category: 'partie',
  description: 'Un Ticket : son numéro, son titre et son état ; un lien quand il mène quelque part.',
  data: z.object({
    number: z.int().positive(),
    title: z.string(),
    meta: z.string().nullable(),
    state: z.enum(TICKET_ROW_STATES),
    label: z.string().nullable(),
    context: z.string().nullable(),
    href: z.string().nullable(),
  }),
  actions: {},
  slots: ['actions'],
  examples: [
    ticket('prêt', { number: 48, title: 'Agenda des conseils municipaux', meta: 'jalon Actualités', state: 'pret' }),
    ticket('en cours, un lien', {
      number: 53,
      title: 'Export du planning',
      meta: 'Personal OS · Code · depuis 6 min',
      state: 'en-cours',
      href: '/boucle?ticket=53',
    }),
    ticket('en review', { number: 44, title: 'Liste des Projets', meta: 'Crewdeck · Revue croisée', state: 'en-review' }),
    ticket('checks, son libellé', {
      number: 45,
      title: 'Filtre par Projet',
      meta: 'Crewdeck · 3 checks sur 5',
      state: 'checks',
      label: 'Checks 3/5',
    }),
    ticket('bloqué', {
      number: 42,
      title: 'Connexion GitHub',
      meta: 'Crewdeck · Code',
      state: 'bloque',
      context: 'L’agent ne trouve pas comment tester le renouvellement du jeton.',
    }),
    ticket('revue visuelle', { number: 38, title: 'Page Planning', meta: 'Personal OS · 4 captures', state: 'revue-visuelle' }),
    ticket(
      'interrompu, un bouton',
      { number: 47, title: 'Actualités en page d’accueil', meta: 'Code · le Runner s’est arrêté', state: 'interrompu' },
      `<cd-button data='{"label":"Reprendre","variant":"secondary","size":"sm"}'></cd-button>`,
    ),
    ticket('mergé', { number: 41, title: 'Page d’accueil', meta: 'jalon Actualités · hier', state: 'merge' }),
    ticket('en attente', { number: 58, title: 'Impression du planning', meta: 'jalon Planning · bloqué par #38', state: 'attente' }),
  ],
});
