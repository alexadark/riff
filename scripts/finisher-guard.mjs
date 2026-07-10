#!/usr/bin/env node
// No-merge guard: refuses to merge any branch referenced by a pending
// finisher. Wired into EVERY merge path (PR-CREATION.md § 8c, commands/next.md
// Step 8, WAVE-RECONCILE.md, AUTONOMY.md § Merge policy) and protects normal
// sessions too — a manual "merge phase 12" is refused while its finisher is
// pending.
//
// CLI:  node .riff/scripts/finisher-guard.mjs <branch> [--project-root <dir>]
// Exit: 0 = branch clear to merge, 2 = BLOCKED by pending finisher(s), 1 = usage.
import { realpathSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { collectPendingFinishers } from './lib/finishers.mjs';

/**
 * Pending finishers that reference `branch`. Empty array = clear to merge.
 * Malformed ledger entries are treated as blocking evidence too when they
 * mention the branch — a corrupt no-merge marker must fail closed, not open.
 */
export function findBlockingFinishers(projectRoot, branch) {
  const { pending, malformed } = collectPendingFinishers(projectRoot);
  const blockers = pending.filter((entry) => entry.branch === branch);
  const suspectMalformed = malformed.filter((bad) => bad.entry?.branch === branch);
  return { blockers, suspectMalformed };
}

export function checkBranch(projectRoot, branch) {
  const { blockers, suspectMalformed } = findBlockingFinishers(projectRoot, branch);
  return {
    allowed: blockers.length === 0 && suspectMalformed.length === 0,
    blockers,
    suspectMalformed,
  };
}

function main() {
  const argv = process.argv.slice(2);
  let branch;
  let projectRoot = process.cwd();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--project-root') {
      projectRoot = argv[index + 1];
      if (!projectRoot) {
        process.stderr.write('--project-root requires a directory\n');
        process.exit(1);
      }
      index += 1;
    } else if (arg.startsWith('--')) {
      process.stderr.write(`unrecognized flag: ${arg}\n`);
      process.exit(1);
    } else if (!branch) {
      branch = arg;
    } else {
      process.stderr.write(`unexpected argument: ${arg}\n`);
      process.exit(1);
    }
  }
  if (!branch) {
    process.stderr.write('usage: finisher-guard <branch> [--project-root <dir>]\n');
    process.exit(1);
  }

  const { allowed, blockers, suspectMalformed } = checkBranch(projectRoot, branch);
  if (allowed) {
    process.stdout.write(`finisher-guard: ${branch} clear to merge\n`);
    process.exit(0);
  }

  process.stdout.write(`finisher-guard: MERGE REFUSED for ${branch}\n`);
  for (const finisher of blockers) {
    process.stdout.write(
      `  blocked by ${finisher.id} (${finisher.type || 'unknown'}, run ${finisher.run || '?'})`
      + ` — waiting on: ${finisher.waiting_on || 'human sign-off'}\n`
      + `  review artifact: ${finisher.artifact || finisher.file}\n`,
    );
  }
  for (const bad of suspectMalformed) {
    process.stdout.write(
      `  blocked by MALFORMED finisher entry at ${bad.file}:${bad.line} (${bad.reason})`
      + ' — fix the ledger before merging\n',
    );
  }
  process.stdout.write('  resolve it first: "finisher F<N> ok, merge it" / "reject finisher F<N>"\n');
  process.exit(2);
}

// realpath both sides: projects call this through the .riff symlink
let invokedDirectly = false;
try {
  invokedDirectly = Boolean(process.argv[1])
    && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
} catch {
  invokedDirectly = false;
}
if (invokedDirectly) main();
