// Copyright (c) 2026 AIKING.
// With no AI model connected the chat stays open; this bar says what is missing and opens the model setup.
import { useStore } from "@/state/store";
import { at } from "./strings";

export function NoModelBanner() {
  const { dispatch } = useStore();
  return <div role="status" data-no-model-banner className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline/40 bg-card px-4 py-2 text-[13px] text-ink">
    <span>{at("engines.bannerText")}</span>
    <button type="button" data-no-model-action onClick={() => dispatch({ type: "toggleAppSettings", open: true, section: "engines" })}
      className="shrink-0 rounded-md bg-control px-3 py-1 text-[12.5px] font-medium text-ink hover:bg-control/70">{at("engines.bannerAction")}</button>
  </div>;
}
