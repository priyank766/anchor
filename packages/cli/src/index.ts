#!/usr/bin/env node
import { loadConfig } from "@anchormem/server/config";
import { Store } from "@anchormem/server/store/db";
import { handleList } from "@anchormem/server/tools/list";
import { redact } from "@anchormem/server/capture/redact";
import { resolveDefaultScope, findGitRoot } from "@anchormem/server/scope";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { banner, c, kv, ok, warn, err } from "./ui.js";

const HELP = `${banner()}
${c.bold("Usage")}
  ${c.cyan("anchor")}                       Open the interactive memory console
  ${c.cyan("anchor browse")} [--scope X]    Same as above
  ${c.cyan("anchor init")}                  Create the data dir and DB at ~/.anchor
  ${c.cyan("anchor status")}                Show config and DB stats
  ${c.cyan("anchor list")} [--scope X]      List memories in a scope
  ${c.cyan("anchor export")} [--scope X] [--anonymize]
                                Print the memory store as JSON (optionally stripped of identity)
  ${c.cyan("anchor import")} <file>         Merge a JSON export into the local store
  ${c.cyan("anchor prune")} [--scope X] [--below N]
                                Delete episodes whose effective salience is below N (default 0.1)
  ${c.cyan("anchor doctor")}                Run diagnostics (db, scope, redaction)
  ${c.cyan("anchor hook")} <event>          Claude Code hook adapter (internal)
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
      const store = new Store(cfg);
      store.close();
      process.stdout.write(banner());
      process.stdout.write(ok(`Initialized at ${c.cyan(cfg.dataDir)}\n`));
      process.stdout.write(c.dim(`  next: configure your agent to talk to anchor-server\n`));
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

    case "hook": {
      if (rest.length === 0) {
        process.stderr.write(err("usage: anchor hook <agent> <event>  (agent ∈ claude-code|gemini|codex|opencode|hermes|generic)\n"));
        process.exit(1);
      }
      const { runHook } = await import("./hook.js");
      await runHook(rest);
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

  // 5. MCP registration hint (best-effort, not a probe)
  const claudeJson = join(homedir(), ".claude.json");
  try {
    const cfgRaw = readFileSync(claudeJson, "utf8");
    if (cfgRaw.includes('"anchor"') || cfgRaw.includes("anchor-server")) {
      process.stdout.write(ok(`Claude Code: anchor entry detected in ${claudeJson}\n`));
    } else {
      process.stdout.write(
        warn(`Claude Code config exists but no anchor entry found. Run: ${c.cyan("claude mcp add anchor -- anchor-server")}\n`)
      );
    }
  } catch {
    process.stdout.write(c.dim(`(no ~/.claude.json — Claude Code may not be installed)\n`));
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

main().catch((e) => {
  process.stderr.write(`anchor: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
