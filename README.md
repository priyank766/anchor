<div align="center">

```
 █████╗ ███╗   ██╗ ██████╗██╗  ██╗ ██████╗ ██████╗
██╔══██╗████╗  ██║██╔════╝██║  ██║██╔═══██╗██╔══██╗
███████║██╔██╗ ██║██║     ███████║██║   ██║██████╔╝
██╔══██║██║╚██╗██║██║     ██╔══██║██║   ██║██╔══██╗
██║  ██║██║ ╚████║╚██████╗██║  ██║╚██████╔╝██║  ██║
╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝
```

**Cross-agent memory for AI coding agents. Local-first.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/protocol-MCP-8A2BE2)](https://modelcontextprotocol.io)
[![Skills](https://img.shields.io/badge/skills.sh-compatible-00C7B7)](https://skills.sh)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

Anchor is an MCP server and open Agent Skill that gives any AI coding agent — Claude Code, Codex, Cursor, Cline, Gemini CLI, Continue.dev, Windsurf, OpenCode, Zed, and others — shared access to a single, durable memory of your project.

When you change agents (rate limits, model preferences, team handoff), the next agent does not start cold. It calls `memory_recall` and receives a compressed, token-budgeted summary of what matters: prior decisions with rationale, durable preferences, recent task summaries, and file pointers. Not a transcript.

No accounts. No API keys. One SQLite file at `~/.anchor/memory.db`.

---

## Contents

- [Installation](#installation)
- [Agent configuration](#agent-configuration)
- [Concepts](#concepts)
- [MCP tool reference](#mcp-tool-reference)
- [Command-line interface](#command-line-interface)
- [Benchmarks](#benchmarks)
- [Security](#security)
- [Architecture](#architecture)
- [Development](#development)
- [Auto-load on session start (hooks)](#auto-load-on-session-start-hooks)
- [Status](#status)
- [License](#license)

---

## Installation

```bash
npx @anchormem/anchor init
```

Or install as an open Agent Skill (compatible with 50+ agents through the [skills.sh](https://skills.sh) ecosystem):

```bash
npx skills add priyank766/anchor
```

A Python distribution is planned:

```bash
pip install anchormem
```

---

## Agent configuration

Anchor exposes its tools through MCP over stdio. Each agent registers MCP servers differently.

### Claude Code

```bash
claude mcp add anchor -- anchor-server
```

### Codex CLI

```toml
# ~/.codex/config.toml
[mcp.anchor]
command = "anchor-server"
```

### Cursor

```json
// .cursor/mcp.json
{
  "mcpServers": {
    "anchor": { "command": "anchor-server" }
  }
}
```

### Cline, Continue.dev, Windsurf, OpenCode, Zed

Each accepts an MCP server entry. Use `command: anchor-server` and refer to the host's MCP documentation for the configuration file location.

---

## Auto-load on session start (hooks)

The MCP tools require the agent to *call* `memory_recall` at the right moment. The hook adapter avoids that: it injects prior project memory into the agent's context the moment a session starts. No tool call required.

The adapter is `anchor hook <agent> <event>`. It reads optional JSON from stdin (the host's hook payload), figures out the project scope from `cwd` (git root), retrieves the most recent in-scope memory under a 1,500-token budget, and emits output in the format the host expects.

| Agent | Output format | Behavior |
|---|---|---|
| `claude-code` | JSON: `{ hookSpecificOutput.additionalContext }` | Injected into the agent's system context. |
| `gemini`, `codex`, `opencode`, `hermes`, `generic` | Plain text | Pipe into the agent's startup `--system` flag, stdin, or context-loader convention. |

If the project scope has no memories, the hook emits nothing — Anchor never wastes the agent's context budget.

### Claude Code

```jsonc
// ~/.claude/settings.json
{
  "hooks": {
    "SessionStart": [
      { "command": "anchor hook claude-code session-start" }
    ]
  }
}
```

Verify with `anchor doctor` — it probes `~/.claude.json` and reports whether the entry is present.

### Gemini CLI / Codex / OpenCode / Hermes

Each tool has a way to load a system prompt at startup. Use the plain-text output:

```bash
# Generic shell pattern
anchor hook generic session-start <<< "{}" > /tmp/anchor-context.txt
gemini --system "$(cat /tmp/anchor-context.txt)"          # Gemini CLI
codex --system-file /tmp/anchor-context.txt               # Codex (illustrative)
opencode --context /tmp/anchor-context.txt                # OpenCode (illustrative)
```

The exact flag varies per agent; the contract is "Anchor produces the system-prompt fragment, you pipe it in." Empty when there is nothing to inject, so the wrapper never harms a fresh project.

### Manual / shell-script integration

For any agent not listed above, treat the `generic` flavor as the universal interface:

```bash
echo '{"cwd":"'"$PWD"'"}' | anchor hook generic session-start
```

This is the same contract Anchor itself follows internally — every agent flavor is a small formatter on top of it.

---

## Concepts

Anchor stores four types of memory. Each has different retrieval and decay behavior.

| Type | Purpose | Decay |
|------|---------|-------|
| `fact` | Durable preference or constraint. Example: *"uses pnpm, not npm"*. | None until superseded. |
| `decision` | A choice made, with rationale. Example: *"use Postgres for the orders service — ACID + team familiarity"*. | None until superseded. |
| `episode` | A 1–3 sentence task summary written by the calling agent. | Logarithmic salience decay. |
| `artifact` | A pointer to a file, symbol, or URL. Example: `src/auth/middleware.ts:42`. | Tied to file existence. |

Each record carries provenance — the calling agent's name, session identifier, and timestamp — so the consuming agent can trust or override individual items.

Memory is partitioned by **scope**. The default scope is `global`; agents typically pass the project root path as the scope to keep work isolated per project.

Anchor does not call an external language model. The calling agent is responsible for writing its own summaries when it stores an episode. Anchor performs storage, retrieval, ranking, and token-budgeted compression.

---

## MCP tool reference

### `memory_recall`

Retrieve a token-budgeted gist of relevant memory.

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Required. Description of the current task or question. |
| `scope` | string | Optional. Project name or absolute path. Defaults to `global`. |
| `budgetTokens` | number | Optional. Maximum tokens in the returned gist. Defaults to `1500`. |

Returns a Markdown document with sections for Facts, Decisions, Recent episodes, and Artifacts, followed by a provenance footer naming the contributing sessions.

### `memory_remember`

Persist a memory record.

| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | `"fact" \| "decision" \| "episode" \| "artifact"` | Required. |
| `content` | string | Required for `fact`, `decision`, `episode`. |
| `rationale` | string | Optional. Recommended for `decision`. |
| `ref` | string | Required for `artifact`. Example: `src/auth/middleware.ts:42`. |
| `note` | string | Optional. Used with `artifact`. |
| `files` | string[] | Optional. Used with `episode`. |
| `scope` | string | Optional. |
| `agent` | string | Optional. The calling agent name. |
| `sessionId` | string | Optional. |

### `memory_forget`

Delete a record by id. Required parameter: `id`.

### `memory_list`

Enumerate memory in a scope. Optional parameters: `scope`, `type`, `limit`.

---

## Command-line interface

```
anchor                Interactive memory console
anchor init           Initialize the data directory
anchor status         Show configuration and stats
anchor list           Print memories (non-interactive)
anchor path           Print the database path
anchor help           Show usage
```

`anchor` with no arguments opens an interactive console with a prompt-driven UI. Type a query to recall; use slash commands for everything else.

```
> rate limiting auth
> /remember fact uses Vitest, not Jest
> /remember decision use token bucket via Redis
> /list decision
> /scope /home/me/projects/api
> /help
> /quit
```

`Ctrl-C` to exit.

---

## Benchmarks

Anchor's read path is the product. Below are end-to-end measurements on a Windows 11 / Node 22 host, with a fresh SQLite database, no embeddings, BM25 retrieval only. Reproducible via `node packages/server/dist/bench/bench.js`.

| Memories stored | Insert avg | Recall p50 | Recall p95 | Gist size (avg) | DB size | Bytes / item |
|---:|---:|---:|---:|---:|---:|---:|
| 100    | 0.74 ms | 1.14 ms | 3.14 ms | 126 tokens  | 168 KB | 1,720 |
| 1,000  | 0.83 ms | 1.53 ms | 1.93 ms | 553 tokens  | 596 KB | 610 |
| 10,000 | 0.82 ms | 2.59 ms | 3.31 ms | 553 tokens  | 4.2 MB | 433 |

Reading the table:

- **Insert is constant-time** in practice — FTS5 keeps up with sustained writes.
- **Recall stays under 4 ms p95 at 10,000 memories.** The query path is dominated by SQLite FTS5 BM25, not by Anchor's reranking.
- **Gist size honors the budget.** Default budget is 1,500 tokens; at every scale the average response is well under it. Larger corpora produce *richer* gists, not bloated ones.
- **Storage is amortized.** FTS index overhead dominates at small scale (1.7 KB/item at 100); at 10k items the marginal cost is ~430 bytes/item.

### Context cost compared to a transcript dump

If your alternative is pasting prior session transcripts into a new agent, a typical 30-minute coding session is 8,000–15,000 tokens of dialogue. Anchor's recall returns a 500–1,500-token gist at any database scale. This is the headline number.

| Approach | Tokens injected | Information density |
|---|---|---|
| Cold start (no memory) | 0 | None |
| Paste prior transcript | 8,000–15,000 | Low (high noise) |
| Anchor recall | 500–1,500 | High (typed, ranked, deduplicated) |

A formal cold-vs-warm benchmark across multiple agents (Claude Code, Codex, Gemini CLI) is on the Phase 1 roadmap.

---

## Security

Anchor redacts known secret patterns at write time, before content reaches disk. Patterns covered include:

- OpenAI, Anthropic, Google, Stripe, Slack, and GitHub API keys
- AWS access key identifiers and likely secret access keys
- JSON Web Tokens
- PEM-encoded private key blocks (RSA, EC, DSA, OpenSSH, PGP)
- `.env`-style assignments whose variable name implies a secret (`*_TOKEN`, `*_API_KEY`, `*_SECRET`, `*_PASSWORD`, `*_PRIVATE_KEY`, `*_ACCESS_KEY`)

Recalled content is delivered with a footer marking it as untrusted. Agents should treat recalled material as data, not instructions, to mitigate prompt-injection vectors.

---

## Architecture

```
Agents (Claude Code, Codex, Cursor, ...)
   |  MCP (stdio)              |  Skill (SKILL.md)
   v                           v
Anchor MCP server (Node 20+, TypeScript)
   |  Tools:    memory_recall / remember / forget / list
   |  Retrieval: SQLite FTS5 (BM25) -> rerank -> token-budgeted gist
   |  Capture:  redact-at-write
   v
SQLite at ~/.anchor/memory.db
```

The MCP server is the runtime. The Skill is the cross-agent contract that makes the runtime usable consistently across agents that speak the open Agent Skills specification.

Anchor has no remote dependencies. There is no telemetry. Optional embedding-based vector search (via Ollama or hosted providers) is on the roadmap and will remain opt-in.

---

## Development

```bash
git clone https://github.com/priyank766/anchor
cd anchor
npm install
npm run build --workspaces
npm test --workspaces
```

Run the development server against Claude Code:

```bash
claude mcp add anchor -- node "$(pwd)/packages/server/dist/index.js"
claude mcp list
```

Run the interactive console locally:

```bash
node packages/cli/dist/index.js
```

Run the benchmark:

```bash
node packages/server/dist/bench/bench.js
```

The repository is a TypeScript workspace:

```
packages/
  server/    MCP server: schema, retrieval, redaction, tool handlers, bench
  cli/       The anchor command and the interactive console
  anchor/    Meta-package for npx @anchormem/anchor
  skill/     SKILL.md — the open Agent Skills entry
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for code style and contribution scope.

---

## Status

Phase 0. The schema, MCP tool surface, BM25 retrieval, redaction, CLI, interactive console, and benchmark harness are in place. Token-budgeted compression and embedding-backed retrieval are scheduled for Phase 1.

---

## License

[MIT](LICENSE)
