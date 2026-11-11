import { nextGettingStartedStep, zGettingStartedAdvance, zGithubToken, zMe } from '../index.js';

describe('zMe', () => {
  const me = { id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a7b', login: 'octocat', avatarUrl: 'https://avatars.example/u/1', timeZone: 'Europe/Paris', gettingStartedStep: 'runner' };

  it('accepts the Pilote, with or without an avatar', () => {
    expect(zMe.parse(me)).toEqual(me);
    expect(zMe.parse({ ...me, avatarUrl: null })).toMatchObject({ avatarUrl: null });
  });

  it('rejects an id that is not a UUIDv7, an empty login', () => {
    expect(zMe.safeParse({ ...me, id: 'p1' }).success).toBe(false);
    expect(zMe.safeParse({ ...me, login: '' }).success).toBe(false);
  });

  it('carries the step of « Premiers pas »: runner, ai-accounts, projects or done', () => {
    expect(zMe.parse({ ...me, gettingStartedStep: 'done' })).toMatchObject({ gettingStartedStep: 'done' });
    expect(zMe.safeParse({ ...me, gettingStartedStep: 'comptes' }).success).toBe(false);
  });
});

describe('the getting started', () => {
  it('goes from runner to ai-accounts to projects to done, and stays there', () => {
    expect(['runner', 'ai-accounts', 'projects', 'done'].map((step) => nextGettingStartedStep(step as 'runner'))).toEqual(['ai-accounts', 'projects', 'done', 'done']);
  });

  it('advances from a step before done, with the seq', () => {
    expect(zGettingStartedAdvance.parse({ from: 'runner', seq: 3 })).toEqual({ from: 'runner', seq: 3 });
    expect(zGettingStartedAdvance.safeParse({ from: 'done', seq: 3 }).success).toBe(false);
  });
});

describe('zGithubToken', () => {
  it('accepts a token and its expiry as an instant, nothing else', () => {
    expect(zGithubToken.parse({ accessToken: 'ghu_x', expiresAt: '2026-11-11T08:00:00.000Z' })).toEqual({ accessToken: 'ghu_x', expiresAt: '2026-11-11T08:00:00.000Z' });
    expect(zGithubToken.safeParse({ accessToken: 'ghu_x', expiresAt: 'tomorrow' }).success).toBe(false);
    expect(zGithubToken.safeParse({ accessToken: '', expiresAt: '2026-11-11T08:00:00.000Z' }).success).toBe(false);
  });
});
