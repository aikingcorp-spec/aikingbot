/// <reference types="vite/client" />

import type { AIKINGBOTDesktopApi } from "@aikingbot/contracts/ipc";

declare global {
  interface HighlightRegistry {
    set(name: string, highlight: Highlight): this;
    delete(name: string): boolean;
  }

  interface Window {
    aikingbot: AIKINGBOTDesktopApi;
  }
}
