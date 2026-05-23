import { homedir, platform } from "node:os";
import { join } from "node:path";
import { mkdirSync, chmodSync, existsSync, statSync, writeFileSync } from "node:fs";
import { findGitRoot } from "./scope.js";

export interface AnchorConfig {
  dataDir: string;
  dbPath: string;
  defaultBudgetTokens: number;
}

export function loadConfig(): AnchorConfig {
  let projectLocalDir: string | null = null;
  try {
    const gitRoot = findGitRoot(process.cwd());
    const activeRoot = gitRoot ?? process.cwd();
    if (activeRoot) {
      const localCandidate = join(activeRoot, ".anchor");
      if (existsSync(localCandidate) && statSync(localCandidate).isDirectory()) {
        projectLocalDir = localCandidate;
      }
    }
  } catch {
    // Best-effort path resolution
  }

  const dataDir = process.env.ANCHOR_HOME ?? projectLocalDir ?? join(homedir(), ".anchor");
  const dbPath = join(dataDir, "memory.db");

  // Create with 0700 if it doesn't exist; tighten if it does.
  // Skip on Windows because POSIX modes are advisory there and chmod is a
  // no-op on most filesystems. NTFS ACLs are the right control on Windows
  // and we leave them to the user's umask / inheritance.
  const isPosix = platform() !== "win32";

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true, mode: isPosix ? 0o700 : undefined });
  } else if (isPosix) {
    try {
      const mode = statSync(dataDir).mode & 0o777;
      if (mode !== 0o700) chmodSync(dataDir, 0o700);
    } catch {
      // Best-effort. Ignore filesystems that don't support chmod.
    }
  }

  // If running in project-local mode, automatically write a .gitignore file
  // inside the .anchor directory to prevent database files from being committed.
  if (projectLocalDir) {
    const gitignorePath = join(projectLocalDir, ".gitignore");
    if (!existsSync(gitignorePath)) {
      try {
        writeFileSync(
          gitignorePath,
          "# Ignore local SQLite database and journal files\nmemory.db\nmemory.db-journal\nmemory.db-wal\nmemory.db-shm\n",
          "utf8"
        );
      } catch {
        // Best-effort
      }
    }
  }

  // Existing db file: tighten too. New SQLite files inherit the dir's umask
  // so creation here is fine, but pre-existing dbs from earlier versions
  // may be 0644.
  if (isPosix && existsSync(dbPath)) {
    try {
      const mode = statSync(dbPath).mode & 0o777;
      if (mode !== 0o600) chmodSync(dbPath, 0o600);
    } catch {
      /* ignore */
    }
  }

  return {
    dataDir,
    dbPath,
    defaultBudgetTokens: 1500,
  };
}
