// Copyright (c) 2026 AIKING.
import { api } from "@/state/store";
import type { InstallRecord, InstallRecordStore } from "./contract";
import { setInstallRecords } from "./installer";
import { HttpCatalogSource, setCatalogSource } from "./sources";

class ServerInstallRecords implements InstallRecordStore {
  private records: InstallRecord[];
  private pending = Promise.resolve();
  constructor(records: InstallRecord[]) { this.records = records; }
  all() { return this.records; }
  private mutate(body: object) {
    this.pending = this.pending.catch(() => {}).then(async () => {
      const result = await api<{ records: InstallRecord[] }>("/api/aiking/marketplace/records", { method: "POST", body: JSON.stringify(body) });
      this.records = result.records;
    });
  }
  add(record: InstallRecord) { this.mutate({ action: "add", record }); }
  remove(listingId: string, target?: string) { this.mutate({ action: "remove", listingId, target }); }
  flush() { return this.pending; }
}

export async function initializeMarketplace() {
  try {
    const result = await api<{ records: InstallRecord[] }>("/api/aiking/marketplace/records", { timeoutMs: 5000 });
    setInstallRecords(new ServerInstallRecords(result.records));
    setCatalogSource(new HttpCatalogSource(new URL("/api/aiking/", location.href).href));
  } catch { /* A paired non-owner or an older server uses the bundled catalog. */ }
}
