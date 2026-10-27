// Copyright (c) 2026 AIKING. The bundled AIKING catalog (catalogVersion
// 2026.10.1). Written for AIKINGBOT; decoded through contract.ts like any
// remote catalog. Stage 3 serves the same document from AIKING Core.

import { OFFICIAL_APPS, appLocales } from "./official-apps";

const AIKING = { id: "aiking", name: "AIKING", verified: true };

function skill(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\nlicense: Proprietary (AIKING)\n---\n\n${body.trim()}\n`;
}

/** A dependency-free MCP server (stdio, newline-delimited JSON-RPC) for offline checks and small text jobs. */
const TOOLBOX_SERVER = [
  "const rl=require('readline').createInterface({input:process.stdin});",
  "const send=(m)=>process.stdout.write(JSON.stringify(m)+'\\n');",
  "const tools=[",
  "{name:'word_count',description:'Count words and characters in a text.',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']}},",
  "{name:'slugify',description:'Turn a title into a URL slug.',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']}},",
  "{name:'aspect_ratio',description:'Pixel size for a ratio such as 9:16 at a given width.',inputSchema:{type:'object',properties:{ratio:{type:'string'},width:{type:'number'}},required:['ratio','width']}}];",
  "const run=(n,a)=>{if(n==='word_count'){const t=String(a.text||'');return {words:(t.trim().match(/\\S+/g)||[]).length,characters:t.length};}",
  "if(n==='slugify')return {slug:String(a.text||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')};",
  "if(n==='aspect_ratio'){const [w,h]=String(a.ratio).split(':').map(Number);return {width:a.width,height:Math.round(a.width*h/w)};}throw new Error('Unknown tool '+n);};",
  "rl.on('line',(line)=>{let m;try{m=JSON.parse(line);}catch{return;}if(m.id===undefined)return;",
  "try{let r;if(m.method==='initialize')r={protocolVersion:(m.params&&m.params.protocolVersion)||'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'aiking-toolbox',version:'1.0.0'}};",
  "else if(m.method==='tools/list')r={tools};else if(m.method==='ping')r={};",
  "else if(m.method==='tools/call')r={content:[{type:'text',text:JSON.stringify(run(m.params.name,m.params.arguments||{}))}]};",
  "else{send({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}});return;}send({jsonrpc:'2.0',id:m.id,result:r});}",
  "catch(e){send({jsonrpc:'2.0',id:m.id,result:{isError:true,content:[{type:'text',text:String(e.message)}]}});}});",
].join("");

export const AIKING_CATALOG = {
  schemaVersion: 1,
  catalogVersion: "2026.10.1",
  source: "aiking-bundled",
  listings: [
    // ── Skills ──────────────────────────────────────────────────────────
    {
      kind: "skill", id: "tiktok-hook-writer", version: "1.0.0", skillName: "tiktok-hook-writer",
      name: "TikTok hook writer", summary: "Writes ten scroll-stopping first lines for a short video and ranks them.",
      category: "Media", tags: ["tiktok", "hooks", "short video"], publisher: AIKING, featured: true, installs: 0,
      text: skill("tiktok-hook-writer", "Write and rank opening hooks for short vertical videos (TikTok, Reels, Shorts).", `
# TikTok hook writer

Use when someone needs the first 1–3 seconds of a short video.

1. Ask for the product, the viewer, and the single promise if any is missing. Do not invent claims or prices.
2. Write 10 hooks, each under 12 words, across these patterns: problem call-out, surprising number, before/after, "stop doing X", POV, question, demo-first.
3. Rank the top 3 by clarity, curiosity and how fast the payoff can be shown on screen. Give one line of reasoning each.
4. For the winner, add the matching first shot (what the viewer sees) and on-screen text.

Return a table: hook | pattern | first shot. Mark anything that needs a claim checked.`),
    },
    {
      kind: "skill", id: "image-prompt-builder", version: "1.0.0", skillName: "image-prompt-builder",
      name: "Image prompt builder", summary: "Turns a visual idea into layered prompts for Flux, Midjourney or SDXL.",
      category: "Media", tags: ["prompt", "image", "flux"], publisher: AIKING, featured: true, installs: 0,
      text: skill("image-prompt-builder", "Build structured image-generation prompts with subject, scene, light, lens and constraints.", `
# Image prompt builder

1. Confirm the goal (ad, thumbnail, product shot, concept) and the target model.
2. Write the prompt in layers: subject → action → setting → lighting → camera/lens → style → color → composition → quality terms.
3. Add a negative prompt for common failures: extra fingers, warped text, duplicated objects, plastic skin.
4. Give the aspect ratio and, when relevant, seed and guidance values to try.
5. Offer two variants that change one layer each (for example, light or lens) so results can be compared.

Keep each prompt under 120 words. Never include a real person's likeness without stated permission.`),
    },
    {
      kind: "skill", id: "video-shot-list", version: "1.0.0", skillName: "video-shot-list",
      name: "Video shot list", summary: "Breaks a script into timed shots with camera, motion and on-screen text.",
      category: "Media", tags: ["video", "storyboard"], publisher: AIKING, installs: 0,
      text: skill("video-shot-list", "Break a short video script into a timed shot list with camera, motion and text overlays.", `
# Video shot list

1. Read the script and the target length. Default to 15 seconds and 9:16.
2. Split it into shots of 1–3 seconds. For each shot give: time range, what is on screen, camera (angle, lens, movement), on-screen text, and audio.
3. Front-load the payoff: the product or result appears by second 3.
4. End with a clear call to action shot.
5. Flag shots that need real footage versus ones an AI video model can generate.`),
    },
    {
      kind: "skill", id: "campaign-brief", version: "1.0.0", skillName: "campaign-brief",
      name: "Campaign brief", summary: "One-page brief: audience, promise, proof, channels and success metric.",
      category: "Marketing", tags: ["brief", "campaign"], publisher: AIKING, featured: true, installs: 0,
      text: skill("campaign-brief", "Write a one-page campaign brief with audience, promise, proof, channels, budget and one success metric.", `
# Campaign brief

Write one page with these headings: Goal, Audience, Single promise, Proof, Offer, Channels, Creative angles (3), Budget and timing, Success metric, Risks.

- One measurable success metric, with the number to beat.
- Proof must be real (reviews, data, demos). Write "needs proof" where none was given.
- Keep it under 400 words.`),
    },
    {
      kind: "skill", id: "ab-test-plan", version: "1.0.0", skillName: "ab-test-plan",
      name: "A/B test plan", summary: "Designs a creative test with one variable, sample size and a stop rule.",
      category: "Marketing", tags: ["experiment", "ads"], publisher: AIKING, installs: 0,
      text: skill("ab-test-plan", "Plan an A/B test for ads or landing pages with one variable, a sample size and a stop rule.", `
# A/B test plan

1. State the hypothesis as "Changing X will move metric Y because Z".
2. Change one variable only. List what stays fixed.
3. Estimate the sample needed for the expected lift at 80% power, and say the assumption used.
4. Define the stop rule and the decision for each outcome before the test starts.
5. Note seasonality or budget changes that would invalidate the result.`),
    },
    {
      kind: "skill", id: "competitor-scan", version: "1.0.0", skillName: "competitor-scan",
      name: "Competitor scan", summary: "Compares competitors' offers, angles and creative with sources.",
      category: "Research", tags: ["research", "competitors"], publisher: AIKING, installs: 0,
      text: skill("competitor-scan", "Compare competitors' offers, prices, messaging angles and creative formats, with sources.", `
# Competitor scan

For each competitor give: offer, price, main promise, proof used, creative formats seen, and one weakness to exploit.
Cite a source link for every fact. Write "not found" instead of guessing.
Finish with three angles nobody in the set is using.`),
    },
    {
      kind: "skill", id: "release-notes", version: "1.0.0", skillName: "release-notes",
      name: "Release notes", summary: "Turns merged changes into short notes people can act on.",
      category: "Coding", tags: ["release", "changelog"], publisher: AIKING, installs: 0,
      text: skill("release-notes", "Turn a list of merged changes into short release notes grouped by what users notice.", `
# Release notes

Group changes into New, Improved and Fixed. One line each, written for the person using the product.
Leave out internal refactors unless they change behavior. Link the pull request when one is given.`),
    },
    {
      kind: "skill", id: "meeting-notes", version: "1.0.0", skillName: "meeting-notes",
      name: "Meeting notes", summary: "Captures decisions, owners and dates from a transcript.",
      category: "Productivity", tags: ["meetings", "notes"], publisher: AIKING, installs: 0,
      text: skill("meeting-notes", "Summarize a meeting transcript into decisions, action items with owners and dates, and open questions.", `
# Meeting notes

Return three sections: Decisions, Action items (owner, task, due date), Open questions.
Quote the transcript when a decision is ambiguous. Never assign an owner who did not agree to the task.`),
    },

    // ── Agents ──────────────────────────────────────────────────────────
    {
      kind: "agent", id: "media-producer", version: "1.0.0", name: "Media Producer",
      summary: "Turns a product idea into hooks, image prompts and a shot list ready for production.",
      category: "Media", tags: ["video", "ads", "production"], publisher: AIKING, featured: true, installs: 0,
      look: { color: "orange", body: "squircle", expression: "proud" },
      profile: {
        name: "Producer", title: "Media producer",
        description: "Turns a product idea into hooks, image prompts and a shot list ready for production.",
        instructions: "You produce short-form media for AIKING. For each request, confirm the product, audience and platform, then deliver hooks, image prompts and a shot list. Prefer concrete, testable creative over adjectives. Never invent product claims.",
      },
      skills: [{ id: "tiktok-hook-writer", version: "1.0.0" }, { id: "image-prompt-builder", version: "1.0.0" }, { id: "video-shot-list", version: "1.0.0" }],
      apps: ["aiking-toolbox", "notion"],
      memory: { "MEMORY.md": "# Production notes\n\n- Default format: 9:16, 15 seconds.\n- Brand voice: direct, confident, no hype words.\n" },
    },
    {
      kind: "agent", id: "ad-strategist", version: "1.0.0", name: "Ad Strategist",
      summary: "Plans campaigns, writes briefs and designs creative tests with clear success metrics.",
      category: "Marketing", tags: ["ads", "campaigns", "testing"], publisher: AIKING, featured: true, installs: 0,
      look: { color: "purple", body: "hexagon", expression: "thinking" },
      profile: {
        name: "Strategist", title: "Ad strategist",
        description: "Plans campaigns, writes briefs and designs creative tests with clear success metrics.",
        instructions: "You plan performance campaigns. Start from one measurable goal. Every plan has a brief, three creative angles, an A/B test with a stop rule, and the metric that decides. Flag claims that need proof.",
      },
      skills: [{ id: "campaign-brief", version: "1.0.0" }, { id: "ab-test-plan", version: "1.0.0" }],
      apps: ["googlesheets", "slack"],
      routines: [{ name: "Monday campaign review", prompt: "Review last week's campaign notes in memory and list the next experiment to run, with its stop rule.", time: "09:00", weekdays: [1], enabled: false }],
    },
    {
      kind: "agent", id: "trend-scout", version: "1.0.0", name: "Trend Scout",
      summary: "Finds formats and angles that are working now, with sources, and what to copy next.",
      category: "Research", tags: ["trends", "research"], publisher: AIKING, installs: 0,
      look: { color: "cyan", body: "drop", expression: "curious" },
      profile: {
        name: "Scout", title: "Trend scout",
        description: "Finds formats and angles that are working now, with sources, and what to copy next.",
        instructions: "You research what is working in short-form content and ads. Every finding has a source link and a date. Separate evidence from guesses. End with three formats worth testing this week.",
      },
      skills: [{ id: "competitor-scan", version: "1.0.0" }],
      apps: ["reddit", "youtube"],
    },
    {
      kind: "agent", id: "prompt-engineer", version: "1.0.0", name: "Prompt Engineer",
      summary: "Builds and debugs prompts for image and video models until output is consistent.",
      category: "Media", tags: ["prompts", "image", "video"], publisher: AIKING, installs: 0,
      look: { color: "teal", body: "diamond", expression: "working" },
      profile: {
        name: "Prompter", title: "Prompt engineer",
        description: "Builds and debugs prompts for image and video models until output is consistent.",
        instructions: "You write and debug prompts for generative image and video models. Change one variable at a time, keep a log of what changed and why, and explain failures (anatomy, text, lighting, consistency) with a fix to try.",
      },
      skills: [{ id: "image-prompt-builder", version: "1.0.0" }],
      apps: ["aiking-toolbox"],
    },
    {
      kind: "agent", id: "launch-coordinator", version: "1.0.0", name: "Launch Coordinator",
      summary: "Turns a launch scope into owners, dates and a checklist people follow.",
      category: "Productivity", tags: ["launch", "planning"], publisher: AIKING, installs: 0,
      look: { color: "green", body: "capsule", expression: "happy" },
      profile: {
        name: "Coordinator", title: "Launch coordinator",
        description: "Turns a launch scope into owners, dates and a checklist people follow.",
        instructions: "You coordinate launches. Keep one checklist with owner and date per item, call out dependencies and blockers, and post a short status each day of launch week.",
      },
      skills: [{ id: "meeting-notes", version: "1.0.0" }, { id: "release-notes", version: "1.0.0" }],
      apps: ["linear", "googlecalendar", "slack"],
    },
    {
      kind: "agent", id: "research-analyst", version: "1.0.0", name: "Research Analyst",
      summary: "Writes cited briefs and comparisons you can act on.",
      category: "Research", tags: ["research", "briefs"], publisher: AIKING, installs: 0,
      look: { color: "blue", body: "circle", expression: "listening" },
      profile: {
        name: "Analyst", title: "Research analyst",
        description: "Writes cited briefs and comparisons you can act on.",
        instructions: "You answer research questions with a brief: the answer first, then evidence with links, then what you could not verify. Prefer primary sources.",
      },
      skills: [{ id: "competitor-scan", version: "1.0.0" }],
      apps: ["notion"],
    },
    {
      kind: "agent", id: "code-reviewer", version: "1.0.0", name: "Code Reviewer",
      summary: "Reads a change, flags the risky lines and writes the review comment for each.",
      category: "Coding", tags: ["code review", "github"], publisher: AIKING, installs: 0,
      look: { color: "red", body: "shield", expression: "suspicious" },
      profile: {
        name: "Reviewer", title: "Code reviewer",
        description: "Reads a change, flags the risky lines and writes the review comment for each.",
        instructions: "You review code changes for correctness first, then security, then clarity. Each finding names the file and line, the failure it causes, and a concrete fix. Do not nitpick style the linter already checks.",
      },
      skills: [{ id: "release-notes", version: "1.0.0" }],
      apps: ["github"],
    },
    {
      kind: "agent", id: "inbox-assistant", version: "1.0.0", name: "Inbox Assistant",
      summary: "Sorts what needs you, drafts replies for approval, never sends on its own.",
      category: "Productivity", tags: ["email", "triage"], publisher: AIKING, installs: 0,
      look: { color: "pink", body: "blob", expression: "idle" },
      profile: {
        name: "Inbox", title: "Inbox assistant",
        description: "Sorts what needs you, drafts replies for approval, never sends on its own.",
        instructions: "You manage the inbox: group mail into needs-a-reply, FYI and noise, then draft replies for approval. Never send, delete or forward mail without approval.",
      },
      skills: [{ id: "meeting-notes", version: "1.0.0" }],
      apps: ["gmail", "googlecalendar"],
    },

    // ── Apps ────────────────────────────────────────────────────────────
    {
      kind: "app", id: "aiking-toolbox", version: "1.0.0", name: "AIKING Toolbox",
      summary: "Local MCP tools: word count, slugify and aspect-ratio sizes. Runs on this computer, no account.",
      category: "Developer tools", tags: ["mcp", "local"], publisher: AIKING, featured: true, installs: 0,
      locales: appLocales("Công cụ MCP cục bộ: đếm từ, tạo slug và tính kích thước theo tỉ lệ khung hình. Chạy trên máy này, không cần tài khoản.", "Developer tools"),
      connector: { type: "mcp", server: { type: "stdio", name: "aiking-toolbox", command: "node", args: ["-e", TOOLBOX_SERVER] } },
    },
    {
      kind: "app", id: "filesystem-mcp", version: "1.0.0", name: "Filesystem",
      summary: "Read and write files in a folder you choose (MCP reference server, needs npx and network on first run).",
      locales: appLocales("Đọc và ghi tệp trong thư mục bạn chọn (máy chủ MCP tham chiếu, lần đầu chạy cần npx và mạng).", "Developer tools"),
      category: "Developer tools", tags: ["mcp", "files"], publisher: { id: "mcp", name: "Model Context Protocol", verified: true }, installs: 0,
      connector: { type: "mcp", server: { type: "stdio", name: "filesystem", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] } },
    },
    ...OFFICIAL_APPS,
    ...[
      ["figma", "Figma", "Frames, comments and design files", "Design", "Khung, bình luận và tệp thiết kế"],
      ["reddit", "Reddit", "Search posts and communities", "Research", "Tìm bài đăng và cộng đồng"],
      ["youtube", "YouTube", "Search videos and read details", "Research", "Tìm video và xem thông tin chi tiết"],
    ].map(([slug, name, summary, category, summaryVi]) => ({
      kind: "app", id: slug, version: "1.0.0", name, summary, category, locales: appLocales(summaryVi, category), tags: ["composio"], logo: slug,
      publisher: { id: "composio", name: "Composio", verified: true }, installs: 0,
      connector: { type: "composio", slug },
    })),
  ],
};
