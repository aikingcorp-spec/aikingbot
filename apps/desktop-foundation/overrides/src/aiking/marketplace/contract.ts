// Copyright (c) 2026 AIKING. Marketplace contract shared by the local catalog
// (stage 2) and AIKING Core or a marketplace server (stage 3).
//
// Wire rules:
//   - Every listing has a stable `id` and an immutable `version`. A new version
//     is a new document; installs record the version they took.
//   - An agent pins the skills it ships with by `{ id, version }`.
//   - Catalog documents are untrusted input: decode them with these schemas at
//     the boundary (local JSON or HTTP), never trust the shape.
import { z } from "zod";
import { MASCOT_BODY_IDS } from "../../../shared/mascot-bodies";

export const CATALOG_SCHEMA_VERSION = 1;

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/);
const version = z.string().regex(/^\d+\.\d+\.\d+$/);

export const publisherSchema = z.object({ id, name: z.string().min(1).max(80), verified: z.boolean() });

const listingBase = {
  id,
  version,
  name: z.string().min(1).max(80),
  summary: z.string().min(1).max(200),
  category: z.string().min(1).max(40),
  tags: z.array(z.string().max(32)).max(12),
  publisher: publisherSchema,
  featured: z.boolean().optional(),
  installs: z.number().int().nonnegative().optional(),
  updatedAt: z.string().optional(),
};

export const skillListingSchema = z.object({
  ...listingBase,
  kind: z.literal("skill"),
  /** The skill's `name` front-matter value; must match the SKILL.md text. */
  skillName: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  /** Complete SKILL.md, installed as is through POST /api/bots/:id/skill-template. */
  text: z.string().min(20).max(60_000),
  license: z.string().max(40).optional(),
});

const mascotColor = z.enum(["green", "blue", "red", "orange", "purple", "cyan", "pink", "yellow", "teal", "coral"]);

export const agentListingSchema = z.object({
  ...listingBase,
  kind: z.literal("agent"),
  look: z.object({ color: mascotColor, body: z.enum(MASCOT_BODY_IDS), expression: z.string().max(24).optional() }),
  profile: z.object({
    name: z.string().min(1).max(60),
    title: z.string().max(60),
    description: z.string().max(400),
    instructions: z.string().max(8_000),
  }),
  skills: z.array(z.object({ id, version })).max(20),
  /** Connector or MCP listings this agent works best with; offered, never installed silently. */
  apps: z.array(id).max(12),
  memory: z.record(z.string().regex(/^[\w./-]{1,80}\.md$/), z.string().max(20_000)).optional(),
  routines: z.array(z.object({
    name: z.string().min(1).max(80),
    prompt: z.string().min(1).max(4_000),
    /** Local time and weekdays (Sunday = 0), the upstream "daily" schedule. */
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    enabled: z.boolean(),
  })).max(6).optional(),
});

const mcpServerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stdio"), name: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/), command: z.string().min(1), args: z.array(z.string()).max(32) }),
  z.object({ type: z.literal("http"), name: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/), url: z.string().url() }),
]);

export const appListingSchema = z.object({
  ...listingBase,
  kind: z.literal("app"),
  /** Bundled logo slug (src/aiking/app-logos.ts); falls back to a letter tile. */
  logo: z.string().max(40).optional(),
  connector: z.discriminatedUnion("type", [
    z.object({ type: z.literal("composio"), slug: z.string().regex(/^[a-z0-9_]{2,40}$/) }),
    z.object({ type: z.literal("mcp"), server: mcpServerSchema }),
  ]),
});

export const listingSchema = z.discriminatedUnion("kind", [agentListingSchema, skillListingSchema, appListingSchema]);

export const catalogDocumentSchema = z.object({
  schemaVersion: z.literal(CATALOG_SCHEMA_VERSION),
  catalogVersion: z.string().min(1).max(32),
  source: z.string().min(1).max(80),
  listings: z.array(listingSchema).max(2_000),
});

export type Publisher = z.infer<typeof publisherSchema>;
export type SkillListing = z.infer<typeof skillListingSchema>;
export type AgentListing = z.infer<typeof agentListingSchema>;
export type AppListing = z.infer<typeof appListingSchema>;
export type Listing = z.infer<typeof listingSchema>;
export type ListingKind = Listing["kind"];
export type CatalogDocument = z.infer<typeof catalogDocumentSchema>;

export type CatalogQuery = { kind: ListingKind; text?: string; category?: string | null; featuredOnly?: boolean };
export type CatalogPage<T extends Listing = Listing> = { items: T[]; categories: string[]; total: number };

/** Where listings come from: the bundled catalog now, AIKING Core later. */
export interface CatalogSource {
  readonly id: string;
  list<K extends ListingKind>(query: CatalogQuery & { kind: K }): Promise<CatalogPage<Extract<Listing, { kind: K }>>>;
  get(id: string): Promise<Listing | null>;
}

/** What this computer has from a listing. Decided from live app state, never from the listing alone. */
export type InstallStatus =
  | { state: "available" }
  | { state: "installed"; version: string; targets: string[]; update?: string }
  | { state: "partial"; detail: string; targets: string[] }
  | { state: "needs-setup"; detail: string }
  | { state: "connected"; detail?: string }
  | { state: "error"; detail: string };

/** A record of an install, kept so uninstall and update know what the listing created. */
export type InstallRecord = { listingId: string; version: string; kind: ListingKind; targets: string[]; installedAt: string };

/** Install records: browser storage in stage 2, AIKING Core in stage 3. */
export interface InstallRecordStore {
  all(): InstallRecord[];
  add(record: InstallRecord): void;
  remove(listingId: string, target?: string): void;
}
