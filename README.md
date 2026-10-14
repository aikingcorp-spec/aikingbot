# AIKING Core

Lõi agent độc lập của AIKINGBOT. Bản v0.1 là một vertical slice:

```
Chat (ChatSession) → Agent Runtime (vòng lặp tool use) → ToolRegistry
                                                         ├── read_skill    → SkillLibrary (SKILL.md)
                                                         └── mcp__<server>__<tool> → McpHub → MCP server
```

| Module | File | Chức năng |
| --- | --- | --- |
| Skills | `src/skills/skill-library.ts`, `skill-tools.ts` | Nạp `<dir>/SKILL.md`. Đưa danh mục skill vào system prompt; model đọc nội dung skill qua tool `read_skill` |
| MCP | `src/mcp/mcp-hub.ts` | Kết nối MCP server (stdio hoặc transport bất kỳ), gắn namespace cho tên tool, chuyển kết quả thành text |
| Agent Runtime | `src/runtime/agent-runtime.ts` | Vòng lặp tool use, chạy tool song song, giới hạn số bước, xử lý `max_tokens` / `refusal` / `pause_turn` |
| Model | `src/runtime/anthropic-model.ts`, `scripted-model.ts` | Claude API (`claude-opus-5-5`, có refusal fallback phía server) và model chạy theo kịch bản cho test/offline |
| Chat | `src/chat/chat-session.ts` | Lịch sử hội thoại, transcript JSONL (vẫn còn sau khi khởi động lại), không ghi lại nửa turn khi lỗi |
| Lắp ráp | `src/core.ts`, `src/cli.ts` | `createCore()` và CLI chat trên terminal |

## Lệnh

```bash
bun install
bun test             # 31 test: unit + vertical slice
bun run typecheck
bun run demo         # demo offline: model theo kịch bản + MCP server thật (process stdio) + skill thật
bun run demo --live  # dùng Claude API (cần ANTHROPIC_API_KEY)
bun run chat         # CLI chat, đọc aiking.config.json
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
| 2 | Streaming câu trả lời, prompt caching, đếm token/chi phí | Tiếp theo |
| 3 | MCP qua HTTP (Streamable HTTP), cấu hình server theo từng agent | |
| 4 | Lưu trữ: SQLite cho agent / thread / message thay cho JSONL | |
| 5 | Agent identity + workspace riêng cho từng agent | |
| 6 | Remote: API HTTP/WebSocket cục bộ cho UI và mobile | |
| 7 | UI desktop/web (dùng lại hoặc thay giao diện tham khảo) | |

Nguồn gốc code và giấy phép: xem `PROVENANCE.md`.
