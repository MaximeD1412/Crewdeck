import { parseWaitingProjects, zWaitingProject } from '../index.js';

const CREWDECK = { projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a01', name: 'Crewdeck', items: [{ kind: 'ticket-in-progress', number: 44 }] };
const IDEAS = { projectId: null, name: 'Idées', items: [{ kind: 'ideas-waiting', count: 3 }] };

describe('zWaitingProject', () => {
  it('is a Projet whose work waits for the Runner, « Idées » without a Projet, with ids, numbers and counts only', () => {
    expect(zWaitingProject.parse(CREWDECK)).toEqual(CREWDECK);
    expect(zWaitingProject.parse(IDEAS)).toEqual(IDEAS);
  });

  it('refuses an unknown kind, a number that is not a positive integer, and free text', () => {
    expect(zWaitingProject.safeParse({ ...CREWDECK, items: [{ kind: 'running' }] }).success).toBe(false);
    expect(zWaitingProject.safeParse({ ...CREWDECK, items: [{ kind: 'tickets-ready', count: 1.5 }] }).success).toBe(false);
    expect(zWaitingProject.safeParse({ ...CREWDECK, items: [{ kind: 'ticket-in-progress', number: 0 }] }).success).toBe(false);
    expect(zWaitingProject.safeParse({ ...CREWDECK, items: [{ kind: 'ticket-in-progress', number: 44, title: 'Liste' }] }).success).toBe(false);
  });
});

describe('parseWaitingProjects', () => {
  it('reads the `projects` param of a « Runner hors ligne » Décision', () => {
    expect(parseWaitingProjects(JSON.stringify([CREWDECK, IDEAS]))).toEqual([CREWDECK, IDEAS]);
  });

  it('gives none for a param it cannot read', () => {
    expect(parseWaitingProjects(undefined)).toEqual([]);
    expect(parseWaitingProjects(42)).toEqual([]);
    expect(parseWaitingProjects('{')).toEqual([]);
    expect(parseWaitingProjects(JSON.stringify([{ name: 'Crewdeck' }]))).toEqual([]);
  });
});
