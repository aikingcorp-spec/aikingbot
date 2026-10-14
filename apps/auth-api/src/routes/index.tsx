import { createFileRoute } from "@tanstack/solid-router";
import { LandingPage } from "../components/landing/LandingPage";
import { aikingBotHomeHead } from "../lib/site-metadata";
import { AIKINGBOT_SOFTWARE_APPLICATION } from "../lib/software-application";

export const Route = createFileRoute("/")({
  head: () => aikingBotHomeHead(AIKINGBOT_SOFTWARE_APPLICATION),
  component: LandingPage,
});
