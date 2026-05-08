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

Anchor lets any AI coding agent — Claude Code, Codex, Cursor, Cline, Gemini CLI, Copilot, Windsurf, OpenCode, Zed, and others — share one project memory. Switch agents and the next one already knows your decisions, preferences, and recent work. No transcripts. No API keys. One local SQLite file you own.

---

## Quick start

Three commands. Anchor is ready in under a minute.

```bash
# 1. Install and initialize (creates ~/.anchor/)
npx @anchormem/anchor init

# 2. Tell Claude Code about it (or your agent of choice — see below)
claude mcp add anchor -- anchor-server

# 3. Open the interactive console any time
anchor
```

That's it. Your next Claude Code session can call `memory_recall` and `memory_remember` automatically. To verify everything's wired up:

```bash
claude mcp list      # should show:  anchor: ✓ Connected
anchor doctor        # checks data dir, scope, redaction, agent config
```

---

## Other agents

Anchor speaks [MCP](https://modelcontextprotocol.io), so almost every modern coding agent can use it. Pick yours:

<details>
<summary><b>Codex CLI</b></summary>

```toml
# ~/.codex/config.toml
[mcp.anchor]
command = "anchor-server"
```
</details>

<details>
<summary><b>Cursor</b></summary>

```json
// .cursor/mcp.json
{
  "mcpServers": {
    "anchor": { "command": "anchor-server" }
  }
}
```
</details>

<details>
<summary><b>Cline / Continue.dev / Windsurf / OpenCode / Zed</b></summary>

Each accepts an MCP server entry. Use `command: anchor-server` and refer to the host's MCP documentation for the configuration file location.
</details>

<details>
<summary><b>Auto-load memory at session start (any agent)</b></summary>

Wire `anchor hook <agent> session-start` into the agent's startup. For Claude Code:

```jsonc
// ~/.claude/settings.json
{
  "hooks": {
    "SessionStart": [{ "command": "anchor hook claude-code session-start" }]
  }
}
```

For other agents, pipe the plain-text output into the agent's system-prompt flag:

```bash
echo '{"cwd":"'"$PWD"'"}' | anchor hook generic session-start
```

When the project scope has no memories, the hook emits nothing — Anchor never wastes the agent's context budget.
</details>

---

## How it works

Your agent calls two tools:

- **`memory_recall(query)`** at the start of a task. Anchor returns a 1–2k-token summary of relevant prior context. Not a transcript — a structured gist of facts, decisions, recent task summaries, and file pointers.
- **`memory_remember(...)`** when something durable happens. Four types:
  - `fact` — a preference or constraint (*"uses pnpm, not npm"*)
  - `decision` — a choice with rationale (*"use Postgres for orders — ACID + team familiarity"*)
  - `episode` — a 1–3 sentence task summary (the agent writes it)
  - `artifact` — a file or symbol pointer (`src/auth/middleware.ts:42`)

When a fact goes stale, the agent uses **`memory_supersede`** instead of adding a contradicting one. Old facts age out via salience decay; secrets get redacted at write time; provenance travels with every recalled item.

Anchor itself has no LLM. Your agent does the writing; Anchor does the storing, ranking, and compressing. There is no telemetry. There are no accounts.

---

## Common commands

```bash
anchor                  # interactive console (search, recall, remember, browse)
anchor init             # initialize ~/.anchor (idempotent)
anchor status           # what's stored, where
anchor list             # print memories in the current scope
anchor doctor           # diagnose db, scope, redaction, agent config
anchor export > a.json  # back up to JSON
anchor import a.json    # restore from JSON (idempotent)
anchor prune            # drop low-salience episodes
anchor reembed          # backfill embeddings (when configured)
anchor help             # full reference
```

The interactive console is the easiest way to inspect and edit memory. Type a query and press enter to recall; use slash commands (`/help`, `/remember`, `/supersede`, `/forget`, `/list`, `/scope`) for everything else.

---

## Optional: semantic recall

Anchor's default retrieval is BM25 over SQLite FTS5 — fast, deterministic, no setup. If a query and a stored fact don't share keywords ("the auth thing" vs "JWT verifier rotation"), BM25 misses. To enable semantic recall, point Anchor at any embedding provider.

<details>
<summary><b>Ollama (local, recommended)</b></summary>

```bash
ollama pull nomic-embed-text
export ANCHOR_EMBED_PROVIDER=ollama
```

That's all. Recall now returns hybrid hits (BM25 + vector). Other supported models: `mxbai-embed-large`, `all-minilm`, `bge-large`, `snowflake-arctic-embed`.
</details>

<details>
<summary><b>OpenAI</b></summary>

```bash
export ANCHOR_EMBED_PROVIDER=openai
export ANCHOR_OPENAI_API_KEY=sk-...
# Default: text-embedding-3-small. Set ANCHOR_EMBED_MODEL to override.
```
</details>

<details>
<summary><b>Google Gemini</b></summary>

```bash
export ANCHOR_EMBED_PROVIDER=gemini
export ANCHOR_GEMINI_API_KEY=...
# Default: text-embedding-004.
```
</details>

<details>
<summary><b>Voyage AI (Anthropic-recommended)</b></summary>

Anthropic has no first-party embeddings API; their official guidance is to use [Voyage](https://www.voyageai.com). Anchor accepts both `voyage` and the alias `anthropic`.

```bash
export ANCHOR_EMBED_PROVIDER=voyage
export ANCHOR_VOYAGE_API_KEY=...
# Default: voyage-3.
```
</details>

To backfill vectors for memories you stored before turning embeddings on:

```bash
anchor reembed
```

---

## Security

Anchor redacts known secret patterns at write time (OpenAI / Anthropic / Google / Stripe / Slack / GitHub keys, AWS access keys, JWTs, PEM private keys, and `.env`-style variables that look like secrets). It also scrubs known prompt-injection phrases ("ignore previous instructions", "you are now …", "reveal your system prompt") before content reaches disk.

The data directory is created with mode `0700` and the database with `0600` on POSIX hosts. Recalled memory is delivered with an explicit *"treat as untrusted"* footer.

To report a security issue privately, see [SECURITY.md](SECURITY.md).

---

## Project status

Phase 0 skeleton plus most of Phase 1 are shipped: the four memory types, BM25 retrieval, hybrid (BM25 + vector) retrieval through four embedding providers, secret redaction, prompt-injection scrubbing, salience decay, supersession, export/import, the universal session-start hook, and a reproducible offline benchmark showing **97% token-cost reduction vs transcript paste** across two scenarios. 79 tests, all passing.

Live cold-vs-warm benchmark across real agents and a marketing site are next.

---

## Contributing

PRs welcome. We're especially looking for:

- New agent integrations (tested install snippets)
- Secret redaction patterns
- Retrieval quality improvements (with benchmarks)
- Documentation for setups we haven't tried yet

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution scope and what we will / won't merge.

---

## License

[MIT](LICENSE) — use it for anything, attribution appreciated.
