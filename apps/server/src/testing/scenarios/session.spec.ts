import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type EngineEvent, zEngineEvent } from '@crewdeck/contracts';
import { findScenario } from './index.js';
import { PERMISSION_REQUEST, QUESTION_REQUEST, SESSION_PATH, permissionLog, questionLog } from './session.js';

const STREAMS = join(import.meta.dirname, '../../../../../packages/contracts/fixtures/runner/sessions');
const stream = (name: string): EngineEvent[] =>
  readFileSync(join(STREAMS, `${name}.jsonl`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => zEngineEvent.parse(JSON.parse(line)));
/** The events without their instant: the scenarios date them from now. */
const undated = (events: readonly EngineEvent[]) => events.map(({ at: _at, ...event }) => event);

describe('the scenarios of a Session’s requests (SESSION-3)', () => {
  it('hold the recorded streams of a question and a permission, their request last', () => {
    const now = Date.parse('2026-11-11T14:21:00.000Z');
    expect(undated(questionLog(now))).toEqual(undated(stream('question')));
    expect(undated(permissionLog(now))).toEqual(undated(stream('permission')));
    expect(questionLog(now).at(-1)).toMatchObject({ kind: 'question', ...QUESTION_REQUEST });
    expect(permissionLog(now).at(-1)).toMatchObject({ kind: 'permission-request', ...PERMISSION_REQUEST });
  });

  it('open the panel of the Session over « À toi »', () => {
    expect(['session-question', 'session-permission'].map((name) => findScenario(name)?.path)).toEqual([SESSION_PATH, SESSION_PATH]);
  });
});
