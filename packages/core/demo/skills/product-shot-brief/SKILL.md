---
name: product-shot-brief
description: Write a generation brief for an AI product shot (image model prompt plus output size).
tasks: [product photo prompt, still image of a product for a feed post]
inputs: [frame-spec]
outputs: [image-brief]
---

# Product shot brief

Use this when the user asks for a product image prompt.

1. Get the output size with the `mcp__media__frame_size` tool. Default ratio: `4:5` (feed post). Default long edge: `1536`.
2. Write the prompt in this order: subject, material and detail, lighting, background, camera.
3. Keep the product the hero: no hands, no text, no extra props unless the user asks.
4. Return:
   - `Size:` width x height
   - `Prompt:` one paragraph
   - `Negative:` comma-separated list
