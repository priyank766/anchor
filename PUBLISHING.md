# Publishing Anchor to npm

Internal notes for the maintainer. Not part of the public package surface.

## One-time setup

1. **Reserve the scope.** Confirm `@anchormem` is available on npmjs.com:

   ```bash
   npm view @anchormem 2>&1 | head -1
   # expected: "npm error 404 Not Found"
   ```

   If it 404s, the scope is yours on first publish. If it returns metadata, someone else has it — pick a different scope (`@priyank766` is always available since it matches your GitHub username) and update every `package.json` and the README accordingly.

2. **Create the npm account and enable 2FA.** `npm publish` for new packages requires a verified email and (for new accounts since 2024) 2FA on writes.

   ```bash
   npm login              # interactive
   npm whoami             # confirm
   ```

3. **Confirm packages build clean from a fresh checkout.**

   ```bash
   git clean -fdx -e CLAUDE.md -e docs   # nuke node_modules, dist, etc.
   npm install
   npm test --workspaces                 # 79 tests should pass
   npm run build --workspaces
   ```

## Publish order

Publish in dependency order. `@anchormem/cli` depends on `@anchormem/server`; `@anchormem/anchor` depends on both.

```bash
cd packages/server  && npm publish --access public
cd ../cli           && npm publish --access public
cd ../anchor        && npm publish --access public
```

`--access public` is required for scoped packages; without it npm tries to publish private and fails on free-tier accounts.

## Verify after publish

In a fresh shell, outside this repo:

```bash
cd $(mktemp -d)
npx @anchormem/anchor init        # banner + "Initialized at ~/.anchor"
npx @anchormem/anchor doctor      # all checks pass
npx @anchormem/anchor help        # full reference
```

Then in Claude Code:

```bash
claude mcp add anchor -- anchor-server
claude mcp list                    # anchor: ✓ Connected
```

## Provenance (recommended for v0.1.0 onward)

For every release, attach a signed attestation linking the package to the GitHub Actions run that built it. This requires publishing from CI rather than your laptop.

```yaml
# .github/workflows/publish.yml — sketch, not yet committed
permissions:
  id-token: write       # required for --provenance
  contents: read

steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 20
      registry-url: https://registry.npmjs.org
  - run: npm install
  - run: npm test --workspaces
  - run: npm run build --workspaces
  - run: |
      cd packages/server  && npm publish --access public --provenance
      cd ../cli           && npm publish --access public --provenance
      cd ../anchor        && npm publish --access public --provenance
    env:
      NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Generate `NPM_TOKEN` as an npm "Granular Access Token" scoped to the `@anchormem` packages with publish permission only.

## Bumping versions

We use semver. For patch/minor/major bumps across the workspace:

```bash
# pick a new version, e.g. 0.0.2
npm version 0.0.2 --workspaces --no-git-tag-version
```

Then re-pin the cross-package deps in `cli` and `anchor` to match (`npm version --workspaces` updates the package's own version but not the version it appears under in dependent packages).

## Things that are easy to forget

- The `@anchormem/cli` and `@anchormem/anchor` packages reference `@anchormem/server` with `^0.0.1`. After the first publish of `server`, both can install. Before that first publish, `npm publish` of `cli` will fail because `server` isn't on the registry yet — that's fine, just publish in order.
- The CLI's `bin` field is `anchor`, the meta-package's `bin` field is also `anchor`. If a user installs both globally, npm picks the most recently installed. Tell users to install the meta-package only.
- The server's `dist/store/schema.sql` is **not** required at runtime; the schema is embedded as a TS string in `dist/store/schema.js`. Don't try to ship the .sql file separately.
- The `files` field in each `package.json` controls what gets uploaded. Verify with `npm pack --dry-run` from each package's directory before the real publish.

## Pre-flight checklist

Run this from the repo root every time you publish:

```bash
# 1. Tests
npm test --workspaces

# 2. Build
npm run build --workspaces

# 3. Inspect what would ship for each package
cd packages/server  && npm pack --dry-run && cd ../..
cd packages/cli     && npm pack --dry-run && cd ../..
cd packages/anchor  && npm pack --dry-run && cd ../..

# 4. Confirm no secrets
grep -rIE "sk-[a-zA-Z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}" packages/*/dist/ || echo "clean"

# 5. Confirm the CLI runs from a fresh install (locally, no publish)
npm pack --workspaces
# install the resulting tarballs in a scratch dir and run anchor init
```

If all five pass, publish. If any fail, fix before publishing — first impressions on npm are sticky.
