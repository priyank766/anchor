import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Store } from "@anchormem/server/store/db";
import { runHookWith } from "./hook.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpHome: string;
let captured: string;
let originalWrite: typeof process.stdout.write;

function captureStdout() {
  captured = "";
  originalWrite = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: typeof process.stdout.write }).write = ((s: string | Uint8Array) => {
    captured += typeof s === "string" ? s : Buffer.from(s).toString("utf8");
    return true;
  }) as typeof process.stdout.write;
}

function restoreStdout() {
  process.stdout.write = originalWrite;
}

function seedScope(scopePath: string, content: string) {
  const cfg = {
    dataDir: tmpHome,
    dbPath: join(tmpHome, "memory.db"),
    defaultBudgetTokens: 1500,
  };
  const store = new Store(cfg);
  const ref = store.resolveScope(scopePath);
  const src = store.recordSource({ agent: "test", deviceId: "host" });
  store.insertFact({ scopeId: ref.id, sourceId: src, content });
  store.close();
}

describe("anchor hook (universal)", () => {
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "anchor-hook-"));
    process.env.ANCHOR_HOME = tmpHome;
    captureStdout();
  });

  afterEach(() => {
    restoreStdout();
    delete process.env.ANCHOR_HOME;
  });

  it("emits nothing when scope is empty", async () => {
    await runHookWith(
      ["claude-code", "session-start"],
      JSON.stringify({ cwd: "/tmp/empty-scope-no-data" })
    );
    expect(captured).toBe("");
  });

  it("emits Claude Code JSON shape with additionalContext", async () => {
    const scopePath = "/tmp/anchor-test-scope-cc";
    seedScope(scopePath, "uses Vitest not Jest");

    await runHookWith(
      ["claude-code", "session-start"],
      JSON.stringify({ cwd: scopePath })
    );
    const parsed = JSON.parse(captured);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("Vitest");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("Anchor memory");
  });

  it("emits plain text for antigravity, gemini, codex, opencode, hermes, generic", async () => {
    const scopePath = "/tmp/anchor-test-scope-generic";
    seedScope(scopePath, "deploys to Cloudflare Workers");

    for (const flavor of ["antigravity", "gemini", "codex", "opencode", "hermes", "generic"]) {
      captured = "";
      await runHookWith(
        [flavor, "session-start"],
        JSON.stringify({ cwd: scopePath })
      );
      expect(captured, `flavor=${flavor}`).toContain("Cloudflare Workers");
      expect(captured, `flavor=${flavor}`).not.toContain("hookSpecificOutput");
    }
  });

  it("legacy single-arg form defaults to claude-code", async () => {
    const scopePath = "/tmp/anchor-test-scope-legacy";
    seedScope(scopePath, "monorepo with Turborepo");

    await runHookWith(
      ["session-start"],
      JSON.stringify({ cwd: scopePath })
    );
    expect(captured).toContain("hookSpecificOutput");
    expect(captured).toContain("Turborepo");
  });

  it("reserved events exit cleanly with no output", async () => {
    await runHookWith(["claude-code", "stop"], "");
    await runHookWith(["claude-code", "pre-compact"], "");
    expect(captured).toBe("");
  });
});
