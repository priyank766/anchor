#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { Store } from "./store/db.js";
import { handleRemember } from "./tools/remember.js";
import { handleRecall } from "./tools/recall.js";
import { handleForget } from "./tools/forget.js";
import { handleList } from "./tools/list.js";
import { handleSupersede } from "./tools/supersede.js";
import { startHttpServer } from "./http.js";

const TOOLS = [
  {
    name: "memory_recall",
    description:
      "Retrieve a token-budgeted gist of relevant memory (facts, decisions, episodes, artifacts) for a query. Call this BEFORE starting work on a task to get prior context.",
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
      "Persist a memory item. Use type='fact' for durable preferences, 'decision' for choices made (with rationale), 'episode' for task summaries, 'artifact' for file/symbol pointers.",
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
    description: "Delete a memory item by id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "memory_list",
    description: "List memories in a scope. Useful for inspection.",
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
      "Replace a stale fact or decision. Marks the old row as superseded and inserts a new one with the same type. Use this instead of remembering a conflicting fact, so recall gets the current version cleanly.",
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
    { name: "anchor", version: "0.0.1" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

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
