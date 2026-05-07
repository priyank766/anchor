# Security Policy

## Reporting a vulnerability

Please **do not** file a public GitHub issue for security problems. Instead, email the maintainer at the address listed on the project's GitHub profile, or open a private GitHub Security Advisory at:

`https://github.com/priyank766/anchor/security/advisories/new`

Include:

- A description of the issue
- Steps to reproduce, ideally with a minimal repro
- The Anchor version (`anchor --version` once published, or commit SHA)
- The agent and OS you observed it on

You should expect an acknowledgement within a week. For confirmed issues, we will work on a fix and coordinate disclosure.

## Scope

The following are in scope:

- Anything that lets an attacker exfiltrate memory across scopes
- Anything that lets an attacker leak a secret that should have been redacted at write time
- Anything that lets an attacker inject prompts via recalled memory in a way that survives the "treat as untrusted" framing
- Privilege escalation via the local SQLite file or its permissions
- SQL injection, FTS5 query injection, or path traversal

Out of scope:

- A user pasting their own secret into an agent before Anchor sees it. Anchor cannot redact data it never receives. Use the agent's own input handling for that.
- Reports that depend on attacker-controlled physical access to the user's machine
- DoS via filling the disk; Anchor is local-first and bounded by the user's own storage

## Defense layers

Anchor is local-first. There is no cloud component, no telemetry, no auto-update. The defenses below are about hardening the local product surface.

### Secret redaction at write time

Every `memory_remember` runs `packages/server/src/capture/redact.ts` before content reaches disk. Patterns covered: OpenAI, Anthropic, Google, Stripe, Slack, GitHub keys; AWS access key IDs and likely secret access keys; JSON Web Tokens; PEM private key blocks; `.env`-style assignments whose variable name implies a secret. Tested per-pattern in `redact.test.ts`. Conservative on purpose — false positives over-redact (visible to the user); false negatives leak secrets (silent and dangerous).

### Prompt-injection scrubbing

After redaction, `packages/server/src/capture/scrub.ts` neutralizes well-known injection phrases ("ignore previous instructions", "you are now a …", "reveal your system prompt", etc.) before storage. Combined with the recall footer that marks all output as untrusted memory, this raises the bar for malicious content surviving a round trip through Anchor. It is not a substitute for the agent treating recalled content as data.

### Scope isolation

All read paths filter by `scope_id`. A fact written in scope A never appears in a scope-B query. Default scope is the git repo root of the agent's cwd; users on shared parent directories should pass an explicit scope.

### Filesystem permissions

On POSIX hosts, `~/.anchor/` is created with mode `0700` and the database file with mode `0600`. Existing directories and files from earlier versions are tightened on next run. On Windows we rely on inherited NTFS ACLs; users on multi-user Windows machines should verify the data directory is not over-shared.

### Parameterized SQL

Every SQL statement uses bound parameters. The only user-controlled string used in a SQL fragment is the table name in `deleteById`, which is restricted to a hard-coded allowlist of the four memory tables.

### FTS5 query sanitization

`sanitizeFtsQuery` strips everything except letters, digits, and whitespace, then OR-joins the remaining tokens as quoted phrases. Attacker input cannot escape the quoted form.

### Provenance footer

Every `memory_recall` response ends with a footer naming the contributing sessions and explicitly marking the content as untrusted memory. The Claude Code hook output wraps the gist with the same warning.

## Supply-chain expectations

Anchor's runtime depends on `@modelcontextprotocol/sdk`, `better-sqlite3`, `zod`, `ink`, `react`, and `ink-text-input`. None call the network in default usage. Users who fork should pin `package-lock.json` and verify `npm audit` before publishing downstream.

When Anchor itself publishes to npm, releases will be built with `--provenance` and signed. Until then, install from source if you need full attestation.

## Disclosure timeline

- Day 0: report received
- ≤ 7 days: acknowledgement
- ≤ 30 days: fix or written rationale for why no fix is appropriate
- After fix: public advisory on GitHub with credit to the reporter (unless they prefer anonymity)
