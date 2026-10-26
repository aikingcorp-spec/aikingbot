// Registry view over the skills library: metadata (integrity / TTL / trust / prerequisites) is derived from the index alone;
// the SKILL.md body is read only on request, through readLibrarySkillFile (sha-verified). Nothing here executes or downloads a skill.
import { readLibrarySkillFile, readSkillLibraryIndex, skillsLibraryRoot, type SkillLibraryEntry } from "./skill-library.ts";

export const DEFAULT_TTL_DAYS = 90;

export type RegistryTrust = "reviewed" | "disabled";
export interface RegistryMetadata {
  name: string;
  description: string;
  source: string;
  sha256: string;
  importedAt: string;
  version: string | null;
  license: string | null;
  trust: RegistryTrust;
  /** Advisory only: a stale skill is still served, the caller decides. */
  ttl: { days: number; ageDays: number | null; stale: boolean };
  /** Declared text, never evaluated here; null when the skill states none. */
  prerequisites: string | null;
  warnings: string[];
}
export interface RegistryLookup {
  metadata: RegistryMetadata;
  /** null = the body failed sha verification (or is gone); metadata still returned so the caller can see why. */
  integrity: "verified" | "failed" | "not-checked";
  body: string | null;
}

export function describeEntry(entry: SkillLibraryEntry, now: Date, ttlDays = DEFAULT_TTL_DAYS): RegistryMetadata {
  const imported = Date.parse(entry.importedAt);
  const future = Number.isFinite(imported) && imported > now.getTime();
  const ageDays = Number.isFinite(imported) && !future ? Math.max(0, Math.floor((now.getTime() - imported) / 86_400_000)) : null;
  const warnings = [...entry.warnings];
  if (future) warnings.push("importedAt is in the future; skill is quarantined until revalidated");
  const license = entry.license?.trim() || null;
  const invalidLicense = !license || /^(unknown|forbidden)$/i.test(license);
  if (!license) warnings.push("license is not declared");
  if (license && /^(unknown|forbidden)$/i.test(license)) warnings.push("license is forbidden or unknown");
  return {
    name: entry.name, description: entry.description, source: entry.source, sha256: entry.sha256, importedAt: entry.importedAt,
    version: entry.package?.release ?? null,
    license,
    trust: entry.reviewState === "approved" && !future && !invalidLicense ? "reviewed" : "disabled",
    ttl: { days: ttlDays, ageDays, stale: ageDays === null || ageDays > ttlDays },
    prerequisites: entry.compatibility ?? null,
    warnings,
  };
}

/** Index only: no SKILL.md file is opened. */
export function listRegistry(opts: { root?: string; now?: Date; ttlDays?: number } = {}): RegistryMetadata[] {
  const index = readSkillLibraryIndex(opts.root ?? skillsLibraryRoot());
  return Object.values(index).map((e) => describeEntry(e, opts.now ?? new Date(), opts.ttlDays)).sort((a, b) => a.name.localeCompare(b.name));
}

/** Lazy: the body is read here and only here, and only for an enabled skill. A disabled skill returns metadata with no body. */
export function lookupRegistry(name: string, opts: { root?: string; now?: Date; ttlDays?: number } = {}): RegistryLookup | null {
  const root = opts.root ?? skillsLibraryRoot();
  const entry = readSkillLibraryIndex(root)[name];
  if (!entry) return null;
  const metadata = describeEntry(entry, opts.now ?? new Date(), opts.ttlDays);
  const imported = Date.parse(metadata.importedAt);
  const future = Number.isFinite(imported) && imported > (opts.now ?? new Date()).getTime();
  if (metadata.trust !== "reviewed" || future || metadata.ttl.stale || !metadata.license || /^(unknown|forbidden)$/i.test(metadata.license)) return { metadata, integrity: "not-checked", body: null };
  const body = readLibrarySkillFile(name, root);
  return { metadata, integrity: body === null ? "failed" : "verified", body };
}
