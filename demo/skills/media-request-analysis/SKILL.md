---
name: media-request-analysis
description: Turn a raw content idea into clear requirements (platform, format, length, audience, goal, constraints).
tasks: [analyze a media request, clarify platform audience and goal of a content idea]
inputs: [idea]
outputs: [requirements]
---

# Media request analysis

1. Extract from the idea: product, platform, format (video / image), length, aspect ratio, audience, goal, must-avoid.
2. Fill gaps with platform defaults and mark them `(default)`:
   - TikTok / Reels / Shorts: vertical 9:16, long edge 1920, 15 s, 5 shots.
   - Instagram feed: 4:5, long edge 1536.
3. Return a `Requirements` list, one field per line. Ask the user only if the product itself is unknown.
