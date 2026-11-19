import { PROCESS_CREWDECK, type ProcessDefinition } from '@crewdeck/contracts';
import { evaluateReadiness, type ReadinessFacts } from './readiness.checks.js';

const DEFINITION: ProcessDefinition = PROCESS_CREWDECK;

/** The definition with one more Étape naming `tools`, in its first Phase. */
const withTools = (tools: ProcessDefinition['steps'][number]['tools']): ProcessDefinition => ({
  ...DEFINITION,
  steps: [...DEFINITION.steps, { id: 'st-extra', phaseId: DEFINITION.phases[0]!.id, kind: DEFINITION.steps[0]!.kind, name: 'Maquettes', col: 9, row: 9, inputs: [], outputs: [], tools }],
});

const ROLE_IDS = [...new Set(DEFINITION.steps.flatMap((step) => step.tools.flatMap((tool) => (tool.kind === 'role' ? [tool.roleId] : []))))];

/** A GitHub Projet where everything is ready. */
const READY: ReadinessFacts = {
  projectId: '019a6f00-0000-7000-8000-000000000021',
  runner: { machine: 'atelier-pc', online: true },
  folder: null,
  releaseBranch: 'main',
  integrationBranch: 'develop',
  process: { active: { number: 3, templateName: 'Process Crewdeck', definition: DEFINITION }, draft: null, draftGaps: 0 },
  roles: ROLE_IDS.map((roleId) => ({ roleId, engine: 'claude-code', model: 'sonnet', usable: true })),
  mcpServers: [],
  sources: { ticket: 'github', code: 'github' },
  repository: { accessLost: false },
  github: { labelsMissing: 0, releaseBranch: true, integrationBranch: true },
  hasCode: true,
  inventoryState: 'approved',
};

const check = (facts: ReadinessFacts, id: string) => evaluateReadiness(facts).checks.find((c) => c.id === id);

describe('the readiness of a Projet', () => {
  it('is ready when every check that applies is ok, a GitHub Projet having no folder row', () => {
    const readiness = evaluateReadiness(READY);
    expect(readiness.ready).toBe(true);
    expect(readiness.checks.map((c) => c.id)).toEqual(['runner-linked', 'engines', 'tools', 'process', 'labels', 'branches', 'inventory']);
    expect(readiness.checks.every((c) => c.state === 'ok')).toBe(true);
  });

  it('lists the missing checks first, then in their order', () => {
    const readiness = evaluateReadiness({ ...READY, inventoryState: 'pending', github: { ...READY.github!, integrationBranch: false } });
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.map((c) => c.id)).toEqual(['branches', 'inventory', 'runner-linked', 'engines', 'tools', 'process', 'labels']);
  });

  describe('runner-linked', () => {
    it('is ok for a Runner linked, even offline', () => {
      expect(check({ ...READY, runner: { machine: 'atelier-pc', online: false } }, 'runner-linked')).toEqual({ id: 'runner-linked', state: 'ok', facts: { online: false, machine: 'atelier-pc' }, fix: null });
    });

    it('is missing without one, its fix a link', () => {
      expect(check({ ...READY, runner: null }, 'runner-linked')).toMatchObject({ state: 'missing', fix: 'link' });
    });
  });

  describe('folder', () => {
    // A Local Projet's active version names no Connecteur: findGaps would have kept it a draft.
    const localDefinition = { ...DEFINITION, steps: DEFINITION.steps.map((step) => ({ ...step, tools: step.tools.filter((tool) => tool.kind !== 'connector') })) };
    const LOCAL: ReadinessFacts = {
      ...READY,
      process: { ...READY.process, active: { ...READY.process.active!, definition: localDefinition } },
      sources: { ticket: 'local', code: 'local' },
      repository: null,
      github: null,
      folder: { state: 'present', last: { present: true, isGit: true, hasCommits: true, releaseBranch: true, integrationBranch: true }, preparing: false, error: null },
    };

    it('is ok for a git folder with commits and both branches, and a Local Projet has no GitHub rows nor, naming no Serveur MCP and no Connecteur, tools', () => {
      expect(check(LOCAL, 'folder')).toEqual({ id: 'folder', state: 'ok', facts: { machine: 'atelier-pc' }, fix: null });
      expect(evaluateReadiness(LOCAL).checks.map((c) => c.id)).toEqual(['runner-linked', 'folder', 'engines', 'process', 'inventory']);
    });

    it('is missing, fixed by hand, while the folder is missing', () => {
      expect(check({ ...LOCAL, folder: { ...LOCAL.folder!, state: 'missing' } }, 'folder')).toEqual({ id: 'folder', state: 'missing', facts: { machine: 'atelier-pc', reason: 'missing' }, fix: 'link' });
    });

    it('is pending while the Runner has not kept it, or not said where it stands, or prepares it', () => {
      expect(check({ ...LOCAL, folder: { ...LOCAL.folder!, state: 'pending' } }, 'folder')?.state).toBe('pending');
      expect(check({ ...LOCAL, folder: { ...LOCAL.folder!, last: null } }, 'folder')?.state).toBe('pending');
      expect(check({ ...LOCAL, folder: { ...LOCAL.folder!, preparing: true } }, 'folder')).toMatchObject({ state: 'pending', facts: { reason: 'preparing' }, fix: null });
    });

    it.each([
      ['not a git repository', { isGit: false, hasCommits: false, releaseBranch: false, integrationBranch: false }, 'not-git'],
      ['without a commit', { isGit: true, hasCommits: false, releaseBranch: false, integrationBranch: false }, 'no-commit'],
      ['without its integration branch', { isGit: true, hasCommits: true, releaseBranch: true, integrationBranch: false }, 'no-integration'],
    ])('is missing, fixed on one click, %s', (_, last, reason) => {
      expect(check({ ...LOCAL, folder: { ...LOCAL.folder!, last: { present: true, ...last } } }, 'folder')).toMatchObject({ state: 'missing', facts: { reason, release: 'main', integration: 'develop' }, fix: 'auto' });
    });

    it('is missing with nothing to click when the release branch is absent from a folder with commits', () => {
      expect(check({ ...LOCAL, folder: { ...LOCAL.folder!, last: { present: true, isGit: true, hasCommits: true, releaseBranch: false, integrationBranch: true } } }, 'folder')).toMatchObject({ state: 'missing', facts: { reason: 'no-release', release: 'main' }, fix: null });
    });

    it('keeps the error of the last preparation', () => {
      const failed = { ...LOCAL.folder!, last: { present: true, isGit: true, hasCommits: false, releaseBranch: false, integrationBranch: false }, error: 'git-identity-missing' as const };
      expect(check({ ...LOCAL, folder: failed }, 'folder')).toMatchObject({ state: 'missing', facts: { reason: 'no-commit', error: 'git-identity-missing' }, fix: 'auto' });
    });

    it('stays shown from its last state while the Runner is offline', () => {
      expect(check({ ...LOCAL, runner: { machine: 'atelier-pc', online: false } }, 'folder')?.state).toBe('ok');
    });
  });

  describe('engines', () => {
    it('names each Rôle with its Moteur', () => {
      const facts = check(READY, 'engines')?.facts;
      expect(Object.keys(facts ?? {}).sort()).toEqual([...ROLE_IDS].sort());
      expect(facts?.[ROLE_IDS[0]!]).toBe('claude-code');
    });

    it('is missing, linked to the Projet\'s Paramètres, for a Rôle without a usable Moteur', () => {
      const roles = READY.roles.map((role, i) => (i === 0 ? { ...role, engine: null, model: null, usable: false, reason: 'no-engine' as const } : role));
      expect(check({ ...READY, roles }, 'engines')).toMatchObject({ state: 'missing', facts: { [ROLE_IDS[0]!]: null }, fix: 'link' });
    });
  });

  describe('tools', () => {
    it('is missing for a Serveur MCP an Étape names that the Runner does not declare, then ok once declared', () => {
      const facts = { ...READY, process: { ...READY.process, active: { ...READY.process.active!, definition: withTools([{ kind: 'mcp', name: 'stitch' }]) } } };
      expect(check(facts, 'tools')).toEqual({ id: 'tools', state: 'missing', facts: { mcpMissing: 'stitch', mcpFailed: null, githubUnavailable: false }, fix: 'link' });
      expect(check({ ...facts, mcpServers: [{ name: 'stitch', state: 'ready' }] }, 'tools')?.state).toBe('ok');
      expect(check({ ...facts, mcpServers: [{ name: 'stitch', state: 'failed' }] }, 'tools')).toMatchObject({ state: 'missing', facts: { mcpMissing: null, mcpFailed: 'stitch' } });
    });

    it('is missing when an Étape uses the Connecteur and the repository is lost or absent', () => {
      const facts = { ...READY, process: { ...READY.process, active: { ...READY.process.active!, definition: withTools([{ kind: 'connector', connector: 'github' }]) } } };
      expect(check(facts, 'tools')?.state).toBe('ok');
      expect(check({ ...facts, repository: { accessLost: true } }, 'tools')).toMatchObject({ state: 'missing', facts: { githubUnavailable: true } });
      expect(check({ ...facts, repository: null }, 'tools')).toMatchObject({ state: 'missing', facts: { githubUnavailable: true } });
    });
  });

  describe('process', () => {
    it('says which version runs', () => {
      expect(check(READY, 'process')).toEqual({ id: 'process', state: 'ok', facts: { version: 3, templateName: 'Process Crewdeck' }, fix: null });
    });

    it('is missing while only a draft with Manques exists, its fix the Gestion du process, and its Rôles read from the draft', () => {
      const facts = { ...READY, process: { active: null, draft: { definition: DEFINITION }, draftGaps: 1 } };
      expect(check(facts, 'process')).toEqual({ id: 'process', state: 'missing', facts: { gaps: 1 }, fix: 'link' });
      expect(check(facts, 'engines')?.state).toBe('ok');
      expect(evaluateReadiness(facts).ready).toBe(false);
    });
  });

  describe('labels', () => {
    it('applies only to a ticket group on GitHub', () => {
      expect(check({ ...READY, sources: { ticket: 'local', code: 'github' } }, 'labels')).toBeUndefined();
    });

    it('is missing, fixed on one click, with the count of labels missing', () => {
      expect(check({ ...READY, github: { ...READY.github!, labelsMissing: 4 } }, 'labels')).toEqual({ id: 'labels', state: 'missing', facts: { missing: 4 }, fix: 'auto' });
    });

    it('is pending until GitHub was read', () => {
      expect(check({ ...READY, github: null }, 'labels')).toMatchObject({ state: 'pending', fix: null });
    });

    it('is pending, never ready, while GitHub never read the labels: the Tickets were Local when it last did', () => {
      const unread = { ...READY, github: { ...READY.github!, labelsMissing: null } };
      expect(check(unread, 'labels')).toMatchObject({ state: 'pending', fix: null });
      expect(evaluateReadiness(unread).ready).toBe(false);
    });
  });

  describe('branches', () => {
    it('applies only to a code group on GitHub', () => {
      expect(check({ ...READY, sources: { ticket: 'github', code: 'local' } }, 'branches')).toBeUndefined();
    });

    it('is missing, fixed on one click, without the integration branch', () => {
      expect(check({ ...READY, github: { ...READY.github!, integrationBranch: false } }, 'branches')).toEqual({
        id: 'branches',
        state: 'missing',
        facts: { release: 'main', integration: 'develop', releaseExists: true, integrationExists: false },
        fix: 'auto',
      });
    });

    it('is missing with nothing to click without the release branch', () => {
      expect(check({ ...READY, github: { ...READY.github!, releaseBranch: false, integrationBranch: false } }, 'branches')).toMatchObject({ state: 'missing', fix: null });
    });

    it('is pending, never ready, while GitHub never read the branches: the Code was Local when it last did', () => {
      const unread = { ...READY, github: { ...READY.github!, releaseBranch: null, integrationBranch: null } };
      expect(check(unread, 'branches')).toMatchObject({ state: 'pending', fix: null });
      expect(evaluateReadiness(unread).ready).toBe(false);
    });
  });

  describe('inventory', () => {
    it('applies only to a Projet with code', () => {
      expect(check({ ...READY, hasCode: false, inventoryState: 'not-needed' }, 'inventory')).toBeUndefined();
    });

    it.each([
      ['approved', 'ok'],
      ['drafting', 'pending'],
      ['to-approve', 'pending'],
      ['awaiting-merge', 'pending'],
      ['pending', 'missing'],
    ] as const)('is %s → %s, never fixed here', (inventoryState, state) => {
      expect(check({ ...READY, inventoryState }, 'inventory')).toEqual({ id: 'inventory', state, facts: { state: inventoryState }, fix: null });
    });
  });
});
