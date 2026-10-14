import { createFileRoute } from "@tanstack/solid-router";
import { JoinPage } from "../components/landing/JoinPage";

export const Route = createFileRoute("/join")({
  head: () => ({
    meta: [
      { title: "Open an AIKINGBOT invitation" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
      { name: "referrer", content: "no-referrer" },
      {
        name: "description",
        content: "Open a private host invitation in the AIKINGBOT desktop app.",
      },
    ],
  }),
  headers: () => ({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  }),
  component: JoinPage,
});
