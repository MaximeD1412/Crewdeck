import type { z } from 'zod';
import { defineContrat, STEP_IDS, zContrat, zRule, zVerdict } from './define.js';

const rule = <K extends string, P extends Record<string, unknown>>(kind: K, params: P) => ({
  id: `x.${kind}` as string,
  label: 'Une règle',
  severity: 'bloquant' as const,
  kind,
  ...params,
});

describe('defineContrat', () => {
  it('returns the declaration, one rule of each kind', () => {
    const declaration = {
      id: 'prd',
      version: 2,
      step: 'prd',
      rules: [
        rule('file', { path: 'CONTEXT.md' }),
        { ...rule('file', { glob: 'docs/**/*.md', min: 2 }), id: 'x.file-glob' },
        rule('sections', { path: 'docs/product/prd.md', headings: ['Problème', 'Solution'], level: 2 }),
        rule('pattern', { path: 'docs/product/prd.md', regex: '^- \\*\\*US-(\\d+)\\*\\*', unique: true, min: 1 }),
        rule('front-matter', { glob: 'backlog/issues/*.md', schema: { type: 'object', required: ['id'] } }),
        rule('json', { path: 'design/screens.json', schema: { type: 'array' } }),
        rule('pr', { base: 'integration', branch: '^feat/', body: ['Closes #\\d+'], labels: ['conception'] }),
        rule('check', { name: 'example-nonempty-dir', params: { path: 'src' } }),
      ],
    } satisfies z.input<typeof zContrat>;

    expect(defineContrat(declaration)).toBe(declaration);
    expect(zContrat.parse(declaration)).toEqual(declaration);
  });

  it('keeps a pr rule’s French label apart from the labels its PR carries', () => {
    const pr = defineContrat({ id: 'x', version: 1, step: 'code', rules: [rule('pr', { labels: ['conception'] }) as never] });
    expect(zContrat.parse(pr).rules[0]).toMatchObject({ label: 'Une règle', labels: ['conception'] });
  });

  it('knows the nine Étapes', () => {
    expect(STEP_IDS).toEqual(['idea-analysis', 'inventory', 'prd', 'mockups', 'technical-design', 'cross-review', 'split', 'code', 'review']);
    expect(() => defineContrat({ id: 'x', version: 1, step: 'deploy' as never, rules: [] })).toThrow();
  });

  it('refuses two rules with the same id', () => {
    const twice = rule('file', { path: 'README.md' });
    expect(() => defineContrat({ id: 'x', version: 1, step: 'code', rules: [twice, twice] as never })).toThrow(/x\.file/);
  });

  it.each([
    ['a version that is not a positive integer', { id: 'x', version: 0, step: 'code', rules: [] }],
    ['an id outside lowercase and dashes', { id: 'Prd', version: 1, step: 'prd', rules: [] }],
  ])('refuses %s', (_, contrat) => {
    expect(zContrat.safeParse(contrat).success).toBe(false);
  });
});

describe('a rule', () => {
  it.each([
    ['an id without a dot', { ...rule('file', { path: 'a' }), id: 'readme' }],
    ['an id with an uppercase letter', { ...rule('file', { path: 'a' }), id: 'x.Readme' }],
    ['an empty label', { ...rule('file', { path: 'a' }), label: '' }],
    ['a severity outside bloquant and attention', { ...rule('file', { path: 'a' }), severity: 'info' }],
    ['an unknown kind', rule('lint', {})],
    ['a file rule with both a path and a glob', rule('file', { path: 'a', glob: '*.md' })],
    ['a file rule with neither a path nor a glob', rule('file', {})],
    ['a file rule with a min and a path', rule('file', { path: 'a', min: 2 })],
    ['an absolute path', rule('file', { path: '/etc/passwd' })],
    ['a path out of the worktree', rule('file', { path: 'docs/../../secret' })],
    ['a sections rule without headings', rule('sections', { path: 'a.md', headings: [] })],
    ['a heading level above 6', rule('sections', { path: 'a.md', headings: ['A'], level: 7 })],
    ['a pattern rule with both a path and a glob', rule('pattern', { path: 'a', glob: '*.md', regex: 'x' })],
    ['a pattern rule with an invalid regex', rule('pattern', { path: 'a', regex: '(' })],
    ['a unique pattern without a capture group', rule('pattern', { path: 'a', regex: '^US-\\d+', unique: true })],
    ['a json rule without its schema', rule('json', { path: 'a.json' })],
    ['a front-matter rule with a path instead of a glob', rule('front-matter', { path: 'a.md', schema: {} })],
    ['a pr rule with an invalid body regex', rule('pr', { body: ['['] })],
    ['a check without its name', rule('check', {})],
    ['a parameter of another kind', rule('json', { path: 'a.json', schema: {}, min: 1 })],
  ])('refuses %s', (_, candidate) => {
    expect(zRule.safeParse(candidate).success).toBe(false);
  });
});

describe('zVerdict', () => {
  it('reads a passed and an incomplete verdict, headSha optional', () => {
    const passed = { contractId: 'prd', version: 2, status: 'passed', failedRuleIds: [], warningRuleIds: ['prd.scope'] };
    expect(zVerdict.parse(passed)).toEqual(passed);
    const incomplete = { ...passed, status: 'incomplete', failedRuleIds: ['prd.stories.unique'], headSha: 'a'.repeat(40) };
    expect(zVerdict.parse(incomplete)).toEqual(incomplete);
  });

  it('refuses a status other than passed or incomplete', () => {
    expect(zVerdict.safeParse({ contractId: 'prd', version: 1, status: 'failed', failedRuleIds: [], warningRuleIds: [] }).success).toBe(false);
  });
});
