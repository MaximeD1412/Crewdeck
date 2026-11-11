#!/usr/bin/env node
// Throwaway PreToolUse hook for the RUNNER-1 spike (matcher AskUserQuestion).
// Logs what it receives to $SPIKE_DIR/hook.jsonl, writes the question to
// $SPIKE_DIR/pending/<tool_use_id>.json and holds until
// $SPIKE_DIR/answers/<tool_use_id>.json exists. That file holds
// {"stdout": <object printed as the hook's JSON output>, "exit": <code>}
// so the spike can try several hook outputs. Not part of the Runner.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.env.SPIKE_DIR;
if (!dir) throw new Error('SPIKE_DIR is required');
fs.mkdirSync(path.join(dir, 'pending'), { recursive: true });
fs.mkdirSync(path.join(dir, 'answers'), { recursive: true });
const log = path.join(dir, 'hook.jsonl');
const record = (direction, payload) =>
  fs.appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), direction, payload }) + '\n');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', async () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    input = raw;
  }
  record('in', input);
  const id = input?.tool_use_id ?? `hook-${Date.now()}`;
  fs.writeFileSync(path.join(dir, 'pending', `${id}.json`), JSON.stringify(input, null, 2));
  const file = path.join(dir, 'answers', `${id}.json`);
  for (;;) {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').trim()) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const answer = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.rmSync(path.join(dir, 'pending', `${id}.json`), { force: true });
  record('out', answer);
  if (answer.stdout !== undefined) process.stdout.write(JSON.stringify(answer.stdout));
  if (answer.stderr) process.stderr.write(answer.stderr);
  process.exit(answer.exit ?? 0);
});
