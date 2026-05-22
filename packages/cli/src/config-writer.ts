// config-writer.ts — Safe read/merge/write for MCP config files.
// Supports JSON (mcpServers) and TOML (mcp_servers) formats.
// Never overwrites existing entries; merges or skips.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type WriteResult = "created" | "merged" | "skipped" | "error";

export interface WriteOutcome {
  status: WriteResult;
  filePath: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// JSON format (Claude Code, Cursor, Windsurf, Cline, Antigravity)
// ---------------------------------------------------------------------------

export function writeJsonMcpEntry(
  filePath: string,
  serverKey: string,
  entry: Record<string, unknown>,
): WriteOutcome {
  try {
    mkdirSync(dirname(filePath), { recursive: true });

    if (!existsSync(filePath)) {
      // File doesn't exist — create it fresh.
      const content = { mcpServers: { [serverKey]: entry } };
      writeFileSync(filePath, JSON.stringify(content, null, 2) + "\n", "utf8");
      return { status: "created", filePath };
    }

    // File exists — read and parse.
    const raw = readFileSync(filePath, "utf8");
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { status: "error", filePath, error: "invalid JSON" };
    }

    // Ensure mcpServers key exists.
    if (!config.mcpServers || typeof config.mcpServers !== "object") {
      config.mcpServers = {};
    }

    const servers = config.mcpServers as Record<string, unknown>;

    // Already has anchor? Skip.
    if (serverKey in servers) {
      return { status: "skipped", filePath };
    }

    // Merge: add anchor alongside existing entries.
    servers[serverKey] = entry;
    writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", "utf8");
    return { status: "merged", filePath };
  } catch (e) {
    return {
      status: "error",
      filePath,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---------------------------------------------------------------------------
// TOML format (Codex CLI)
// ---------------------------------------------------------------------------

/** Minimal TOML append for Codex's [mcp_servers.X] table. */
export function writeTomlMcpEntry(
  filePath: string,
  serverKey: string,
  entry: { command: string; args: string[] },
): WriteOutcome {
  try {
    mkdirSync(dirname(filePath), { recursive: true });

    const tableHeader = `[mcp_servers.${serverKey}]`;
    const tomlBlock = [
      "",
      tableHeader,
      `command = ${JSON.stringify(entry.command)}`,
      `args = [${entry.args.map((a) => JSON.stringify(a)).join(", ")}]`,
      "",
    ].join("\n");

    if (!existsSync(filePath)) {
      // File doesn't exist — create it.
      writeFileSync(filePath, tomlBlock.trimStart() + "\n", "utf8");
      return { status: "created", filePath };
    }

    // File exists — check for existing entry.
    const raw = readFileSync(filePath, "utf8");
    if (raw.includes(tableHeader)) {
      return { status: "skipped", filePath };
    }

    // Append the new table.
    const separator = raw.endsWith("\n") ? "" : "\n";
    writeFileSync(filePath, raw + separator + tomlBlock + "\n", "utf8");
    return { status: "merged", filePath };
  } catch (e) {
    return {
      status: "error",
      filePath,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---------------------------------------------------------------------------
// Unified writer that dispatches based on format.
// ---------------------------------------------------------------------------

export function writeMcpEntry(
  filePath: string,
  serverKey: string,
  entry: { command: string; args: string[] },
  format: "json" | "toml",
): WriteOutcome {
  return format === "toml"
    ? writeTomlMcpEntry(filePath, serverKey, entry)
    : writeJsonMcpEntry(filePath, serverKey, entry);
}

// ---------------------------------------------------------------------------
// Reader: check if anchor is already registered in a config file.
// ---------------------------------------------------------------------------

export function hasAnchorEntry(
  filePath: string,
  serverKey: string,
  format: "json" | "toml",
): boolean {
  if (!existsSync(filePath)) return false;
  try {
    const raw = readFileSync(filePath, "utf8");
    if (format === "toml") {
      return raw.includes(`[mcp_servers.${serverKey}]`);
    }
    const config = JSON.parse(raw) as Record<string, unknown>;
    const servers = config.mcpServers as Record<string, unknown> | undefined;
    return servers != null && serverKey in servers;
  } catch {
    return false;
  }
}
