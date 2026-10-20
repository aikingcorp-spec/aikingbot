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
node scripts/cloudflare.lab-test.mjs                                       # the shared Cloudflare helper, against a stand-in API
```

Putting the web service and the site on the owner's domain (the domain must be an active zone in the Cloudflare account):

```sh
set -a; . <secrets>/cloudflare.env; . <secrets>/relay.env; set +a
node scripts/go-live.mjs --domain example.com --dry-run      # checks the token, the zone, the Workers and the host names; changes nothing
node scripts/go-live.mjs --domain example.com                # deploys the web service on app.example.com and the site, then runs the checks
node scripts/verify-live.mjs --app https://app.example.com --site https://aikingbot-site.<account>.workers.dev   # the light check, any time
```

After the domain is live, run `node scripts/set-addresses.mjs --app-url https://app.example.com`, the release gate, then build the next release.

Rules: every change reaches staging first, then a desktop build, then a release. Branches are `feature/*` or `fix/*`, changes land on
`main` by pull request with the tests passing. Task notes and hand-offs do not belong in this repository.
