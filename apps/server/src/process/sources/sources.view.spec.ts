import { toProcessSources, toProjectProcessSources } from './sources.view.js';

const PROJECT = '019a6f00-0000-7000-8000-000000000011';
const SINCE = new Date('2026-11-15T08:00:00.000Z');
const row = (group: 'ticket' | 'code', source: 'local' | 'github') => ({ projectId: PROJECT, group, source, since: SINCE });

describe('the Sources of a Projet', () => {
  it('give the view both groups, each with its Source and since when, whatever the rows’ order', () => {
    expect(toProjectProcessSources(PROJECT, [row('code', 'local'), row('ticket', 'github')])).toEqual({
      ticket: { source: 'github', since: '2026-11-15T08:00:00.000Z' },
      code: { source: 'local', since: '2026-11-15T08:00:00.000Z' },
    });
  });

  it('throw for a Projet without a group: a Projet holds both from its creation', () => {
    expect(() => toProjectProcessSources(PROJECT, [row('ticket', 'github')])).toThrow(/no Source for its group code/);
  });

  it('give findGaps the kinds alone, null for a group without a row', () => {
    expect(toProcessSources([row('ticket', 'local'), row('code', 'local')])).toEqual({ ticket: 'local', code: 'local' });
    expect(toProcessSources([row('code', 'github')])).toEqual({ ticket: null, code: 'github' });
  });
});
