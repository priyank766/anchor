# CLAUDE.md — Project orientation for Claude Code

This file is **gitignored**. It's the assistant's brain for this project. The public repo never sees it.

## What this project is

**Anchor** — cross-agent memory layer. Local-first MCP server + open Agent Skill so any agent (Claude Code, Codex, Cursor, Cline, Antigravity, …) shares context across sessions.

The moat is **compressed, query-time retrieval** — not storage.

## Where to find things

The **`docs/` folder is the project's diary, mind, and soul.** Always check it before answering questions about intent, decisions, or trajectory. It's gitignored — internal-only.

Read in this order when starting a new session:

1. `docs/vision.md` — thesis, audience, non-goals
2. `docs/roadmap.md` — current phase, what's in/out
3. `docs/decisions/` — ADRs, numbered. **0005 supersedes 0004.** Treat ADRs as immutable history; supersede with a new one rather than editing.
4. `docs/journal/` — dated progress entries; the most recent has the freshest context
5. `docs/threats.md` — failure modes that can kill the product (secret leakage, prompt injection via memory, etc.)
6. `docs/competitors.md` — prior art and where we differ
7. `docs/marketing.md` — positioning, the "cold vs warm" pitch
8. `docs/testing.md` — eval methodology
9. `docs/ideas.md` — parking lot for half-baked ideas
10. `docs/distribution.md` — publish checklist (skills.sh, MCP dirs, npm, pip, brew, etc.)

## Conventions

- **Every non-trivial change** adds either a new ADR (`docs/decisions/NNNN-*.md`) for choices, or a journal entry (`docs/journal/YYYY-MM-DD.md`) for progress. Short paragraphs, not essays.
- **ADRs are immutable.** Mark old ones `superseded by NNNN` rather than rewriting.
- **Code style**: terse, no unnecessary comments, no premature abstractions. The repo's own root rules apply (CLAUDE.md instructions in user's home dir take precedence — check those first).
- **Branding**: Product = **Anchor**. CLI = `anchor`. Server bin = `anchor-server`. npm scope = `@anchormem`. Skill registry handle = `anchormem/anchor` (or user's GitHub username if going personal). Data dir = `~/.anchor/`. The folder on disk is still named `OpenMEM/` for legacy reasons; rename later when convenient.

## Architecture (one-screen)

```
Agents (Claude Code, Codex, Cursor, …)
   │ MCP (stdio)            │ Skill (SKILL.md)
   ▼                        ▼
Anchor MCP Server (TypeScript, Node 20+)
   ├ tools: memory_recall / memory_remember / memory_forget / memory_list
   ├ retrieval: SQLite FTS5 (BM25)  →  rerank by type/recency  →  token-budgeted gist
   ├ capture: redact-at-write (secrets stripped before storage)
   └ store: SQLite at ~/.anchor/memory.db
```

Repo:

```
packages/
  server/     MCP server (TS) — the runtime, where the moat lives
  cli/        `anchor` — TUI (ink) + one-shot subcommands
  anchor/     meta-package for `npx @anchormem/anchor`
  skill/      SKILL.md for skills.sh / Vercel Labs CLI
docs/         GITIGNORED — internal diary, do not push
```

## What's NOT in the public repo

- `docs/` (this whole folder)
- `CLAUDE.md` (this file)
- `.claude/` (personal Claude Code settings)
- The plan file at `~/.claude/plans/yes-lets-create-plan-glistening-rainbow.md`

If asked about strategy, roadmap, or product reasoning, draw on `docs/` — but never copy private content into public files (PRs, README, commits, GitHub issues).

## Current state (rough; refresh from journal)

- Phase 0 skeleton complete: schema, retrieval, redaction, four MCP tools, CLI, ink TUI, SKILL.md
- All unit tests pass
- Registered with Claude Code via `claude mcp add anchor` — `✓ Connected`
- LICENSE (MIT), README, plugin manifest in place
- Pending user actions: GitHub repo creation, npm scope reservation, first push

## Defaults when uncertain

- Pick TypeScript over alternatives (ADR 0002)
- Pick local-first over hosted (vision)
- Pick "agent does its own summarization" over "Anchor calls an LLM" (ADR 0005)
- Pick no API key required over BYO key in the hot path (ADR 0005)
- Pick MCP for the runtime and Skill for distribution, both (ADR 0001)

When in doubt: re-read the most recent journal entry and the latest ADR.


for the commit only commit like this : git commit -m "{just what changes we have done in very short sentence only}"--->>> do not add the sign of claude email or anything extra to it 