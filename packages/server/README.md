# @anchormem/server

The MCP server for [Anchor](https://github.com/priyank766/anchor) — local-first cross-agent memory for AI coding agents.

This package is the runtime where memory lives. It exposes five tools (`memory_recall`, `memory_remember`, `memory_supersede`, `memory_forget`, `memory_list`) over the [Model Context Protocol](https://modelcontextprotocol.io) so any compatible agent can read and write a single, durable memory of your project.

Most users do not install this package directly. Install [`@anchormem/anchor`](https://www.npmjs.com/package/@anchormem/anchor) instead — it installs both the server and the CLI in one step.

If you do want the server alone:

```bash
npm install -g @anchormem/server
anchor-server   # starts the stdio MCP server
```

### HTTP transport

```bash
ANCHOR_TRANSPORT=http anchor-server         # localhost:3838
ANCHOR_HTTP_PORT=4000 ANCHOR_TRANSPORT=http anchor-server
```

HTTP mode binds to `127.0.0.1` only, with DNS rebinding protection, rate limiting, and restricted CORS. See the main README for security details.

## Documentation

See the [main project README](https://github.com/priyank766/anchor#readme) for installation, agent configuration, concepts, security notes, and the full reference.

## License

MIT
