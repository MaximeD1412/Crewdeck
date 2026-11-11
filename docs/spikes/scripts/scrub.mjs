#!/usr/bin/env node
// Throwaway: scrubs a spike recording before it is committed.
//
//   scrub.mjs <in.jsonl> <out.jsonl>
//
// Machine paths become /home/pilote/…, the user name `pilote`, emails
// `<email>`, the host name `pilote-machine`, Anthropic's message ids
// `msg_spike<n>` (one map per file); anything given in
// SPIKE_SCRUB_EXTRA (JSON array of [from, to]) is replaced too. Fails if an
// output line no longer parses. Not part of the Runner.
import fs from 'node:fs';
import os from 'node:os';

const [input, output] = process.argv.slice(2);
const user = os.userInfo().username;
const home = os.homedir();
const host = os.hostname();
const literal = [
  ['/tmp/crewdeck-spike/spike', '/home/pilote/spike'],
  ['-tmp-crewdeck-spike-spike', '-home-pilote-spike'],
  ['/tmp/crewdeck-spike/plugin', '/home/pilote/.crewdeck/sessions/spike/plugin'],
  ['/tmp/crewdeck-spike/codex-home', '/home/pilote/.crewdeck/sessions/spike/codex-home'],
  ['/tmp/crewdeck-spike/home-codex', '/home/pilote'],
  ['/tmp/crewdeck-spike/home-empty', '/home/pilote'],
  ['/tmp/crewdeck-spike/outside', '/home/pilote/outside'],
  ['/tmp/crewdeck-spike', '/home/pilote/spike-root'],
  [home, '/home/pilote'],
  ...JSON.parse(process.env.SPIKE_SCRUB_EXTRA ?? '[]'),
];
const patterns = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>'],
  [new RegExp(host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'pilote-machine'],
  [new RegExp(`\\b${user}\\b`, 'g'), 'pilote'],
  [/\/run\/user\/\d+\/cc-socks\/\d+\.sock/g, '/run/user/1000/cc-socks/0.sock'],
  [/"installationId":"[0-9a-f-]+"/g, '"installationId":"00000000-0000-4000-8000-000000000000"'],
  [/"pid":\d+/g, '"pid":4242'],
];

// Anthropic's message ids (msg_…) next to the word "api" trip gitleaks'
// generic-api-key rule: each becomes msg_spike<n>, the same id everywhere.
const messageIds = new Map();
const messageId = (id) => {
  if (!messageIds.has(id)) messageIds.set(id, `msg_spike${String(messageIds.size + 1).padStart(4, '0')}`);
  return messageIds.get(id);
};

const lines = fs.readFileSync(input, 'utf8').split('\n').filter((l) => l.length);
const out = lines.map((line, i) => {
  let s = line;
  for (const [from, to] of literal) s = s.split(from).join(to);
  for (const [re, to] of patterns) s = s.replace(re, to);
  s = s.replace(/msg_[A-Za-z0-9]{12,}/g, messageId);
  try {
    JSON.parse(s);
  } catch (e) {
    throw new Error(`${input}:${i + 1} no longer parses: ${e.message}`);
  }
  return s;
});
fs.writeFileSync(output, out.join('\n') + '\n');
console.log(`${output}: ${out.length} lines`);
