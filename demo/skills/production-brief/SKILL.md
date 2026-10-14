---
name: production-brief
description: Assemble the production brief for a video ad from the script, frame size and shot timing.
tasks: [production brief for a tiktok video ad, plan a short video shoot or generation]
inputs: [ad-script, frame-spec, shot-timing]
outputs: [production-brief]
---

# Production brief

Return these sections:

1. `Format:` width x height, duration, shot count.
2. `Shots:` table with shot number, start-end seconds, visual prompt, voiceover / text.
3. `Style:` lighting, palette, camera movement, music mood.
4. `Negative:` what generation must avoid.

Each shot's visual prompt must stand alone (subject, action, setting, light, camera), because shots are generated separately.
