import type { Idea, IdeaList } from '@crewdeck/contracts';
import type { Client } from './api/client.js';
import { createClosedIdeas } from './closed-ideas.js';

const merged = (number: number): Idea => ({
  id: `0193a4f2-7c1e-7a10-8c2c-0000000000${number}`,
  number,
  projectId: null,
  targetProjectId: null,
  targetIsNew: false,
  state: 'merged',
  text: { key: 'k'.repeat(80), ciphertext: 'c'.repeat(40) },
  analysis: null,
  impact: null,
  effort: null,
  duplicateIds: [],
  notedFrom: 'pc',
  dictated: false,
  mergedIntoId: null,
  reason: null,
  ticketNumber: null,
  createdAt: '2026-07-01T08:00:00.000Z',
  updatedAt: '2026-07-01T08:00:00.000Z',
  analysedAt: null,
  triagedAt: null,
});

const setup = (answer: (path: string) => Promise<IdeaList>) => {
  const paths: string[] = [];
  const client: Pick<Client, 'query'> = {
    query: (async (path: string) => {
      paths.push(path);
      return answer(path);
    }) as Client['query'],
  };
  const closed = createClosedIdeas({ client });
  const changes = vi.fn<() => void>();
  closed.subscribe(changes);
  return { closed, paths, changes };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createClosedIdeas', () => {
  it('reads the first page of the Idées merged or rejected once, then the next ones on more, until none remains', async () => {
    const { closed, paths, changes } = setup(async (path) =>
      path.includes('cursor=') ? { items: [merged(40)], nextCursor: null } : { items: [merged(50), merged(45)], nextCursor: 'c/2' },
    );
    expect(closed.view()).toEqual({ ideas: [], known: false, older: 'none' });

    closed.ensure();
    expect(changes).not.toHaveBeenCalled();
    expect(closed.view()).toMatchObject({ known: false, older: 'loading' });
    closed.ensure();
    await settle();
    expect(paths).toEqual(['/api/ideas?states=merged,rejected']);
    expect(changes).toHaveBeenCalled();
    expect(closed.view()).toMatchObject({ known: true, older: 'available' });
    expect(closed.view().ideas.map((idea) => idea.number)).toEqual([50, 45]);

    const more = closed.more();
    expect(closed.view().older).toBe('loading');
    await more;
    expect(paths).toEqual(['/api/ideas?states=merged,rejected', '/api/ideas?states=merged,rejected&cursor=c%2F2']);
    expect(closed.view()).toMatchObject({ known: true, older: 'none' });
    expect(closed.view().ideas.map((idea) => idea.number)).toEqual([50, 45, 40]);

    await closed.more();
    expect(paths).toHaveLength(2);
  });

  it('after a failed page, offers to read it again, and throws the refusal of more for the page to show', async () => {
    let fails = true;
    const { closed, paths } = setup(async () => {
      if (fails) throw new Error('offline');
      return { items: [merged(50)], nextCursor: null };
    });
    closed.ensure();
    await settle();
    expect(closed.view()).toEqual({ ideas: [], known: false, older: 'available' });
    await expect(closed.more()).rejects.toThrow('offline');

    fails = false;
    await closed.more();
    expect(paths).toEqual(['/api/ideas?states=merged,rejected', '/api/ideas?states=merged,rejected', '/api/ideas?states=merged,rejected']);
    expect(closed.view()).toMatchObject({ known: true, older: 'none' });
  });
});
