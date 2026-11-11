import { z } from 'zod';
import { COMPOSANT_CATEGORIES, defineComposant } from './define.js';

const zEntry = z.object({ name: z.string(), version: z.number().int().positive() });
/** A piece the core provides itself (the `crewdeck-confirm` dialog): listed with its meta, no Skin implements it. */
const zProvided = z.object({ name: z.string(), meta: z.string() });

/**
 * The library of Composants (US-23, `/parametres/composants?c=<Name>`): the
 * Composants by category, then the one selected, its preview rendered from
 * its examples, its data, its actions and its Emplacements. A group also
 * lists what the core provides in it (`provided`), neither replaceable nor
 * selectable. Built from the
 * declarations by `apps/web/src/views/composants.ts`; `select` changes `?c=`.
 */
export const PageComposants = defineComposant({
  name: 'PageComposants',
  version: 1,
  tag: 'cd-page-composants',
  category: 'page',
  description: 'La bibliothèque des Composants, générée de leurs déclarations.',
  data: z.object({
    groups: z.array(
      z.object({
        category: z.enum(COMPOSANT_CATEGORIES),
        composants: z.array(zEntry),
        provided: z.array(zProvided).optional(),
      }),
    ),
    selected: zEntry.extend({
      tag: z.string(),
      category: z.enum(COMPOSANT_CATEGORIES),
      description: z.string(),
      fields: z.array(z.object({ name: z.string(), type: z.string(), description: z.string() })),
      actions: z.array(z.object({ name: z.string(), sensitive: z.boolean(), description: z.string() })),
      slots: z.array(z.object({ name: z.string(), description: z.string() })),
      examples: z.array(
        z.object({
          name: z.string(),
          data: z.record(z.string(), z.unknown()),
          slots: z.record(z.string(), z.string()).optional(),
        }),
      ),
    }),
  }),
  actions: { select: z.object({ name: z.string() }) },
  slots: [],
  examples: [
    {
      name: 'Banner ouvert',
      data: {
        groups: [
          { category: 'cadre', composants: [{ name: 'PageHeader', version: 1 }] },
          {
            category: 'signal',
            composants: [
              { name: 'Banner', version: 1 },
              { name: 'Button', version: 1 },
            ],
            provided: [{ name: 'ConfirmDialog', meta: 'fourni par le produit, non remplaçable' }],
          },
        ],
        selected: {
          name: 'Banner',
          version: 1,
          tag: 'cd-banner',
          category: 'signal',
          description: 'Un message en travers de la page.',
          fields: [
            { name: 'tone', type: 'Tone', description: 'Sa couleur.' },
            { name: 'title', type: 'string', description: 'Son titre.' },
          ],
          actions: [
            { name: 'open', sensitive: false, description: 'Ouvre le message.' },
            { name: 'merge', sensitive: true, description: 'Merge la PR, confirmé par le produit.' },
          ],
          slots: [
            { name: 'default', description: 'Son texte.' },
            { name: 'actions', description: 'Ses boutons.' },
          ],
          examples: [{ name: 'nominal', data: { tone: 'caution', title: 'Resynchronisation…' }, slots: { default: 'Un instant.' } }],
        },
      },
    },
  ],
});
