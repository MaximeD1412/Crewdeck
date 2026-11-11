import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { exampleContrat } from '../fixtures/contrats/example.js';
import { zContrat } from './contrats/index.js';
import { contratFileName, embeddedContrats, renderContrat, renderGoConstants, renderGoUnion, renderJsonSchema } from './generate.js';
import { generatedEntries, goConstants, goUnions } from './registry.js';

describe('renderJsonSchema', () => {
  it('matches the committed JSON Schema of every registry entry and of every option of a union', () => {
    expect(generatedEntries.map((entry) => entry.name)).toContain('engine-event-tool-call');
    for (const entry of generatedEntries) {
      const committed = readFileSync(
        join(import.meta.dirname, '../generated/json-schema', `${entry.name}.schema.json`),
        'utf8',
      );
      expect(renderJsonSchema(entry), entry.name).toBe(committed);
    }
  });

  it('writes draft 2020-12 with the entry name as title', () => {
    const rendered = JSON.parse(renderJsonSchema({ name: 'agent-session', schema: z.object({ id: z.string() }) }));
    expect(rendered.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(rendered.title).toBe('AgentSession');
  });

  it('sorts object keys so that the output does not depend on declaration order', () => {
    const a = renderJsonSchema({ name: 'x', schema: z.object({ b: z.string(), a: z.number() }) });
    const b = renderJsonSchema({ name: 'x', schema: z.object({ a: z.number(), b: z.string() }) });
    expect(a).toBe(b);
    expect(Object.keys(JSON.parse(a))).toEqual([...Object.keys(JSON.parse(a))].sort());
  });

  it('matches the committed Go constants', () => {
    const committed = readFileSync(join(import.meta.dirname, '../../../apps/runner/internal/contracts/constants.go'), 'utf8');
    expect(renderGoConstants(goConstants)).toBe(committed);
    expect(committed).toMatch(/^\tProtocolVersion += 1$/m);
  });
});

describe('renderGoUnion', () => {
  const goDir = join(import.meta.dirname, '../../../apps/runner/internal/contracts');

  it('matches the committed Go file of every union', () => {
    for (const union of goUnions) {
      expect(renderGoUnion(union), union.name).toBe(readFileSync(join(goDir, `${union.name}.go`), 'utf8'));
    }
  });

  it('holds one pointer per option, its kind constant, and dispatches on the discriminator', () => {
    const go = renderGoUnion({
      name: 'agent-step',
      discriminator: 'kind',
      options: [
        { value: 'tool-call', schema: z.object({ kind: z.literal('tool-call') }) },
        { value: 'error', schema: z.object({ kind: z.literal('error') }) },
      ],
    });
    expect(go).toContain('type AgentStep struct {\n\tError    *AgentStepError\n\tToolCall *AgentStepToolCall\n}\n');
    expect(go).toMatch(/^\tAgentStepKindToolCall = "tool-call"$/m);
    expect(go).toContain('var head struct {\n\t\tKind string `json:"kind"`\n\t}');
    expect(go).toContain('\tcase AgentStepKindError:\n\t\tu.Error = new(AgentStepError)\n\t\treturn json.Unmarshal(data, u.Error)\n');
  });
});

describe('renderContrat', () => {
  const runnerContrats = join(import.meta.dirname, '../../../apps/runner/internal/contrat/contrats');

  it('matches the JSON the Runner embeds, one file per Contrat and no other, each valid against zContrat', () => {
    const committed = readdirSync(runnerContrats).filter((file) => file.endsWith('.json'));
    expect(committed.sort()).toEqual(embeddedContrats.map(contratFileName).sort());
    for (const contrat of embeddedContrats) {
      const text = readFileSync(join(runnerContrats, contratFileName(contrat)), 'utf8');
      expect(text, contratFileName(contrat)).toBe(renderContrat(contrat));
      expect(zContrat.parse(JSON.parse(text))).toEqual(contrat);
    }
  });

  it('embeds the example Contrat, and writes it beside its fixtures', () => {
    expect(contratFileName(exampleContrat)).toBe('example.v1.json');
    expect(embeddedContrats).toContain(exampleContrat);
    expect(readFileSync(join(import.meta.dirname, '../fixtures/contrats/example.json'), 'utf8')).toBe(renderContrat(exampleContrat));
  });
});
