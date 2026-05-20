// Expanded eval fixtures — 8 scenarios covering diverse project types.
// Each scenario describes a realistic project snapshot + follow-up request.
// We seed Anchor with the scenario's prior facts/decisions/episodes/artifacts,
// then measure what the agent would receive in cold vs warm mode.

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
 * @property {string} category - Project category for grouping results
 * @property {string} newRequest
 * @property {number} approxColdTranscriptTokens
 * @property {SeedItem[]} seed
 * @property {string[]} expectedHits - Substrings that MUST appear in the gist
 * @property {string[]} [expectedMisses] - Substrings that should NOT appear (superseded/redacted)
 */

/** @type {Scenario[]} */
export const SCENARIOS = [
  // ─── Scenario 1: Backend rate limiting (existing) ─────────────────────
  {
    id: "auth-rate-limiting",
    title: "Adding rate limiting to /auth/* endpoints",
    category: "Backend API",
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

  // ─── Scenario 2: Billing migration (existing) ─────────────────────────
  {
    id: "stripe-billing",
    title: "Migrating billing to Stripe Checkout",
    category: "SaaS Payments",
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

  // ─── Scenario 3: Monorepo migration ───────────────────────────────────
  {
    id: "monorepo-migration",
    title: "Migrating from multi-repo to Turborepo monorepo",
    category: "Infrastructure",
    newRequest:
      "I need to add a new shared package 'utils'. How should I set it up in this monorepo?",
    approxColdTranscriptTokens: 12_500,
    seed: [
      {
        type: "fact",
        content: "Monorepo uses Turborepo with pnpm workspaces. Node 20, TypeScript 5.4.",
      },
      {
        type: "fact",
        content: "Three packages: @acme/web (Next.js 14), @acme/api (Fastify), @acme/db (Drizzle ORM + PostgreSQL).",
      },
      {
        type: "fact",
        content: "CI runs on GitHub Actions. Build order: db → api → web. Turborepo caches in .turbo/.",
      },
      {
        type: "decision",
        content: "Use internal packages (not published to npm) with TypeScript project references.",
        rationale: "Simpler dependency graph; tsconfig paths resolve at build time without npm link.",
      },
      {
        type: "decision",
        content: "Shared tsconfig.base.json at root; each package extends it.",
        rationale: "Consistent compiler options; package-level overrides are explicit.",
      },
      {
        type: "episode",
        content: "Migrated @acme/db from Prisma to Drizzle. Took 3 sessions. Key blocker was Prisma's generated types not playing nicely with project references.",
        files: ["packages/db/src/schema.ts", "packages/db/drizzle.config.ts"],
      },
      {
        type: "episode",
        content: "Added shared ESLint config at packages/config-eslint/. All packages import from it.",
        files: ["packages/config-eslint/index.js"],
      },
      {
        type: "artifact",
        ref: "turbo.json",
        note: "Build pipeline definition — controls caching and task ordering",
      },
      {
        type: "artifact",
        ref: "packages/db/src/schema.ts",
        note: "Drizzle schema — shared type source for the entire monorepo",
      },
    ],
    expectedHits: [
      "Turborepo",
      "pnpm",
      "TypeScript",
      "project references",
      "turbo.json",
      "packages/db",
    ],
  },

  // ─── Scenario 4: ML pipeline debugging ────────────────────────────────
  {
    id: "ml-pipeline-debug",
    title: "Debugging data pipeline for recommendation engine",
    category: "ML/Data",
    newRequest:
      "The recommendation scores are drifting. Where should I look first?",
    approxColdTranscriptTokens: 15_000,
    seed: [
      {
        type: "fact",
        content: "Recommendation engine is Python 3.11, uses scikit-learn for feature engineering and a custom XGBoost ranker.",
      },
      {
        type: "fact",
        content: "Data pipeline: Airflow DAGs pull from PostgreSQL → transform in pandas → write Parquet to S3 → model loads from S3.",
      },
      {
        type: "fact",
        content: "Feature store is a Redis sorted set keyed by user_id. TTL is 24h.",
      },
      {
        type: "decision",
        content: "Log all prediction inputs to a drift_monitor table for post-hoc analysis.",
        rationale: "Can't inspect live without a log; production traffic is 50k req/min.",
      },
      {
        type: "decision",
        content: "Use evidently-ai for data drift detection, running nightly as an Airflow DAG.",
        rationale: "Open-source, integrates with our existing Airflow setup, outputs HTML reports.",
      },
      {
        type: "episode",
        content: "Found that a recent schema migration added a nullable column to the events table; pandas was silently filling NaN with 0, which inflated a key feature.",
        files: ["dags/feature_pipeline.py", "models/ranker/features.py"],
      },
      {
        type: "episode",
        content: "Retrained model after fixing the NaN bug. AUC went from 0.72 to 0.81. Deployed via blue-green on ECS.",
        files: ["models/ranker/train.py", "infra/ecs-deploy.sh"],
      },
      {
        type: "artifact",
        ref: "dags/feature_pipeline.py:120",
        note: "Feature transform that was generating the NaN issue — now fixed with explicit fillna(-1)",
      },
      {
        type: "artifact",
        ref: "models/ranker/config.yaml",
        note: "XGBoost hyperparameters — last tuned after the NaN fix",
      },
    ],
    expectedHits: [
      "XGBoost",
      "drift",
      "NaN",
      "feature_pipeline",
      "Airflow",
      "Parquet",
    ],
  },

  // ─── Scenario 5: Mobile app state management ──────────────────────────
  {
    id: "mobile-state-mgmt",
    title: "React Native app — refactoring global state",
    category: "Mobile",
    newRequest:
      "We need to add offline sync. How does the current state management work and where should queue logic go?",
    approxColdTranscriptTokens: 11_200,
    seed: [
      {
        type: "fact",
        content: "React Native 0.73 with Expo SDK 50. State is Zustand with persist middleware backed by AsyncStorage.",
      },
      {
        type: "fact",
        content: "API layer uses react-query (TanStack Query v5) for server state. Zustand handles only UI + auth state.",
      },
      {
        type: "fact",
        content: "Navigation is Expo Router (file-based routing). Deep links are configured for /product/:id and /order/:id.",
      },
      {
        type: "decision",
        content: "Keep Zustand for client state, TanStack Query for server state. No Redux.",
        rationale: "Redux adds boilerplate without benefit for our scale. Zustand is 2kb and team already knows it.",
      },
      {
        type: "decision",
        content: "Offline mutations queue in Zustand store, replay on reconnect via NetInfo listener.",
        rationale: "TanStack Query's built-in offline support is too opinionated for our custom retry logic.",
      },
      {
        type: "episode",
        content: "Implemented optimistic updates for cart actions. Zustand store has a pendingActions[] array that drains on sync.",
        files: ["src/stores/cart.ts", "src/hooks/useSync.ts"],
      },
      {
        type: "artifact",
        ref: "src/stores/cart.ts",
        note: "Cart store with offline queue — the pattern to follow for new stores",
      },
    ],
    expectedHits: [
      "Zustand",
      "TanStack Query",
      "AsyncStorage",
      "offline",
      "cart.ts",
    ],
  },

  // ─── Scenario 6: Kubernetes migration ─────────────────────────────────
  {
    id: "k8s-migration",
    title: "Migrating from EC2 to Kubernetes",
    category: "DevOps",
    newRequest:
      "We need to add a new microservice. What's the deploy template and CI flow?",
    approxColdTranscriptTokens: 13_800,
    seed: [
      {
        type: "fact",
        content: "EKS cluster on AWS (us-east-1, us-west-2). Helm v3 for chart management. ArgoCD for GitOps deployments.",
      },
      {
        type: "fact",
        content: "Each service has its own Dockerfile, Helm chart under deploy/charts/, and Terraform module for IAM roles.",
      },
      {
        type: "fact",
        content: "Observability: Datadog for metrics/APM, Loki for logs, PagerDuty for alerting. All services export OpenTelemetry spans.",
      },
      {
        type: "decision",
        content: "One namespace per service, one Helm release per environment (staging, prod).",
        rationale: "Namespace isolation prevents resource bleed. Helm values-{env}.yaml per environment.",
      },
      {
        type: "decision",
        content: "All services must expose /healthz and /readyz endpoints. Probes are standardized in the base Helm chart.",
        rationale: "Consistent liveness/readiness checks simplify on-call debugging.",
      },
      {
        type: "episode",
        content: "Migrated the auth service from EC2 to EKS. Hit a DNS resolution issue with the RDS endpoint — had to add a CoreDNS config for the VPC-peered database.",
        files: ["deploy/charts/auth/values-prod.yaml", "infra/coredns-patch.yaml"],
      },
      {
        type: "episode",
        content: "Set up HPA for the API gateway — scales 2→20 pods based on requests/sec. P95 latency dropped from 800ms to 120ms under load.",
      },
      {
        type: "artifact",
        ref: "deploy/charts/base/",
        note: "Base Helm chart — all services inherit from this. Contains probe templates, resource limits, and OTel sidecar.",
      },
    ],
    expectedHits: [
      "EKS",
      "Helm",
      "ArgoCD",
      "OpenTelemetry",
      "deploy/charts",
      "healthz",
    ],
  },

  // ─── Scenario 7: Security audit remediation ───────────────────────────
  {
    id: "security-audit",
    title: "Remediating findings from security audit",
    category: "Security",
    newRequest:
      "Auditor flagged that our API accepts tokens in query strings. What's the fix and what else should I harden?",
    approxColdTranscriptTokens: 10_500,
    seed: [
      {
        type: "fact",
        content: "API is Express.js behind AWS ALB. Auth tokens are JWT signed with RS256, stored in httpOnly cookies.",
      },
      {
        type: "fact",
        content: "CORS is configured per-environment. Dev allows localhost:3000; prod restricts to app.example.com.",
      },
      {
        type: "decision",
        content: "Reject any request with auth token in query string (X-Token-Source header check).",
        rationale: "Query string tokens leak into access logs, referrer headers, and browser history. Cookie-only is safer.",
      },
      {
        type: "decision",
        content: "Add CSP headers via helmet middleware. Report-only mode first, enforce after 2 weeks.",
        rationale: "Cold deploy of CSP breaks unknown inline scripts. Report-only gives us visibility without outage.",
      },
      {
        type: "episode",
        content: "Rotated all JWT signing keys. Old key stays valid for 24h grace period via JWKS endpoint rotation.",
        files: ["src/auth/jwks.ts", "src/auth/rotate-keys.sh"],
      },
      {
        type: "episode",
        content: "Added rate limiting to /login (5 req/min per IP) and /password-reset (3 req/min per email).",
        files: ["src/middleware/rate-limit.ts"],
      },
      {
        type: "artifact",
        ref: "docs/security-audit-2026.md",
        note: "Full audit report with finding IDs and remediation status",
      },
    ],
    expectedHits: [
      "query string",
      "RS256",
      "CSP",
      "helmet",
      "rate limit",
      "security-audit",
    ],
  },

  // ─── Scenario 8: Large-scale refactor with superseded decisions ───────
  {
    id: "db-migration-superseded",
    title: "Database migration — MySQL to PostgreSQL with changed decisions",
    category: "Database",
    newRequest:
      "We're about to migrate the users table. What's the current plan and which tools are we using?",
    approxColdTranscriptTokens: 18_000,
    seed: [
      {
        type: "fact",
        content: "Legacy database is MySQL 5.7 on RDS. Target is PostgreSQL 15 on Aurora Serverless v2.",
      },
      {
        type: "fact",
        content: "ORM is Prisma. Migration scripts are in prisma/migrations/.",
      },
      {
        type: "fact",
        content: "Critical tables: users (8M rows), orders (45M rows), products (200k rows). users has 12 foreign key constraints.",
      },
      {
        type: "decision",
        content: "Use pgloader for the bulk data copy phase.",
        rationale: "pgloader handles MySQL→Postgres type mapping natively. Tested on staging with full dataset in 40 minutes.",
      },
      // This decision was superseded — testing that the old one doesn't leak
      {
        type: "decision",
        content: "Run dual-write mode for 2 weeks before cutover, not 1 week.",
        rationale: "1 week wasn't enough to catch monthly billing edge cases. Extended to cover a full billing cycle.",
      },
      {
        type: "episode",
        content: "Discovered that MySQL ENUM columns don't map cleanly to Postgres. Created a manual mapping script for 14 enum columns.",
        files: ["scripts/enum-mapping.ts", "prisma/schema.prisma"],
      },
      {
        type: "episode",
        content: "Load-tested Aurora Serverless with production traffic replay. 99th percentile latency was 23ms vs MySQL's 45ms.",
      },
      {
        type: "episode",
        content: "Rolled back first cutover attempt — a stored procedure used MySQL-specific DATE_FORMAT(). Rewrote to use TO_CHAR().",
        files: ["scripts/migrate-sprocs.sql"],
      },
      {
        type: "artifact",
        ref: "docs/migration-runbook.md",
        note: "Step-by-step cutover runbook with rollback procedures",
      },
      {
        type: "artifact",
        ref: "scripts/enum-mapping.ts",
        note: "MySQL ENUM → Postgres type mapping — run before pgloader",
      },
    ],
    expectedHits: [
      "pgloader",
      "Aurora Serverless",
      "dual-write",
      "enum",
      "migration-runbook",
      "Prisma",
    ],
  },
];
