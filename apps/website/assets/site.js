// AIKINGBOT website. Copyright (c) 2026 AIKING.
// Progressive enhancement only: the pages work without this file.
(() => {
  const lang = document.documentElement.lang || "vi";

  // Product preview tabs (WAI-ARIA tabs pattern).
  for (const tabs of document.querySelectorAll("[data-tabs]")) {
    const buttons = [...tabs.querySelectorAll('[role="tab"]')];
    const select = (button) => {
      for (const other of buttons) {
        const active = other === button;
        other.setAttribute("aria-selected", String(active));
        other.tabIndex = active ? 0 : -1;
        document.getElementById(other.getAttribute("aria-controls")).hidden = !active;
      }
    };
    buttons.forEach((button, index) => {
      button.addEventListener("click", () => select(button));
      button.addEventListener("keydown", (event) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
        if (!step) return;
        const next = buttons[(index + step + buttons.length) % buttons.length];
        select(next); next.focus(); event.preventDefault();
      });
    });
  }

  // Copy the SHA-256.
  for (const button of document.querySelectorAll("[data-copy]")) {
    button.addEventListener("click", async () => {
      const source = document.querySelector(button.dataset.copy);
      const label = button.querySelector("span");
      try {
        await navigator.clipboard.writeText(source.textContent.trim());
        const before = label.textContent; label.textContent = button.dataset.copied;
        setTimeout(() => { label.textContent = before; }, 1600);
      } catch { getSelection().selectAllChildren(source); }
    });
  }

  // Close the mobile menu after picking a link.
  for (const link of document.querySelectorAll(".nav-menu a")) link.addEventListener("click", () => link.closest("details")?.removeAttribute("open"));

  // Keep the language choice when switching: same page, same section.
  for (const link of document.querySelectorAll(".lang a")) link.addEventListener("click", () => { if (location.hash) link.href = link.href.split("#")[0] + location.hash; });

  // The release on the server may be newer than this build: refresh the download panel.
  const manifest = document.body.dataset.releaseManifest;
  if (!manifest || !window.fetch) return;
  const mb = (bytes) => `${new Intl.NumberFormat(lang, { maximumFractionDigits: bytes >= 104857600 ? 0 : 1 }).format(bytes / 1048576)} MB`;
  const date = (iso) => new Intl.DateTimeFormat(lang, { dateStyle: "long", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(iso));
  const set = (key, apply) => document.querySelectorAll(`[data-r="${key}"]`).forEach(apply);
  fetch(manifest, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).then((release) => {
    if (!release?.files) return;
    const pick = (platform, kind) => release.files.find((f) => f.platform === platform && f.kind === kind);
    const installer = pick("windows", "installer");
    const portable = pick("windows", "portable");
    set("version", (el) => { el.textContent = release.version; });
    if (release.releasedAt) set("releasedAt", (el) => { el.textContent = date(release.releasedAt); });
    if (installer) {
      set("installer.url", (el) => { el.href = installer.url; });
      set("installer.size", (el) => { el.textContent = mb(installer.size); });
      set("installer.sha256", (el) => { el.textContent = installer.sha256; });
      set("installer.name", (el) => { el.textContent = installer.name; });
      document.querySelectorAll("[data-download]").forEach((el) => el.classList.remove("is-pending"));
    }
    if (portable) {
      set("portable.url", (el) => { el.href = portable.url; el.classList.remove("is-hidden"); });
      set("portable.size", (el) => { el.textContent = mb(portable.size); });
    }
  }).catch(() => {});
})();
