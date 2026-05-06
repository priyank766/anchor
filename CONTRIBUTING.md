# Contributing to Anchor

Thanks for thinking about contributing. Anchor is a cross-agent memory layer — small, focused, local-first. We want it to stay that way.

## Quick start

```bash
git clone https://github.com/priyank766/anchor
cd anchor
npm install
npm run build --workspaces
npm test --workspaces
```

To register the local server with Claude Code:

```bash
claude mcp add anchor -- node "$(pwd)/packages/server/dist/index.js"
claude mcp list   # should show: anchor ✓ Connected
```

To run the TUI:

```bash
node packages/cli/dist/index.js
```

## Project layout

```
packages/
  server/    MCP server (the runtime: storage + retrieval + redaction)
  cli/       `anchor` CLI + ink-based TUI
  anchor/    meta-package for `npx @anchormem/anchor`
  skill/     SKILL.md (open Agent Skills spec, for skills.sh)
```

## What we want help with

- **More agent integrations.** Tested install snippets for Codex, Cursor, Cline, Gemini CLI, Continue.dev, Aider, Zed, Windsurf, OpenCode — anything that speaks MCP. PR adds to the README + a small writeup of any quirks.
- **Secret redaction patterns.** New API key formats, new framework patterns, regression cases. Add the pattern + a unit test in `packages/server/src/capture/redact.ts` and `redact.test.ts`.
- **Retrieval quality.** Better reranking heuristics, salience decay, supersession handling. Bring a benchmark, not just a vibe.
- **Embedding adapters.** Optional, for users who want vector search. Local (Ollama) and hosted (OpenAI / Anthropic / Gemini) adapters behind the `EmbedProvider` interface.
- **Eval harness.** The "cold vs warm" benchmark from `tests/eval/` — improvements to the methodology, more agents, more realistic tasks.

## What we won't merge

- **Cloud-first features** that require accounts to use the basic product. Local-first is non-negotiable.
- **Mandatory LLM dependencies** in the hot path (recall/remember). The agent does its own summarization. Adapters are opt-in only.
- **Vendor lock-in.** No Anthropic-only or OpenAI-only paths. Cross-agent is the whole point.
- **Premature abstractions.** Show the second concrete use case before extracting an interface.
- **Unsolicited refactors** bundled with feature work. Keep PRs scoped.

## Code style

- TypeScript, strict mode. `noUncheckedIndexedAccess` is on; respect it.
- Default to no comments. Add one when *why* is non-obvious; never explain *what*.
- No JSDoc on internal symbols.
- Tests with `vitest`. Critical paths (redaction, retrieval, compression) need regression tests.
- No new dependencies without justification in the PR description. We're proud of how few there are.

## Commit style

Conventional-ish, but not strict:

- `feat(server): add scope filter to recall`
- `fix(redact): catch new Anthropic key prefix`
- `docs(readme): per-agent install snippet for Cline`

Group logical changes per commit. PRs can have multiple commits if it helps review.

## Pull requests

- One change per PR. Bundling makes review hard.
- Include a test if you're touching redaction, retrieval, compression, or the MCP tool surface.
- Update the per-agent install snippet in the README if you add a new integration.
- For non-trivial design choices, link an ADR (or write one — see below).

## Architecture decisions

We use ADRs (Architecture Decision Records) for non-trivial choices. They live in `docs/decisions/` privately; if you propose a significant architectural change, open a discussion issue first and we'll either point you to the relevant ADR or work one out together.

## Reporting bugs

GitHub Issues. Include:
- What agent / version
- What MCP tool was called and with what args
- Expected vs actual
- A minimal repro if possible (e.g. an exported `~/.anchor/memory.db` snippet, or a SQL transcript)

Never paste real API keys or secrets — even though the redactor strips them at write time, your bug report doesn't go through it.

## Security

If you find a way to leak secrets, exfiltrate memory across scopes, or inject prompts via recalled content — please email **[security contact TBD]** rather than filing a public issue.

## License

MIT. By contributing, you agree your contributions are MIT-licensed.

## Code of conduct

Be kind. Critique code, not people. Assume good faith.
