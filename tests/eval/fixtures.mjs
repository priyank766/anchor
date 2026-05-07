// Eval fixtures.
// Each scenario describes a fictional project state and a follow-up request.
// We seed Anchor with the scenario's prior facts/decisions/episodes/artifacts,
// then measure what the agent would receive in (a) cold mode and (b) warm mode.

/**
 * @typedef {Object} SeedItem
 * @property {"fact"|"decision"|"episode"|"artifact"} type
 * @property {string} [content]
 * @property {string} [rationale]
 * @property {string} [ref]
 * @property {string} [note]
 * @property {string[]} [files]
 */

/**
 * @typedef {Object} Scenario
 * @property {string} id
 * @property {string} title
 * @property {string} newRequest
 * @property {number} approxColdTranscriptTokens
 * @property {SeedItem[]} seed
 * @property {string[]} expectedHits
 */

/** @type {Scenario[]} */
export const SCENARIOS = [
  {
    id: "auth-rate-limiting",
    title: "Adding rate limiting to /auth/* endpoints",
    newRequest:
      "Help me add rate limiting to the auth endpoints. Use whatever fits this project.",
    approxColdTranscriptTokens: 9_400,
    seed: [
      {
        type: "fact",
        content: "Backend is Node 20 + Fastify, deployed to Cloudflare Workers.",
      },
      {
        type: "fact",
        content: "Tests are Vitest. The repo has migrated away from Jest.",
      },
      { type: "fact", content: "Package manager is pnpm." },
      {
        type: "decision",
        content: "Use Redis token bucket for cross-instance rate limiting.",
        rationale:
          "We tried in-memory first; failed on multi-region deploy. Redis is already provisioned for sessions.",
      },
      {
        type: "decision",
        content:
          "Auth middleware sits in src/auth/middleware.ts and runs before all /auth/* routes.",
        rationale: "Single chokepoint matches the existing pattern.",
      },
      {
        type: "episode",
        content:
          "Last week added JWT verifier with key rotation; touched src/auth/middleware.ts and tests/auth.spec.ts.",
        files: ["src/auth/middleware.ts", "tests/auth.spec.ts"],
      },
      {
        type: "artifact",
        ref: "src/auth/middleware.ts:42",
        note: "JWT verifier — extension point for new middleware",
      },
      {
        type: "artifact",
        ref: "src/lib/redis.ts:1",
        note: "Shared Redis client singleton",
      },
    ],
    expectedHits: [
      "Fastify",
      "Redis",
      "Vitest",
      "pnpm",
      "src/auth/middleware.ts",
    ],
  },
  {
    id: "stripe-billing",
    title: "Migrating billing to Stripe Checkout",
    newRequest:
      "We need to support self-serve upgrades. What's the right place to plug in?",
    approxColdTranscriptTokens: 7_800,
    seed: [
      {
        type: "fact",
        content:
          "Billing is currently invoice-based via QuickBooks; webhook code lives in legacy/billing-webhook.",
      },
      {
        type: "decision",
        content: "Migrate to Stripe Checkout for self-serve.",
        rationale:
          "Lower friction than negotiating per-customer; tax handled by Stripe.",
      },
      {
        type: "decision",
        content: "New billing module at src/billing/, behind a 'self_serve' flag.",
        rationale:
          "Allows soft launch without breaking existing invoice customers.",
      },
      {
        type: "episode",
        content:
          "Reviewed Stripe API; chose Checkout Sessions over Payment Links for richer metadata.",
      },
      {
        type: "artifact",
        ref: "src/billing/index.ts:1",
        note: "New billing module entry",
      },
    ],
    expectedHits: ["Stripe Checkout", "self_serve", "src/billing"],
  },
];
