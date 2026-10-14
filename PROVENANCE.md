# Nguồn gốc mã nguồn — AIKING Core

## Code của AIKING

Mọi file trong `src/`, `test/`, `demo/` và `apps/shell/src/` (trừ `apps/shell/src/vendor/`) được viết mới cho AIKING Core và mang header
`Copyright (c) 2026 AIKING`. Nhánh này là nhánh orphan (`claude/aiking-core-rnd`), không mang lịch sử
git hay file nào của fork OpenBot/AIKINGBOT.

Code được viết dựa trên:

- yêu cầu chức năng do AIKING đưa ra (Chat → Agent Runtime → MCP tool → Skill);
- tài liệu công khai: Claude Messages API (vòng lặp tool use), Model Context Protocol, tài liệu của MCP
  TypeScript SDK, định dạng skill `SKILL.md` (front matter YAML + Markdown).

v0.1: không file nào được sao chép, chuyển ngữ hay viết lại từ implementation của OpenBot; khi viết v0.1
không mở file nguồn nào của OpenBot, chỉ đọc `LICENSE`, `NOTICE` và `docs/AIKINGBOT.md` của fork.

v0.2: để nghiên cứu, đã đọc source của OpenBot **v0.1.11 (Apache-2.0)**, CopilotKit OpenBot, OpenDots,
CopilotKit và AG-UI (đều MIT). Chỉ phần OpenBot v0.1.11 liệt kê ở mục "Code bên thứ ba" được sao chép (có
ghi nguồn). Source OpenBot bản mới (PolyForm Noncommercial) chỉ được liệt kê cấu trúc thư mục, giấy phép và
dependency để so sánh; không dùng code nào từ đó.

Fork OpenBot vẫn được giữ nguyên ở nhánh riêng làm bản tham khảo nghiên cứu, với `LICENSE` và `NOTICE` gốc.

## Code bên thứ ba được nhúng (v0.2)

| Thư mục | Nguồn | Giấy phép | Nội dung | Thay đổi |
| --- | --- | --- | --- | --- |
| `apps/shell/src/vendor/openbot-v0.1.11/` | OpenBot, github.com/nightly-labs/openbot, tag `v0.1.11` (commit trước khi repo đổi sang PolyForm Noncommercial ngày 2026-08-20) | Apache-2.0, Copyright 2026 Norbert Bodziony | `openbot.css` (design tokens, sidebar, agent row, avatar — trích từ `src/renderer/src/styles.css`), `AgentMark.tsx` | Ghi trong header từng file. `LICENSE` và `NOTICE` gốc nằm cùng thư mục |

Không dùng code nào từ OpenBot sau v0.1.11 (PolyForm Noncommercial). CopilotKit OpenBot, OpenDots,
CopilotKit và AG-UI (MIT) chỉ được đọc để nghiên cứu; không file nào được sao chép. AG-UI được dùng qua
package npm `@ag-ui/core`.

**Chưa chọn giấy phép** cho code của AIKING Core. Cho đến khi AIKING chọn, code này không được cấp phép
cho bên ngoài.

## Dependency trực tiếp

| Package | Phiên bản | Giấy phép | Nguồn | Dùng cho |
| --- | --- | --- | --- | --- |
| `@anthropic-ai/sdk` | 0.133.0 | MIT | Anthropic, github.com/anthropics/anthropic-sdk-typescript | Gọi Claude Messages API |
| `@modelcontextprotocol/sdk` | 1.32.1 | MIT | Dự án Model Context Protocol, github.com/modelcontextprotocol/typescript-sdk | MCP client (hub) và MCP server (demo) |
| `@ag-ui/core` | 1.0.2 | MIT | github.com/ag-ui-protocol/ag-ui | Kiểu và schema của giao thức AG-UI (gateway + shell) |
| `solid-js` | 1.9.17 | MIT | github.com/solidjs/solid | UI shell |
| `vite` (dev) | 7.3.7 | MIT | github.com/vitejs/vite | Build UI shell |
| `vite-plugin-solid` (dev) | 2.11.14 | MIT | github.com/solidjs/vite-plugin-solid | Biên dịch JSX của Solid |
| `zod` | 4.6.7 | MIT | github.com/colinhacks/zod | Schema input của tool trong MCP server demo |
| `yaml` | 2.9.1 | ISC | github.com/eemeli/yaml | Đọc front matter của `SKILL.md` |
| `typescript` (dev) | 7.0.2 | Apache-2.0 | Microsoft | Kiểm tra kiểu |
| `@types/bun` (dev) | 1.4.3 | MIT | DefinitelyTyped / Oven | Kiểu dữ liệu của Bun |
| Bun (runtime, không đóng gói kèm) | 1.4.2 | MIT | Oven, bun.sh | Chạy code và test |

## Dependency gián tiếp

`docs/third-party-licenses.tsv` liệt kê toàn bộ 182 package trong `node_modules` (v0.2):
158 MIT, 14 ISC, 3 Apache-2.0, 3 BSD-3-Clause, 2 BSD-2-Clause, 1 Unlicense, 1 CC-BY-4.0.
Không có copyleft hay noncommercial.

**Cần duyệt:** `caniuse-lite` (CC-BY-4.0) là dữ liệu trình duyệt mà Vite/Babel dùng lúc build (dev
dependency gián tiếp), không có trong bundle UI hay runtime. CC-BY-4.0 cho phép dùng thương mại, chỉ yêu cầu
ghi công nếu phân phối lại dữ liệu đó.

Muốn tạo lại danh sách này sau khi đổi dependency thì chạy lại lệnh kiểm kê trong `docs/README-licenses.md`.
