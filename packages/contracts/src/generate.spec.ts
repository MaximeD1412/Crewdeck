import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { renderGoConstants, renderJsonSchema } from './generate.js';
import { goConstants, registry } from './registry.js';

describe('renderJsonSchema', () => {
  it('matches the committed JSON Schema of every registry entry', () => {
    for (const entry of registry) {
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
