# Nguồn gốc mã nguồn — AIKING Core

## Code của AIKING

Mọi file trong `src/`, `test/` và `demo/` được viết mới cho AIKING Core và mang header
`Copyright (c) 2026 AIKING`. Nhánh này là nhánh orphan (`claude/aiking-core-rnd`), không mang lịch sử
git hay file nào của fork OpenBot/AIKINGBOT.

Code được viết dựa trên:

- yêu cầu chức năng do AIKING đưa ra (Chat → Agent Runtime → MCP tool → Skill);
- tài liệu công khai: Claude Messages API (vòng lặp tool use), Model Context Protocol, tài liệu của MCP
  TypeScript SDK, định dạng skill `SKILL.md` (front matter YAML + Markdown).

Không file nào được sao chép, chuyển ngữ hay viết lại từ implementation của OpenBot. Khi viết code, không có
file nguồn nào trong `src/`, `packages/` hay `apps/` của OpenBot được mở ra đọc. Từ fork chỉ đọc các file mô
tả: `LICENSE`, `NOTICE` và `docs/AIKINGBOT.md`.

Fork OpenBot vẫn được giữ nguyên ở nhánh riêng làm bản tham khảo nghiên cứu, với `LICENSE` và `NOTICE` gốc.

**Chưa chọn giấy phép** cho code của AIKING Core. Cho đến khi AIKING chọn, code này không được cấp phép
cho bên ngoài.

## Dependency trực tiếp

| Package | Phiên bản | Giấy phép | Nguồn | Dùng cho |
| --- | --- | --- | --- | --- |
| `@anthropic-ai/sdk` | 0.133.0 | MIT | Anthropic, github.com/anthropics/anthropic-sdk-typescript | Gọi Claude Messages API |
| `@modelcontextprotocol/sdk` | 1.32.1 | MIT | Dự án Model Context Protocol, github.com/modelcontextprotocol/typescript-sdk | MCP client (hub) và MCP server (demo) |
| `zod` | 4.6.7 | MIT | github.com/colinhacks/zod | Schema input của tool trong MCP server demo |
| `yaml` | 2.9.1 | ISC | github.com/eemeli/yaml | Đọc front matter của `SKILL.md` |
| `typescript` (dev) | 7.0.2 | Apache-2.0 | Microsoft | Kiểm tra kiểu |
| `@types/bun` (dev) | 1.4.3 | MIT | DefinitelyTyped / Oven | Kiểu dữ liệu của Bun |
| Bun (runtime, không đóng gói kèm) | 1.4.2 | MIT | Oven, bun.sh | Chạy code và test |

## Dependency gián tiếp

`docs/third-party-licenses.tsv` liệt kê toàn bộ 109 package trong `node_modules`:
94 MIT, 9 ISC, 2 Apache-2.0, 2 BSD-3-Clause, 1 BSD-2-Clause, 1 Unlicense (`fast-sha256`).
Tất cả đều là giấy phép permissive, dùng được cho mục đích thương mại. Không có package nào dùng
copyleft hay giấy phép noncommercial.

Muốn tạo lại danh sách này sau khi đổi dependency thì chạy lại lệnh kiểm kê trong `docs/README-licenses.md`.
