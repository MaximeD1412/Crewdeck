import { type Project, zProject } from '../api/projects.js';
import { registerEventPayload } from './index.js';

/** `project.upserted`: the Projet as `GET /api/projects` lists it, once followed and on each change (its access lost or back). */
export const zProjectEventPayload = registerEventPayload('project', zProject);

declare module './index.js' {
  interface EventPayloads {
    project: Project;
  }
}
