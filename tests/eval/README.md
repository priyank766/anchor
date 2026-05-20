# Anchor evaluation harness

Two evaluations live here. Both run locally; neither calls an LLM API.

## `cold-vs-warm` (offline)

Measures the headline product claim: *"the new agent gets the right context for a fraction of the tokens."*

For each scenario fixture:

1. Seed an isolated Anchor database with the scenario's prior facts, decisions, episodes, and artifacts.
2. Compute **warm tokens**: the size of the gist Anchor would inject at session-start, using the standard 1,500-token budget.
3. Compare against **cold tokens**: the conservative estimate of what the user would have to paste from prior session transcripts to give a new agent the same context.
4. Score **hit-rate**: of the substrings the fixture labels as relevant, how many appear in the warm gist.
5. Score **BM25 precision**: how many expected hits appear in the BM25-only search path.
6. Measure **latency**: seed time, recall time, FTS search time.
7. Check **information leaks**: superseded/redacted content that shouldn't appear in the gist.

Run:

```bash
npm run build --workspaces
node tests/eval/run.mjs
```

Output is a Markdown summary on stdout and a JSON artifact under `tests/eval/results/`.

## Scenarios

`tests/eval/fixtures.mjs` — 8 scenarios across 8 project categories:

| # | Scenario | Category | Seed Items |
|---|----------|----------|:----------:|
| 1 | Auth rate limiting | Backend API | 8 |
| 2 | Stripe billing migration | SaaS Payments | 5 |
| 3 | Turborepo monorepo | Infrastructure | 9 |
| 4 | ML pipeline debugging | ML/Data | 9 |
| 5 | React Native state mgmt | Mobile | 7 |
| 6 | EC2 → Kubernetes | DevOps | 8 |
| 7 | Security audit remediation | Security | 7 |
| 8 | MySQL → PostgreSQL migration | Database | 10 |

Add more by appending to the `SCENARIOS` array. Each fixture is a self-contained project snapshot plus a follow-up request.

## Metrics

| Metric | What it measures |
|--------|-----------------|
| **Token reduction** | `1 - warm/cold` — how much context budget Anchor saves |
| **Hit rate** | Fraction of expected keywords found in the gist |
| **BM25 precision** | Same as hit rate, but using FTS search path only |
| **Seed latency** | Time to insert all items (write throughput) |
| **Recall latency** | Time to retrieve + compress gist (read throughput) |
| **Information leaks** | Superseded/redacted content that shouldn't appear |

## What this is *not*

This harness does **not** measure whether a real agent (Claude, Codex, Antigravity) actually completes a task more quickly with Anchor. That would require real API calls and is the next step in the eval roadmap. The numbers here measure the *context cost* delta and the *retrieval quality* signal, both of which are necessary preconditions for the live eval to matter.
