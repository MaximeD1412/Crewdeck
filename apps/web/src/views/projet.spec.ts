import type { Project, ReadinessCheck } from '@crewdeck/contracts';
import { readinessBadge, readinessView } from './projet.js';

const AT = '2026-11-12T09:00:00.000Z';

const ROLES: Record<string, string> = { idea: 'Idée', design: 'Conception', code: 'Code' };
const roleName = (roleId: string): string => ROLES[roleId] ?? roleId;

const check = (id: ReadinessCheck['id'], state: ReadinessCheck['state'], facts: ReadinessCheck['facts'] = {}, fix: ReadinessCheck['fix'] = null): ReadinessCheck => ({ id, state, facts, fix });

const projectWith = (checks: ReadinessCheck[] | null): Pick<Project, 'id' | 'readiness'> => ({
  id: 'p1',
  readiness: checks === null ? null : { ready: checks.every((c) => c.state === 'ok'), computedAt: AT, checks },
});

const view = (checks: ReadinessCheck[] | null, fixing: ReadinessCheck['id'] | null = null) => readinessView(projectWith(checks), { roleName, fixing });

const BRANCHES = { release: 'main', integration: 'develop' };

describe('readinessView', () => {
  it('says « prêt » and no Banner when every check is ok, each row with what it found', () => {
    const shown = view([
      check('runner-linked', 'ok', { online: true, machine: 'atelier' }),
      check('folder', 'ok', { machine: 'atelier' }),
      check('engines', 'ok', { idea: 'claude-code', design: 'claude-code', code: 'codex' }),
      check('process', 'ok', { version: 3, templateName: 'Process Crewdeck' }),
    ]);
    expect(shown.count).toBe('prêt');
    expect(shown.blocked).toBeNull();
    expect(shown.rows.map((row) => [row.title, row.meta, row.state, row.fix])).toEqual([
      ['Runner relié', 'en ligne · atelier', 'ok', false],
      ['Dossier du Projet', expect.stringContaining('atelier'), 'ok', false],
      ['Un Moteur utilisable par Rôle', 'Idée, Conception : Claude Code · Code : Codex', 'ok', false],
      ['Process', expect.stringContaining('v3'), 'ok', false],
    ]);
    expect(shown.rows[3]?.meta).toContain('Process Crewdeck');
  });

  it('counts the points to fix, the Banner names the first, « Corriger » only on an auto fix', () => {
    const shown = view([
      check('branches', 'missing', { ...BRANCHES, releaseExists: true, integrationExists: false }, 'auto'),
      check('labels', 'missing', { missing: 3 }, 'auto'),
      check('runner-linked', 'ok', { online: true, machine: 'atelier' }),
    ]);
    expect(shown.count).toBe('2 points à régler');
    expect(shown.blocked).toContain('develop');
    expect(shown.rows.map((row) => row.fix)).toEqual([true, true, false]);
    expect(shown.rows[0]?.meta).toContain('main');
    expect(shown.rows[1]?.meta).toContain('3');
  });

  it('says one point in the singular', () => {
    expect(view([check('labels', 'missing', { missing: 1 }, 'auto')]).count).toBe('1 point à régler');
  });

  it('waits while a check is read, and before the first readiness', () => {
    expect(view(null)).toEqual({ count: 'en attente', blocked: null, rows: [], fixing: null });
    const reading = view([check('labels', 'pending'), check('runner-linked', 'ok', { online: false, machine: 'atelier' })]);
    expect(reading.count).toBe('en attente');
    expect(reading.blocked).toBeNull();
    expect(reading.rows[0]?.meta).toBe('lecture de GitHub en cours');
  });

  it('carries the check whose « Corriger » runs', () => {
    expect(view([check('labels', 'missing', { missing: 2 }, 'auto')], 'labels').fixing).toBe('labels');
  });

  it('links a check fixed elsewhere to where it is fixed, the Process always to its Gestion du process', () => {
    const shown = view([
      check('runner-linked', 'missing', {}, 'link'),
      check('folder', 'missing', { machine: 'atelier', reason: 'missing' }, 'link'),
      check('engines', 'missing', { idea: 'claude-code', code: null }, 'link'),
      check('tools', 'missing', { mcpMissing: 'figma', mcpFailed: null, githubUnavailable: false }, 'link'),
      check('branches', 'missing', { ...BRANCHES, releaseExists: false, integrationExists: false }),
      check('process', 'ok', { version: 1, templateName: null }),
      check('labels', 'missing', { missing: 2 }, 'auto'),
    ]);
    expect(shown.rows.map((row) => [row.id, row.href])).toEqual([
      ['runner-linked', '/runner'],
      ['folder', '/projets/ajouter?projet=p1'],
      ['engines', '/projets/p1/parametres'],
      ['tools', '/runner'],
      ['branches', '/projets/p1/parametres'],
      ['process', '/projets/p1/process'],
      ['labels', null],
    ]);
    expect(shown.rows[2]?.meta).toContain('Code');
    expect(shown.rows[3]?.meta).toContain('figma');
    expect(shown.blocked).toBe('Aucun Runner n’est relié : c’est lui qui fait travailler les agents sur ta machine.');
  });

  it('says what « Corriger » does to a folder, from its reason, and the last preparation’s error', () => {
    const folder = (facts: ReadinessCheck['facts'], fix: ReadinessCheck['fix'] = 'auto') => view([check('folder', 'missing', { machine: 'atelier', ...BRANCHES, error: null, ...facts }, fix)]);
    expect(folder({ reason: 'not-git' }).rows[0]?.meta).toContain('git init');
    expect(folder({ reason: 'no-integration' }).rows[0]?.meta).toContain('develop');
    expect(folder({ reason: 'not-git' }).blocked).toContain('atelier');
    const release = folder({ reason: 'no-release' }, null);
    expect(release.rows[0]?.fix).toBe(false);
    expect(release.rows[0]?.href).toBe('/projets/p1/parametres');
    expect(release.blocked).toContain('main');
    expect(folder({ reason: 'not-git', error: 'git-identity-missing' }).rows[0]?.meta).toContain('git config --global user.name');
  });

  it('counts the Manques of a Process to activate', () => {
    expect(view([check('process', 'missing', { gaps: 2 }, 'link')]).rows[0]?.meta).toContain('2');
  });
});

describe('readinessBadge', () => {
  const badge = (checks: ReadinessCheck[] | null) => readinessBadge(projectWith(checks), 'GitHub · acme/atelier');

  it('is « prêt », go, with the usual meta, when the Projet is ready', () => {
    expect(badge([check('runner-linked', 'ok', { online: true, machine: 'atelier' })])).toEqual({ tone: 'go', badge: 'prêt', meta: 'GitHub · acme/atelier' });
  });

  it('is « à régler », caution, with the count and the first point', () => {
    expect(badge([check('branches', 'missing', { ...BRANCHES, releaseExists: true, integrationExists: false }, 'auto'), check('labels', 'missing', { missing: 1 }, 'auto')])).toEqual({
      tone: 'caution',
      badge: 'à régler',
      meta: '2 points à régler : branche d’intégration absente',
    });
    expect(badge([check('labels', 'missing', { missing: 1 }, 'auto')]).meta).toBe('1 point à régler : labels absents');
  });

  it('is « inventaire », accent, when only the Inventaire waits', () => {
    expect(badge([check('runner-linked', 'ok', { online: true, machine: 'atelier' }), check('inventory', 'pending', { state: 'to-approve' })])).toEqual({
      tone: 'accent',
      badge: 'inventaire',
      meta: 'Inventaire à approuver avant le Process',
    });
  });

  it('is « en cours », neutral, while a check is read and before the first readiness', () => {
    expect(badge(null)).toEqual({ tone: 'neutral', badge: 'en cours', meta: 'GitHub · acme/atelier' });
    expect(badge([check('labels', 'pending'), check('inventory', 'pending', { state: 'drafting' })]).tone).toBe('neutral');
  });
});
