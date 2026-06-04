import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Store } from "../store/db.js";
import { UpdateInput } from "./schemas.js";
import { resolveDefaultScope } from "../scope.js";

export function handleUpdate(store: Store, raw: unknown) {
  const input = UpdateInput.parse(raw);
  const scope = input.scope ? store.resolveScope(resolveDefaultScope(input.scope)) : null;

  // Locate the local CLI binary in development
  let cliPath: string | undefined;
  try {
    const __dirname = fileURLToPath(new URL(".", import.meta.url));
    const localCli = resolve(__dirname, "..", "..", "..", "cli", "dist", "index.js");
    if (existsSync(localCli)) {
      cliPath = `node "${localCli}"`;
    }
  } catch {}

  let output = "";

  // 1. Run global init command to register/update MCP configuration in all detected tools
  const initCmd = cliPath ? `${cliPath} init` : "npx -y @anchormem/anchor@latest init";
  try {
    output += `Running: ${initCmd}\n`;
    output += execSync(initCmd, { encoding: "utf8" });
  } catch (err: any) {
    output += `Error running init: ${err.message}\n`;
    if (err.stdout) output += `Stdout:\n${err.stdout}\n`;
    if (err.stderr) output += `Stderr:\n${err.stderr}\n`;
  }

  // 2. If scope is provided, also run project-level setup
  if (scope && scope.path && existsSync(scope.path)) {
    const setupCmd = cliPath
      ? `${cliPath} setup --all`
      : "npx -y @anchormem/anchor@latest setup --all";
    try {
      output += `\nRunning: ${setupCmd} (in ${scope.path})\n`;
      output += execSync(setupCmd, { cwd: scope.path, encoding: "utf8" });
    } catch (err: any) {
      output += `Error running setup: ${err.message}\n`;
      if (err.stdout) output += `Stdout:\n${err.stdout}\n`;
      if (err.stderr) output += `Stderr:\n${err.stderr}\n`;
    }
  }

  return {
    success: !output.includes("Error running"),
    output: output.trim(),
  };
}
