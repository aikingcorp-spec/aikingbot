# AIKINGBOT V0: ghi chú bản prototype

AIKINGBOT là bản fork thử nghiệm, phi thương mại, dựa trên [OpenBot](https://github.com/nightly-labs/openbot)
(commit `3a657f6`). Giao diện, cách tương tác và agent runtime vẫn là của OpenBot. Bản fork đổi định danh của
ứng dụng và chạy **local-only**, không cần tài khoản cloud.

> Giấy phép: PolyForm Noncommercial 1.0.0 (xem `LICENSE`, `NOTICE`). **Không được dùng vào mục đích thương mại**,
> kể cả dùng nội bộ cho hoạt động kinh doanh của công ty, nếu chưa có giấy phép riêng từ tác giả upstream.
> `LICENSE`, `NOTICE` và `CHANGELOG.md` được giữ nguyên.

## Cài bản Windows

1. Mở trang [Releases](https://github.com/aikingcorp-spec/AIKINGX_Bot/releases) và chọn bản prerelease mới nhất
   tên `aikingbot-v0-local-*`. Nếu muốn, lấy bản trong mục artifact `AIKINGBOT-windows-x64` của workflow
   **Windows local build**.
2. Tải `AIKINGBOT-<version>-x64.exe`. Muốn kiểm tra file thì so mã hash với `SHA256SUMS-windows.txt`
   (`Get-FileHash .\AIKINGBOT-*.exe`).
3. Chạy file installer. Bản build chưa được ký số, nên SmartScreen sẽ cảnh báo: bấm **More info → Run anyway**.
4. Lúc mở app sẽ vào thẳng onboarding, không có màn đăng nhập. Chọn **Start free** (dùng model free của
   OpenCode Zen) hoặc **I have a subscription** (Claude, ChatGPT hoặc Grok, đăng nhập bằng CLI của chính hãng đó).

Dữ liệu nằm ở `%APPDATA%\AIKINGBOT` (database `aikingbot.db`). Workspace của agent nằm ở
`%USERPROFILE%\AIKINGBOT\Agents`.

## Build từ source

Cần Bun 1.4.2 và Node 24 (`.nvmrc`).

```bash
bun install --frozen-lockfile
bun run build             # electron-vite build -> out/
bun run typecheck && bun run lint
bunx vitest run           # bộ test desktop
bun run dist:win:local    # trên Windows: build installer NSIS chưa ký vào dist/
```

`bun run dev` cần `.env.keys` đã mã hoá của upstream, mà bản fork không có. Muốn chạy bản đã build mà không
đóng gói thì dùng: `bun run build && npx electron . --user-data-dir=<thư mục profile>`.

## Local-only mode

Local-only bật mặc định. Nó tắt khi đặt `AIKINGBOT_AUTH_API_URL` (account API tự host) hoặc
`AIKINGBOT_HOSTED_SERVICES=1`.

| Phần | Hành vi ở local-only |
| --- | --- |
| Tài khoản | `CentralAuthManager` đăng nhập sẵn bằng tài khoản local cố định, không có token. Sign-out bị ẩn. |
| Mạng | `src/main/hosted-services.ts` chặn mọi request tới `*.aikingbot.aikingx.com` và `*.aikingbot-sites.aikingx.com`: `fetch` của main process, cùng HTTP/WS trên mọi Electron session. |
| Auto-update | Tắt. |
| UI | Ẩn: Sign out, card mobile, nút `+` thêm server, các tab Settings Profile/Billing/Mobile Connect. Phần code xử lý vẫn còn nguyên. |

## Đã kiểm chứng (trên Linux, Electron 44, profile sạch)

| Tính năng | Kết quả |
| --- | --- |
| Khởi động, không đăng nhập | OK: vào onboarding, rồi vào workspace với tên "Local user" |
| Agent: tạo agent | OK |
| Chat: gửi tin nhắn, runtime OpenCode chạy | OK. Model không trả lời được vì network policy của container chặn `opencode.ai`, và app báo lỗi gọn gàng |
| Skills local: tạo, cài vào agent, liệt kê | OK |
| MCP (Tools): test server stdio, lưu, liệt kê | OK (tìm thấy 1 tool) |
| Files: liệt kê workspace của agent | OK |
| Lưu dữ liệu sau khi restart | OK: agent, chat, skill, MCP đều còn |
| Marketplace > Apps (catalog có sẵn trong app) | OK |
| Không có kết nối tới hosted | OK: map các hostname hosted của AIKING và OpenBot về một listener cục bộ trong `/etc/hosts`. Chạy toàn bộ luồng trên (main, renderer, child process OpenCode, cộng thêm 90 giây cho timer nền) thì listener ghi nhận **0 kết nối**. Kiểm tra đối chứng bằng `curl` thì bắt được. |

Test tự động: `vitest` cho 6142 pass, 21 fail, 14 skip. Bản upstream gốc trong cùng container cũng ra 21 fail đó:

- Có 20 test fail vì container chạy bằng **root** (test về quyền file và UID). Chạy lại bằng user thường thì
  20 test này pass.
- Còn 1 lỗi thật của upstream: `scripts/publish-production-catalog.test.ts` (nhận `null` trong khi mong đợi `0`).
- `scripts/custom-acp-agent-e2e.ts` fail giống hệt trên upstream: script cũ, định dạng thread id đã thay đổi.

## Bản đồ phụ thuộc vận hành

| Nhóm | Thành phần |
| --- | --- |
| **Hoàn toàn local** | Electron app, renderer SolidJS, agent runtime (`src/backend`), SQLite `aikingbot.db`, agent store, skills local, MCP stdio/http, file workspace, routines, browser của agent, computer use, voice (runtime sherpa-onnx tải sẵn lúc build) |
| **Tải từ vendor bên thứ ba** | CLI/runtime của provider (Codex, Claude, Grok, OpenCode, Cline, …), cua-driver. Đây là dịch vụ của vendor, không thuộc OpenBot |
| **Hosted, có thể tự host** | Account API (`apps/auth-api`, Cloudflare Workers + D1), Signal/TURN (`remote/`, Docker compose + coturn), site router (`apps/site-router`, R2) |
| **Phụ thuộc dịch vụ chưa có hoặc độc quyền** | Marketplace Agents/Skills (cần account API), hosted servers + billing (Stripe), Mobile Connect, team sync, remote desktop runtime (binary build sẵn đăng trên release của upstream), analytics OpenPanel, ký code (Azure Artifact Signing, Apple Developer ID của upstream), push iOS (APNs) |

## Giới hạn đã biết

- Marketplace tab Agents/Skills báo "Sign in is required". Muốn có skill thì tạo skill local trong workspace của agent.
- Remote desktop, team, hosted servers, hosted sites, mobile app: tắt hoặc không chạy được.
- Skill quản lý sẵn `aikingbot-site-hosting` vẫn được cài vào agent. Nếu agent dùng nó, request publish sẽ bị
  guard chặn và trả lỗi.
- Installer chưa ký số, nên SmartScreen cảnh báo. Không có auto-update.
- Một số định danh của bên thứ ba từ upstream vẫn còn trong cấu hình release/mobile: Apple Team ID, client ID của
  Azure signing, Expo project. Chúng chỉ được dùng trong workflow release gốc, workflow build local không dùng tới.
- Các workflow gốc của upstream (`release.yml`, `ci.yml`, review bot…) cần secret của upstream nên sẽ fail.
  Workflow dùng cho bản fork là `windows-local-build.yml`.
- Chưa test được trên Windows thật trong session này. Phần kiểm chứng end-to-end ở trên chạy trên Linux.

## Bước tiếp theo đề xuất

1. Anh cài bản Windows và chạy lại bảng kiểm chứng ở trên, dùng tài khoản Claude hoặc ChatGPT thật của anh.
2. Đặt một biến cấu hình cho origin hosted (thay cho hằng số `*.aikingbot.aikingx.com`), để sau này trỏ sang VPS.
3. Tự host `apps/auth-api` và `remote/` trên VPS, rồi bật lại account, team và remote bằng `AIKINGBOT_AUTH_API_URL`.
4. Tắt hoặc xoá các workflow upstream không dùng, và cấu hình Dependabot.
5. Phần nghiên cứu so sánh với OpenClaw / Hermes Agent / OpenDots / Paperclip **chưa làm** trong vòng này,
   vì ưu tiên ra bản Windows trước.
