import { describe, it, expect, beforeEach } from "vitest";
import { Store } from "../store/db.js";
import { handleContext } from "./context.js";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function newStore() {
  const dir = mkdtempSync(join(tmpdir(), "anchor-context-test-"));
  return {
    store: new Store({
      dataDir: dir,
      dbPath: join(dir, "memory.db"),
      defaultBudgetTokens: 1500,
    }),
    tempDir: dir,
  };
}

describe("handleContext", () => {
  let store: Store;
  let tempDir: string;

  beforeEach(() => {
    const setup = newStore();
    store = setup.store;
    tempDir = setup.tempDir;
  });

  it("handles non-existent scope directory gracefully", () => {
    const res = handleContext(store, { scope: "non-existent-scope-name" });
    expect(res.scope).toBe("non-existent-scope-name");
    expect(res.context).toContain("Scope is not resolved to a local folder path");
  });

  it("builds file tree and ignores node_modules and general dotfiles", () => {
    // Create some structure
    mkdirSync(join(tempDir, "src"));
    mkdirSync(join(tempDir, "node_modules"));
    mkdirSync(join(tempDir, "node_modules", "some-pkg"));

    writeFileSync(join(tempDir, "src", "index.ts"), "console.log('hello');");
    writeFileSync(join(tempDir, "node_modules", "some-pkg", "index.js"), "foo");
    writeFileSync(join(tempDir, ".ignored-file"), "ignored");
    writeFileSync(join(tempDir, ".cursorrules"), "cursor rules here");

    const res = handleContext(store, { scope: tempDir, depth: 3 });
    expect(res.scope).toBe(tempDir);
    expect(res.path).toBe(tempDir);
    
    // Check that src/index.ts is in tree
    expect(res.context).toContain("src/");
    expect(res.context).toContain("index.ts");
    
    // Check that whitelisted dotfile .cursorrules is in tree
    expect(res.context).toContain(".cursorrules");
    
    // Check that node_modules and .ignored-file are ignored
    expect(res.context).not.toContain("node_modules");
    expect(res.context).not.toContain(".ignored-file");
  });
});
