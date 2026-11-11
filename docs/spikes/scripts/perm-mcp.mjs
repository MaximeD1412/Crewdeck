#!/usr/bin/env node
// Throwaway stdio MCP server for the RUNNER-1 spike: the tool Claude Code
// calls through `--permission-prompt-tool mcp__spike__permission_prompt`.
// Logs every JSON-RPC message (both ways) to $SPIKE_DIR/permission-tool.jsonl,
// writes each request to $SPIKE_DIR/pending/<id>.json and holds it until
// $SPIKE_DIR/answers/<id>.json exists; that file's content is the decision
// returned verbatim, e.g. {"behavior":"allow","updatedInput":{...}} or
// {"behavior":"deny","message":"..."}. Not part of the Runner.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const dir = process.env.SPIKE_DIR;
if (!dir) throw new Error('SPIKE_DIR is required');
fs.mkdirSync(path.join(dir, 'pending'), { recursive: true });
fs.mkdirSync(path.join(dir, 'answers'), { recursive: true });
const log = path.join(dir, 'permission-tool.jsonl');

function record(direction, message) {
  fs.appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), direction, message }) + '\n');
}

function send(message) {
  record('out', message);
  process.stdout.write(JSON.stringify(message) + '\n');
}

let counter = 0;

async function waitForAnswer(id) {
  const file = path.join(dir, 'answers', `${id}.json`);
  for (;;) {
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, 'utf8').trim();
      if (text) return text;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function handle(msg) {
  record('in', msg);
  if (msg.id === undefined) return; // a notification
  switch (msg.method) {
    case 'initialize':
      return send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'crewdeck-spike', version: '0.0.0' },
        },
      });
    case 'ping':
      return send({ jsonrpc: '2.0', id: msg.id, result: {} });
    case 'tools/list':
      return send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: [
            {
              name: 'permission_prompt',
              description: 'Asks the Pilote whether a tool call may run.',
              inputSchema: {
                type: 'object',
                properties: {
                  tool_name: { type: 'string' },
                  input: { type: 'object' },
                  tool_use_id: { type: 'string' },
                },
                required: ['tool_name', 'input'],
              },
            },
          ],
        },
      });
    case 'tools/call': {
      const id = msg.params?.arguments?.tool_use_id ?? `req-${++counter}`;
      fs.writeFileSync(
        path.join(dir, 'pending', `${id}.json`),
        JSON.stringify({ at: new Date().toISOString(), params: msg.params }, null, 2),
      );
      // Claude Code aborts a call silent for ~30 min; a progress
      // notification every SPIKE_PROGRESS_MS keeps it alive.
      const token = msg.params?._meta?.progressToken;
      const every = Number(process.env.SPIKE_PROGRESS_MS ?? 0);
      let progress = 0;
      const keepAlive =
        every > 0 && token !== undefined
          ? setInterval(
              () =>
                send({
                  jsonrpc: '2.0',
                  method: 'notifications/progress',
                  params: { progressToken: token, progress: ++progress, message: 'En attente du Pilote' },
                }),
              every,
            )
          : null;
      const decision = await waitForAnswer(id);
      if (keepAlive) clearInterval(keepAlive);
      fs.rmSync(path.join(dir, 'pending', `${id}.json`), { force: true });
      return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: decision }] } });
    }
    default:
      return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `unknown method ${msg.method}` } });
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    record('in-unparsed', line);
    return;
  }
  handle(msg).catch((e) => record('error', String(e)));
});
rl.on('close', () => {
  record('closed', 'stdin closed');
  process.exit(0);
});
