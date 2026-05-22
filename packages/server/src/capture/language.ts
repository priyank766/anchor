// Language detection module for Anchor

const EXTENSION_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  go: "go",
  py: "python",
  rs: "rust",
  java: "java",
  cpp: "cpp",
  hpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  c: "c",
  h: "c",
  rb: "ruby",
  php: "php",
  cs: "csharp",
  swift: "swift",
  kt: "kotlin",
  kts: "kotlin",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  yaml: "yaml",
  yml: "yaml",
  json: "json",
  md: "markdown",
  html: "html",
  htm: "html",
  css: "css",
  sql: "sql",
  dockerfile: "docker",
};

const CODEBLOCK_MAP: Record<string, string> = {
  ts: "typescript",
  typescript: "typescript",
  tsx: "typescript",
  js: "javascript",
  javascript: "javascript",
  jsx: "javascript",
  go: "go",
  golang: "go",
  py: "python",
  python: "python",
  rs: "rust",
  rust: "rust",
  java: "java",
  cpp: "cpp",
  c: "c",
  rb: "ruby",
  ruby: "ruby",
  php: "php",
  cs: "csharp",
  csharp: "csharp",
  swift: "swift",
  sh: "shell",
  bash: "shell",
  yaml: "yaml",
  json: "json",
  sql: "sql",
  css: "css",
  html: "html",
  docker: "docker",
  dockerfile: "docker",
};

export function detectLanguage(args: {
  content: string;
  rationale?: string;
  ref?: string;
  files?: string[];
}): string | null {
  // 1. Detect from ref extension
  if (args.ref) {
    const ext = getExtension(args.ref);
    if (ext && EXTENSION_MAP[ext]) {
      return EXTENSION_MAP[ext]!;
    }
  }

  // 2. Detect from files extensions
  if (args.files && args.files.length > 0) {
    for (const file of args.files) {
      const ext = getExtension(file);
      if (ext && EXTENSION_MAP[ext]) {
        return EXTENSION_MAP[ext]!;
      }
    }
  }

  // Combine content and rationale for text-based analysis
  const fullText = (args.content + " " + (args.rationale ?? "")).trim();
  if (!fullText) return null;

  // 3. Detect from markdown code blocks, e.g., ```typescript
  const codeBlockRegex = /```(\w+)/g;
  let match;
  while ((match = codeBlockRegex.exec(fullText)) !== null) {
    const langToken = match[1]?.toLowerCase();
    if (langToken && CODEBLOCK_MAP[langToken]) {
      return CODEBLOCK_MAP[langToken]!;
    }
  }

  // 4. Heuristic-based syntax keyword detection
  const lowerText = fullText.toLowerCase();

  // Go heuristics
  if (
    /package\s+\w+/.test(fullText) &&
    (lowerText.includes("func ") || lowerText.includes("import (") || lowerText.includes("struct {"))
  ) {
    return "go";
  }

  // Rust heuristics
  if (
    lowerText.includes("fn main(") ||
    lowerText.includes("pub struct ") ||
    lowerText.includes("impl ") ||
    lowerText.includes("let mut ")
  ) {
    return "rust";
  }

  // Python heuristics
  if (
    lowerText.includes("def ") &&
    (lowerText.includes("self") || lowerText.includes("import ") || lowerText.includes("class "))
  ) {
    return "python";
  }

  // TypeScript/JavaScript heuristics
  if (
    lowerText.includes("import {") ||
    lowerText.includes("export class ") ||
    lowerText.includes("const ") ||
    lowerText.includes("let ")
  ) {
    if (
      lowerText.includes("interface ") ||
      lowerText.includes("type ") ||
      lowerText.includes("as string") ||
      lowerText.includes(": string") ||
      lowerText.includes(": number")
    ) {
      return "typescript";
    }
    return "javascript";
  }

  // SQL heuristics
  if (
    (lowerText.includes("select ") || lowerText.includes("insert into ") || lowerText.includes("create table ")) &&
    (lowerText.includes("where ") || lowerText.includes("values (") || lowerText.includes("primary key"))
  ) {
    return "sql";
  }

  // HTML heuristics
  if (lowerText.includes("<!doctype html>") || lowerText.includes("<html>") || lowerText.includes("</div>")) {
    return "html";
  }

  // CSS heuristics
  if (lowerText.includes("margin:") && lowerText.includes("padding:") && lowerText.includes("color:")) {
    return "css";
  }

  // Shell heuristics
  if (lowerText.includes("#!/bin/bash") || lowerText.includes("#!/bin/sh")) {
    return "shell";
  }

  return null;
}

function getExtension(path: string): string | null {
  const parts = path.split(/[/\\]/);
  const fileName = parts[parts.length - 1] ?? "";
  if (fileName.toLowerCase() === "dockerfile") return "dockerfile";
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0) return null;
  return fileName.substring(dotIndex + 1).toLowerCase();
}
