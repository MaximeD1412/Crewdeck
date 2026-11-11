import type { Runner } from '@crewdeck/contracts';

/** What of a `runners` row the page sees: `GET /api/runner`, the `runner` slice of `GET /api/state`, the payload of `runner.upserted`. */
export const RUNNER_VIEW = {
  id: true,
  machine: true,
  os: true,
  arch: true,
  wsl: true,
  runnerVersion: true,
  state: true,
  lastSeenAt: true,
  linkedAt: true,
} as const;

interface RunnerRow {
  id: string;
  machine: string;
  os: Runner['os'];
  arch: Runner['arch'];
  wsl: boolean;
  runnerVersion: string;
  state: Runner['state'];
  lastSeenAt: Date;
  linkedAt: Date;
}

export const toRunner = (row: RunnerRow): Runner => ({
  ...row,
  lastSeenAt: row.lastSeenAt.toISOString(),
  linkedAt: row.linkedAt.toISOString(),
});
