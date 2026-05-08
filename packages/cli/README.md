# @anchormem/cli

The `anchor` command-line interface for [Anchor](https://github.com/priyank766/anchor) — local-first cross-agent memory for AI coding agents.

Provides:

- An interactive console (TUI) for browsing, searching, and editing memory
- One-shot commands: `anchor init`, `status`, `list`, `export`, `import`, `doctor`, `prune`, `reembed`, `hook`

Most users install [`@anchormem/anchor`](https://www.npmjs.com/package/@anchormem/anchor) instead — it bundles both this CLI and the MCP server.

If you want the CLI alone (and already have `@anchormem/server` installed for `anchor-server`):

```bash
npm install -g @anchormem/cli
anchor                # opens the interactive console
anchor help           # full command reference
```

## Documentation

See the [main project README](https://github.com/priyank766/anchor#readme) for installation, agent configuration, concepts, security notes, and the full reference.

## License

MIT
