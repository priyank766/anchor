// setup.ts — Generate project-level MCP configs for team sharing.
// Running `anchor setup` in a git repo creates config files that,
// when committed, let teammates' tools auto-detect Anchor.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { TOOLS, ANCHOR_MCP_ENTRY, ANCHOR_SERVER_KEY } from "./tools-registry.js";
import { writeMcpEntry, type WriteOutcome } from "./config-writer.js";
import { banner, c, ok, warn, err } from "./ui.js";

export interface SetupResult {
  outcomes: Array<WriteOutcome & { toolName: string }>;
  projectRoot: string;
}

export function runSetup(opts: {
  projectRoot: string;
  all?: boolean;
  cursor?: boolean;
  codex?: boolean;
}): SetupResult {
  const { projectRoot, all = false, cursor = false, codex = false } = opts;
  const outcomes: SetupResult["outcomes"] = [];

  // Only generate project-level configs for tools that support it.
  // By default, only generate for CLI tools (antigravity, claude-code) that are detected.
  // IDEs (like Cursor) or other tools can be explicitly requested or generated with --all.
  const projectTools = TOOLS.filter((t) => {
    if (t.projectConfigPath() === null) return false;

    // If --all is passed, generate for all supported tools
    if (all) return true;

    // By default, only generate for detected terminal CLI tools
    const isDefaultCli = t.id === "antigravity" || t.id === "claude-code";
    const isExplicitlyRequested =
      (t.id === "cursor" && cursor) || (t.id === "codex" && codex);

    return t.detect() && (isDefaultCli || isExplicitlyRequested);
  });

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

  // Generate or update project-level agent custom instruction files
  const instructionOutcomes = writeAgentInstructions(projectRoot);
  outcomes.push(...instructionOutcomes);

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

/**
 * Generate or update project-level agent custom instructions files.
 * Tells agents (GitHub Copilot, Cursor, Cline) to automatically use the memory recall/remember tools.
 */
export function writeAgentInstructions(projectRoot: string): Array<WriteOutcome & { toolName: string }> {
  const outcomes: Array<WriteOutcome & { toolName: string }> = [];

  const anchorInstructions = `
# Anchor Memory Sharing
- **REQUIRED FIRST STEP**: Always call the \`memory_recall\` tool from the \`anchor\` MCP server at the start of any session or query. Use it to retrieve project preferences, architectural decisions, recent task summaries (episodes), and settings (such as API ports). Do not assume context is defined in local files.
- **REQUIRED COMPLETION STEP**: When you finish a task, establish a new preference, or make an architectural choice, invoke \`memory_remember\` (or \`memory_supersede\` for updates) to persist it for future runs and other agents.
`;

  const targets = [
    {
      filePath: join(projectRoot, ".github", "copilot-instructions.md"),
      toolName: "GitHub Copilot Instructions",
      needsFolder: true,
    },
    {
      filePath: join(projectRoot, ".cursorrules"),
      toolName: "Cursor Rules",
      needsFolder: false,
    },
    {
      filePath: join(projectRoot, ".clinerules"),
      toolName: "Cline Rules",
      needsFolder: false,
    },
  ];

  for (const target of targets) {
    try {
      if (target.needsFolder) {
        mkdirSync(join(projectRoot, ".github"), { recursive: true });
      }

      if (!existsSync(target.filePath)) {
        writeFileSync(target.filePath, `# Custom Instructions\n${anchorInstructions}`, "utf8");
        outcomes.push({ filePath: target.filePath, status: "created", toolName: target.toolName });
      } else {
        const content = readFileSync(target.filePath, "utf8");
        if (content.includes("memory_recall") || content.includes("Anchor Memory")) {
          outcomes.push({ filePath: target.filePath, status: "skipped", toolName: target.toolName });
        } else {
          const separator = content.endsWith("\n") ? "" : "\n";
          writeFileSync(target.filePath, content + separator + anchorInstructions, "utf8");
          outcomes.push({ filePath: target.filePath, status: "merged", toolName: target.toolName });
        }
      }
    } catch (e) {
      outcomes.push({
        filePath: target.filePath,
        status: "error",
        toolName: target.toolName,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return outcomes;
}

