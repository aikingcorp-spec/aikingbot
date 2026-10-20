// Copyright (c) 2026 AIKING.
// Page templates for the AIKINGBOT website. Every visible string comes from
// i18n/<locale>.json through t(); markup stays locale-neutral.

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);

const ICONS = {
  team: '<circle cx="9" cy="8" r="3.2"/><circle cx="17" cy="9.5" r="2.4"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><path d="M15 14.3c2.6-.4 4.8 1.1 5.5 4.2"/>',
  models: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 4v16M15 4v16M4 9h16M4 15h16"/>',
  marketplace: '<path d="M4 9h16l-1.2 10.2a1 1 0 0 1-1 .8H6.2a1 1 0 0 1-1-.8z"/><path d="M8.5 9V7.5a3.5 3.5 0 0 1 7 0V9"/>',
  skills: '<path d="M14 4h6v6M20 4l-8 8"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  workspace: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  schedule: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M4 10h16M9 14h2v2"/>',
  remote: '<rect x="3" y="4" width="13" height="10" rx="1.8"/><rect x="16.5" y="9" width="4.5" height="10" rx="1.2"/><path d="M7 18h6M9.5 14v4"/>',
  voice: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  windows: '<path d="M3 5.3 10.5 4.2v7.3H3zM11.5 4 21 2.7v8.8h-9.5zM3 12.5h7.5v7.3L3 18.7zM11.5 12.5H21v8.8L11.5 20z" fill="currentColor" stroke="none"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  shield: '<path d="M12 3 5 6v5.5c0 4.3 3 7.9 7 9.5 4-1.6 7-5.2 7-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.7-4.3L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.7 4.3l1.3-1.8M20 20v-4.5h-4.5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
};
export const icon = (name, cls = "icon") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const LOGO = '<svg class="logo-mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#111318"/><path d="M32 9 52 44H12Z" fill="none" stroke="#6ee7c0" stroke-width="5" stroke-linejoin="round"/><path d="M24 34h16M32 46v8" stroke="#6ee7c0" stroke-width="4" stroke-linecap="round"/></svg>';

export function formatBytes(bytes, lang) {
  if (!Number.isFinite(bytes)) return "";
  const mb = bytes / (1024 * 1024);
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: mb >= 100 ? 0 : 1 }).format(mb)} MB`;
}
export function formatDate(iso, lang) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(lang, { dateStyle: "long", timeZone: "Asia/Ho_Chi_Minh" }).format(date);
}

/** The files the page offers, picked from a release manifest (see README). */
export function releaseFiles(release) {
  const files = release?.files ?? [];
  const pick = (platform, kind) => files.find((file) => file.platform === platform && file.kind === kind) ?? null;
  return {
    installer: pick("windows", "installer"),
    portable: pick("windows", "portable"),
    linux: files.filter((file) => file.platform === "linux"),
  };
}

function layout(ctx, { title, description, path, body, pageClass = "" }) {
  const { t, locale, config, assets } = ctx;
  const alternates = config.locales.map((l) => `<link rel="alternate" hreflang="${l.htmlLang}" href="${esc(config.origin + l.path + path)}">`).join("\n    ");
  const xDefault = config.locales.find((l) => l.default);
  const canonical = config.origin + locale.path + path;
  return `<!doctype html>
<html lang="${locale.htmlLang}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}">
    <link rel="canonical" href="${esc(canonical)}">
    ${alternates}
    <link rel="alternate" hreflang="x-default" href="${esc(config.origin + xDefault.path + path)}">
    <meta name="theme-color" content="#0d0f12">
    <meta name="color-scheme" content="dark">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="AIKINGBOT">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:url" content="${esc(canonical)}">
    <meta property="og:locale" content="${locale.ogLocale}">
    ${config.locales.filter((l) => l !== locale).map((l) => `<meta property="og:locale:alternate" content="${l.ogLocale}">`).join("\n    ")}
    <meta property="og:image" content="${esc(config.origin)}/${assets.og}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="icon" href="/${assets.favicon}" type="image/svg+xml">
    <link rel="apple-touch-icon" href="/${assets.touchIcon}">
    <link rel="preload" href="/${assets.fontVi}" as="font" type="font/woff2" crossorigin>
    <link rel="stylesheet" href="/${assets.css}">
    <script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org", "@type": "SoftwareApplication", name: "AIKINGBOT", operatingSystem: "Windows 10, Windows 11",
      applicationCategory: "BusinessApplication", url: canonical, description, inLanguage: locale.htmlLang,
      softwareVersion: ctx.release?.version, offers: { "@type": "Offer", price: "0", priceCurrency: "VND" },
      publisher: { "@type": "Organization", name: "AIKING", url: config.company },
    }).replace(/</g, "\\u003c")}</script>
    <script src="/${assets.js}" defer></script>
  </head>
  <body class="${pageClass}" data-locale="${locale.code}" data-release-manifest="${esc(config.releaseManifest)}">
    <a class="skip" href="#main">${esc(t("nav.skip"))}</a>
    ${header(ctx, path)}
    <main id="main">${body}</main>
    ${footer(ctx)}
  </body>
</html>
`;
}

function languageSwitch({ config, locale, t }, path) {
  const links = config.locales.map((l) => `<a href="${l.path}${path}" hreflang="${l.htmlLang}" lang="${l.htmlLang}"${l === locale ? ' aria-current="true"' : ""} data-lang="${l.code}" title="${esc(l.label)}">${l.short}</a>`).join("");
  return `<nav class="lang" aria-label="${esc(t("nav.language"))}">${links}</nav>`;
}

function header(ctx, path) {
  const { t, locale, config } = ctx;
  const home = locale.path;
  const links = [["#features", "nav.features"], ["#how", "nav.how"], ["#download", "nav.download"], ["#faq", "nav.faq"]]
    .map(([hash, key]) => `<a href="${home}${hash}">${esc(t(key))}</a>`).join("");
  return `<header class="site-header">
      <div class="container header-row">
        <a class="brand" href="${home}" aria-label="AIKINGBOT">${LOGO}<span>AIKINGBOT</span></a>
        <details class="nav-menu">
          <summary aria-label="${esc(t("nav.menu"))}">${icon("menu")}</summary>
          <nav class="nav-links" aria-label="${esc(t("nav.menu"))}">${links}<a href="${home}docs/">${esc(t("nav.docs"))}</a></nav>
        </details>
        <div class="header-actions">
          ${languageSwitch(ctx, path)}
          <a class="btn btn-ghost btn-sm hide-sm" href="${esc(config.appUrl)}" rel="noopener">${esc(t("nav.openApp"))}</a>
          <a class="btn btn-primary btn-sm" href="${home}#download">${icon("download")}<span>${esc(t("nav.download"))}</span></a>
        </div>
      </div>
    </header>`;
}

function footer(ctx) {
  const { t, locale, config, release } = ctx;
  const home = locale.path;
  return `<footer class="site-footer">
      <div class="container footer-grid">
        <div class="footer-brand">
          <a class="brand" href="${home}">${LOGO}<span>AIKINGBOT</span></a>
          <p>${esc(t("footer.tagline"))}</p>
          <p class="muted small">${esc(t("footer.version"))} <span data-r="version">${esc(release?.version ?? "—")}</span></p>
        </div>
        <div>
          <h2>${esc(t("footer.product"))}</h2>
          <a href="${home}#features">${esc(t("nav.features"))}</a>
          <a href="${home}#download">${esc(t("nav.download"))}</a>
          <a href="${esc(config.appUrl)}" rel="noopener">${esc(t("nav.openApp"))}</a>
          <a href="/downloads/">${esc(t("footer.checksums"))}</a>
        </div>
        <div>
          <h2>${esc(t("footer.resources"))}</h2>
          <a href="${home}docs/">${esc(t("footer.docs"))}</a>
          <a href="${home}#faq">${esc(t("nav.faq"))}</a>
          ${config.github ? `<a href="${esc(config.github)}" rel="noopener">${esc(t("footer.github"))}</a>` : ""}
          <a href="${esc(config.appUrl)}${esc(config.statusPath ?? "/api/health")}" rel="noopener">${esc(t("footer.status"))}</a>
        </div>
        <div>
          <h2>${esc(t("footer.company"))}</h2>
          <p class="muted small">${esc(t("footer.about"))}</p>
          <a href="${esc(config.company)}" rel="noopener">${esc(t("footer.website"))}</a>
          <a href="mailto:${esc(config.contactEmail)}">${esc(t("footer.contact"))}</a>
        </div>
      </div>
      <div class="container footer-base">
        <span>${esc(t("footer.rights"))}</span>
        <span>${esc(t("footer.attribution"))}</span>
      </div>
    </footer>`;
}

function screenshot(ctx, key, eager = false) {
  const shot = ctx.assets.screens[key];
  const alt = ctx.t(`preview.alt.${key}`);
  if (!shot) return `<div class="shot-missing">${esc(alt)}</div>`;
  return `<img src="/${shot.file}" width="${shot.width}" height="${shot.height}" alt="${esc(alt)}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async">`;
}

function windowFrame(content) {
  return `<div class="window"><div class="window-bar" aria-hidden="true"><span></span><span></span><span></span></div>${content}</div>`;
}

function downloadPanel(ctx) {
  const { t, locale, release } = ctx;
  const lang = locale.htmlLang;
  const { installer, portable, linux } = releaseFiles(release);
  const pending = !installer;
  const file = (f, field) => esc(f?.[field] ?? "");
  const linuxLinks = linux.map((f) => `<a href="${esc(f.url)}">${esc(f.name)}</a> <span class="muted">${formatBytes(f.size, lang)}</span>`).join("<br>");
  return `<div class="download-card${pending ? " is-pending" : ""}" data-download>
      <div class="download-head">
        <span class="os-badge">${icon("windows")}</span>
        <div>
          <h3>AIKINGBOT ${esc(t("release.beta"))}</h3>
          <p class="muted">${esc(t("download.windows"))}</p>
        </div>
      </div>
      <p class="pending-note">${esc(t("download.pending"))}</p>
      <dl class="release-meta">
        <div><dt>${esc(t("download.version"))}</dt><dd data-r="version">${esc(release?.version ?? "—")}</dd></div>
        <div><dt>${esc(t("download.size"))}</dt><dd data-r="installer.size">${installer ? formatBytes(installer.size, lang) : "—"}</dd></div>
        <div><dt>${esc(t("download.released"))}</dt><dd data-r="releasedAt">${release?.releasedAt ? esc(formatDate(release.releasedAt, lang)) : "—"}</dd></div>
      </dl>
      <div class="download-actions">
        <a class="btn btn-primary btn-lg" data-r="installer.url" href="${file(installer, "url") || "#download"}" download>
          ${icon("download")}<span><strong>${esc(t("download.installer"))}</strong><small>${esc(t("download.installerHint"))}</small></span>
        </a>
        <a class="btn btn-ghost btn-lg${portable ? "" : " is-hidden"}" data-r="portable.url" href="${file(portable, "url") || "#download"}" download>
          <span><strong>${esc(t("download.portable"))}</strong><small>${esc(t("download.portableHint"))} · <span data-r="portable.size">${portable ? formatBytes(portable.size, lang) : ""}</span></small></span>
        </a>
      </div>
      <div class="checksum">
        <span class="checksum-label">${esc(t("download.checksum"))} <code data-r="installer.name">${file(installer, "name")}</code></span>
        <div class="checksum-row">
          <code class="hash" data-r="installer.sha256">${file(installer, "sha256") || "—"}</code>
          <button class="btn btn-ghost btn-sm" type="button" data-copy="[data-r='installer.sha256']" data-copied="${esc(t("download.copied"))}">${icon("copy")}<span>${esc(t("download.copy"))}</span></button>
        </div>
      </div>
      <p class="small linux-row${linux.length ? "" : " is-hidden"}" data-r="linux"><strong>${esc(t("download.linux"))}:</strong> ${linuxLinks}</p>
      <p class="small"><a href="/downloads/">${esc(t("download.allFiles"))} →</a></p>
    </div>`;
}

export function homePage(ctx) {
  const { t, locale, config } = ctx;
  const featureKeys = ["team", "models", "marketplace", "skills", "workspace", "schedule", "remote", "voice"];
  const setupNeeded = new Set(["voice"]);
  const steps = ["download", "connect", "team", "work"];
  const tabs = ["chat", "marketplace", "settings"];
  const body = `
    <section class="hero">
      <div class="container hero-grid">
        <div class="hero-copy">
          <span class="badge">${esc(t("hero.badge"))}${ctx.release?.version ? ` · <span data-r="version">${esc(ctx.release.version)}</span>` : ""}</span>
          <h1>${esc(t("hero.title"))}</h1>
          <p class="lead">${esc(t("hero.lead"))}</p>
          <div class="cta-row">
            <a class="btn btn-primary btn-lg" href="#download">${icon("windows")}<span>${esc(t("hero.primary"))}</span></a>
            <a class="btn btn-ghost btn-lg" href="${esc(config.appUrl)}" rel="noopener">${esc(t("hero.secondary"))}${icon("external")}</a>
          </div>
          <p class="muted small">${esc(t("hero.note"))}</p>
        </div>
        <div class="hero-shot">${windowFrame(screenshot(ctx, "chat", true))}</div>
      </div>
    </section>

    <section class="section" id="preview" aria-labelledby="preview-title">
      <div class="container">
        <header class="section-head">
          <span class="eyebrow">${esc(t("preview.eyebrow"))}</span>
          <h2 id="preview-title">${esc(t("preview.title"))}</h2>
          <p class="lead">${esc(t("preview.lead"))}</p>
        </header>
        <div class="tabs" data-tabs>
          <div class="tab-list" role="tablist">
            ${tabs.map((key, i) => `<button type="button" role="tab" id="tab-${key}" aria-controls="panel-${key}" aria-selected="${i === 0}"${i ? ' tabindex="-1"' : ""}>${esc(t(`preview.tabs.${key}`))}</button>`).join("")}
          </div>
          ${tabs.map((key, i) => `<div class="tab-panel" role="tabpanel" id="panel-${key}" aria-labelledby="tab-${key}"${i ? " hidden" : ""}>${windowFrame(screenshot(ctx, key))}</div>`).join("")}
        </div>
      </div>
    </section>

    <section class="section" id="features" aria-labelledby="features-title">
      <div class="container">
        <header class="section-head">
          <span class="eyebrow">${esc(t("features.eyebrow"))}</span>
          <h2 id="features-title">${esc(t("features.title"))}</h2>
          <p class="lead">${esc(t("features.lead"))}</p>
        </header>
        <div class="feature-grid">
          ${featureKeys.map((key) => `<article class="feature">
            <div class="feature-icon">${icon(key)}</div>
            <h3>${esc(t(`features.items.${key}.title`))}${setupNeeded.has(key) ? ` <span class="tag">${esc(t("features.needsSetup"))}</span>` : ""}</h3>
            <p>${esc(t(`features.items.${key}.body`))}</p>
          </article>`).join("")}
        </div>
      </div>
    </section>

    <section class="section section-alt" id="how" aria-labelledby="how-title">
      <div class="container">
        <header class="section-head">
          <span class="eyebrow">${esc(t("how.eyebrow"))}</span>
          <h2 id="how-title">${esc(t("how.title"))}</h2>
        </header>
        <ol class="steps">
          ${steps.map((key, i) => `<li class="step"><span class="step-no">${i + 1}</span><h3>${esc(t(`how.steps.${key}.title`))}</h3><p>${esc(t(`how.steps.${key}.body`))}</p></li>`).join("")}
        </ol>
      </div>
    </section>

    <section class="section" id="download" aria-labelledby="download-title">
      <div class="container">
        <header class="section-head">
          <span class="eyebrow">${esc(t("download.eyebrow"))}</span>
          <h2 id="download-title">${esc(t("download.title"))}</h2>
          <p class="lead">${esc(t("download.lead"))}</p>
        </header>
        <div class="download-grid">
          ${downloadPanel(ctx)}
          <div class="download-help">
            <div class="help-block">
              <h3>${icon("shield")}${esc(t("download.installTitle"))}</h3>
              <ol>${t("download.installSteps").map((step) => `<li>${esc(step)}</li>`).join("")}</ol>
            </div>
            <div class="help-block">
              <h3>${icon("refresh")}${esc(t("download.updateTitle"))}</h3>
              <p>${esc(t("download.updateBody"))}</p>
            </div>
            <div class="help-block">
              <h3>${icon("copy")}${esc(t("download.verifyTitle"))}</h3>
              <p>${esc(t("download.verifyBody"))}</p>
              <pre><code>Get-FileHash .\\<span data-r="installer.name">${esc(releaseFiles(ctx.release).installer?.name ?? "AIKINGBOT-setup.exe")}</span> -Algorithm SHA256</code></pre>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="section section-alt" id="faq" aria-labelledby="faq-title">
      <div class="container narrow">
        <header class="section-head">
          <span class="eyebrow">${esc(t("faq.eyebrow"))}</span>
          <h2 id="faq-title">${esc(t("faq.title"))}</h2>
        </header>
        <div class="faq">
          ${t("faq.items").map((item) => `<details><summary>${esc(item.q)}${icon("chevron")}</summary><p>${esc(item.a)}</p></details>`).join("")}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="cta-band">
          <div>
            <h2>${esc(t("cta.title"))}</h2>
            <p>${esc(t("cta.body"))}</p>
          </div>
          <div class="cta-row">
            <a class="btn btn-primary btn-lg" href="#download">${icon("download")}<span>${esc(t("cta.primary"))}</span></a>
            <a class="btn btn-ghost btn-lg" href="${locale.path}docs/">${esc(t("cta.secondary"))}</a>
          </div>
        </div>
      </div>
    </section>`;
  return layout(ctx, { title: t("meta.title"), description: t("meta.description"), path: "", body, pageClass: "page-home" });
}

export function docsPage(ctx) {
  const { t, config } = ctx;
  const fill = (text) => esc(text).replaceAll("&lt;app&gt;", esc(config.appUrl));
  const sections = t("docs.sections");
  const body = `
    <section class="section docs">
      <div class="container docs-grid">
        <aside class="docs-toc">
          <h2>${esc(t("docs.toc"))}</h2>
          ${sections.map((s) => `<a href="#${s.id}">${esc(s.title)}</a>`).join("")}
        </aside>
        <article class="docs-body">
          <span class="eyebrow">${esc(t("docs.eyebrow"))}</span>
          <h1>${esc(t("docs.title"))}</h1>
          <p class="lead">${esc(t("docs.lead"))}</p>
          ${sections.map((s) => `<section id="${s.id}"><h2>${esc(s.title)}</h2>${s.paras.map((p) => `<p>${fill(p)}</p>`).join("")}</section>`).join("")}
        </article>
      </div>
    </section>`;
  return layout(ctx, { title: t("meta.docsTitle"), description: t("meta.docsDescription"), path: "docs/", body, pageClass: "page-docs" });
}

export function notFoundPage(ctx) {
  const { t, locale } = ctx;
  const body = `<section class="section notfound"><div class="container narrow"><h1>${esc(t("notFound.title"))}</h1><p class="lead">${esc(t("notFound.body"))}</p><a class="btn btn-primary" href="${locale.path}">${esc(t("notFound.home"))}</a></div></section>`;
  return layout(ctx, { title: t("meta.notFoundTitle"), description: t("meta.description"), path: "404.html", body, pageClass: "page-404" });
}
