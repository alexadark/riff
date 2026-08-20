#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installGitHookDispatchers } from './lib/git-hooks.mjs';

const frameworkRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
let projectRoot = process.cwd();
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] === '--project-root') {
    if (!argv[index + 1]) throw new Error('--project-root requires a value');
    projectRoot = argv[index + 1];
    index += 1;
  } else throw new Error(`unknown option: ${argv[index]}`);
}
const result = installGitHookDispatchers({ projectRoot: fs.realpathSync(projectRoot), frameworkRoot });
process.stdout.write(`${JSON.stringify(result)}\n`);
