import { type ProcessTemplate, zProcessTemplate } from '../api/process-templates.js';
import { registerEventPayload } from './index.js';

/**
 * `process-template.upserted`: a Modèle de process as `POST /api/process-templates`
 * returns it, on each save, replacement or renaming; `process-template.removed`
 * once it is deleted.
 */
export const zProcessTemplateEventPayload = registerEventPayload('process-template', zProcessTemplate);

declare module './index.js' {
  interface EventPayloads {
    'process-template': ProcessTemplate;
  }
}
