#!/usr/bin/env node
// Throwaway: answers every pending request of a spike scenario folder.
//
//   answer.mjs <dir> allow                  permission tool: allow, input unchanged
//   answer.mjs <dir> deny "<message>"       permission tool: deny
//   answer.mjs <dir> ask "<label>"          AskUserQuestion hook: answers every question with <label>
//   answer.mjs <dir> accept|decline         Codex approval request: {decision}
//   answer.mjs <dir> input "<label>"        Codex requestUserInput: <label> to every question
//   answer.mjs <dir> raw '<json>'           writes <json> as the answer file as is
//
// Not part of the Runner.
import fs from 'node:fs';
import path from 'node:path';

const [dir, kind, extra] = process.argv.slice(2);
const pending = path.join(dir, 'pending');
const files = fs.existsSync(pending) ? fs.readdirSync(pending) : [];
if (!files.length) {
  console.log('nothing pending');
  process.exit(1);
}
fs.mkdirSync(path.join(dir, 'answers'), { recursive: true });
for (const f of files) {
  const req = JSON.parse(fs.readFileSync(path.join(pending, f), 'utf8'));
  let answer;
  if (kind === 'allow') answer = { behavior: 'allow', updatedInput: req.params.arguments.input };
  else if (kind === 'deny') answer = { behavior: 'deny', message: extra ?? 'Refusé par le Pilote.' };
  else if (['accept', 'acceptForSession', 'decline', 'cancel'].includes(kind)) answer = { decision: kind };
  else if (kind === 'input') {
    // Codex app-server item/tool/requestUserInput: <label> to every question
    const qs = req.request.params.questions;
    answer = { answers: Object.fromEntries(qs.map((q) => [q.id, { answers: [extra] }])) };
  } else if (kind === 'ask') {
    // hook: the question's own input, plus the answer (label) to each question
    const input = req.tool_input;
    const answers = Object.fromEntries(input.questions.map((q) => [q.question, extra]));
    answer = {
      stdout: {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          updatedInput: { ...input, answers },
        },
      },
    };
  }
  else answer = JSON.parse(extra);
  fs.writeFileSync(path.join(dir, 'answers', f), JSON.stringify(answer));
  console.log(`${f}: ${kind}`);
}
