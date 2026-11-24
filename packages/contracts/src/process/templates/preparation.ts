import { defaultStep } from '../catalogue.js';
import { type ProcessDefinition, zProcessDefinition } from '../definition.js';

/**
 * « Préparation » (PROJET-4, US-68): what a Projet whose code already exists
 * runs before its Process starts, its Inventaire drafted by the Rôle
 * Conception. A definition of the release, never a Modèle de process: the
 * Pilote's canvas never shows it, and each pass (the first drafting, a
 * send-back) is its own PhaseRun on it, with no version.
 */
export const PREPARATION: ProcessDefinition = zProcessDefinition.parse({
  schemaVersion: 1,
  phases: [{ id: 'ph-preparation', name: 'Préparation', col: 1, row: 1, forEach: null }],
  steps: [defaultStep('inventory', { id: 'st-inventory', phaseId: 'ph-preparation', col: 1, row: 1 })],
  arrows: [],
  loopBacks: [],
  commands: [],
});
