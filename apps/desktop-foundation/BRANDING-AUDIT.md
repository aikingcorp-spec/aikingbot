# AIKINGBOT branding overrides

Source: OpenMausBot OSS commit `93b3c24cdade51e362e443d2387a9f37eb7e115c`, under Apache 2.0. Each override replaces the same relative source path during foundation bootstrap. The imported source retains its original LICENSE, NOTICE and third-party notices. No current nightly OpenBot code is used here.

The built-in brand is AIKINGBOT. The welcome mark, favicon and default bot avatar use an original geometric SVG made for this foundation: a triangular mark and central stem on a dark or per-bot color surface. The original Maus mascot is not rendered by the avatar component. The avatar API keeps its upstream names and props to avoid changing consumers; uploaded images retain the original crop, zoom, focus, error fallback and readable color behavior. The imperative `blink`, `spin` and `setExpression` methods remain available. Geometric marks do not draw a face, gaze or alternate mascot body.

The optional runtime `brand.json` white-label entitlement check in `server/brand.ts` is preserved. The Apache default-brand source is changed directly; the enterprise branding feature is not activated or bypassed. The restricted `enterprise/` implementation must stay outside the imported foundation.

App/help/feedback links point to the AIKING repository. The License link points to the exact upstream Apache license, and About credits Milind Soni and OpenMausBot contributors. Mobile download constants point to the AIKING documentation because this phase does not provide branded native mobile packages. These constants preserve the source API without advertising the upstream Maus applications as AIKING downloads.

Overrides:

- `src/lib/brand.ts`, `server/brand.ts`: built-in name, SVG mark, favicon and support URL.
- `src/lib/app-links.ts`: app name, repository/help/feedback links and pinned upstream license link.
- `src/lib/analytics.ts`: no configured telemetry token; analytics and email-identification calls remain disabled even if a local analytics setting is enabled.
- `src/main.tsx`: records the upstream email gate as skipped before the app renders.
- `src/components/Avatar.tsx`: geometric default mark; original uploaded-image rendering preserved.
- `src/components/AboutDialog.tsx`: source credit.
- `src/components/NoEngines.tsx`: host setup product name.
- `src/components/onboarding/PhonePreview.tsx`: preview product name.
- `src/components/onboarding/reel/scenes/{Terminal,Channels,Hands}.tsx`: branded preview labels.
- `index.html`, `public/app-icon.svg`, `public/manifest.webmanifest`: page and install metadata.

Static checks confirmed that the server entitlement guard and the avatar crop/zoom/focus implementation are unchanged. Typechecking and browser verification are performed against the assembled foundation by the main implementation task. Original image files may remain in the immutable upstream archive for provenance; the active manifest and page icon refer to the AIKING SVG.

The upstream PostHog project is not configured in AIKINGBOT. Its original public ingestion token is removed, and `analyticsEnabled()` returns false before reading local choices when no token is configured. Event tracking and email identification therefore cannot initialize the upstream analytics client. The exported analytics/settings API and local email-gate storage remain compatible. AIKINGBOT marks that marketing gate skipped during startup because no AIKING marketing collection destination exists. Provider authentication, server pairing and workspace access checks are unchanged. Workspace setup, guided tour and onboarding replay implementations remain available; the upstream legacy gate ordinarily suppresses the first automatic welcome flow when marked skipped.

Targeted inspection found no direct `CursorAvatar` rendering in primary surfaces outside `Avatar.tsx`. Avatar-body thumbnails in `BotProfileAvatarCard.tsx` render through `MausAvatar`, so they use the same AIKING geometric mark. Its old facial-expression and body identifiers remain source compatibility fields; the mark does not display upstream character silhouettes.
