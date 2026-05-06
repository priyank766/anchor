import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export interface AnchorConfig {
  dataDir: string;
  dbPath: string;
  defaultBudgetTokens: number;
}

export function loadConfig(): AnchorConfig {
  const dataDir = process.env.ANCHOR_HOME ?? join(homedir(), ".anchor");
  mkdirSync(dataDir, { recursive: true });
  return {
    dataDir,
    dbPath: join(dataDir, "memory.db"),
    defaultBudgetTokens: 1500,
  };
}
