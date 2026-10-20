/** Owner-confirmed catalog updates compare the reviewed hash before publishing a new immutable revision. */
export function updateCatalogSkill(botId: string, name: string, text: string, source: string, baseSha256: string): SkillListing | { error: string } {
  const prepared = preparedSkillFiles([{ path: "SKILL.md", content: text }]);
  if ("error" in prepared) return prepared;
  if (prepared.parsed.name !== name || !/^aiking-marketplace:[a-z0-9-]+@\d+\.\d+\.\d+$/.test(source)) return { error: "Invalid catalog skill update." };
  const manifest = readManifest(botId); const old = manifest[name];
  if (!old || old.source.split("@")[0] !== source.split("@")[0] || old.sha256 !== baseSha256 || readSkillFile(botId, name) === null) return { error: "This skill changed or belongs to another source. Review a fresh update." };
  const sha256 = createHash("sha256").update(text).digest("hex");
  const storageRevision = publishReviewedRevision(botId, randomUUID(), text, sha256);
  manifest[name] = { ...old, description: prepared.parsed.description, source, sha256,
    importedAt: new Date().toISOString(), license: prepared.parsed.license, compatibility: prepared.parsed.compatibility,
    warnings: prepared.warnings, skippedFiles: prepared.skippedFiles, storageRevision };
  writeManifest(botId, manifest); syncSkillLinks(botId);
  return skillListing(botId, name, manifest[name]!);
}

