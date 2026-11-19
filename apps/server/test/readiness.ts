import type { INestApplication } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { ReadinessService } from '../src/projects/readiness/readiness.service.js';

/** Resolves once the readiness computed after the last changes is written: what a test awaits before it reads the events or the seq. */
export const readinessSettled = (app: INestApplication): Promise<void> => app.get(ReadinessService).settled();

/**
 * The events without the readiness's own (PROJET-3): each `project.upserted`
 * that changes nothing of its Projet but `readiness` since its previous one.
 * What the test of another feature compares; pass the whole list, a slice
 * would keep its first.
 */
export const withoutReadiness = <E extends { type: string; payload: unknown }>(events: readonly E[]): E[] => {
  const last = new Map<string, unknown>();
  return events.filter((event) => {
    if (event.type !== 'project.upserted') return true;
    const { readiness: _readiness, ...rest } = event.payload as { id: string; readiness?: unknown };
    const previous = last.get(rest.id);
    last.set(rest.id, rest);
    return previous === undefined || !isDeepStrictEqual(previous, rest);
  });
};
