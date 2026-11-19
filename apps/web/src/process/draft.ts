import type { ProcessDefinition, ProcessDraftInput, ProjectProcess } from '@crewdeck/contracts';
import { t } from '@crewdeck/sdk';
import type { Client } from '../api/client.js';
import { saveDraft } from '../api/process.js';
import { ApiError } from '../api/request.js';
import type { EditResult } from './edit.js';

export interface DraftSaver {
  /** The Projet's Process as the canvas shows it: the store's, or the last answer when more recent, its draft the last accepted edit. */
  view(): ProjectProcess | undefined;
  /** Applies `change` to the shown definition; accepted and new, it is shown at once and saved. */
  edit(change: (definition: ProcessDefinition) => EditResult): EditResult;
  /** Resolves once nothing is in flight nor left to send. */
  settled(): Promise<void>;
  /** Calls `listener` each time what `view` shows changes; returns the function that stops. */
  subscribe(listener: () => void): () => void;
}

export interface DraftSaverOptions {
  readonly projectId: string;
  readonly client: Pick<Client, 'command'>;
  /** The store's view of the Projet's Process. */
  readonly stored: () => ProjectProcess | undefined;
  /** Says why the last edits were not saved: the page shows it, the store's draft shown again. */
  readonly onFailure: (text: string) => void;
}

const revisionOf = (view: ProjectProcess | undefined): number => view?.draft?.revision ?? 0;
const versionOf = (view: ProjectProcess | undefined): number => view?.active?.number ?? 0;

/** The sealed part sent with a definition: its Commandes' text, `null` once it holds none (the draft's schema). */
const sealedFor = (definition: ProcessDefinition, view: ProjectProcess | undefined): ProcessDraftInput['sealed'] =>
  definition.commands.length === 0 ? null : (view?.draft?.sealed ?? view?.active?.sealed ?? null);

const failureOf = (error: unknown): string => {
  if (!(error instanceof ApiError)) return t('process.draft.failed');
  return error.code === 'process.draft-stale' ? t('process.draft.stale') : error.message;
};

/**
 * Saves a Projet's draft on each change of the canvas (US-93, ADR 0011):
 * the whole definition, one PUT in flight at a time, the edits made
 * meanwhile sent together in the next one, on the revision the answer gave.
 * A refused save drops the edits not saved and says why.
 */
export const createDraftSaver = ({ projectId, client, stored, onFailure }: DraftSaverOptions): DraftSaver => {
  /** The shown definition while an edit is not confirmed yet. */
  let local: ProcessDefinition | null = null;
  /** Whether `local` holds edits not sent yet. */
  let dirty = false;
  /** The last answer, shown until the store is as recent. */
  let confirmed: ProjectProcess | null = null;
  let inFlight: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  let shown: { base: ProjectProcess | undefined; local: ProcessDefinition | null; view: ProjectProcess | undefined } | null = null;

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const base = (): ProjectProcess | undefined => {
    const current = stored();
    if (confirmed && revisionOf(confirmed) > revisionOf(current) && versionOf(current) <= versionOf(confirmed)) return confirmed;
    confirmed = null;
    return current;
  };

  const view = (): ProjectProcess | undefined => {
    const from = base();
    if (shown && shown.base === from && shown.local === local) return shown.view;
    const draft = from?.draft;
    const next =
      from && local
        ? {
            ...from,
            draft: {
              definition: local,
              sealed: sealedFor(local, from),
              revision: revisionOf(from),
              baseVersion: versionOf(from),
              updatedAt: draft?.updatedAt ?? from.active?.activatedAt ?? '',
            },
          }
        : from;
    shown = { base: from, local, view: next };
    return next;
  };

  const flush = (): void => {
    if (inFlight || !dirty || !local) return;
    const from = base();
    const definition = local;
    dirty = false;
    const input: ProcessDraftInput = { definition, sealed: sealedFor(definition, from), revision: revisionOf(from), baseVersion: versionOf(from) };
    inFlight = saveDraft(client, projectId, input)
      .then(
        (answer) => {
          confirmed = answer;
          if (!dirty) local = null;
        },
        (error: unknown) => {
          local = null;
          dirty = false;
          confirmed = null;
          onFailure(failureOf(error));
        },
      )
      .finally(() => {
        inFlight = null;
        notify();
        flush();
      });
  };

  return {
    view,
    edit(change) {
      const from = view();
      const current = from?.draft?.definition ?? from?.active?.definition;
      if (!current) return { ok: false, reason: t('process.draft.failed') };
      const result = change(current);
      if (!result.ok || result.definition === current) return result;
      local = result.definition;
      dirty = true;
      notify();
      flush();
      return result;
    },
    async settled() {
      while (inFlight) await inFlight;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
