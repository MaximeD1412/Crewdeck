// Which projects in scope run a target, and which of them drive a browser
// through Playwright (`playwright` or `@playwright/test` in their own
// node_modules). Reads the project names (`nx show projects --json`) and the
// project graph (`nx graph --file=stdout`) from the files given as
// arguments, prints `key=value` lines for $GITHUB_OUTPUT:
//
//   projects=<the projects in scope with the target, space-separated>
//   playwright=<the Playwright version of the first one that has it, or empty>
//   root=<that project's root, where `playwright install` runs>
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [namesFile, graphFile] = process.argv.slice(2);
const names = JSON.parse(readFileSync(namesFile, 'utf8'));
const nodes = JSON.parse(readFileSync(graphFile, 'utf8')).graph.nodes;

let playwright = '';
let root = '';
for (const name of names) {
  const projectRoot = nodes[name]?.data?.root;
  if (!projectRoot) continue;
  const manifest = ['playwright', '@playwright/test']
    .map((pkg) => join(projectRoot, 'node_modules', pkg, 'package.json'))
    .find((path) => existsSync(path));
  if (manifest) {
    playwright = JSON.parse(readFileSync(manifest, 'utf8')).version;
    root = projectRoot;
    break;
  }
}

console.log(`projects=${names.join(' ')}`);
console.log(`playwright=${playwright}`);
console.log(`root=${root}`);
