import { createLazyFileRoute } from "@tanstack/solid-router";
import { createSignal, lazy, onSettled, Show } from "solid-js";
import "../../../../src/renderer/src/preview/preview.css";

const AIKINGBOTPlayground = lazy(() =>
  import("@aikingbot/renderer-preview").then((module) => ({ default: module.AIKINGBOTPlayground })),
);

export const Route = createLazyFileRoute("/app-preview")({ component: AppPreviewPage });

export function AppPreviewPage() {
  const [mounted, setMounted] = createSignal(false);
  onSettled(() => {
    setMounted(true);
  });

  return (
    <div id="root" class="aikingbot-playground-root" data-preview-variant="landing">
      <Show
        when={mounted()}
        fallback={<div class="aikingbot-playground-loading" role="status" aria-label="Loading AIKINGBOT preview" />}
      >
        <AIKINGBOTPlayground variant="landing" />
      </Show>
    </div>
  );
}
