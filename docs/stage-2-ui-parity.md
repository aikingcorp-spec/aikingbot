# Stage 2 — UI/UX parity với OpenBot

Ngày: 2026-10-14. Nhánh: `stage2/ui-parity` (tách từ `AIKINGBOT`). Tham chiếu: nightly-labs/openbot `82c317a`
(v0.39.1), chạy bằng Storybook + `OpenBotPlayground`, chỉ để quan sát (PolyForm Noncommercial — không copy code).

## Cách làm

1. Chạy Storybook của OpenBot, chụp 34 màn hình 1440×900, đo token bằng computed style (nền, surface, radius,
   font, kích thước rail/sidebar/header/composer).
2. Giữ OpenMausBot làm nền. Thay đổi nằm trong `apps/desktop-foundation/overrides/` (setup.mjs chép đè lên source).
3. Ưu tiên đòn bẩy: skin token → khung shell → từng màn hình → CSS cho các phần dùng chung (popup, setting rows,
   bubble, header group) thay vì fork file lớn.
4. Mỗi vòng: `ui-tour.mjs` lái app thật, chụp ảnh, so với ảnh tham chiếu, sửa, chạy lại.

## Token đã đo và áp dụng (skin `aiking`, mặc định)

| Vùng | OpenBot | AIKINGBOT |
| --- | --- | --- |
| Khung cửa sổ (top bar + rail) | `#141414` | `--color-chrome #141414` |
| Tấm nội dung (sidebar + chat) | `#1a1a1a` | `--color-app/panel #1a1a1a` |
| Surface / bubble agent / composer | `#212121` | `--color-raised #212121` |
| Bubble của người dùng | `#242424` | `--color-bubble-user #242424` |
| Accent | xanh `#007cf7` | mint AIKING `#3fd9a6`, chữ tối `#04261a` (AA) |
| Font | Inter Variable 13–14px | Inter Variable (đóng gói, OFL) |
| Radius | 6 / 8 / 12 / 14 / 22px | giống |
| Rail / sidebar / header | 72 / 280 / ~38px | 72 / 280 / 40px |

Có thêm skin `aiking-light`; 9 skin gốc của nền vẫn chọn được ở Settings → Appearance.

## Màn hình đã hoàn thiện

| Khu vực | Trạng thái | Ghi chú |
| --- | --- | --- |
| Desktop shell: rail workspace, top bar chrome, tấm bo góc | Xong | `WorkspaceChrome.tsx`, `App.tsx` |
| Sidebar: workspace title, Marketplace, New, search, tab Agents/Routines, agent row 54px + badge vai trò, account dock | Xong | Giữ toàn bộ section, pin, thread, kéo thả của nền |
| Chat: header 40px căn trái, bubble 22px/14px, markdown, bảng, code | Xong | Render gốc của nền, restyle |
| Composer: khung 12px, nút + tròn, nút gửi/dừng tròn | Xong | Giữ mention, attachment, dictation, approval mode |
| Tool activity: thẻ "n steps · tools  n/n" thu gọn | Xong | Luôn hiện, kể cả khi tắt "Show tool calls" |
| Agent creation: template từ Marketplace điền sẵn dialog | Xong | Dialog nhiều mục của nền giữ nguyên |
| Avatar agent: khối màu + mắt theo biểu cảm, 10 hình dạng | Xong | Thiết kế gốc AIKING, thay mark hình học Stage 1 |
| Model selector, profile agent, Computer/Browser panel | Xong (restyle qua token) | Chức năng của nền |
| Marketplace Agents / Apps / Skills, trang chi tiết agent | Xong | `Marketplace.tsx`; Apps nhúng `PluginsPanel` (connect, OAuth, MCP giữ nguyên) |
| Logo app (29 dịch vụ) không cần mạng | Xong | simple-icons CC0; Slack/Salesforce không có trong bộ → chữ cái |
| Settings: rail, tiêu đề 18px, hàng gộp nhóm, popup đặc | Xong | CSS + `SettingsModal.tsx` |
| Settings → Connectors (apps, MCP, skills, chưa cài, gợi ý Marketplace) | Xong | `ConnectorsOverview.tsx` trên mục API keys |
| Providers (Settings → AI) | Xong (restyle) | Chức năng của nền |
| Routines/Schedules (lịch tuần) | Xong (restyle) | Sidebar giữ lại khi xem Routines |
| Groups: tạo group, header 40px, setup | Xong | |
| Thuật ngữ bot → agent, OpenMausBot → AIKINGBOT | Xong | `terminology.mjs` sinh `en.json` |
| Hover / loading / empty states | Xong cho màn mới | Marketplace, Skills, Connectors, search không kết quả |
| Mobile/hẹp (≤ 768px) | Kiểm tra | Drawer sidebar, composer xuống dòng |

## Còn thiếu / khác biệt có chủ đích

| Mục | Lý do / việc cần làm |
| --- | --- |
| Catalog Marketplace thật (agents/skills từ server, publish, số lượt cài) | Cần AIKING Core (Stage 3). Hiện dùng 6 template local + skill của agent |
| Connector first-party (GitHub, Slack, Discord, Telegram, 1Password) theo kiểu OpenBot | Nền dùng Composio + MCP. Cần backend Stage 3 |
| Remote desktop toàn màn hình như OpenBot | Nền có Computer panel/VM; chưa thử với máy thật |
| Rail nhiều server (remote workspace) | Rail chỉ có máy này + nút kết nối (mở Settings → Remote) |
| "Waiting for replies", Dynamic Island, Billing, mobile card | Không có tính năng tương ứng ở nền |
| Dialog New agent dạng trang giữa màn hình | Giữ dialog nhiều mục của nền (nhiều tính năng hơn); chưa đổi bố cục |
| Tiếng Việt | Hệ i18n của nền chưa có `vi`; chuỗi AIKING mới nằm ở `src/aiking/strings.ts` sẵn chỗ cho `vi` |
| Light theme của OpenBot | OpenBot chỉ có dark; `aiking-light` là thiết kế riêng |

## Trạng thái tích hợp AIKING Core (Stage 3)

- Chat, agent, tool, group, routine chạy trên harness của OpenMausBot. Core v0.2 **chưa** nối vào app.
- Marketplace Agents hiển thị ghi chú "Live catalog and publishing arrive with AIKING Core (stage 3)".
- Điểm nối dự kiến: catalog Marketplace (agents/skills/apps), trạng thái connector, model provider của Core.

## Kiểm chứng (2026-10-14)

- `ui-tour.mjs`: **28/28 bước** trên Chromium (1440×900) và **28/28** (1 bỏ qua hợp lệ: Account không có trên
  host desktop local) trên renderer Electron 43.7.9 thật dưới Xvfb, sandbox bật, chạy bằng user thường. 0 lỗi
  renderer. Gồm: tạo agent từ template, gửi tin, nhận phản hồi qua pipeline thật (provider offline), mở thẻ tool
  activity, tạo group, mọi trang Settings, Marketplace 3 tab, command palette.
- `verify.mjs` (Stage 1): 12/12 kiểm tra pass sau thay đổi UI.
- Typecheck renderer (`tsc -p tsconfig.json`): pass.
- **Chưa kiểm chứng**: provider thật, connector thật, remote/cloud computer, build installer Windows/macOS.

## Lệnh

```sh
node apps/desktop-foundation/setup.mjs
node apps/desktop-foundation/dev.mjs --offline                 # browser: http://127.0.0.1:5199
AIKING_CHROME=/path/to/chrome node apps/desktop-foundation/ui-tour.mjs
# Electron:
AIKING_DESKTOP_DEBUG_PORT=9223 node apps/desktop-foundation/dev.mjs --offline --desktop
AIKING_VERIFY_CDP=http://127.0.0.1:9223 node apps/desktop-foundation/ui-tour.mjs
# Hội thoại mẫu phong phú cho review UI (markdown, bảng, code, tool calls):
AIKING_OFFLINE_REPLIES='["..."]' FAKE_CLAUDE_TOOL_CALLS='[{"name":"Read"}]' node apps/desktop-foundation/dev.mjs --offline
# Sau khi đổi en.json upstream:
node apps/desktop-foundation/terminology.mjs
```

Ảnh và báo cáo JSON nằm ở `.aikingbot-foundation/evidence/stage2/` (không commit). Electron từ chối chạy bằng root
khi bật sandbox — chạy bằng user thường, không thêm `--no-sandbox`.
