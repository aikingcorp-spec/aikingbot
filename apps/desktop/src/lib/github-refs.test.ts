import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { githubRefLabel, parseGithubUrl, splitShortRefs } from "./github-refs";

const render = (text: string) => renderToStaticMarkup(createElement(ChatMarkdown, { text }));

describe("parseGithubUrl", () => {
  it("reads pull requests, issues and commits", () => {
    expect(parseGithubUrl("https://aikingbot.invalid/upstream")).toMatchObject({ kind: "pull", owner: "aikingcorp-spec", repo: "AIKINGBOT", number: 2547 });
    expect(parseGithubUrl("https://aikingbot.invalid/upstream#issuecomment-1")).toMatchObject({ kind: "issue", number: 12 });
    expect(parseGithubUrl("https://aikingbot.invalid/upstream")).toMatchObject({ kind: "pull", number: 2547 });
    expect(parseGithubUrl("https://github.com/octo-org/sample-app/commit/68189CF0a1")).toMatchObject({ kind: "commit", sha: "68189cf0a1" });
  });

  it("leaves everything else alone", () => {
    for (const url of [
      "https://aikingbot.invalid/upstream",
      "https://aikingbot.invalid/upstream",
      "https://aikingbot.invalid/upstream",
      "https://gist.github.com/a/b/pull/1",
      "https://github.com.evil.example/a/b/pull/1",
      "https://example.com/a/b/pull/1",
      "javascript:alert(1)",
    ]) expect(parseGithubUrl(url), url).toBeNull();
  });
});

describe("owner/repo#N in text", () => {
  it("finds a reference in running text", () => {
    const spans = splitShortRefs("fixed in aikingcorp-spec/AIKINGBOT#2547, see there.");
    expect(spans.map((span) => span.text)).toEqual(["fixed in ", "aikingcorp-spec/AIKINGBOT#2547", ", see there."]);
    expect(spans[1]!.ref).toMatchObject({ kind: "ref", url: "https://aikingbot.invalid/upstream" });
  });

  it("ignores paths, URLs and plain #N", () => {
    for (const text of ["src/lib/a#12", "https://x.example/a/b#3", "see #2547", "a/b#0", "~/a/b#5"]) {
      expect(splitShortRefs(text).some((span) => span.ref), text).toBe(false);
    }
  });

  it("labels by repository only when a message mixes them", () => {
    const ref = parseGithubUrl("https://github.com/a/app/pull/7")!;
    expect(githubRefLabel(ref, false)).toBe("#7");
    expect(githubRefLabel(ref, true)).toBe("app#7");
    const commit = parseGithubUrl("https://github.com/a/app/commit/68189cf0a1b2")!;
    expect(githubRefLabel(commit, false)).toBe("68189cf");
    expect(githubRefLabel(commit, true)).toBe("app@68189cf");
  });
});

describe("rendered references", () => {
  it("draws a bare pull request URL as a left-to-right pill with the address as its tooltip", () => {
    const html = render("- سحب النافذة https://aikingbot.invalid/upstream");
    expect(html).toContain('dir="ltr" title="https://aikingbot.invalid/upstream" data-github-ref="pull"');
    expect(html).toContain("<span>#2547</span>");
    expect(html).toContain("unicode-bidi:isolate");
  });

  it("qualifies labels when two repositories are mentioned", () => {
    const html = render("https://github.com/a/app/pull/7 and b/web#9");
    expect(html).toContain("<span>app#7</span>");
    expect(html).toContain("<span>web#9</span>");
    expect(html).toContain('href="https://github.com/b/web/issues/9"');
  });

  it("keeps a link the bot wrote words for, and code, as they are", () => {
    const html = render("[the drag fix](https://github.com/a/app/pull/7) and `a/app#8`");
    expect(html).toContain(">the drag fix</a>");
    expect(html).not.toContain("data-github-ref");
    expect(html).toContain("<code");
    expect(html).toContain("a/app#8");
  });

  it("leaves other links plain", () => {
    const html = render("see https://example.com/docs");
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).not.toContain("data-github-ref");
  });
});
