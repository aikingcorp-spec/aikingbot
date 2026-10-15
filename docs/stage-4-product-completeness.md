# Stage 4 — product integration and recovery

2026-10-15 · `stage3/shipping-candidate` · follows Stage 3 `e7ff535`.

Marketplace now supports reviewed agent/skill template updates, install status per target, removal only
after the server confirms deletion, and migration of Stage 2 browser records. Migration admits targets
present in this workspace and never downgrades records already on the server. Updates publish immutable
skill revisions after checking the source and reviewed hash. They keep disabled skills disabled and preserve
agent conversations, names, models, permissions, memory and routines. Partial updates leave the prior
version marker so retry remains available. An operator can publish a validated catalog through
`AIKING_CATALOG_FILE` and restart the server; remote catalog administration is not exposed.

Core is listed in the host's engine fleet and uses the existing Anthropic Connections settings. A connection
with its own endpoint/key never receives the shared key. Core supports owner-assigned library skills,
token usage, model-fallback notices and unknown-price reporting. Completed transcripts survive restart;
interrupted approval state is marked interrupted, with no replay. Compact/reset seeds the selected host
branch. A missing native transcript fails closed or explicitly rebuilds from host recovery text. A room's
next member starts after the prior member's MCP cleanup. Model fallback and MCP initialization honor abort.

## Gate results

- 950/950 compatibility tests across 36 files: models/account/key flows, permissions, routines/restart,
  groups, browser, computer, remote sessions, Voice, Marketplace, encrypted backup/restore and redaction.
- 87/87 Core tests, including authenticated HTTP MCP, desktop-compatible server names and fallback abort.
- 6/6 focused Core driver recovery tests after the final recovery changes.
- 9/9 Chromium shipping E2E: Core stream/approve/deny/reload, Marketplace install/update/migrate/uninstall,
  local Voice with the JFK microphone fixture, and local API authorization. No renderer errors.
- Core/shell, renderer and server typechecks pass; production UI builds; changed code lint passes.

`compatibility.mjs` records its adjustments and restores original fixtures. Adjustments retain every
behavior assertion: AIKING product/agent terminology, Connections navigation, the added Core key-reload
expectation, and the previously documented restart HTTP timeout of 10 seconds. Native controls, paid
providers and external OAuth are not inferred from fixture success.

Reports: `.aikingbot-foundation/evidence/shipping/{compatibility,stage4-core-recovery,shipping-e2e}.json`.
The latest shipping report supersedes Stage 3's six-flow report. Source pin and licensing boundary remain
unchanged; no newer PolyForm source, production services, user data or paid API calls were used.

## Next gate

Stage 5: isolated production identity/data paths, original app icons, packaging and dependency resources,
Windows build CI, Chromium/Electron tours, platform/security checks, artifacts and deployment checklist.
Provider/STT/TTS credentials and server deployment remain the operator's next-day configuration.
