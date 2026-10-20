// Copyright (c) 2026 AIKING.
// The few Cloudflare API calls the deploy scripts share: finding the zone of a host name and attaching a Worker to it.
// Nothing here prints the token.
export function cloudflare({ token, account, fetchImpl = fetch }) {
  const api = async (path, init = {}) => {
    const response = await fetchImpl(`https://api.cloudflare.com/client/v4${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!payload.success) throw new Error(`${init.method ?? "GET"} ${path}: ${JSON.stringify(payload.errors ?? payload).slice(0, 300)}`);
    return payload.result;
  };
  /** The active zone that contains `hostname` (app.example.com -> example.com), or null. */
  async function zoneFor(hostname) {
    const labels = hostname.toLowerCase().split(".");
    for (let i = 0; i <= labels.length - 2; i++) {
      const name = labels.slice(i).join(".");
      const zones = await api(`/zones?name=${encodeURIComponent(name)}`);
      const zone = zones.find((entry) => entry.name === name);
      if (zone) return zone;
    }
    return null;
  }
  /** Serves `hostname` from the Worker `service`. Cloudflare creates the DNS record and the certificate. */
  async function attachDomain(service, hostname) {
    const zone = await zoneFor(hostname);
    if (!zone) throw new Error(`No Cloudflare zone for ${hostname}. Add the domain to this Cloudflare account first, and give the token Zone Read and Workers Routes permission.`);
    if (zone.status !== "active") throw new Error(`The zone ${zone.name} is "${zone.status}", not active. Finish pointing the domain's name servers at Cloudflare first.`);
    await api(`/accounts/${account}/workers/domains`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ hostname, service, zone_id: zone.id, environment: "production" }) });
    return { hostname, zone: zone.name };
  }
  return { api, zoneFor, attachDomain, verifyToken: () => api("/user/tokens/verify") };
}
