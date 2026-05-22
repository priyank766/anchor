// tools-registry.ts — Central registry of AI coding tools and their MCP config locations.
// Used by `anchor init` (global registration) and `anchor setup` (project-level configs).

import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

export interface ToolDefinition {
  /** Short identifier, e.g. "claude-code" */
  id: string;
  /** Human-readable name, e.g. "Claude Code" */
  name: string;
  /** Returns true if the tool appears to be installed on this machine. */
  detect: () => boolean;
  /** Absolute path to the user-level (global) MCP config file, or null if N/A. */
  globalConfigPath: () => string | null;
  /** Relative path from project root for project-scoped config, or null if N/A. */
  projectConfigPath: () => string | null;
  /** Config format — determines how we read/write the file. */
  format: "json" | "toml";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function commandExists(cmd: string): boolean {
  try {
    const which = platform() === "win32" ? "where" : "command -v";
    execSync(`${which} ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function home(...segments: string[]): string {
  return join(homedir(), ...segments);
}

function clineGlobalStoragePath(): string | null {
  const p = platform();
  if (p === "win32") {
    const appData = process.env.APPDATA;
    if (!appData) return null;
    return join(appData, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");
  }
  if (p === "darwin") {
    return home("Library", "Application Support", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");
  }
  // Linux
  return home(".config", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");
}

// ---------------------------------------------------------------------------
// The MCP server entry that gets injected into every tool's config.
// Uses npx for zero-install: teammates don't need anchor pre-installed.
// ---------------------------------------------------------------------------

export const ANCHOR_MCP_ENTRY = {
  command: "npx",
  args: ["-y", "@anchormem/anchor@latest", "anchor-server"],
};

export const ANCHOR_SERVER_KEY = "anchor";

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const TOOLS: ToolDefinition[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    detect: () => commandExists("claude") || existsSync(home(".claude.json")),
    globalConfigPath: () => home(".claude.json"),
    projectConfigPath: () => ".mcp.json",
    format: "json",
  },
  {
    id: "cursor",
    name: "Cursor",
    detect: () => existsSync(home(".cursor")),
    globalConfigPath: () => home(".cursor", "mcp.json"),
    projectConfigPath: () => join(".cursor", "mcp.json"),
    format: "json",
  },
  {
    id: "codex",
    name: "Codex CLI",
    detect: () => commandExists("codex") || existsSync(home(".codex")),
    globalConfigPath: () => home(".codex", "config.toml"),
    projectConfigPath: () => join(".codex", "config.toml"),
    format: "toml",
  },
  {
    id: "windsurf",
    name: "Windsurf",
    detect: () => existsSync(home(".codeium", "windsurf")),
    globalConfigPath: () => home(".codeium", "windsurf", "mcp_config.json"),
    projectConfigPath: () => null, // Windsurf only supports global config
    format: "json",
  },
  {
    id: "cline",
    name: "Cline",
    detect: () => {
      const p = clineGlobalStoragePath();
      if (!p) return false;
      // Check if the Cline extension directory exists (one level up from the settings file)
      const settingsDir = join(p, "..");
      return existsSync(settingsDir);
    },
    globalConfigPath: () => clineGlobalStoragePath(),
    projectConfigPath: () => null, // Cline only supports global config
    format: "json",
  },
  {
    id: "antigravity",
    name: "Antigravity CLI",
    detect: () => existsSync(home(".gemini", "antigravity-cli")),
    globalConfigPath: () => home(".gemini", "antigravity-cli", "mcp_config.json"),
    projectConfigPath: () => join(".agents", "mcp_config.json"),
    format: "json",
  },
];

/** Return only tools that appear to be installed. */
export function detectInstalledTools(): ToolDefinition[] {
  return TOOLS.filter((t) => t.detect());
}
