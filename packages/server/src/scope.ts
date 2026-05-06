// Resolve a default scope. Order:
//   1. explicit arg (caller-provided)
//   2. ANCHOR_SCOPE env var
//   3. git repo root of cwd
//   4. cwd itself
//   5. "global"
//
// Walking the filesystem to find .git is cheap and synchronous; we only run
// this when no explicit scope was supplied.

import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function resolveDefaultScope(explicit?: string): string {
  if (explicit && explicit.trim().length > 0) return explicit;
  const env = process.env.ANCHOR_SCOPE;
  if (env && env.trim().length > 0) return env;
  const root = findGitRoot(process.cwd());
  return root ?? process.cwd() ?? "global";
}

export function findGitRoot(start: string): string | undefined {
  let current = resolve(start);
  for (let i = 0; i < 32; i++) {
    const candidate = resolve(current, ".git");
    if (existsSync(candidate)) {
      try {
        // .git can be a directory (normal repo) or file (worktrees, submodules).
        statSync(candidate);
        return current;
      } catch {
        // Stat failed; continue walking up.
      }
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return undefined;
}
