# AIKINGBOT Zalo / Chatwoot — live integration

Status: **AIKINGBOT stack is live; full acceptance is waiting for Lisa's existing Zalo account to be reauthenticated.** Do not report both channels fully migrated until that phone step and a real Lisa outbound check succeed.

Root: /srv/aikingbot-staging/integrations/zalo-chatwoot
Service: aikingbot-zalo.service (cadu; independent HOME and AppArmor profile)
Original aiking-zalo.service is stopped/disabled; OpenBot itself is untouched.

Active path:
Zalo ↔ runtime/zca-bridge ↔ runtime/chatwoot ↔ bridge_service.py ↔ authenticated AIKINGBOT Lisa/Aimie.
No OpenBot API/client/provider or folder is used as a runtime intermediary.
Unused legacy source and daemon code are retained only under checkpoints for rollback.

Lisa: 1fc1c1f2-a58d-4e96-9962-34fb8186f5fa, inbox/account 1.
Aimie: 769f59b1-30bb-435f-8cdd-36351fa1a3fa, inbox/account 2.

Separate official client-only AIKINGBOT paired sessions, per-Agent durable SQLite queue,
fixed inbox/Agent mapping, canonical Chatwoot validation, source Zalo UID verification,
Ask-only per-delivery tasks, deterministic sendId/correlation and automatic final reply delivery.
No model fallback or Agent reply helper is required.
Untrusted customer requests never automatically approve tools; permission requests are denied.
Sensitive business decisions produce only a neutral acknowledgement and a private review note.
Ambiguous external sends are held/reconciled, never blindly replayed.
Group @mentions/quoted replies and same-source-UID 60s followup are supported.
Known bot-owned Zalo identities and native self echoes cannot start reply loops.
Messages/images/files are transferred through official attachment endpoints.
10 attachments / 10 MiB each; queue admission and processing pause below 3 GiB free.

Production ports unchanged: Chatwoot 3010, bridge 4000, Lisa 3025, Aimie 3026.
Lisa/Aimie listeners are loopback only. Existing ZCA write-control routes now require its
existing authenticated accounts.write permission. No global authentication policy changed.
Full ZCA boot and /admin assets are qualified against an isolated restored DB with all
Zalo accounts/jobs removed, so smoke testing never consumes a production Zalo session.

## Operations

- Status: python3 preflight.py
- Review records: state/lisa/queue.sqlite3 and state/aimie/queue.sqlite3 (private; customer data).
- Evidence: evidence/*.json and evidence-*.log. Real model + real Chatwoot + images/files pass.
- Real internal Aimie FAQ: incoming 2976 → task 88094190-4550-4602-9a75-6f89dc5c6c50
  → Chatwoot outgoing 2977 → real Zalo provider receipt (hashed in evidence).
  Inbound was an authorized mock message in the verified internal owner's conversation.
  This does not claim a physical handset's inbound/rendering was observed.
- Initial marker test invoked an unneeded cross-session tool, was denied, then correctly held
  business approval. Keep that failed-marker evidence; do not present it as a marker pass.
- 23 pre-existing legacy queued events (Lisa 9/Aimie 14; newest 17 Oct) were imported as review,
  never replayed. The 10 old ZCA failed jobs are retained. Do not mass-retry them.
- Lisa Zalo account 1 was already expired in the pre-migration logical snapshot.
  Owner must scan the official QR and confirm with the correct Lisa Zalo account.
  Do not mint auth rows, turn off auth, reset credentials, or log out unrelated accounts.

## Backup and rollback

Transaction-consistent custom pg_dump + roles + valid Redis SAVE snapshot, private config/source
checkpoints. Both database archives were restored successfully into temporary isolated DBs.
No running PostgreSQL data directory was copied.
Rootfs/data were relocated on the same filesystem, retaining directory inodes; no rootfs/image clone.
No new scheduled backup system, global cleanup, CI or release was introduced.

Current rollback checkpoint is recorded in checkpoints/current-cutover.txt.
Concrete command as root:
python3 rollback.py "$(cat checkpoints/current-cutover.txt)"
This stops the new integration only, restores source/config/code paths and returns current
databases/session files to their original location. It does NOT restore an old customer DB.
Two failed health-gated attempts actually exercised rollback before successful cutover.
Do not run cutover.py again on an already active runtime.

Secrets/business/evidence/state/runtime are intentionally excluded from source control.
The existing Linux UID cadu is retained for extracted runtimes; this is application-level
Agent/inbox isolation, not a separate-UID or per-Agent OS sandbox.
