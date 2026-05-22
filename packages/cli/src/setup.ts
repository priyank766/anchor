// setup.ts — Generate project-level MCP configs for team sharing.
// Running `anchor setup` in a git repo creates config files that,
// when committed, let teammates' tools auto-detect Anchor.

import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { TOOLS, ANCHOR_MCP_ENTRY, ANCHOR_SERVER_KEY } from "./tools-registry.js";
import { writeMcpEntry, type WriteOutcome } from "./config-writer.js";
import { banner, c, ok, warn, err } from "./ui.js";

export interface SetupResult {
  outcomes: Array<WriteOutcome & { toolName: string }>;
  projectRoot: string;
}

export function runSetup(opts: { projectRoot: string }): SetupResult {
  const { projectRoot } = opts;
  const outcomes: SetupResult["outcomes"] = [];

  // Only generate project-level configs for tools that support it.
  const projectTools = TOOLS.filter((t) => t.projectConfigPath() !== null);

  for (const tool of projectTools) {
    const relPath = tool.projectConfigPath()!;
    const absPath = join(projectRoot, relPath);

    const outcome = writeMcpEntry(
      absPath,
      ANCHOR_SERVER_KEY,
      ANCHOR_MCP_ENTRY,
      tool.format,
    );
    outcomes.push({ ...outcome, toolName: tool.name });
  }

  return { outcomes, projectRoot };
}

export function printSetupResults(result: SetupResult): void {
  process.stdout.write(banner());
  process.stdout.write(c.bold("Project Setup\n\n"));

  const created: string[] = [];
  const merged: string[] = [];

  for (const o of result.outcomes) {
    const relPath = relative(result.projectRoot, o.filePath);
    const label = `${relPath.padEnd(28)} ${c.dim(`(${o.toolName})`)}`;

    switch (o.status) {
      case "created":
        process.stdout.write(`  ${c.green("✓")} ${label}\n`);
        created.push(relPath);
        break;
      case "merged":
        process.stdout.write(`  ${c.green("+")} ${label} ${c.dim("merged")}\n`);
        merged.push(relPath);
        break;
      case "skipped":
        process.stdout.write(`  ${c.dim("–")} ${label} ${c.dim("already configured")}\n`);
        break;
      case "error":
        process.stdout.write(`  ${c.red("✗")} ${label} ${c.red(o.error ?? "unknown error")}\n`);
        break;
    }
  }

  const allFiles = [...created, ...merged];
  if (allFiles.length > 0) {
    process.stdout.write("\n");
    process.stdout.write(
      ok(`Generated ${allFiles.length} project config${allFiles.length === 1 ? "" : "s"}.\n`),
    );
    process.stdout.write("\n" + c.dim("  Next: commit these files to share Anchor with your team:\n"));
    process.stdout.write(
      c.cyan(`    git add ${allFiles.join(" ")}\n`),
    );
    process.stdout.write(
      c.cyan(`    git commit -m "chore: add Anchor MCP config"\n`),
    );
    process.stdout.write(
      "\n" +
      c.dim("  When teammates clone this repo, their tools will auto-detect\n") +
      c.dim("  and prompt them to enable Anchor's memory server. ⚓\n"),
    );
  } else {
    process.stdout.write("\n" + c.dim("  All project configs already in place. Nothing to do.\n"));
  }
  process.stdout.write("\n");
}
