<div align="center">

```
       _
      ( )
       H
      _H_
   .-'-.-'-.
  /         \
  '---------'
```

# Anchor

**Cross-agent memory. Your context, every agent.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/protocol-MCP-8A2BE2)](https://modelcontextprotocol.io)
[![Skills](https://img.shields.io/badge/skills.sh-compatible-00C7B7)](https://skills.sh)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

You hit your Claude limit. You switch to Gemini CLI. It knows nothing about your project.

Anchor fixes that. A **local-first** memory layer any AI agent can read from and write to — Claude Code, Codex, Cursor, Cline, Gemini CLI, Copilot, Windsurf, and 50+ more via the [open Agent Skills](https://skills.sh) spec + [MCP](https://modelcontextprotocol.io).

The moat isn't storage. It's **compressed, query-time retrieval** — the new agent gets a 1–2k-token gist of what matters, not a transcript dump.

> **No API keys required.** The calling agent writes its own summaries. Anchor stores, retrieves, and ranks.

---

##  Why Anchor?

| Without Anchor | With Anchor |
|---|---|
| Switch agents → re-explain everything | Switch agents → context follows you |
| Each tool has its own siloed memory | One local store, every tool reads it |
| Agent dumps full transcripts → context bloats | Agent gets a 1500-token gist of *this* task |
| Need vendor accounts / API keys | Local SQLite file. No accounts. |

##  Install

```bash
# Quickest — try it
npx @anchormem/anchor init

# Or as an open Agent Skill (auto-installs into 50+ agents)
npx skills add priyank766/anchor

# Or pip (coming soon)
pip install anchormem
```

## 🔌 Connect your agent

Anchor speaks MCP. Every modern agent has its own way to register an MCP server. Pick yours:

<details open>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add anchor -- anchor-server
```
</details>

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

Each accepts an MCP server config. Use `command: anchor-server`. PRs welcome with tested snippets — see [CONTRIBUTING.md](CONTRIBUTING.md).
</details>

##  How it works

1. **Recall at task start.** Your agent calls `memory_recall(query)` and gets a token-budgeted markdown gist — facts, decisions with rationale, recent episode summaries, file pointers. ~1500 tokens, not a transcript.

2. **Remember as you work.** Your agent calls `memory_remember` with one of four typed records:

   | Type | What it is | Example |
   |---|---|---|
   | `fact` | Durable preference / constraint | "uses pnpm, not npm" |
   | `decision` | Choice made, with rationale | "use Postgres because…" |
   | `episode` | 1–3 sentence task summary written *by the agent* | "Added rate limiting via Redis token bucket; touched auth/*" |
   | `artifact` | File / symbol pointer that matters | `src/auth/middleware.ts:42` |

3. **Provenance on every recall.** You see which agent and session wrote each fact, so the new agent (and you) can trust or override.

4. **Secret redaction at write time.** API keys, tokens, JWTs, AWS keys, `.env` values stripped before they hit disk. Trust is the unblock.

5. **Local-only.** One SQLite file at `~/.anchor/memory.db`. You own it. Export/import any time. Optional cloud sync later.

## 🖥️ CLI

```
anchor              Open the interactive memory browser (TUI)
anchor init         Initialize ~/.anchor
anchor status       DB stats
anchor list         List memories (text)
anchor path         Print the DB path
```

The TUI ships with search (`/`), navigation (`↑↓`/`jk`), expand (`enter`), forget (`d`), quit (`q`).

##  What gets redacted before storage

- OpenAI / Anthropic / Google / Stripe / Slack / GitHub keys
- AWS access key IDs and secret access keys
- JWTs (header.payload.signature)
- Private key blocks (RSA / EC / DSA / OpenSSH / PGP)
- `.env`-style assignments where the variable name suggests a secret (`*_TOKEN`, `*_API_KEY`, `*_SECRET`, `*_PASSWORD`, etc.)

If you find a leak path, please email instead of filing a public issue. See [CONTRIBUTING.md](CONTRIBUTING.md#security).

## 🗺️ Roadmap

- **Phase 0** *(now)* — skeleton: SQLite store, BM25 retrieval, four MCP tools, CLI + TUI, secret redaction, the open Skill
- **Phase 1** — token-budgeted compression, optional embeddings (Ollama / OpenAI), per-agent capture hooks, the *cold-vs-warm* benchmark
- **Phase 2** — `pip install anchormem`, single static binary, Homebrew tap, marketing site
- **Phase 3** — opt-in E2E-encrypted cloud sync (multi-device)

## 🤝 Contributing

PRs welcome. We're especially looking for:

- New agent integrations (tested install snippets)
- Secret redaction patterns
- Retrieval quality improvements (with benchmarks)
- Embedding adapters

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide and what we will / won't merge.

##  FAQ

**Is this an agent?** No. Anchor doesn't generate, plan, or act. It remembers. Your agent does the work.

**Does it need an LLM API key?** No. The calling agent writes its own summaries. Embeddings (vector search) are optional and can be local (Ollama) or hosted.

**What about privacy?** Local-first. Single SQLite file. Secret redaction at write time. Per-project scoping so work memory doesn't leak into personal projects.

**How is this different from `mem0` / `Letta` / `Zep` / `OpenMemory MCP`?** Most ship an SDK and need code changes in your agent. Anchor ships an MCP server + an open Skill — zero changes in any agent that already speaks MCP. Plus typed memory (facts/decisions/episodes/artifacts) instead of undifferentiated blobs.

**Why is the moat compression?** Storage is a commodity (SQLite). The hard part is turning a year of conversations into the right 1500 tokens for *this* task. That's the engineering.

##  License

[MIT](LICENSE)

---

<div align="center">
<sub>Built so you never have to re-explain your project to a new agent again.</sub>
</div>
