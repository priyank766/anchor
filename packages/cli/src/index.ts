#!/usr/bin/env node
import { loadConfig } from "@anchormem/server/config";
import { Store } from "@anchormem/server/store/db";
import { handleList } from "@anchormem/server/tools/list";
import { banner, c, kv, ok } from "./ui.js";

const HELP = `${banner()}
${c.bold("Usage")}
  ${c.cyan("anchor")}                       Open the interactive memory browser (TUI)
  ${c.cyan("anchor browse")} [--scope X]    Same as above
  ${c.cyan("anchor init")}                  Create the data dir and DB at ~/.anchor
  ${c.cyan("anchor status")}                Show config and DB stats
  ${c.cyan("anchor list")} [--scope X]      List memories in a scope
  ${c.cyan("anchor path")}                  Print the DB file path
  ${c.cyan("anchor help")}

${c.dim("For agent integration, run the MCP server: `anchor-server` (from @anchormem/server).")}
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

    default:
      process.stderr.write(`unknown command: ${cmd}\n\n${HELP}`);
      process.exit(1);
  }
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
