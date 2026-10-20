// Copyright (c) 2026 AIKING.
import { it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspaceBackupSnapshot, stageWorkspaceBackup, commitPendingWorkspaceRestore, applyPendingWorkspaceRestore } from "../workspace-backup.ts";

it("encrypted workspace backup restores Core transcripts and Marketplace records without pairing identity", async () => {
  const source = mkdtempSync(join(tmpdir(), "aiking-backup-")); const target = mkdtempSync(join(tmpdir(), "aiking-restore-"));
  const entries = { "aiking/marketplace-installs.json": JSON.stringify([{ listingId: "media-producer", version: "1.0.0", targets: ["bot"] }]),
    "aiking-core/instance/thread.jsonl": JSON.stringify({ role: "user", content: "Core backup fixture" }) + "\n", "aiking-core/instance/thread.mapping.json": JSON.stringify({ schema: 1, generation: "fixture" }) };
  const password = "offline backup test password";
  try {
    writeFileSync(join(source, "config.json"), "{}"); writeFileSync(join(source, "bots.json"), "[]"); writeFileSync(join(source, "groups.json"), "[]");
    writeFileSync(join(source, "sessions.json"), JSON.stringify({ fixture: "source-only-session" })); writeFileSync(join(target, "sessions.json"), JSON.stringify({ fixture: "target-owner" }));
    for (const [path, text] of Object.entries(entries)) { mkdirSync(join(source, path, ".."), { recursive: true }); writeFileSync(join(source, path), text); }
    const archive = await createWorkspaceBackupSnapshot(source, { password }); expect(readFileSync(archive.path).includes(Buffer.from("Core backup fixture"))).toBe(false);
    const staged = await stageWorkspaceBackup(target, archive.path, { password }); commitPendingWorkspaceRestore(target, staged.id); expect(applyPendingWorkspaceRestore(target).restored).toBe(true);
    for (const [path, text] of Object.entries(entries)) expect(readFileSync(join(target, path), "utf8")).toBe(text);
    expect(JSON.parse(readFileSync(join(target, "sessions.json"), "utf8")).fixture).toBe("target-owner");
  } finally { rmSync(source, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }); }
});
