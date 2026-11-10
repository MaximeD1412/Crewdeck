import { ERROR_CODE_PATTERN } from '@crewdeck/contracts';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MESSAGES } from './messages.js';

const srcRoot = join(import.meta.dirname, '..');

/** The codes a source thrown as an `AppError`, directly or through a helper. */
const thrownCodes = (source: string): string[] => {
  const calls = /(?:new\s+AppError\s*\(\s*\d+\s*,|\b(?:notFound|conflict|unprocessable)\s*\()\s*['"`]([^'"`]+)['"`]/g;
  return [...source.matchAll(calls)].map((match) => match[1] ?? '');
};

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });

describe('MESSAGES', () => {
  it.each(Object.keys(MESSAGES))('%s matches <module>.<case>', (code) => {
    expect(code).toMatch(ERROR_CODE_PATTERN);
  });

  it('has a French message, never empty, for each code', () => {
    for (const message of Object.values(MESSAGES)) expect(message.trim()).not.toBe('');
  });

  it('has a message for every code thrown in src/', () => {
    const missing = sourceFiles(srcRoot).flatMap((file) =>
      thrownCodes(readFileSync(file, 'utf8'))
        .filter((code) => !(code in MESSAGES))
        .map((code) => `${relative(srcRoot, file)}: ${code}`),
    );

    expect(missing).toEqual([]);
  });

  it('finds the codes of AppError and of its helpers', () => {
    const source = `
      throw new AppError(422, 'idea.already-retained', MESSAGES['idea.already-retained']);
      throw notFound("idea.not-found", m);
      throw conflict(
        'realtime.stale', m);
      throw unprocessable('loop.runner-offline', m, { runner: 'x' });
      const notACall = 'notFound';
    `;

    expect(thrownCodes(source)).toEqual(['idea.already-retained', 'idea.not-found', 'realtime.stale', 'loop.runner-offline']);
  });
});
