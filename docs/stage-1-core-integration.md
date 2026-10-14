# AIKING Core v0.2 integration plan

Status: **planned, not implemented in Stage 1**. The setup in `apps/desktop-foundation/` exports the pinned source from `vendor/openmausbot`, excludes `enterprise/`, and runs the complete OSS harness in `.aikingbot-foundation/source/server/`. Existing AIKING Core, gateway and Solid shell remain separate. Neither runtime replaces the other in this stage.

## Existing AIKING boundary

`src/gateway/agent-backend.ts` defines `AgentBackend`: list agents and threads, ensure a thread, read history, discover skills/capabilities, run with hooks, and close. `CoreBackend` implements it with one Core per agent profile, `ChatSession` and SQLite history/run records.

`src/gateway/server.ts` exposes discovery/history endpoints and `POST /api/agents/:id/run`. The POST accepts AG-UI `RunAgentInput` and streams events over SSE. `src/gateway/ag-ui-adapter.ts` maps text, tool calls/results, usage and fallback events. Approval ends a stream with `RUN_FINISHED.outcome` interrupt; a new run on the same thread supplies `resume`. Pending approval state lives in memory. A process restart invalidates that interrupt; the client must show the existing error and require a new request.

`apps/shell/src/agui-client.ts` is the existing Solid client. AG-UI is independent of React or Solid. Keeping this protocol allows a later React client to use the same Core without rewriting either UI in the other's framework. The earlier Solid choice in `docs/v0.2-architecture.md` describes that shell; Stage 1's React choice applies to the newly selected full desktop foundation.

## Proposed adapter

Keep the renderer's existing Maus HTTP/WebSocket API and Node harness. Add an AIKING Core provider in a later stage behind `server/contracts.ts`'s `ProviderDriver`, `ProviderInstance` and `ProviderAdapter`. Register it through the existing driver registry. The provider adapter connects to the independent Core gateway over HTTP/SSE and translates AG-UI events into the harness's runtime events. Native Electron window, dialog and update operations remain in the desktop bridge.

The adapter must explicitly map:

- Bot/profile, thread, turn and run IDs. Store the mapping; do not infer equality from display names.
- `sendTurn` to an AG-UI run, text deltas to message updates, and tool calls/results to stable tool IDs. Emit completion/error once.
- Maus `respondToRequest` to the matching AG-UI interrupt and a fresh resumed run. Preserve allow/deny semantics, timeouts and unavailable-request handling.
- Driver capabilities and models to actual Core support. Core v0.2's current gateway accepts user text; do not advertise images, steering, strict resume, computer tools or connector mounting without explicit implementation and verification.
- Cancellation and disposal. Maus requires `interruptTurn` and `stopAll`; the current Core HTTP gateway has no cancellation route. Define Core cancellation semantics before exposing this provider as fully functional.
- Skills, MCP tools and connector grants. One runtime must own authorization for each tool path. Do not grant all catalog tools to Core or execute a tool twice through both engines.

The harness remains responsible for its bot/group/routine UI and application state. Core remains responsible for its execution policy, capability planner, model routing, tool approvals and runtime transcript. Group dispatch and scheduled tasks may call the future provider through normal harness operations; this does not mean Core v0.2 already implements all group or background-job behavior.

## Data ownership

Use separate application data directories and databases for Maus and Core. Do not point the harness at the Core SQLite file or write Maus message objects into Core's transcript schema. Core stores its canonical runtime messages and run records; the application stores UI state and a normalized display projection. ID mapping and event deduplication must make that projection traceable.

AG-UI history from `/api/threads/:id/messages` is a UI projection produced by `toAgUiMessages`. It is not a round-trip replacement for the Core transcript. The current gateway reads the last user text from a request and resumes server-owned history. It does not import a client's entire conversation into the runtime. Any historical migration requires a separate, versioned importer and explicit handling of tool results, attachments and interrupted runs.

## Later acceptance checks

Before claiming integration, verify streamed text and tool results, user denial and approval/resume, expired/restarted approval, cancellation, reconnect without duplicate execution, thread ownership, usage/cost display, and persistence isolation. Verify a Core-backed bot through the real React desktop client. Run the existing Solid client against the same gateway contract to check compatibility. These checks and the adapter implementation are outside Stage 1.
