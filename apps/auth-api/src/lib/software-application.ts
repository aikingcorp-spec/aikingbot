// The app's structured data, with the two facts that `site-metadata.ts` can not
// import: the version, from the repository's `package.json`, and a picture of the app.
// A named import, so the bundle holds the version and not the whole file. The
// release script changes it and `CHANGELOG.md` in one step.

import { version } from "../../../../package.json";
import channelScreenshot from "../content/guides/media/aikingbot-101/a-channel.webp";
import { AIKINGBOT_SITE_URL, aikingBotSoftwareApplication } from "./site-metadata";

export const AIKINGBOT_SOFTWARE_APPLICATION = aikingBotSoftwareApplication({
  version,
  screenshot: new URL(channelScreenshot, AIKINGBOT_SITE_URL).toString(),
});
