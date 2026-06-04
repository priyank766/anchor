import { describe, it, expect, beforeEach } from "vitest";
import { Store } from "../store/db.js";
import { handleUpdate } from "./update.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function newStore() {
  const dir = mkdtempSync(join(tmpdir(), "anchor-update-test-"));
  return new Store({
    dataDir: dir,
    dbPath: join(dir, "memory.db"),
    defaultBudgetTokens: 1500,
  });
}

describe("handleUpdate", () => {
  let store: Store;
  beforeEach(() => {
    store = newStore();
  });

  it("triggers global update and logs command execution", () => {
    const res = handleUpdate(store, {});
    expect(res.success).toBe(true);
    expect(res.output).toContain("Running:");
  });

  it("handles scope and logs project level configuration if scope is valid", () => {
    const res = handleUpdate(store, { scope: "test-scope" });
    expect(res.success).toBe(true);
    // Since "test-scope" is not a valid directory path, it should not run the setup command (only init)
    expect(res.output).not.toContain("setup --all");
  });
});
