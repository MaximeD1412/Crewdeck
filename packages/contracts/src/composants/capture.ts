import { z } from 'zod';
import { defineComposant } from './define.js';

/**
 * The address of a capture: an object URL the core built from the content it
 * read on GitHub (`blob:`), or an inline image (`data:image/…`). Never a remote
 * URL the Composant would fetch itself.
 */
const zCaptureSrc = z
  .string()
  .regex(/^(blob:|data:image\/)/, 'une URL blob: ou data:image/, jamais une adresse distante')
  .meta({ title: 'ObjectUrl' });

/** A sketch of a screen at `width`, for the examples: a header, a title, three rows. */
const sketch = (width: number, height: number): string => {
  const pad = width / 20;
  const rows = [0, 1, 2]
    .map(
      (i) =>
        `<rect x="${pad}" y="${height * 0.28 + i * height * 0.14}" width="${width - 2 * pad}" height="${height * 0.1}" rx="6" fill="#ffffff" stroke="#d9dce3"/>`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#f4f5f7"/><rect width="${width}" height="${height * 0.08}" fill="#1f2430"/><rect x="${pad}" y="${height * 0.14}" width="${width * 0.45}" height="${height * 0.05}" rx="4" fill="#3d4352"/>${rows}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

/**
 * A capture of a visual review (BOUCLE-6), framed with its caption; a press
 * on it asks to enlarge it (`open`). `sm` and `lg` are the widths of the
 * `--cd-capture-w` and `--cd-capture-w-lg` tokens.
 */
export const Capture = defineComposant({
  name: 'Capture',
  version: 1,
  tag: 'cd-capture',
  category: 'partie',
  description: 'Une capture d’une revue visuelle, avec sa légende ; un clic l’agrandit.',
  data: z.object({
    src: zCaptureSrc,
    alt: z.string(),
    label: z.string(),
    size: z.enum(['sm', 'lg']),
  }),
  actions: { open: z.object({ src: zCaptureSrc }) },
  slots: [],
  examples: [
    {
      name: 'téléphone',
      data: { src: sketch(390, 844), alt: 'La page Planning livrée, au téléphone', label: 'Livré · 390', size: 'sm' },
    },
    {
      name: 'ordinateur',
      data: { src: sketch(1280, 800), alt: 'La page Planning livrée, sur l’ordinateur', label: 'Livré · 1280', size: 'lg' },
    },
  ],
});
