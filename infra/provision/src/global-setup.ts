/**
 * One fresh machine for every spec: provisioned twice in a row here, the two
 * runs' output and the state of `/etc` and of the services after each handed
 * to the specs (`inject`). `PROVISION_KEEP=1` keeps the machine afterwards,
 * to look inside (`docker exec -it <name> bash`).
 */
import type { TestProject } from 'vitest/node';
import { etcState, provision, removeMachine, type Result, servicesState, startMachine } from './machine.js';

declare module 'vitest' {
  export interface ProvidedContext {
    machine: string;
    runs: { first: Result; second: Result };
    etc: { first: string; second: string };
    services: { first: string; second: string };
  }
}

export default function setup(project: TestProject): () => void {
  const machine = `crewdeck-provision-${process.pid}`;
  const teardown = (): void => {
    if (process.env['PROVISION_KEEP'] === '1') console.log(`machine gardée : ${machine}`);
    else removeMachine(machine);
  };
  try {
    startMachine(machine);
    const first = provision(machine);
    if (first.status !== 0) {
      throw new Error(`premier passage en échec (${first.status}) :\n${first.stdout}\n${first.stderr}`);
    }
    const etcFirst = etcState(machine);
    const servicesFirst = servicesState(machine);
    const second = provision(machine);
    project.provide('machine', machine);
    project.provide('runs', { first, second });
    project.provide('etc', { first: etcFirst, second: etcState(machine) });
    project.provide('services', { first: servicesFirst, second: servicesState(machine) });
  } catch (error) {
    teardown();
    throw error;
  }
  return teardown;
}
