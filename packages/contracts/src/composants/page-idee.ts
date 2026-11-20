import { z } from 'zod';
import { zId } from '../values.js';
import { defineComposant } from './define.js';
import { IdeaAnalysis } from './idea-analysis.js';
import { IDEA_ROW_STATES } from './idea-row.js';

const [passed, , incomplete, running] = IdeaAnalysis.examples;
if (!passed || !incomplete || !running) throw new Error('IdeaAnalysis lacks its examples');

const HEADER = { title: 'Exporter le planning en PDF pour le client', count: '#63 · Analysée' };
const NOTED = { text: 'Pouvoir exporter le planning en PDF pour l’envoyer au client.', meta: 'par toi · au téléphone, dictée · il y a 2 h' };

/**
 * « Une Idée » (US-6, `/idees/:id`, `design/screens/crewdeck/idee.html`):
 * its PageHeader, back to « Idées », titled by the analysis's title (else the
 * text's first line), its number and its state as its count, its
 * Emplacement `actions` in the header (the triage, IDEE-3). Then the Card
 * « Notée », the text between quotes and how it was noted; the Card of its
 * analysis (`IdeaAnalysis`, whose actions bubble up), none when the Process
 * has no analysis; beside them from 1280 px, the Card « Doublons possibles »,
 * a row per duplicate that leads to its page.
 */
export const PageIdee = defineComposant({
  name: 'PageIdee',
  version: 1,
  tag: 'cd-page-idee',
  category: 'page',
  description: 'La page d’une Idée : son texte noté, son analyse et ses doublons possibles.',
  data: z.object({
    title: z.string().min(1),
    count: z.string().min(1),
    noted: z.object({ text: z.string(), meta: z.string() }),
    analysis: IdeaAnalysis.data.nullable(),
    duplicates: z.array(z.object({ id: zId, title: z.string().min(1), meta: z.string(), state: z.enum(IDEA_ROW_STATES), href: z.string().min(1) })),
  }),
  actions: {},
  slots: ['actions'],
  examples: [
    {
      name: 'analysée, un doublon possible',
      data: {
        ...HEADER,
        noted: NOTED,
        analysis: passed.data,
        duplicates: [
          {
            id: '0193a4f2-7c1e-7a10-8c2c-000000000058',
            title: '#58 Imprimer le planning de la semaine',
            meta: 'Personal OS · à trier · il y a 9 j',
            state: 'analysee',
            href: '/idees/0193a4f2-7c1e-7a10-8c2c-000000000058',
          },
        ],
      },
      slots: { actions: `<cd-button data='{"label":"Retenir","variant":"primary","size":"md","icon":"check"}'></cd-button>` },
    },
    {
      name: 'en analyse',
      data: { ...HEADER, count: '#63 · En analyse', noted: NOTED, analysis: { ...running.data, label: 'Une Idée / Analyse', title: 'Analyse', heading: null }, duplicates: [] },
    },
    {
      name: 'son analyse échouée',
      data: {
        title: 'Prévenir quand une Planification démarre la Boucle',
        count: '#64 · À trier',
        noted: { text: 'Prévenir quand une Planification démarre la Boucle', meta: 'par toi · au PC · il y a 5 min' },
        analysis: { ...incomplete.data, title: 'Analyse', label: 'Une Idée / Analyse', heading: null },
        duplicates: [],
      },
    },
    {
      name: 'sans analyse',
      data: { ...HEADER, count: '#63 · À trier', noted: { ...NOTED, meta: 'par toi · au PC · il y a 2 h' }, analysis: null, duplicates: [] },
    },
  ],
});
