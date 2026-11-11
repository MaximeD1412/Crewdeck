import type { LinkFailureReason, Me, Runner } from '@crewdeck/contracts';
import type { ComposantData, DemarrageSystem, PageDemarrage } from '@crewdeck/sdk';

export type DemarrageView = ComposantData<typeof PageDemarrage>;

/** The code the page drew: its short id the server knows, its secret that never left the page. */
export interface DrawnCode {
  readonly shortId: string;
  readonly secret: string;
}

export interface DemarrageState {
  /** The Pilote as the page knows them now: their login and their step. */
  readonly pilot: Pick<Me, 'login' | 'gettingStartedStep'>;
  readonly runner: Runner | null;
  readonly system: DemarrageSystem;
  /** `null` until the page drew its code. */
  readonly code: DrawnCode | null;
  readonly failure: { readonly reason: LinkFailureReason; readonly shortId: string } | null;
  readonly busy: boolean;
  /** Where the page is served, which serves `install.sh` too. */
  readonly origin: string;
  /** `GET /api/config`'s `runnerServer`: `null` in production, where `install.sh` knows its server. */
  readonly server: string | null;
}

/** The install command of ADR 0004 with the full code; `--server` only off production. */
export const installCommand = (origin: string, code: DrawnCode, server: string | null): string =>
  `curl -fsSL ${origin}/runner/install.sh | sh -s -- --link ${code.shortId}-${code.secret}${server ? ` --server ${server}` : ''}`;

/** The tab first open: the browser's system, Linux by default. */
export const systemOfBrowser = (userAgent: string): DemarrageSystem =>
  /Macintosh|Mac OS X|iPhone|iPad/i.test(userAgent) ? 'macos' : /Windows/i.test(userAgent) ? 'wsl' : 'linux';

/**
 * « Premiers pas »'s data (pure): the Pilote's step (`done` only for the
 * instant before the router leaves the page, read as its last step), the
 * command of the page's code, and the Runner once linked.
 */
export const demarrageView = ({ pilot, runner, system, code, failure, busy, origin, server }: DemarrageState): DemarrageView => ({
  step: pilot.gettingStartedStep === 'done' ? 'projects' : pilot.gettingStartedStep,
  login: pilot.login,
  system,
  command: code && !runner ? installCommand(origin, code, server) : null,
  shortId: code && !runner ? code.shortId : null,
  failure: runner ? null : failure,
  runner: runner
    ? {
        machine: runner.machine,
        os: runner.os,
        arch: runner.arch,
        wsl: runner.wsl,
        runnerVersion: runner.runnerVersion,
        state: runner.state,
        lastSeenAt: runner.lastSeenAt,
      }
    : null,
  busy,
});
