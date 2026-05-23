#!/usr/bin/env node
import { loadConfig } from "@anchormem/server/config";
import { Store } from "@anchormem/server/store/db";
import { handleList } from "@anchormem/server/tools/list";
import { redact } from "@anchormem/server/capture/redact";
import { resolveDefaultScope, findGitRoot } from "@anchormem/server/scope";
import { readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { banner, c, kv, ok, warn, err } from "./ui.js";
import { TOOLS, ANCHOR_MCP_ENTRY, ANCHOR_SERVER_KEY } from "./tools-registry.js";
import { writeMcpEntry, hasAnchorEntry } from "./config-writer.js";

const HELP = `${banner()}
${c.bold("Usage")}
  ${c.cyan("anchor")}                       Open the interactive memory console
  ${c.cyan("anchor browse")} [--scope X]    Same as above
  ${c.cyan("anchor init")}                  Initialize Anchor + auto-register in all detected tools
  ${c.cyan("anchor setup")} [--cursor] [--all]
                                Generate project-level MCP configs for terminal coding CLIs
                                (--cursor to add Cursor, --all for all tools)
  ${c.cyan("anchor status")}                Show config and DB stats
  ${c.cyan("anchor list")} [--scope X]      List memories in a scope
  ${c.cyan("anchor export")} [--scope X] [--anonymize]
                                Print the memory store as JSON (optionally stripped of identity)
  ${c.cyan("anchor import")} <file>         Merge a JSON export into the local store
  ${c.cyan("anchor prune")} [--scope X] [--below N]
                                Delete episodes whose effective salience is below N (default 0.1)
  ${c.cyan("anchor reembed")} [--scope X] [--limit N]
                                Backfill embeddings for memories missing them (requires ANCHOR_EMBED_PROVIDER)
  ${c.cyan("anchor doctor")}                Run diagnostics (db, scope, redaction, tool registration)
  ${c.cyan("anchor hook")} <event>          Claude Code hook adapter (internal)
  ${c.cyan("anchor diff")} [--since 1d] [--scope X]
                                Show what changed in memory since a given time (default: 24h)
  ${c.cyan("anchor replay")} [--scope X] [--limit N]
                                Reconstruct a chronological narrative from episodes + decisions
  ${c.cyan("anchor path")}                  Print the DB file path
  ${c.cyan("anchor help")}

${c.dim("For agent integration, run the MCP server: `anchor-server`.")}
`;

async function main() {
  const [, , cmdArg, ...rest] = process.argv;
  const cfg = loadConfig();
  const cmd = cmdArg ?? "browse";

  switch (cmd) {
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(HELP);
      return;

    case "browse": {
      const scopeArg = argFlag(rest, "--scope");
      const { runTui } = await import("./tui/index.js");
      runTui({ scope: scopeArg });
      return;
    }

    case "init": {
      // 1. Create ~/.anchor/ and DB (original behavior)
      const store = new Store(cfg);
      store.close();
      process.stdout.write(banner());
      process.stdout.write(ok(`Initialized at ${c.cyan(cfg.dataDir)}\n`));

      // 2. Auto-register MCP server in all detected tools
      process.stdout.write("\n" + c.bold("Registering MCP server in detected tools…\n\n"));
      let registered = 0;
      for (const tool of TOOLS) {
        const detected = tool.detect();
        if (!detected) {
          process.stdout.write(c.dim(`  – ${tool.name.padEnd(18)} not detected\n`));
          continue;
        }
        const configPath = tool.globalConfigPath();
        if (!configPath) {
          process.stdout.write(c.dim(`  – ${tool.name.padEnd(18)} no global config path\n`));
          continue;
        }
        const result = writeMcpEntry(configPath, ANCHOR_SERVER_KEY, ANCHOR_MCP_ENTRY, tool.format);
        switch (result.status) {
          case "created":
          case "merged":
            process.stdout.write(ok(`${tool.name.padEnd(18)} registered ${c.green("✓")}\n`));
            registered++;
            break;
          case "skipped":
            process.stdout.write(c.dim(`  – ${tool.name.padEnd(18)} already configured\n`));
            break;
          case "error":
            process.stdout.write(warn(`${tool.name.padEnd(18)} ${result.error ?? "failed"}\n`));
            break;
        }
      }

      process.stdout.write("\n");
      if (registered > 0) {
        process.stdout.write(
          ok(`Registered in ${c.bold(String(registered))} tool${registered === 1 ? "" : "s"}. You're all set!\n`),
        );
      } else {
        process.stdout.write(c.dim("No new tools configured. Run 'anchor doctor' to check status.\n"));
      }
      process.stdout.write(c.dim(`\nTip: run ${c.cyan("anchor setup")} to generate project-level configs for team sharing.\n`));
      return;
    }

    case "status": {
      const store = new Store(cfg);
      const all = store.listByScope(store.resolveScope(undefined).id, undefined, 1000);
      store.close();
      process.stdout.write(banner());
      process.stdout.write(kv("data dir", c.cyan(cfg.dataDir)) + "\n");
      process.stdout.write(kv("db", c.cyan(cfg.dbPath)) + "\n");
      process.stdout.write(
        kv("items", `${c.bold(String(all.length))} ${c.dim("(default scope)")}`) + "\n"
      );
      return;
    }

    case "path":
      process.stdout.write(cfg.dbPath + "\n");
      return;

    case "anchor-server":
      await import("@anchormem/server");
      return;

    case "list": {
      const store = new Store(cfg);
      const scopeArg = argFlag(rest, "--scope");
      const out = handleList(store, { scope: scopeArg });
      store.close();
      if (out.count === 0) {
        process.stdout.write(c.dim(`(no memories in scope "${out.scope}")\n`));
        return;
      }
      process.stdout.write(`${c.bold(out.scope)} ${c.dim(`— ${out.count} item${out.count === 1 ? "" : "s"}`)}\n\n`);
      for (const item of out.items) {
        const tag = typeColor(item.type);
        const date = new Date(item.updatedAt).toISOString().slice(0, 10);
        process.stdout.write(`${tag}  ${c.dim(date)}  ${item.content}\n`);
        if (item.rationale) process.stdout.write(c.dim(`    ↳ ${item.rationale}\n`));
      }
      return;
    }

    case "export": {
      const scopeArg = argFlag(rest, "--scope");
      const anonymize = rest.includes("--anonymize");
      const store = new Store(cfg);
      let scopeId: string | undefined;
      if (scopeArg) scopeId = store.resolveScope(scopeArg).id;
      const payload = store.exportAll(scopeId, { anonymize });
      store.close();
      process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
      return;
    }

    case "import": {
      const file = rest[0];
      if (!file) {
        process.stderr.write(err("usage: anchor import <file>\n"));
        process.exit(1);
      }
      const raw = readFileSync(file, "utf8");
      const payload = JSON.parse(raw);
      if (payload?.version !== 1) {
        process.stderr.write(err(`unsupported export version: ${payload?.version}\n`));
        process.exit(1);
      }
      const store = new Store(cfg);
      const result = store.importPayload(payload);
      store.close();
      process.stdout.write(
        ok(
          `imported ${c.bold(String(result.imported))} ${c.dim(`(${result.skipped} already present)`)}\n`
        )
      );
      return;
    }

    case "setup": {
      const { runSetup, printSetupResults } = await import("./setup.js");
      const projectRoot = findGitRoot(process.cwd()) ?? process.cwd();
      const allFlag = rest.includes("--all");
      const cursorFlag = rest.includes("--cursor");
      const codexFlag = rest.includes("--codex");

      // Also ensure ~/.anchor/ exists (run init if needed)
      if (!existsSync(cfg.dataDir)) {
        const initStore = new Store(cfg);
        initStore.close();
        process.stdout.write(ok(`Initialized at ${c.cyan(cfg.dataDir)}\n\n`));
      }

      const result = runSetup({
        projectRoot,
        all: allFlag,
        cursor: cursorFlag,
        codex: codexFlag,
      });
      printSetupResults(result);
      return;
    }

    case "doctor": {
      runDoctor(cfg);
      return;
    }

    case "prune": {
      const scopeArg = argFlag(rest, "--scope");
      const belowArg = argFlag(rest, "--below");
      const threshold = belowArg ? Number(belowArg) : 0.1;
      if (!Number.isFinite(threshold) || threshold < 0) {
        process.stderr.write(err(`invalid --below value: ${belowArg}\n`));
        process.exit(1);
      }
      const store = new Store(cfg);
      let scopeId: string | undefined;
      if (scopeArg) scopeId = store.resolveScope(scopeArg).id;
      const deleted = store.pruneEpisodes(scopeId, threshold);
      store.close();
      process.stdout.write(
        ok(`pruned ${c.bold(String(deleted))} episode${deleted === 1 ? "" : "s"} below salience ${threshold}\n`)
      );
      return;
    }

    case "reembed": {
      const scopeArg = argFlag(rest, "--scope");
      const limitArg = argFlag(rest, "--limit");
      const limit = limitArg ? Number(limitArg) : undefined;
      const { runReembed } = await import("./reembed.js");
      try {
        const result = await runReembed({
          scope: scopeArg,
          limit,
          onProgress: (done, total) => {
            // Minimal progress: rewrite a single line.
            if (process.stdout.isTTY) {
              process.stdout.write(`\r${c.dim(`embedding ${done}/${total}…`)}`);
            }
          },
        });
        if (process.stdout.isTTY) process.stdout.write("\r" + " ".repeat(40) + "\r");
        process.stdout.write(
          ok(
            `embedded ${c.bold(String(result.embedded))} ${c.dim(`(${result.failed} failed)`)} via ${c.cyan(result.provider)}\n`
          )
        );
      } catch (e) {
        process.stderr.write(err(`${(e as Error).message}\n`));
        process.exit(1);
      }
      return;
    }

    case "hook": {
      if (rest.length === 0) {
        process.stderr.write(err("usage: anchor hook <agent> <event>  (claude-code|antigravity|codex|opencode|hermes|generic)\n"));
        process.exit(1);
      }
      const { runHook } = await import("./hook.js");
      await runHook(rest);
      return;
    }

    case "diff": {
      const scopeArg = argFlag(rest, "--scope");
      const sinceArg = argFlag(rest, "--since") ?? "1d";
      const since = parseSince(sinceArg);
      if (since === null) {
        process.stderr.write(err(`invalid --since value: ${sinceArg} (use 1h, 1d, 7d, 30d, or ISO date)\n`));
        process.exit(1);
      }
      const store = new Store(cfg);
      const scopeRef = store.resolveScope(resolveDefaultScope(scopeArg));
      const rows = store.diffSince(scopeRef.id, since);
      store.close();
      if (rows.length === 0) {
        process.stdout.write(c.dim(`(no changes in scope "${scopeRef.name}" since ${new Date(since).toISOString().slice(0, 16)})\n`));
        return;
      }
      process.stdout.write(`${c.bold(scopeRef.name)} ${c.dim(`— ${rows.length} change${rows.length === 1 ? "" : "s"} since ${new Date(since).toISOString().slice(0, 16)}`)}\n\n`);
      for (const r of rows) {
        const tag = typeColor(r.type);
        const date = new Date(r.updatedAt).toISOString().slice(0, 16).replace("T", " ");
        const isNew = r.createdAt >= since;
        const marker = isNew ? c.green("+ ") : c.yellow("~ ");
        process.stdout.write(`${marker}${tag}  ${c.dim(date)}  ${r.content.slice(0, 120)}\n`);
        if (r.rationale) process.stdout.write(c.dim(`    ↳ ${r.rationale}\n`));
      }
      return;
    }

    case "replay": {
      const scopeArg = argFlag(rest, "--scope");
      const limitArg = argFlag(rest, "--limit");
      const limit = limitArg ? parseInt(limitArg, 10) : 200;
      const store = new Store(cfg);
      const scopeRef = store.resolveScope(resolveDefaultScope(scopeArg));
      const rows = store.replay(scopeRef.id, limit);
      store.close();
      if (rows.length === 0) {
        process.stdout.write(c.dim(`(no episodes or decisions in scope "${scopeRef.name}")\n`));
        return;
      }
      process.stdout.write(banner());
      process.stdout.write(`${c.bold("Replay")} ${c.dim(`— ${scopeRef.name} — ${rows.length} event${rows.length === 1 ? "" : "s"}`)}\n\n`);
      let prevDate = "";
      for (const r of rows) {
        const date = new Date(r.createdAt).toISOString().slice(0, 10);
        const time = new Date(r.createdAt).toISOString().slice(11, 16);
        // Print date headers when day changes
        if (date !== prevDate) {
          process.stdout.write(`\n${c.bold(c.cyan(`── ${date} ──`))}\n`);
          prevDate = date;
        }
        const icon = r.type === "decision" ? c.magenta("◆") : c.blue("●");
        const tag = r.type === "decision" ? c.magenta("decided") : c.blue("episode");
        process.stdout.write(`  ${c.dim(time)}  ${icon} ${tag}  ${r.content.slice(0, 120)}\n`);
        if (r.rationale) process.stdout.write(c.dim(`           ↳ ${r.rationale}\n`));
        if (r.files && r.files.length) process.stdout.write(c.dim(`           files: ${r.files.slice(0, 5).join(", ")}\n`));
      }
      process.stdout.write("\n");
      return;
    }

    default:
      process.stderr.write(`unknown command: ${cmd}\n\n${HELP}`);
      process.exit(1);
  }
}

function runDoctor(cfg: ReturnType<typeof loadConfig>) {
  process.stdout.write(banner());

  // 1. Data dir + DB
  let dbBytes = 0;
  try {
    dbBytes = statSync(cfg.dbPath).size;
  } catch {
    process.stdout.write(err(`db not found at ${cfg.dbPath} — run \`anchor init\`\n`));
  }
  process.stdout.write(kv("data dir", cfg.dataDir) + "\n");
  process.stdout.write(
    kv("db", `${cfg.dbPath} ${c.dim(`(${(dbBytes / 1024).toFixed(1)} KB)`)}`) + "\n"
  );

  // 2. Store schema check
  try {
    const store = new Store(cfg);
    const total = store
      .listByScope(store.resolveScope(undefined).id, undefined, 1)
      .length;
    store.close();
    process.stdout.write(ok(`schema reachable (sample read returned ${total})\n`));
  } catch (e) {
    process.stdout.write(err(`schema error: ${(e as Error).message}\n`));
  }

  // 3. Scope detection
  const cwd = process.cwd();
  const gitRoot = findGitRoot(cwd);
  const scope = resolveDefaultScope();
  process.stdout.write(kv("cwd", cwd) + "\n");
  process.stdout.write(
    kv("git root", gitRoot ?? c.dim("(not in a git repo)")) + "\n"
  );
  process.stdout.write(kv("default scope", c.bold(scope)) + "\n");

  // 4. Redaction self-test
  const probe = redact("sk-ant-api03-FAKETESTABCDEFGHIJKLMNOPQRSTUVWX and ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  if (probe.redacted.includes("anthropic") && probe.redacted.includes("github")) {
    process.stdout.write(ok(`redaction patterns firing (${probe.redacted.join(", ")})\n`));
  } else {
    process.stdout.write(err(`redaction self-test failed: only matched ${probe.redacted.join(", ")}\n`));
  }

  // 5. MCP registration check — all tools
  process.stdout.write("\n" + c.bold("MCP Registration\n"));
  for (const tool of TOOLS) {
    const detected = tool.detect();
    if (!detected) {
      process.stdout.write(c.dim(`  – ${tool.name.padEnd(18)} not installed\n`));
      continue;
    }
    const configPath = tool.globalConfigPath();
    if (!configPath) continue;
    const registered = hasAnchorEntry(configPath, ANCHOR_SERVER_KEY, tool.format);
    if (registered) {
      process.stdout.write(ok(`${tool.name.padEnd(18)} anchor registered ${c.green("✓")}\n`));
    } else {
      process.stdout.write(
        warn(`${tool.name.padEnd(18)} detected but anchor not registered. Run: ${c.cyan("anchor init")}\n`),
      );
    }
  }

  // 6. Project-level config check
  const projectRoot = findGitRoot(process.cwd());
  if (projectRoot) {
    process.stdout.write("\n" + c.bold("Project Configs\n"));
    const projectTools = TOOLS.filter((t) => t.projectConfigPath() !== null);
    let hasAny = false;
    for (const tool of projectTools) {
      const relPath = tool.projectConfigPath()!;
      const absPath = join(projectRoot, relPath);
      if (existsSync(absPath)) {
        process.stdout.write(ok(`${relPath.padEnd(28)} ${c.dim(`(${tool.name})`)} ${c.green("✓")}\n`));
        hasAny = true;
      }
    }
    if (!hasAny) {
      process.stdout.write(
        c.dim(`  No project-level configs found. Run ${c.cyan("anchor setup")} to generate.\n`),
      );
    }
  }

  process.stdout.write("\n" + c.dim("doctor complete.\n"));
}

function typeColor(t: string): string {
  switch (t) {
    case "fact":
      return c.green("fact    ");
    case "decision":
      return c.magenta("decision");
    case "episode":
      return c.blue("episode ");
    case "artifact":
      return c.yellow("artifact");
    default:
      return c.gray(t);
  }
}

function argFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  return argv[i + 1];
}

// Parse a --since value. Accepts:
//   1h, 2h, 12h     → hours ago
//   1d, 7d, 30d     → days ago
//   2026-05-20       → ISO date
//   2026-05-20T12:00 → ISO datetime
function parseSince(s: string): number | null {
  // Duration strings: Nh or Nd
  const m = s.match(/^(\d+)([hd])$/i);
  if (m) {
    const n = parseInt(m[1]!, 10);
    const unit = m[2]!.toLowerCase();
    const ms = unit === "h" ? n * 60 * 60 * 1000 : n * 24 * 60 * 60 * 1000;
    return Date.now() - ms;
  }
  // ISO date/datetime
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.getTime();
  return null;
}

main().catch((e) => {
  process.stderr.write(`anchor: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
