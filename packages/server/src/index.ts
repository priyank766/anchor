#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { Store } from "./store/db.js";
import { handleRemember } from "./tools/remember.js";
import { handleRecall } from "./tools/recall.js";
import { handleForget } from "./tools/forget.js";
import { handleList } from "./tools/list.js";
import { handleSupersede } from "./tools/supersede.js";
import { handleSummary } from "./tools/summary.js";
import { handleContext } from "./tools/context.js";
import { handleUpdate } from "./tools/update.js";
import { handleHandoff } from "./tools/handoff.js";
import { handleDiff } from "./tools/diff.js";
import { handleReplay } from "./tools/replay.js";
import { startHttpServer } from "./http.js";


const TOOLS = [
  {
    name: "memory_recall",
    description:
      "REQUIRED FIRST STEP: Retrieve a token-budgeted gist of relevant historical memory (facts, decisions, episodes, artifacts) for a query. You MUST call this tool at the VERY START of any task or session to get prior context, retrieve established project rules, and avoid asking redundant questions or violating design choices.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What you're working on / looking for." },
        scope: {
          type: "string",
          description: "Project scope. Defaults to global. Pass a path or project name to isolate.",
        },
        budgetTokens: {
          type: "number",
          description: "Max tokens in the returned gist. Default 1500.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_remember",
    description:
      "REQUIRED TASK COMPLETION STEP: Persist a durable historical memory item. You MUST call this tool immediately upon completing a task, making a key architectural choice, discovering a project preference, or identifying a critical file so future runs/agents are aware. Use type='fact' for durable preferences, 'decision' for choices made (with rationale), 'episode' for task summaries, 'artifact' for file/symbol pointers.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["fact", "decision", "episode", "artifact"] },
        content: { type: "string" },
        rationale: { type: "string", description: "Required only for type=decision (recommended)." },
        ref: { type: "string", description: "Required for type=artifact (e.g. 'src/foo.ts:42')." },
        note: { type: "string" },
        files: { type: "array", items: { type: "string" } },
        scope: { type: "string" },
        agent: { type: "string", description: "Calling agent name, e.g. 'claude-code'." },
        sessionId: { type: "string" },
      },
      required: ["type", "content"],
    },
  },
  {
    name: "memory_forget",
    description:
      "Delete a memory item by ID. Use only when a memory is completely invalid or created by mistake.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "memory_list",
    description: "List memories in a scope. Useful for auditing and inspecting stored facts/decisions.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string" },
        type: { type: "string", enum: ["fact", "decision", "episode", "artifact"] },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "memory_supersede",
    description:
      "REQUIRED UPDATE STEP: Replace an outdated or stale fact or decision. Marks the old row as superseded and inserts a new one with the same type. You MUST use this instead of memory_remember when a prior choice or preference changes, so subsequent recalls get the correct, clean version.",
    inputSchema: {
      type: "object",
      properties: {
        oldId: { type: "string", description: "id of the fact/decision being replaced" },
        content: { type: "string" },
        rationale: { type: "string", description: "Recommended for decisions." },
        scope: { type: "string" },
        agent: { type: "string" },
        sessionId: { type: "string" },
      },
      required: ["oldId", "content"],
    },
  },
  {
    name: "memory_summary",
    description:
      "Retrieve a structured summary of all stored memories (facts, decisions, episodes, and artifacts) for a scope to understand existing context and rules.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          description: "Project scope. Defaults to global. Pass a path or project name to isolate.",
        },
      },
    },
  },
  {
    name: "memory_context",
    description:
      "Retrieve codebase context (file tree, git branch, commits, status) if the scope represents a local directory.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          description: "Project scope directory path. Defaults to current workspace root.",
        },
        depth: {
          type: "number",
          description: "Max folder depth to traverse for the file tree. Default 2, max 5.",
        },
      },
    },
  },
  {
    name: "memory_update",
    description:
      "Update and register the Anchor MCP server configuration in all detected local coding tools (Claude Code, Cursor, Codex, Windsurf, Cline, Antigravity, etc.). Optionally setup project-scoped files if scope is provided.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          description: "Project scope directory path to also generate project-level configs.",
        },
      },
    },
  },
  {
    name: "memory_handoff",
    description:
      "RECOMMENDED FIRST STEP when switching agents or starting a new session. Generates a structured handoff brief containing: (1) Active thread — what was being worked on recently, (2) Standing rules — facts and decisions that constrain behavior, (3) Key files — artifacts pointing into the codebase. Token-budgeted. Call this ONCE at session start instead of asking the user to re-explain the project.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          description: "Project scope. Defaults to global.",
        },
        budgetTokens: {
          type: "number",
          description: "Max tokens in the handoff brief. Default 3000.",
        },
        since: {
          type: "string",
          description: "How far back to look for recent activity. E.g. '1h', '1d', '7d'. Default '3d'.",
        },
      },
    },
  },
  {
    name: "memory_diff",
    description:
      "Show what changed in memory since a given time. Returns new and updated facts, decisions, episodes, and artifacts. Useful for catching up on what happened while you were away.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          description: "Project scope. Defaults to global.",
        },
        since: {
          type: "string",
          description: "How far back to look. E.g. '1h', '1d', '7d', or ISO date. Default '1d'.",
        },
      },
    },
  },
  {
    name: "memory_replay",
    description:
      "Reconstruct a chronological narrative of project decisions and episodes. Returns the project timeline — what happened, in order. Useful for understanding the full arc of a project.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          description: "Project scope. Defaults to global.",
        },
        limit: {
          type: "number",
          description: "Max events to return. Default 100.",
        },
      },
    },
  },
];

// Detect transport mode from env or CLI args.
function detectTransport(): "stdio" | "http" {
  if (process.env.ANCHOR_TRANSPORT?.toLowerCase() === "http") return "http";
  if (process.argv.includes("--http")) return "http";
  return "stdio";
}

async function main() {
  const cfg = loadConfig();
  const store = new Store(cfg);
  const mode = detectTransport();

  const server = new Server(
    { name: "anchor", version: "0.1.5" },
    { capabilities: { tools: {}, prompts: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: [
        {
          name: "anchor-instructions",
          description: "System instructions for using Anchor persistent memory effectively.",
        },
      ],
    };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const { name } = req.params;
    if (name !== "anchor-instructions") {
      throw new Error(`Unknown prompt: ${name}`);
    }
    return {
      description: "Instructions for persistent memory tools",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `You are equipped with the 'anchor' persistent cross-agent memory system. This repository contains a local-first memory store (SQLite) that is persistent across all terminal and IDE agents (Cursor, Claude Code, Cline, Antigravity, Codex, etc.).

To ensure alignment and avoid repetitive questions, you must follow these guidelines:

1. **At the start of any session (especially when switching agents)**, invoke 'memory_handoff' FIRST. This gives you a structured brief of: what was being worked on, standing decisions/facts, and key files. If you only need narrow context for a specific query, use 'memory_recall' instead.
2. **When you finish a task, make an architectural decision, or identify a critical file**, you MUST invoke 'memory_remember' to store this context for future runs:
   - type='fact': Durable project preference (e.g., "uses vitest for testing").
   - type='decision': Architectural choice + required 'rationale' (e.g., why you chose a specific library).
   - type='episode': Summarize the task completed in 1-3 sentences.
   - type='artifact': Points to a specific file/symbol.
3. **If a recalled fact/decision is now outdated or incorrect** (e.g., codebase migrated from Jest to Vitest), you MUST invoke 'memory_supersede' using the old memory ID. Do not simply call 'memory_remember' to add a contradicting fact.
4. **To catch up on recent changes**, use 'memory_diff' with a time range (e.g. since='1d').
5. **To understand the full project arc**, use 'memory_replay' for a chronological timeline.
6. **Scope**: Always pass the project scope (typically the project folder path) to isolate memory to this project.`,
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      let result: unknown;
      switch (name) {
        case "memory_recall":
          result = await handleRecall(store, args ?? {});
          break;
        case "memory_remember":
          result = await handleRemember(store, args ?? {});
          break;
        case "memory_forget":
          result = handleForget(store, args ?? {});
          break;
        case "memory_list":
          result = handleList(store, args ?? {});
          break;
        case "memory_supersede":
          result = handleSupersede(store, args ?? {});
          break;
        case "memory_summary":
          result = handleSummary(store, args ?? {});
          break;
        case "memory_context":
          result = handleContext(store, args ?? {});
          break;
        case "memory_update":
          result = handleUpdate(store, args ?? {});
          break;
        case "memory_handoff":
          result = handleHandoff(store, args ?? {});
          break;
        case "memory_diff":
          result = handleDiff(store, args ?? {});
          break;
        case "memory_replay":
          result = handleReplay(store, args ?? {});
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
      return {
        content: [
          {
            type: "text",
            text:
              typeof result === "string"
                ? result
                : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${msg}` }],
        isError: true,
      };
    }
  });

  if (mode === "http") {
    const port = parseInt(process.env.ANCHOR_HTTP_PORT ?? "3838", 10);
    const host = process.env.ANCHOR_HTTP_HOST ?? "127.0.0.1";
    process.stderr.write(`[anchor] starting HTTP transport. db=${cfg.dbPath}\n`);
    await startHttpServer({ port, host, mcpServer: server });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // Server runs until stdin closes. No log-to-stdout: stdio is the protocol.
    process.stderr.write(`[anchor] ready. db=${cfg.dbPath}\n`);
  }
}

main().catch((e) => {
  process.stderr.write(`[anchor] fatal: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
