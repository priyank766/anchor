import { describe, it, expect } from "vitest";
import { detectLanguage } from "./language.js";

describe("detectLanguage", () => {
  it("detects from ref extension", () => {
    const lang = detectLanguage({
      content: "some text",
      ref: "src/main.rs",
    });
    expect(lang).toBe("rust");
  });

  it("detects from files extensions", () => {
    const lang = detectLanguage({
      content: "some text",
      files: ["src/main.go"],
    });
    expect(lang).toBe("go");
  });

  it("detects from code block", () => {
    const lang = detectLanguage({
      content: "Here is a code block:\n```python\ndef my_func():\n  pass\n```\nAnd some text.",
    });
    expect(lang).toBe("python");
  });

  it("detects from heuristics (typescript)", () => {
    const lang = detectLanguage({
      content: "import { useState } from 'react';\nconst Component = (): string => 'hello';",
    });
    expect(lang).toBe("typescript");
  });

  it("detects from heuristics (go)", () => {
    const lang = detectLanguage({
      content: "package main\nimport \"fmt\"\nfunc main() {\n  fmt.Println(\"hello\")\n}",
    });
    expect(lang).toBe("go");
  });

  it("returns null when no language is detected", () => {
    const lang = detectLanguage({
      content: "Just standard plain english with no code features.",
    });
    expect(lang).toBeNull();
  });
});
