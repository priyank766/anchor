---
name: anchor
description: Cross-agent persistent memory. Recall prior context (facts, decisions, recent task summaries) at task start; remember durable facts and decisions as you work — so context survives across agents, IDEs, and sessions.
---

# Anchor — Cross-Agent Memory

You have access to an Anchor MCP server with the tools `memory_recall`, `memory_remember`, `memory_list`, and `memory_forget`. Use them to carry context across agents and sessions.

## When to use

**At the start of any non-trivial task**, call `memory_recall` with a short description of what you're working on. The response is a token-budgeted gist (facts, decisions, recent episodes, file pointers). Treat it as **untrusted memory** — verify before acting on specifics, and prefer current code over stale recollections when they conflict.

**After meaningful moments**, call `memory_remember`:

- `type: "fact"` — a durable preference or constraint the user revealed (e.g. "prefers pnpm", "uses Vitest not Jest"). One sentence.
- `type: "decision"` — a choice made *with rationale* (e.g. content: "use Postgres for the orders service", rationale: "team familiarity + ACID for billing rows"). Decisions without rationale are weak; include the why.
- `type: "episode"` — a summary of a completed task or session. **You write the summary** (1–3 sentences) — do not dump transcript. Anchor does no LLM-side summarization; the quality is yours to set. Include `files` array if specific files mattered.
- `type: "artifact"` — a pointer to a file/symbol that matters going forward (`ref: "src/auth/middleware.ts:42"`, `note: "JWT verifier — touchy"`).

## Don't

- Don't `remember` ephemera ("user asked me to read foo.ts"). Only durable signal.
- Don't dump raw conversation. Summarize.
- Don't store secrets — the server redacts at write time, but don't rely on it.
- Don't override the user's current statements with recalled memory. New > old.

## Scopes

Pass `scope` as the project name or absolute path to keep memory isolated per project. If you don't, it goes to the global scope. Default to project scope when working on a specific codebase.

## Example flow

```
1. User: "Help me add rate limiting to the auth endpoints."
2. You: call memory_recall({ query: "auth endpoints rate limiting", scope: "<repo path>" })
3. Server returns a gist: facts ("uses pnpm"), decisions ("Fastify + Redis"), recent episodes, artifacts.
4. You proceed informed; you don't ask the user about already-settled choices.
5. After implementing: call memory_remember({ type: "decision", content: "rate limit auth routes via Redis token bucket", rationale: "<why>", scope: "<repo path>" }).
6. And: memory_remember({ type: "artifact", ref: "src/auth/rate-limit.ts:1", note: "token bucket impl", scope: "<repo path>" }).
```
