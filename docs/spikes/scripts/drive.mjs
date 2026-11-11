#!/usr/bin/env node
// Throwaway driver for the RUNNER-1 spike: starts a Moteur, plays a list of
// steps on its stdin and records everything. Not part of the Runner.
//
//   node drive.mjs --dir <out dir> --name <scenario> --cwd <repo> \
//     --steps '<json array>'|<steps file> [--env '<json object>'] -- <command> <args…>
//
// Writes <dir>/<name>.stdout.jsonl (the raw stdout, line by line),
// <name>.stdin.jsonl (what was written), <name>.timeline.jsonl (both, plus
// stderr and exit, timestamped) and <name>.stderr.txt. The child gets
// SPIKE_DIR=<dir> and none of the CLAUDE* variables of the calling session.
//
// Steps: {"send": "text" | object}, {"interrupt": true}, {"control": {…}},
// {"untilType": "result", "timeoutMs": n}, {"untilMatch": "regex"},
// {"untilPending": true}, {"sleep": ms}, {"kill": "SIGKILL"},
// {"closeStdin": true}, {"untilExit": true}.
// untilType and untilMatch take "capture": {"name": "dot.path"}, a value of
// the matched line that later sends use as "{{name}}".
//
// With --serverRequests on (Codex app-server), a JSON-RPC request from the
// Moteur (a line with "method" and "id") is written to <dir>/pending/<id>.json
// and held until <dir>/answers/<id>.json exists; its content is sent back as
// the "result".
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const opts = {};
for (let i = 0; i < sep; i += 2) opts[argv[i].replace(/^--/, '')] = argv[i + 1];
const [cmd, ...args] = argv.slice(sep + 1);
const dir = path.resolve(opts.dir);
const name = opts.name;
const rawSteps = opts.steps ?? '[]';
const steps = JSON.parse(rawSteps.trimStart().startsWith('[') ? rawSteps : fs.readFileSync(rawSteps, 'utf8'));
fs.mkdirSync(dir, { recursive: true });

const out = (suffix) => path.join(dir, `${name}.${suffix}`);
for (const s of ['stdout.jsonl', 'stdin.jsonl', 'timeline.jsonl', 'stderr.txt']) fs.writeFileSync(out(s), '');
const timeline = (dirn, line) =>
  fs.appendFileSync(out('timeline.jsonl'), JSON.stringify({ at: new Date().toISOString(), dir: dirn, line }) + '\n');

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE')));
Object.assign(env, { SPIKE_DIR: dir }, JSON.parse(opts.env ?? '{}'));

const child = spawn(cmd, args, { cwd: opts.cwd ?? process.cwd(), env, stdio: ['pipe', 'pipe', 'pipe'] });
timeline('spawn', { cmd, args, pid: child.pid });

const lines = [];
let waiters = [];
const notify = () => {
  waiters = waiters.filter((w) => !w());
};
let exited = null;
readline.createInterface({ input: child.stdout }).on('line', (line) => {
  fs.appendFileSync(out('stdout.jsonl'), line + '\n');
  timeline('out', line);
  let parsed = null;
  try {
    parsed = JSON.parse(line);
  } catch {}
  lines.push({ line, parsed });
  notify();
  if (opts.serverRequests === 'on' && parsed?.method && parsed.id !== undefined && !('result' in parsed))
    holdServerRequest(parsed);
});

async function holdServerRequest(req) {
  const id = String(req.id);
  fs.mkdirSync(path.join(dir, 'pending'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'answers'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'pending', `${id}.json`),
    JSON.stringify({ at: new Date().toISOString(), request: req }, null, 2),
  );
  const file = path.join(dir, 'answers', `${id}.json`);
  while (!(fs.existsSync(file) && fs.readFileSync(file, 'utf8').trim())) {
    if (exited) return;
    await sleep(500);
  }
  fs.rmSync(path.join(dir, 'pending', `${id}.json`), { force: true });
  write({ id: req.id, result: JSON.parse(fs.readFileSync(file, 'utf8')) });
}

const vars = {};
const dig = (obj, p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
const fill = (obj) => JSON.parse(JSON.stringify(obj).replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? ''));
const capture = (step, l) => {
  for (const [k, p] of Object.entries(step.capture ?? {})) vars[k] = dig(l.parsed, p);
  if (step.capture) timeline('captured', vars);
};
child.stderr.on('data', (d) => {
  fs.appendFileSync(out('stderr.txt'), d);
  timeline('stderr', d.toString());
});
child.on('exit', (code, signal) => {
  exited = { code, signal };
  timeline('exit', exited);
  notify();
});
child.stdin.on('error', (e) => timeline('stdin-error', String(e)));

const write = (obj) => {
  const line = typeof obj === 'string' ? obj : JSON.stringify(obj);
  fs.appendFileSync(out('stdin.jsonl'), line + '\n');
  timeline('in', line);
  child.stdin.write(line + '\n');
};

let reqId = 0;
const waitFor = (pred, timeoutMs = 600000) =>
  new Promise((resolve, reject) => {
    const start = lines.length;
    const check = () => {
      for (let i = start; i < lines.length; i++) if (pred(lines[i])) return resolve(lines[i]), true;
      if (exited) return reject(new Error(`exited ${JSON.stringify(exited)} while waiting`)), true;
      return false;
    };
    if (check()) return;
    waiters.push(check);
    setTimeout(() => reject(new Error('timeout')), timeoutMs).unref();
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  for (const step of steps) {
    timeline('step', step);
    try {
      if (step.send !== undefined)
        write(
          typeof step.send === 'string'
            ? { type: 'user', message: { role: 'user', content: step.send } }
            : fill(step.send),
        );
      else if (step.interrupt)
        write({ type: 'control_request', request_id: `drv-${++reqId}`, request: { subtype: 'interrupt' } });
      else if (step.control)
        write({ type: 'control_request', request_id: `drv-${++reqId}`, request: step.control });
      else if (step.untilType)
        capture(step, await waitFor((l) => l.parsed?.type === step.untilType, step.timeoutMs));
      else if (step.untilMatch)
        capture(step, await waitFor((l) => new RegExp(step.untilMatch).test(l.line), step.timeoutMs));
      else if (step.untilPending) {
        const p = path.join(dir, 'pending');
        const deadline = Date.now() + (step.timeoutMs ?? 600000);
        while (!(fs.existsSync(p) && fs.readdirSync(p).length) && !exited && Date.now() < deadline) await sleep(500);
      } else if (step.sleep) await sleep(step.sleep);
      else if (step.kill) child.kill(step.kill);
      else if (step.closeStdin) child.stdin.end();
      else if (step.untilExit) {
        const deadline = Date.now() + (step.timeoutMs ?? 120000);
        while (!exited && Date.now() < deadline) await sleep(200);
      }
    } catch (e) {
      timeline('step-error', String(e));
      console.error(`step ${JSON.stringify(step)}: ${e}`);
      break;
    }
  }
  if (!exited) {
    child.stdin.end();
    const deadline = Date.now() + 30000;
    while (!exited && Date.now() < deadline) await sleep(200);
    if (!exited) child.kill('SIGTERM');
  }
  await sleep(300);
  console.log(`${name}: ${lines.length} stdout lines, exit ${JSON.stringify(exited)}`);
  process.exit(0);
}
run();
