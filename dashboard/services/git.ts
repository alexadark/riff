/**
 * Run `git diff --stat` for a phase folder. Returns a short summary string,
 * or null if not in a git repo / git not available.
 *
 * Best-effort scope: diff against the phase folder so the stat reflects what
 * the phase actually touched (vs. all of HEAD).
 */
export async function gitDiffStat(projectRoot: string, phaseRelPath: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", "diff", "--stat", "HEAD", "--", phaseRelPath], {
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) return null;
    return out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Compute a stat for the per-phase plan/summary commit range. We have no
 * canonical "this phase's commit" pointer here, so fall back to a folder-scoped
 * diff against HEAD. Callers may treat null as "unavailable".
 */
export async function diffStatForPhase(
  projectRoot: string,
  phaseFolderRel: string,
): Promise<string | null> {
  return gitDiffStat(projectRoot, phaseFolderRel);
}
