# @anchormem/anchor

**Cross-agent memory for AI coding agents. Local-first.**

This is the meta-package. Installing it gives you both the `anchor` CLI and the `anchor-server` MCP server in one step — the recommended way to use [Anchor](https://github.com/priyank766/anchor).

## Quick start

```bash
# 1. Install and initialize (creates ~/.anchor/)
npx @anchormem/anchor init

# 2. Tell Claude Code about it
claude mcp add anchor -- anchor-server

# 3. Open the interactive console any time
anchor
```

That's it. Your next Claude Code session can call `memory_recall` and `memory_remember` automatically.

## What you get

- `anchor` — the CLI and interactive console
- `anchor-server` — the MCP server stdio binary

Both are installed on your `PATH` after `npm install -g @anchormem/anchor` (or used directly via `npx`).

## Documentation

See the [main project README](https://github.com/priyank766/anchor#readme) for:

- Connecting other agents (Codex, Cursor, Cline, Antigravity CLI, Continue.dev, Windsurf, OpenCode, Zed)
- Auto-loading project memory at session start (hooks)
- Optional semantic recall via embeddings (Ollama, OpenAI, Gemini, Voyage)
- Common commands
- Security notes
- Contributing

## License

MIT
