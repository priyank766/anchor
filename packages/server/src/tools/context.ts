import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { Store } from "../store/db.js";
import { ContextInput } from "./schemas.js";
import { resolveDefaultScope } from "../scope.js";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".anchor",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "out",
  "coverage",
  ".cache",
  "target",
  ".idea",
  ".vscode",
  "vendor",
  "bin",
  "obj",
]);

const ALLOWED_DOT_FILES = new Set([
  ".cursorrules",
  ".clinerules",
  ".gitignore",
  ".mcp.json",
  ".npmrc",
  ".env",
  ".env.example",
  ".env.local",
]);

function buildFileTree(dir: string, maxDepth: number): string {
  const lines: string[] = [];

  function walk(currDir: string, depth: number, prefix: string) {
    if (depth > maxDepth) return;

    let files: string[];
    try {
      files = readdirSync(currDir);
    } catch {
      return;
    }

    const filtered = files.filter((f) => {
      if (IGNORED_DIRS.has(f)) return false;
      if (f.startsWith(".") && !ALLOWED_DOT_FILES.has(f)) return false;
      return true;
    });

    // Sort folders first, then files
    filtered.sort((a, b) => {
      let aIsDir = false;
      let bIsDir = false;
      try {
        aIsDir = statSync(join(currDir, a)).isDirectory();
      } catch {}
      try {
        bIsDir = statSync(join(currDir, b)).isDirectory();
      } catch {}
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return a.localeCompare(b);
    });

    filtered.forEach((file, index) => {
      const fullPath = join(currDir, file);
      let isDir = false;
      try {
        isDir = statSync(fullPath).isDirectory();
      } catch {}

      const isLast = index === filtered.length - 1;
      const marker = isLast ? "└── " : "├── ";
      lines.push(`${prefix}${marker}${file}${isDir ? "/" : ""}`);

      if (isDir) {
        const newPrefix = prefix + (isLast ? "    " : "│   ");
        walk(fullPath, depth + 1, newPrefix);
      }
    });
  }

  walk(dir, 1, "");
  return lines.join("\n");
}

function getGitInfo(dir: string): { branch?: string; status?: string; log?: string } {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd: dir, stdio: "ignore" });
  } catch {
    return {};
  }

  let branch: string | undefined;
  let status: string | undefined;
  let log: string | undefined;

  try {
    branch = execSync("git branch --show-current", { cwd: dir, encoding: "utf8" }).trim();
  } catch {}

  try {
    status = execSync("git status --porcelain", { cwd: dir, encoding: "utf8" }).trim();
  } catch {}

  try {
    log = execSync("git log -n 5 --oneline", { cwd: dir, encoding: "utf8" }).trim();
  } catch {}

  return { branch, status, log };
}

export function handleContext(store: Store, raw: unknown) {
  const input = ContextInput.parse(raw);
  const scope = store.resolveScope(resolveDefaultScope(input.scope));
  const depth = input.depth ?? 2;

  const resolvedPath = scope.path;

  if (!resolvedPath || !existsSync(resolvedPath)) {
    return {
      scope: scope.name,
      path: resolvedPath,
      message: "Scope is not a local folder path, or the directory does not exist.",
      context: `# Codebase Context: ${scope.name}\n\nScope is not resolved to a local folder path or the directory does not exist.`,
    };
  }

  const gitInfo = getGitInfo(resolvedPath);
  const fileTree = buildFileTree(resolvedPath, depth);

  let md = `# Codebase Context: ${scope.name}\n`;
  md += `**Path:** \`${resolvedPath}\`\n\n`;

  md += `## 🌿 Git Information\n`;
  if (gitInfo.branch) {
    md += `- **Branch:** \`${gitInfo.branch}\`\n`;
    if (gitInfo.log) {
      md += `- **Recent Commits:**\n\`\`\`text\n${gitInfo.log}\n\`\`\`\n`;
    } else {
      md += `- **Recent Commits:** None found\n`;
    }

    if (gitInfo.status) {
      md += `- **Uncommitted Changes:**\n\`\`\`text\n${gitInfo.status}\n\`\`\`\n`;
    } else {
      md += `- **Uncommitted Changes:** Clean\n`;
    }
  } else {
    md += `Not a git repository or git commands failed.\n`;
  }
  md += `\n`;

  md += `## 📂 File Structure (depth: ${depth})\n`;
  if (fileTree) {
    md += `\`\`\`text\n${fileTree}\n\`\`\`\n`;
  } else {
    md += `No visible files found in the directory.\n`;
  }

  return {
    scope: scope.name,
    path: resolvedPath,
    git: {
      branch: gitInfo.branch,
      hasChanges: !!gitInfo.status,
    },
    context: md.trim(),
  };
}
