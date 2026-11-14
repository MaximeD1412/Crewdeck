import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROCESS_CASES } from '../../fixtures/process/cases.js';
import { processCaseFileName, renderProcessCase } from '../generate.js';
import { zProcessDefinition } from './definition.js';
import { findGaps, GAP_KINDS, type ProcessGap, type Refusal, REFUSAL_KINDS, validateDefinition } from './gaps.js';
import { type ProcessSources, zProcessSources } from './sources.js';
import { PROCESS_CREWDECK } from './templates/process-crewdeck.js';

const FIXTURES = join(import.meta.dirname, '../../fixtures/process');

interface Fixture {
  file: string;
  change: string;
  definition: unknown;
  sources: unknown;
  refusals: Refusal[];
  gaps: ProcessGap[] | null;
}

const fixtures: Fixture[] = readdirSync(FIXTURES)
  .filter((file) => file.endsWith('.json'))
  .sort()
  .map((file) => ({ file, ...JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) }));

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
};

describe('the fixtures of fixtures/process/', () => {
  it('are the cases of cases.ts, as contracts:generate writes them', () => {
    expect(fixtures.map((fixture) => fixture.file)).toEqual(PROCESS_CASES.map(processCaseFileName).sort());
    for (const processCase of PROCESS_CASES) {
      expect(readFileSync(join(FIXTURES, processCaseFileName(processCase)), 'utf8'), processCase.name).toBe(renderProcessCase(processCase));
    }
  });

  it('hold definitions and Sources their schemas accept', () => {
    for (const fixture of fixtures) {
      expect(zProcessDefinition.parse(fixture.definition), fixture.file).toEqual(fixture.definition);
      expect(zProcessSources.parse(fixture.sources), fixture.file).toEqual(fixture.sources);
    }
  });

  describe.each(fixtures)('$file', (fixture) => {
    const definition = deepFreeze(zProcessDefinition.parse(fixture.definition));
    const sources = deepFreeze(zProcessSources.parse(fixture.sources));

    it('validateDefinition gives exactly its refusals', () => {
      expect(validateDefinition(definition)).toEqual(fixture.refusals);
    });

    it.runIf(fixture.gaps !== null)('findGaps gives exactly its Manques', () => {
      expect(findGaps(definition, sources)).toEqual(fixture.gaps);
    });
  });

  it('have, for each refusal kind, a case where it is the only refusal', () => {
    const alone = new Set(fixtures.flatMap(({ refusals }) => (refusals.length === 1 ? refusals.map((refusal) => refusal.kind) : [])));
    expect([...REFUSAL_KINDS].filter((kind) => !alone.has(kind))).toEqual([]);
  });

  it('have, for each Manque kind, a case where it is the only Manque', () => {
    const alone = new Set(fixtures.flatMap(({ gaps }) => (gaps?.length === 1 ? gaps.map((gap) => gap.kind) : [])));
    expect([...GAP_KINDS].filter((kind) => !alone.has(kind))).toEqual([]);
  });
});

describe('« Process Crewdeck »', () => {
  const both = (kind: ProcessSources['code']): ProcessSources => ({ ticket: kind, code: kind });

  it('has no refusal', () => {
    expect(validateDefinition(PROCESS_CREWDECK)).toEqual([]);
  });

  it('has no Manque with both groups on GitHub', () => {
    expect(findGaps(PROCESS_CREWDECK, both('github'))).toEqual([]);
  });

  it('has one Manque with both groups Local: the Checks have no CI', () => {
    expect(findGaps(PROCESS_CREWDECK, both('local'))).toEqual([
      { kind: 'capability.missing', target: 'steps.st-checks', label: '« Checks » a besoin de la CI du dépôt ou d’une Commande : aucun Outil attaché n’en donne' },
    ]);
  });
});
