# Development

Node.js 24, pnpm 10 (fetched by the scripts), bun (Core tests).

```sh
node scripts/prepare.mjs          # install both packages, fetch pinned assets, build what the app embeds
cd apps/desktop && npx tsc -b && npx tsc -p tsconfig.server.json --noEmit
(cd packages/core && npx tsc --noEmit && bun test ./test)
node scripts/run-tests.mjs        # the release gate (tests/manifest.json)
node scripts/build.mjs            # installer for this platform (Windows: .exe, Linux: AppImage/deb)
node scripts/server-bundle.mjs    # server archive used by the staging image
node scripts/server-smoke.mjs     # starts the packaged server and checks it
```

Web client and site (Cloudflare Workers) are tested with Miniflare:

```sh
cd apps/web-remote && node --experimental-strip-types relay.lab-test.mjs   # needs miniflare and ws installed
cd apps/site       && node site.lab-test.mjs
```

Rules: every change reaches staging first, then a desktop build, then a release. Branches are `feature/*` or `fix/*`, changes land on
`main` by pull request with the tests passing. Task notes and hand-offs do not belong in this repository.
