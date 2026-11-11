import { z } from 'zod';
import { zId } from '../values.js';
import { defineComposant } from './define.js';

/** The states of an Idée as its row shows them, each with its badge (`ideaRow.state.<state>`). */
export const IDEA_ROW_STATES = ['en-analyse', 'a-trier', 'analysee', 'retenue', 'fusionnee', 'rejetee'] as const;

/**
 * An Idée in the Idées (IDEE-1): its state in a badge, the summary of its
 * analysis, its impact, its effort and its possible duplicates. A click on
 * the row outside its buttons (`actions`) emits `open`.
 */
export const IdeaRow = defineComposant({
  name: 'IdeaRow',
  version: 1,
  tag: 'cd-idea-row',
  category: 'partie',
  description: 'Une Idée : son état, le résumé de son analyse, son impact, son effort et ses doublons possibles.',
  data: z.object({
    id: zId,
    title: z.string(),
    meta: z.string(),
    state: z.enum(IDEA_ROW_STATES),
    summary: z.string().nullable(),
    impact: z.string().nullable(),
    effort: z.string().nullable(),
    duplicates: z.string().nullable(),
    selected: z.boolean(),
  }),
  actions: { open: z.object({ id: zId }) },
  slots: ['actions'],
  examples: [
    {
      name: 'en analyse',
      data: {
        id: '0193a4f2-7c1e-7a10-8c2c-000000000064',
        title: 'Prévenir quand une Planification démarre la Boucle',
        meta: '#64 · Crewdeck · il y a 5 min',
        state: 'en-analyse',
        summary: null,
        impact: null,
        effort: null,
        duplicates: null,
        selected: false,
      },
    },
    {
      name: 'à trier, son analyse échouée',
      data: {
        id: '0193a4f2-7c1e-7a10-8c2c-000000000065',
        title: 'Prévenir quand une Planification démarre la Boucle',
        meta: '#65 · Crewdeck · il y a 5 min',
        state: 'a-trier',
        summary: 'L’analyse a échoué : son Contrat n’est pas rempli (ni résumé, ni impact, ni effort).',
        impact: null,
        effort: null,
        duplicates: null,
        selected: false,
      },
      slots: {
        actions: `<cd-status-badge data='{"tone":"halt","label":"Analyse échouée"}'></cd-status-badge><cd-button data='{"label":"Relancer l’analyse","variant":"secondary","size":"sm","icon":"refresh"}'></cd-button>`,
      },
    },
    {
      name: 'analysée, ouverte',
      data: {
        id: '0193a4f2-7c1e-7a10-8c2c-000000000063',
        title: 'Exporter le planning en PDF pour le client',
        meta: '#63 · Personal OS · il y a 2 h',
        state: 'analysee',
        summary: 'Un bouton qui produit le planning de la semaine en PDF, à envoyer au client.',
        impact: 'moyen',
        effort: 'faible',
        duplicates: 'doublon possible : #58',
        selected: true,
      },
    },
    {
      name: 'retenue',
      data: {
        id: '0193a4f2-7c1e-7a10-8c2c-000000000062',
        title: 'Corriger la date des actualités sur le téléphone',
        meta: '#62 · Site mairie · hier',
        state: 'retenue',
        summary: 'La date des actualités s’affiche en anglais sur le téléphone.',
        impact: 'faible',
        effort: 'faible',
        duplicates: null,
        selected: false,
      },
    },
    {
      name: 'fusionnée',
      data: {
        id: '0193a4f2-7c1e-7a10-8c2c-000000000061',
        title: 'Chercher dans les recettes par ingrédient',
        meta: '#61 · Personal OS · il y a 3 j',
        state: 'fusionnee',
        summary: 'Une recherche des recettes qui contiennent un ingrédient donné.',
        impact: 'moyen',
        effort: 'moyen',
        duplicates: 'fusionnée dans #57',
        selected: false,
      },
    },
    {
      name: 'rejetée',
      data: {
        id: '0193a4f2-7c1e-7a10-8c2c-000000000060',
        title: 'Un thème sombre pour le site de la mairie',
        meta: '#60 · Site mairie · il y a 5 j',
        state: 'rejetee',
        summary: 'Le site suit déjà le thème du téléphone.',
        impact: 'faible',
        effort: 'moyen',
        duplicates: null,
        selected: false,
      },
    },
  ],
});
