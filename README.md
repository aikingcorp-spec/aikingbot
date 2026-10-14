# AIKING Core

**AIKINGBOT stage 1:** the complete desktop foundation is in [apps/desktop-foundation](apps/desktop-foundation/README.md). It runs the selected OpenMausBot OSS application with AIKING branding. [Source comparison](docs/stage-1-source-comparison.md) and [the later Core integration plan](docs/stage-1-core-integration.md) describe the boundary. Core integration is not implemented in this stage.

Lõi agent độc lập của AIKINGBOT.

```
Chat (ChatSession) → Agent Runtime (vòng lặp tool use, trung lập provider)
   │                      │
   │                      ├── ModelClient ← AnthropicModel | FallbackModel | ScriptedModel | (provider khác: thêm adapter)
   │                      └── ToolRegistry ── PermissionGate (read / side_effect / dangerous) + timeout + giới hạn output
   │                             ├── read_skill          → SkillLibrary (SKILL.md, có tasks/inputs/outputs)
   │                             ├── plan_capabilities   → CapabilityIndex (ghép skill + tool qua đồ thị artifact)
   │                             └── mcp__<server>__<tool> → McpHub → MCP server (risk từ annotations, capability từ _meta)
   └── transcript JSONL
```

| Module | File | Chức năng |
| --- | --- | --- |
| Model contract | `src/runtime/model.ts` | Kiểu message/tool/response trung lập, `ModelClient`, `ModelError` (phân loại lỗi, `retryable`) |
| Claude adapter | `src/runtime/anthropic-model.ts` | Map sang Messages API; refusal fallback phía server; usage theo từng model từ `usage.iterations` |
| Fallback | `src/runtime/fallback-model.ts` | Chuỗi model/provider phía client; chỉ chuyển khi lỗi retryable; ghi mọi lần thử |
| Chi phí | `src/runtime/cost.ts` | Bảng giá Claude, cộng theo model đã phục vụ; model không có giá → báo `unpriced`, không đoán |
| Tool guard | `src/runtime/tools.ts` | Permission gate, approver, timeout, giới hạn output |
| Agent Runtime | `src/runtime/agent-runtime.ts` | Vòng lặp tool use; giới hạn bước, số tool call mỗi lượt / mỗi run; trả về chi phí, model phục vụ, fallback |
| Capability | `src/capabilities/*` | Chỉ mục skill + MCP tool, lập kế hoạch theo inputs/outputs, tool `plan_capabilities` |
| Skills / MCP / Chat | `src/skills/*`, `src/mcp/mcp-hub.ts`, `src/chat/chat-session.ts` | Như v0.1, đã chuyển sang kiểu trung lập |

### Thêm provider mới

Viết một class `implements ModelClient` (`provider`, `create(request) → ModelResponse`): map `Message`/`ToolDefinition` sang API của provider, map ngược `tool_call`, `stopReason`, `usage`; ném `ModelError` với `kind` phù hợp. Block riêng của provider (thinking…) để dạng `opaque` với tên provider. Runtime, chat, tool không đổi. Ghép nhiều provider bằng `FallbackModel`.

### Khai báo capability

Skill (front matter):

```yaml
tasks: [write a short video ad script]
inputs: [requirements]
outputs: [ad-script]
```

MCP tool: `annotations` (`readOnlyHint`, `destructiveHint`) quyết định risk — tool không khai báo bị coi là `dangerous` (theo mặc định của spec MCP); `_meta["aiking/capability"] = { tasks, inputs, outputs }`. Operator có thể ghi đè risk bằng `toolRisk` trong cấu hình server.

### Quyền

- `read`: chạy ngay.
- `side_effect`: cần approver đồng ý (hoặc nằm trong `preapproved`). Không có approver → từ chối.
- `dangerous`: từ chối, không hỏi, trừ khi có trong `allowDangerous` — khi đó vẫn hỏi approver mỗi lần.

## AIKINGBOT shell (v0.2)

```
apps/shell (SolidJS) ──AG-UI/SSE──► src/gateway (server + AG-UI adapter) ──AgentBackend──► AIKING Core ──► SQLite
```

Sidebar agent + threads, chat streaming, timeline tool call, thẻ approval (AG-UI interrupt/resume),
tab Skills & MCP, lịch sử lưu SQLite và khôi phục sau restart. Báo cáo nghiên cứu và quyết định stack:
`docs/v0.2-architecture.md`. Trạng thái và việc tiếp theo: `HANDOFF.md`.

## Lệnh

```bash
bun install
bun test             # 83 test: unit, vertical slice, pipeline demo, gateway AG-UI
bun run typecheck
bun run demo         # demo offline: ý tưởng → phân tích → chọn skill → brief → MCP tool → render job (có approval)
bun run demo --deny  # như trên, operator từ chối render
bun run demo --live  # dùng Claude API (cần credentials, tốn credits)
bun run chat         # CLI chat, đọc aiking.config.json
bun run app          # UI + gateway offline: http://127.0.0.1:4317
```

Ví dụ `aiking.config.json`:

```json
{
  "skillsDir": "demo/skills",
  "mcpServers": { "media": { "command": "bun", "args": ["demo/media-tools-server.ts"] } }
}
```

## Lộ trình

| Bước | Module | Trạng thái |
| --- | --- | --- |
| 1 | Chat → Runtime → MCP stdio → Skill | **Xong (v0.1)** |
| 2a | ModelClient trung lập, fallback, chi phí, permission gate, capability discovery | **Xong (v0.2)** |
| 2b | Streaming, SQLite, AG-UI gateway, shell UI (web) | **Xong (v0.2)** |
| 2c | Approval bền vững qua restart, Electron wrapper, prompt caching | Tiếp theo |
| 3 | MCP qua HTTP (Streamable HTTP), cấu hình server theo từng agent | |
| 4 | Lưu trữ: SQLite cho agent / thread / message thay cho JSONL | |
| 5 | Agent identity + workspace riêng cho từng agent | |
| 6 | Remote: API HTTP/WebSocket cục bộ cho UI và mobile | |
| 7 | UI desktop/web (dùng lại hoặc thay giao diện tham khảo) | |

Nguồn gốc code và giấy phép: xem `PROVENANCE.md`.

> Lưu ý v0.2: transcript JSONL giờ lưu message dạng trung lập (`tool_call` / `tool_result` / `opaque`), không đọc được transcript của v0.1.
