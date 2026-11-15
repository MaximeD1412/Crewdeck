import type { z } from 'zod';
import {
  FOR_EACH,
  LOOP_BACK_MAX_DEFAULT,
  type ProcessDefinition,
  processSealAad,
  templateSealAad,
  zProcessDefinition,
  zProcessId,
  zProcessSealedPayload,
  zTool,
} from './definition.js';
import { zSealedItem } from '../keys/sealed.js';

const definition = (): ProcessDefinition => ({
  schemaVersion: 1,
  phases: [{ id: 'ph-dev', name: 'Développement', col: 1, row: 1, forEach: 'ticket.ready' }],
  steps: [
    {
      id: 'st-code',
      phaseId: 'ph-dev',
      kind: 'code',
      name: 'Code',
      col: 1,
      row: 1,
      inputs: [{ id: 'ticket', type: 'ticket' }],
      outputs: [{ id: 'changement', type: 'code-change' }],
      tools: [
        { kind: 'role', roleId: 'code' },
        { kind: 'skill', skillId: 'code' },
      ],
    },
    {
      id: 'st-review',
      phaseId: 'ph-dev',
      kind: 'review',
      name: 'Review',
      col: 2,
      row: 1,
      inputs: [{ id: 'changement', type: 'code-change', note: 'du Code' }],
      outputs: [{ id: 'verdict', type: 'verdict' }],
      tools: [{ kind: 'role', roleId: 'r-a1b2c3d4' }],
    },
  ],
  arrows: [{ from: { stepId: 'st-code', portId: 'changement' }, to: { stepId: 'st-review', portId: 'changement' } }],
  loopBacks: [{ from: 'st-review', to: 'st-code', max: 3 }],
  commands: [{ id: 'cmd-tests' }],
});

/** The paths of the issues of `value`, each once, or `[]` when it parses. */
const refusedAt = (value: unknown, schema: z.ZodType = zProcessDefinition) => {
  const result = schema.safeParse(value);
  if (result.success) return [];
  const paths = new Map(result.error.issues.map((issue) => [JSON.stringify(issue.path), issue.path]));
  return [...paths.values()];
};

const times = <T>(n: number, item: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => item(i));

describe('zProcessDefinition', () => {
  it('parses a definition, every block within its bounds', () => {
    expect(zProcessDefinition.parse(definition())).toEqual(definition());
  });

  it('trims the names', () => {
    const value = definition();
    value.phases[0]!.name = '  Développement ';
    value.steps[0]!.name = ' Code ';
    const parsed = zProcessDefinition.parse(value);
    expect(parsed.phases[0]!.name).toBe('Développement');
    expect(parsed.steps[0]!.name).toBe('Code');
  });

  it('refuses a schemaVersion other than 1', () => {
    expect(refusedAt({ ...definition(), schemaVersion: 2 })).toEqual([['schemaVersion']]);
  });

  it('refuses an id that is not lower-case words joined by dashes, or longer than 40', () => {
    for (const id of ['Code', 'st_code', '-st', 'st-', 'st--code', '', 'a'.repeat(41)]) {
      const value = definition();
      value.phases[0]!.id = id;
      expect(refusedAt(value), id).toEqual([['phases', 0, 'id']]);
    }
    expect(zProcessId.safeParse('a'.repeat(40)).success).toBe(true);
    expect(zProcessId.safeParse('st-code').success).toBe(true);
  });

  it('refuses a name of 61 characters, or empty once trimmed', () => {
    const value = definition();
    value.steps[0]!.name = 'a'.repeat(61);
    expect(refusedAt(value)).toEqual([['steps', 0, 'name']]);
    value.steps[0]!.name = '   ';
    expect(refusedAt(value)).toEqual([['steps', 0, 'name']]);
    value.steps[0]!.name = 'a'.repeat(60);
    expect(refusedAt(value)).toEqual([]);
    value.phases[0]!.name = 'a'.repeat(61);
    expect(refusedAt(value)).toEqual([['phases', 0, 'name']]);
  });

  it('refuses a position off the grid of 50 by 50', () => {
    for (const [field, cell] of [['col', 0], ['row', 51], ['col', 1.5]] as const) {
      const value = definition();
      value.steps[1]![field] = cell;
      expect(refusedAt(value), `${field} ${cell}`).toEqual([['steps', 1, field]]);
      const phase = definition();
      phase.phases[0]![field] = cell;
      expect(refusedAt(phase), `phase ${field} ${cell}`).toEqual([['phases', 0, field]]);
    }
  });

  it('refuses a Phase carrying a phaseId: no Phase inside a Phase', () => {
    const value = definition();
    expect(refusedAt({ ...value, phases: [{ ...value.phases[0], phaseId: 'ph-autre' }] })).toEqual([['phases', 0]]);
  });

  it('refuses a field it does not know, in any block', () => {
    const value = definition();
    expect(refusedAt({ ...value, extra: true })).toEqual([[]]);
    expect(refusedAt({ ...value, steps: [{ ...value.steps[0], col: 1, color: 'red' }, value.steps[1]] })).toEqual([['steps', 0]]);
    expect(refusedAt({ ...value, arrows: [{ ...value.arrows[0], max: 1 }] })).toEqual([['arrows', 0]]);
  });

  it('refuses a « pour chaque » outside the closed list', () => {
    const value = definition();
    (value.phases[0] as { forEach: unknown }).forEach = 'ticket.done';
    expect(refusedAt(value)).toEqual([['phases', 0, 'forEach']]);
    value.phases[0]!.forEach = null;
    expect(refusedAt(value)).toEqual([]);
    expect(FOR_EACH).toEqual({
      'idea.noted': { type: 'idea', label: 'chaque Idée notée' },
      'idea.retained': { type: 'idea', label: 'chaque Idée retenue' },
      'ticket.ready': { type: 'ticket', label: 'chaque Ticket prêt' },
    });
  });

  it('refuses a kind outside the catalogue', () => {
    const value = definition();
    (value.steps[0] as { kind: string }).kind = 'deploy';
    expect(refusedAt(value)).toEqual([['steps', 0, 'kind']]);
  });

  it('refuses a port of an unknown type, or whose note is empty or longer than 40', () => {
    const value = definition();
    (value.steps[0]!.inputs[0] as { type: string }).type = 'commit';
    expect(refusedAt(value)).toEqual([['steps', 0, 'inputs', 0, 'type']]);
    const note = definition();
    note.steps[1]!.inputs[0]!.note = 'a'.repeat(41);
    expect(refusedAt(note)).toEqual([['steps', 1, 'inputs', 0, 'note']]);
    note.steps[1]!.inputs[0]!.note = ' ';
    expect(refusedAt(note)).toEqual([['steps', 1, 'inputs', 0, 'note']]);
  });

  it('refuses more than 8 Entrées, 4 Sorties or 10 Outils on an Étape', () => {
    const value = definition();
    value.steps[0]!.inputs = times(9, (i) => ({ id: `in-${i}`, type: 'ticket' }));
    value.steps[0]!.outputs = times(5, (i) => ({ id: `out-${i}`, type: 'code-change' }));
    value.steps[0]!.tools = times(11, (i) => ({ kind: 'mcp', name: `mcp ${i}` }));
    expect(refusedAt(value)).toEqual([['steps', 0, 'inputs'], ['steps', 0, 'outputs'], ['steps', 0, 'tools']]);
    value.steps[0]!.inputs = value.steps[0]!.inputs.slice(0, 8);
    value.steps[0]!.outputs = value.steps[0]!.outputs.slice(0, 4);
    value.steps[0]!.tools = value.steps[0]!.tools.slice(0, 10);
    expect(refusedAt(value)).toEqual([]);
  });

  it('refuses a Retour whose maximum is not 1 to 10, and defaults it to 3', () => {
    expect(LOOP_BACK_MAX_DEFAULT).toBe(3);
    for (const max of [0, 11, 2.5]) {
      const value = definition();
      value.loopBacks[0]!.max = max;
      expect(refusedAt(value), String(max)).toEqual([['loopBacks', 0, 'max']]);
    }
    const ten = definition();
    ten.loopBacks[0]!.max = 10;
    expect(refusedAt(ten)).toEqual([]);
  });

  it('refuses no Phase, more than 20 Phases, 200 Étapes, 600 arrows, 50 Retours or 50 Commandes', () => {
    const value = definition();
    expect(refusedAt({ ...value, phases: [] })).toEqual([['phases']]);
    expect(refusedAt({ ...value, phases: times(21, (i) => ({ ...value.phases[0], id: `ph-${i}` })) })).toEqual([['phases']]);
    expect(refusedAt({ ...value, steps: times(201, (i) => ({ ...value.steps[0], id: `st-${i}` })) })).toEqual([['steps']]);
    expect(refusedAt({ ...value, arrows: times(601, () => value.arrows[0]) })).toEqual([['arrows']]);
    expect(refusedAt({ ...value, loopBacks: times(51, () => value.loopBacks[0]) })).toEqual([['loopBacks']]);
    expect(refusedAt({ ...value, commands: times(51, (i) => ({ id: `cmd-${i}` })) })).toEqual([['commands']]);
    expect(refusedAt({ ...value, phases: times(20, (i) => ({ ...value.phases[0], id: `ph-${i}` })), commands: times(50, (i) => ({ id: `cmd-${i}` })) })).toEqual([]);
  });

  it('refuses an arrow whose ends are not ids', () => {
    const value = definition();
    value.arrows[0]!.to.portId = 'Changement';
    expect(refusedAt(value)).toEqual([['arrows', 0, 'to', 'portId']]);
  });
});

describe('zTool', () => {
  it('takes a Rôle, a Skill, a Serveur MCP, a Commande and the GitHub Connecteur', () => {
    for (const tool of [
      { kind: 'role', roleId: 'review' },
      { kind: 'role', roleId: 'r-a1b2c3d4' },
      { kind: 'skill', skillId: 'plan-backlog' },
      { kind: 'mcp', name: 'Playwright' },
      { kind: 'command', commandId: 'cmd-tests' },
      { kind: 'connector', connector: 'github' },
    ]) {
      expect(refusedAt(tool, zTool), tool.kind).toEqual([]);
    }
  });

  it('refuses an unknown Rôle id, Skill id, Connecteur or kind, and an MCP name of 61 characters', () => {
    expect(refusedAt({ kind: 'role', roleId: 'tester' }, zTool)).toEqual([['roleId']]);
    expect(refusedAt({ kind: 'skill', skillId: 'Red_Green' }, zTool)).toEqual([['skillId']]);
    expect(refusedAt({ kind: 'connector', connector: 'gitlab' }, zTool)).toEqual([['connector']]);
    expect(refusedAt({ kind: 'mcp', name: 'a'.repeat(61) }, zTool)).toEqual([['name']]);
    expect(refusedAt({ kind: 'command', commandId: 'Tests' }, zTool)).toEqual([['commandId']]);
    expect(refusedAt({ kind: 'script', run: 'ls' }, zTool)).toEqual([['kind']]);
    expect(refusedAt({ kind: 'skill', skillId: 'code', roleId: 'code' }, zTool)).toEqual([[]]);
  });
});

describe('the sealed part', () => {
  const bytes = (n: number) => Buffer.alloc(n, 7).toString('base64url');

  it('is a sealed item: a key of 60 bytes and a ciphertext of 16 to 65536 bytes', () => {
    expect(refusedAt({ key: bytes(60), ciphertext: bytes(16) }, zSealedItem)).toEqual([]);
    expect(refusedAt({ key: bytes(60), ciphertext: bytes(65536) }, zSealedItem)).toEqual([]);
    expect(refusedAt({ key: bytes(59), ciphertext: bytes(16) }, zSealedItem)).toEqual([['key']]);
    expect(refusedAt({ key: bytes(60), ciphertext: bytes(15) }, zSealedItem)).toEqual([['ciphertext']]);
    expect(refusedAt({ key: bytes(60), ciphertext: bytes(65537) }, zSealedItem)).toEqual([['ciphertext']]);
  });

  it('opens to the Commandes by id: their text, their place and their health address', () => {
    const payload = {
      commands: {
        'cmd-tests': { run: 'pnpm test', where: 'worktree' },
        'cmd-dev': { run: 'pnpm dev', where: 'project', healthUrl: 'http://localhost:3000/health' },
      },
    };
    expect(zProcessSealedPayload.parse(payload)).toEqual(payload);
    expect(refusedAt({ commands: {} }, zProcessSealedPayload)).toEqual([]);
  });

  it('refuses a Commande with an empty text or one of 4001 characters, another place, a non-http address, an id that is not one', () => {
    const one = (command: object, id = 'cmd-tests') => ({ commands: { [id]: { run: 'pnpm test', where: 'worktree', ...command } } });
    expect(refusedAt(one({ run: '' }), zProcessSealedPayload)).toEqual([['commands', 'cmd-tests', 'run']]);
    expect(refusedAt(one({ run: 'a'.repeat(4001) }), zProcessSealedPayload)).toEqual([['commands', 'cmd-tests', 'run']]);
    expect(refusedAt(one({ run: 'a'.repeat(4000) }), zProcessSealedPayload)).toEqual([]);
    expect(refusedAt(one({ where: 'home' }), zProcessSealedPayload)).toEqual([['commands', 'cmd-tests', 'where']]);
    expect(refusedAt(one({ healthUrl: 'ftp://localhost/health' }), zProcessSealedPayload)).toEqual([['commands', 'cmd-tests', 'healthUrl']]);
    expect(refusedAt(one({ healthUrl: 'https://localhost:5173' }), zProcessSealedPayload)).toEqual([]);
    expect(refusedAt(one({}, 'Tests'), zProcessSealedPayload)).not.toEqual([]);
    expect(refusedAt(one({ env: 'x' }), zProcessSealedPayload)).toEqual([['commands', 'cmd-tests']]);
  });

  it('is sealed with the Projet’s or the Modèle’s id as additional data', () => {
    expect(processSealAad('0190c3c4-5e6f-7a8b-9c0d-1e2f3a4b5c6d')).toBe('process:0190c3c4-5e6f-7a8b-9c0d-1e2f3a4b5c6d');
    expect(templateSealAad('process-crewdeck')).toBe('template:process-crewdeck');
  });
});
