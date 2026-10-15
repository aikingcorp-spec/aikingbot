# V2 / 0.3.0-rc.2 beta — feedback for the next update

The user explicitly chose to ship the current V2 beta first, then collect feedback for a larger update. This does not qualify the missing capabilities below as delivered.

## Workspace logout and identity

Reported: no obvious sign-out button in the web app. The backend has `POST /api/auth/logout`, but the shared-workspace profile menu does not expose it. Add an always-discoverable account identity/role and sign-out action; clear the host cookie/stored connection, revoke the server session, close authenticated streams and verify reload cannot regain access. Verify account switching revokes the previous browser session. Local desktop mode must remain usable without an account.

## Personal workspaces and execution isolation

Reported: signing in appears to enter the same staging admin workspace. Current deployment is one shared operator workspace with two explicitly configured owner emails. A fresh email outside its allow-list returned 403 before an OTP was sent. This negative check does not establish personal tenant isolation.

Personal per-account workspaces and execution sandboxes are not implemented in this candidate. Do not advertise this shared workspace as public personal hosting. The next update needs an authenticated account-to-workspace boundary, isolated persistent files/provider credentials/runtime processes and computer/tool scopes, plus negative tests preventing account A from reading or acting on B. Filtering lists in the browser is insufficient. Operator/team workspaces should remain an explicit separate choice.

## Connector error while a model still answers

User reported an AIKING-related connector error, while ordinary model answers still worked. Exact provider, connector name, error and trace remain unrecorded. Capture the actual error with credential redaction and distinguish optional connector failure from provider/model failure. Do not hide failures or silently replace a selected provider.

## Acceptance still pending

Physical Windows installation without global Node/npm; real OAuth and first task for each requested provider; natural speech and native realtime as separate modes; rc.1 manual upgrade and a later HTTPS-feed upgrade with data preservation. Current fixture/CI evidence does not replace these tests.
