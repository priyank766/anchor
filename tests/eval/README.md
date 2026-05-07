# Anchor evaluation harness

Two evaluations live here. Both run locally; neither calls an LLM API.

## `cold-vs-warm` (offline)

Measures the headline product claim: *"the new agent gets the right context for a fraction of the tokens."*

For each scenario fixture:

1. Seed an isolated Anchor database with the scenario's prior facts, decisions, episodes, and artifacts.
2. Compute **warm tokens**: the size of the gist Anchor would inject at session-start, using the standard 1,500-token budget.
3. Compare against **cold tokens**: the conservative estimate of what the user would have to paste from prior session transcripts to give a new agent the same context.
4. Score **hit-rate**: of the substrings the fixture labels as relevant, how many appear in the warm gist.

Run:

```bash
npm run build --workspaces
node tests/eval/run.mjs
```

Output is a Markdown table on stdout and a JSON artifact under `tests/eval/results/`.

## Scenarios

`tests/eval/fixtures.mjs` — add more by appending to the `SCENARIOS` array. Each fixture is a self-contained project snapshot plus a follow-up request.

## What this is *not*

This harness does **not** measure whether a real agent (Claude, Gemini, Codex) actually completes a task more quickly with Anchor. That would require real API calls and is the next step in the eval roadmap. The numbers here measure the *context cost* delta and the *retrieval quality* signal, both of which are necessary preconditions for the live eval to matter.
