# HANDOFF — AIKING Core / AIKINGBOT v0.2

Cập nhật: 2026-10-15. Tài liệu này đủ để một coding agent tiếp tục mà không cần đọc lịch sử hội thoại.
Không chứa secret.

## Claude tiếp quản — TRẠNG THÁI HIỆN TẠI (cập nhật 2026-10-15 ~03:40 UTC)

Nhánh làm việc: **`AIKINGBOT`** (fast-forward từ `stage3/shipping-candidate@c9bea47`, không rebase).
`stage3/shipping-candidate` giữ nguyên `c9bea47`. Workflow `shipping-candidate.yml` chạy trên cả hai nhánh.

Đã làm (đều đã push):
1. `cf29a7a` — Branding AIKINGBOT toàn runtime (`apps/desktop-foundation/branding-patches.mjs`, gọi trong setup):
   177 file src/server/electron/shared + mọi bản dịch; tray, thông báo, system prompt, MCP/OAuth client name;
   bỏ default `admin.openmausbot.com`, ảnh `mausbot.com`, link docs upstream → `docs/aikingbot/`. Giữ attribution,
   asset pinned SHA, tên native helper, storage key/protocol id. Chi tiết: `apps/desktop-foundation/BRANDING-AUDIT.md`.
2. `527aec0` — Server độc lập: `server-bundle.mjs` (tar.gz + SHA256SUMS + manifest commit/hash từng file),
   `server-smoke.mjs` (15 kiểm tra), `deploy/aikingbot-server/` (Docker + Caddy edge sở hữu netns, mode sau proxy
   có sẵn hoặc tự TLS, systemd hardened, vhost nginx/Caddy, preflight/backup/restore/stack-check).
   Hướng dẫn: `docs/aikingbot/server-deployment.md` (gồm staging → production).
3. `49245bf` — Sửa race E2E (Windows run 8 và Linux run 10 cùng gặp): kiểm tra record Marketplace sau uninstall
   chờ ghi hàng đợi (≤15 s).
4. `ddb95ff` — Test Voice qua adapter STT/TTS HTTP thật (OpenAI-compatible) + adapter lỗi không lộ body.
5. Sửa bug thật do đổi protocol của Codex: link cài package `aikingbot://install` bị từ chối, link thread
   `aikingbot://thread/…` dạng markdown không parse, updater relaunch không lọc deep link organization.
   Cloud account/plan/move/lending chỉ hiện khi có `AIKING_CLOUD_ORIGIN`. Toàn bộ suite Electron main-process
   750 pass/0 fail (Codex để lại 6 fail) và đã thêm vào CI Linux.

CI:
- Run 7 `38671558099` (`2dd6b48`): Linux xanh; Windows fail tour avatar (đã sửa ở `c9bea47`).
- Run 8 `38673404476` (`c9bea47`): **Linux xanh toàn bộ**; Windows fail `marketplace-backend-uninstall`
  (race ở trên, run 7 cùng bước đã pass → không phải lỗi product). Installer Windows build/upload được.
- Run 9/11 bị hủy (đã có commit mới hơn). Run 10 `38675718326` (branding) và run cho `49245bf` cần đọc kết quả;
  CI giờ thêm bước server bundle/smoke + Docker image đầy đủ (browser) + stack-check, upload
  `AIKINGBOT-server-linux-x64-<sha>`.

Kiểm chứng local (container Linux, Node 24.22.0 `/opt/node24`, root nên không chạy Electron):
compatibility 1000 pass/1 skip; desktop security 124 pass/2 skip; Core `bun test` 87 pass; renderer + server
typecheck; Chromium verify-shipping (E2E 11/11, Voice, tours dark/light/advanced) pass sau branding;
server smoke 15/15; Docker stack (image `WITH_BROWSER=0` vì sandbox chặn deb.debian.org) + Caddy edge +
stack-check pass; app restart/backup không làm rớt edge; `systemd-analyze verify` unit OK; preflight OK.

Chưa làm được / cần người vận hành:
- Không có quyền SSH VPS từ container này → chưa đối chiếu hạ tầng thật. Chạy
  `deploy/aikingbot-server/scripts/preflight.sh` trên VPS trước (read-only), sau đó làm theo server-deployment.md.
- Credential: Anthropic key (Core live), STT/TTS endpoint+token, Composio project/OAuth, chứng chỉ ký Windows/macOS,
  DNS + TLS cho hostname staging/production, (tuỳ chọn) feed update HTTPS, catalog Marketplace đã review.
- Windows installer chưa cài thử trên máy thật; macOS chưa build. Tiếng Việt UI chưa có.

Tiếp tục: đọc kết quả CI mới nhất trên `AIKINGBOT`, lấy SHA-256 từ `build-artifacts.json` (evidence) và
`SHA256SUMS` (server), cập nhật bảng artifact ở cuối mục này.

## Overnight Stage 3 → 5 — `stage3/shipping-candidate`

Base Stage 2: `5037d24fa0545369a234fee6743788effe484c05`.
Stage 3 gate push `e7ff535`; Stage 4 gate push `0da04fb`.
Stage 5 local candidate đạt; CI Windows/Linux đang chạy, chưa tuyên bố Windows installer đạt.
Code checkpoint `aed55ccd58b23d83cc919cb3d41e3ead8f47ab1d` (shutdown IPC, hosted defaults,
startup/promotion fix); thay đổi hiện tại bổ sung license dependency vào installer và tài liệu thực tế.

- Core thật nối React/Electron: streaming, MCP stdio/HTTP/SSE, skills đã review, approvals/deny/cancel,
  sessions/recovery/mapping; giữ nguyên các engine mạnh của nền Apache.
- Voice có Web Audio/JFK fixture → WebSocket local → Core → transcript/audio, interruption/reconnect.
  Model, STT transcript và TTS tone trong E2E là fixture được ghi rõ. Chưa gọi provider tính phí.
- Marketplace catalog/backend, install/update/uninstall/status và migration; group hai Core agent và
  scheduler đã thực thi thật với model offline.
- Build Linux thực tế: AppImage + DEB, app ID/profile/protocol riêng, updater mặc định tắt, không dùng
  hosted account/Composio upstream. Package kèm 108 license dependency Core và notices nền/native.
- Kiểm thử local: compatibility 1000 pass/1 procfs skip; desktop security 124 pass/2 platform skip;
  patch LF/CRLF 2 pass; Core 87 pass ở Stage 4 (Core không đổi); shipping E2E 11/11, Voice 5/5.
- UI tour profile sạch dark/light 1440px: Chromium 37/37 mỗi skin; Electron 36 pass/Account skip mỗi skin.
  Advanced 1000px: 33 pass/4 skip mỗi surface. Không lỗi renderer. Tour cuối chạy lại sau sửa cleanup.
- Packaged server ngoài checkout: startup, 13 proxies, MCP/CLI, encrypted backup, shutdown/cache restart đạt.
  Packaged Core → MCP → approval → persisted reply và packaged Electron startup/auth/profile đạt.
  Strict typecheck Core/shell, renderer/server/launcher và production UI build đạt.
- Lifecycle đã sửa nguyên nhân Vite SIGTERM thoát sớm: một cleanup promise, IPC parent trên Windows;
  kiểm tra shutdown đạt code 0, backend dừng, khoảng 300 ms.

CI: run `38668030797` phát hiện CRLF Windows/thiếu pnpm Linux; đã sửa và thêm kiểm thử. Các run tiếp theo
đang xác minh Windows/Linux. Theo dõi latest HEAD trên GitHub Actions, lấy artifacts và ghi kết quả cuối.
Không đánh dấu job đang chạy là pass. Nếu không thể build OS trong runner local, giữ trạng thái CI thật.

Bằng chứng/log/screenshot/hash: `.aikingbot-foundation/evidence/shipping/`.
Installer: `.aikingbot-foundation/source/release/`. Manifest: `build-artifacts.json` trong evidence shipping.
Tiếp tục: chờ build/license và CI cuối, đóng gói evidence sạch, cập nhật matrix/HANDOFF, commit + push gate.
Các flow cần credentials/server, ký mã và kiểm thử thiết bị/OS thật nằm trong checklist Stage 5.
Không chạm production VPS/OpenBot/dữ liệu thật; không dùng code OpenBot PolyForm.
Mọi sửa lâu dài ở overrides/patches; source sinh `.aikingbot-foundation/source/`.

Tài liệu: [Stage 3](docs/stage-3-functional-integration.md), [Stage 4](docs/stage-4-product-completeness.md),
[Stage 5/lệnh triển khai/checklist](docs/stage-5-shipping-candidate.md),
[feature matrix](docs/shipping-feature-matrix.md).

## Stage 2 — UI/UX parity (nhánh `stage2/ui-parity`, 2026-10-14)

Ứng dụng chính là `apps/desktop-foundation/` (OpenMausBot OSS + overrides). Stage 2 đưa giao diện về tương đương
OpenBot 0.39 với thương hiệu AIKING. Chi tiết, bảng màn hình xong/còn thiếu, token đo được:
[`docs/stage-2-ui-parity.md`](docs/stage-2-ui-parity.md).

- Sửa ở `apps/desktop-foundation/overrides/` rồi chạy `node apps/desktop-foundation/setup.mjs --source-only`
  (hoặc chép overrides vào `.aikingbot-foundation/source/`). Không sửa source sinh ra làm bản lâu dài.
- Code mới: `overrides/src/aiking/` (theme, rail, marketplace, connectors, sliding tabs, logo, strings).
- `en.json` là file sinh bởi `apps/desktop-foundation/terminology.mjs` — sửa script, không sửa tay.
- Kiểm thử tương tác: `apps/desktop-foundation/ui-tour.mjs` (28 bước, browser + Electron/CDP), `verify.mjs` (Stage 1).
- OpenBot mới (PolyForm Noncommercial) chỉ được quan sát qua ảnh/đo đạc. Không copy code.
- Electron trên Linux: chạy bằng user thường (sandbox bật). Root bị Electron từ chối — không thêm `--no-sandbox`.

Stage 2 finalization: UI, Marketplace/install và Voice client đã triển khai. Voice có chọn micro/loa, Web Audio
PCM16 16 kHz/20 ms, VAD, barge-in, reconnect, pipeline STT/agent/TTS, loopback offline và WebSocket v1 theo
`overrides/src/aiking/voice/contract.ts`. Nút Voice trong composer mở màn gọi; gọi provider cũ vẫn có trong
"Existing provider call options". Loopback chỉ trả transcript/reply theo kịch bản và tone, không phải STT/AI thật.

Kiểm chứng: UI tour Chromium 37/37; Electron 36 pass + Account bỏ qua hợp lệ (user thường, sandbox bật,
profile offline mới). Voice E2E Chromium với `fixtures/voice/jfk-16k.wav`: 5/5; tương thích: 483/483 test;
Stage 1 verify: 12/12 mỗi surface; typecheck renderer + server: pass. Chi tiết và điều chỉnh fixture ở
[`docs/stage-2-finalization-verification.md`](docs/stage-2-finalization-verification.md).

Việc tiếp theo là Stage 3: Core voice server `/v1/voice/sessions`, STT/TTS thật, resolve model theo bot/thread,
approval gate và lưu transcript trên server. Giao thức v1 chưa có event approval/group routing; không dùng
giọng nói để tự phê duyệt tool. Remote/cloud computer, provider và connector thật vẫn chưa được xác minh.
Phần Core bên dưới (mục 0–9) là lịch sử v0.2.

## 0. Bối cảnh và luật làm việc (bắt buộc)

- Repo: `github.com/aikingcorp-spec/AIKINGX_Bot`, nhánh **`claude/aiking-core-rnd`** (nhánh orphan, độc lập
  với lịch sử OpenBot). Trên máy staging (`srv1866690`), nhánh này nằm ở **worktree riêng**
  `/srv/aikingbot-staging/aiking-core`. Checkout chính `/srv/aikingbot-staging/AIKINGX_Bot` đang ở nhánh
  `claude/aiking-alpha` — **không đụng**.
- **Không** chạm OpenBot production (`/opt/OpenBot`), các container aiki/hermes/openclaw, stack staging Signal/TURN
  trong `/srv/aikingbot-staging/deploy`, hay `/srv/aikingbot-staging/.secrets`.
- **Không** gọi API tính phí khi chưa được người dùng đồng ý (mọi test/demo chạy offline). **Không** tự mở
  session Claude phụ. **Không** overbuild: làm vertical slice trước.
- Code bên thứ ba: chỉ MIT/Apache-2.0 (hoặc permissive tương đương) và phải ghi vào `PROVENANCE.md`.
  **Không** copy code OpenBot sau v0.1.11 (PolyForm Noncommercial).
- Commit message kết thúc bằng dòng `Co-Authored-By:` như các commit trước.
- Push: deploy key của máy staging trước đây là read-only — xem mục 7.

## 1. Kiến trúc hiện tại

```
apps/shell (SolidJS + Vite)          UI: sidebar agent/threads, chat streaming, tool timeline,
                                      thẻ approval, tab Skills & MCP
        │  AG-UI 1.0 qua HTTP POST + SSE (@ag-ui/core types/schemas)
src/gateway/server.ts                 Bun.serve, chỉ bind 127.0.0.1
src/gateway/ag-ui-adapter.ts          RuntimeEvent → AG-UI events; approval = AG-UI interrupt/resume
src/gateway/agent-backend.ts          interface AgentBackend (điểm thay runtime) + CoreBackend
        │
src/core.ts                           createCore(): skills + MCP + capability index + runtime + chat
src/chat/chat-session.ts              ChatSession + TranscriptStore (JSONL hoặc SQLite)
src/runtime/agent-runtime.ts          vòng lặp tool use trung lập provider, giới hạn bước/tool call, chi phí
src/runtime/model.ts                  hợp đồng ModelClient trung lập (message, tool, usage, fallback, ModelError)
src/runtime/anthropic-model.ts        adapter Claude (Messages API, streaming, server-side refusal fallback)
src/runtime/fallback-model.ts         chuỗi fallback phía client (chỉ chuyển khi lỗi retryable)
src/runtime/cost.ts                   bảng giá Claude + CostTracker (model không có giá → "unpriced")
src/runtime/tools.ts                  ToolRegistry + PermissionGate (read/side_effect/dangerous), timeout, cap output
src/capabilities/                     CapabilityIndex (skill + MCP tool; tasks/inputs/outputs) + tool plan_capabilities
src/skills/                           SkillLibrary (SKILL.md + front matter capability) + tool read_skill
src/mcp/mcp-hub.ts                    MCP client; risk từ annotations; capability từ _meta["aiking/capability"]
src/store/sqlite-store.ts             SQLite (bun:sqlite): agents, threads, messages, runs; migration; backup
demo/                                 MCP server demo, skills demo, model offline, demo CLI
```

Hai điểm mở rộng chính:
- **Đổi/thêm model provider**: viết class `implements ModelClient` (xem README mục "Thêm provider mới").
- **Đổi runtime sau UI**: viết class `implements AgentBackend`; adapter AG-UI và UI không đổi.

## 2. Quyết định kỹ thuật (và lý do)

| Quyết định | Lý do |
| --- | --- |
| Giữ AIKING Core làm runtime, không thay bằng framework | Nhỏ, test tốt, đã có những gì cần; framework khác không thêm giá trị ở giai đoạn này |
| `ModelClient` trung lập, block riêng provider để `opaque` | Thêm provider không phải sửa runtime; thinking/fallback block của Claude vẫn round-trip |
| Fallback client chỉ khi lỗi retryable; auth/invalid_request dừng chain | Không che lỗi cấu hình bằng cách lặng lẽ đổi model |
| Chi phí: model không có trong bảng giá → `unpriced`, không đoán | Số sai còn tệ hơn không có số |
| MCP tool không có annotation = `dangerous` | Theo mặc định của spec MCP (destructiveHint mặc định true); operator ghi đè bằng `toolRisk` |
| `dangerous` bị từ chối không hỏi trừ khi nằm trong `allowDangerous` | Yêu cầu "không tự động cho phép công cụ nguy hiểm" |
| Capability planner theo đồ thị artifact (inputs/outputs), deliverable = đầu ra sâu nhất trong các match mạnh | Kết hợp được skill/tool không trùng keyword (ví dụ `frame_size` cho yêu cầu "TikTok ad") |
| UI: **Electron + SolidJS** (Option A), giao tiếp qua **AG-UI** | Giữ UX OpenBot (tái dụng hợp lệ CSS/tokens của OpenBot v0.1.11 Apache-2.0); AG-UI giữ đường cho client React sau này. Phân tích đầy đủ: `docs/v0.2-architecture.md` |
| Approval = AG-UI interrupt: run kết thúc `RUN_FINISHED{outcome:interrupt}`, client gửi run mới với `resume` | Đúng spec AG-UI 1.0; vòng lặp agent chờ trong bộ nhớ; hết hạn (mặc định 10 phút) = từ chối |
| Lưu lượt hội thoại chỉ khi run kết thúc | Không bao giờ có nửa lượt trong lịch sử; đổi lại: lượt đang chờ approval mất nếu restart (xem mục 5) |
| SQLite local + migration đánh số; app cũ từ chối DB mới hơn | Local-first, có backup/migration; Postgres chỉ khi cần multi-user |
| Không dùng CopilotKit runtime / Intelligence, OpenDots làm nền | Hội thoại phụ thuộc CopilotKit Intelligence (dịch vụ có licence) — trái nguyên tắc không phụ thuộc cloud trả phí |

## 3. Module đã hoàn thiện (có test)

| Module | Trạng thái |
| --- | --- |
| v0.1: Chat → Runtime → MCP stdio → Skill | Xong (commit `4956f16`) |
| v0.2a: ModelClient trung lập, Claude adapter, FallbackModel, CostTracker, PermissionGate + timeout + giới hạn, Capability discovery, demo media pipeline CLI | Xong (commit `99230f4`) |
| v0.2: streaming text trong ModelClient/runtime, per-run hooks (onEvent, approver) | Xong |
| v0.2: SQLite store (agents/threads/messages/runs, migration, backup, đánh dấu run bị gián đoạn) | Xong |
| v0.2: AgentBackend + CoreBackend, AG-UI adapter (interrupt/resume, pending interrupts), HTTP gateway | Xong |
| v0.2: Shell UI SolidJS (sidebar, streaming, tool timeline, approval, Skills & MCP, khôi phục thread) | Xong (prototype web) |
| Model offline cho UI (`demo/offline-producer.ts`) | Xong — chỉ là stand-in, không phải AI thật |

## 4. Kết quả kiểm chứng (2026-10-14, trên staging)

- `bun test`: **83 pass, 0 fail** (8 file: agent-runtime, capabilities, gateway, mcp-hub, model-providers,
  permissions, skills, vertical-slice).
- `bun run typecheck` (Core + shell): pass.
- `bun run demo` (CLI offline): completed, render job được ghi, `purge_renders` bị từ chối.
- UI kiểm tra thật bằng Chrome headless (Playwright, script ngoài repo): gửi ý tưởng → text stream → 7 tool
  call hiện trên timeline → thẻ approval → bấm Approve → "Render queued"; restart server → chọn thread ở
  sidebar → toàn bộ lịch sử hiện lại; không có lỗi console.
- Test gateway kiểm mọi event AG-UI phát ra bằng `EventSchemas` chính thức của `@ag-ui/core`.
- **Chưa kiểm chứng**: gọi Claude API thật (`--live`) cho cả CLI và app — adapter chỉ được test với client
  giả lập trả về đúng shape của SDK. Electron/Windows chưa build.

## 5. Vấn đề chưa giải quyết / hạn chế đã biết

1. **Approval đang chờ mất khi restart**: vòng lặp agent chờ trong RAM. Sau restart, `resume` nhận
   `RUN_ERROR interrupt_not_found`; lượt đó không được lưu (run ghi `interrupted`). Cần: lưu trạng thái run
   (messages tạm + pending tool call) vào SQLite để resume thật.
2. Quyết định approve/decline không lưu thành item riêng trong lịch sử (chỉ thấy qua kết quả tool).
3. Mỗi agent profile tạo một `Core` riêng → mỗi agent spawn một process MCP. Ổn với 2 agent; cần MCP hub
   dùng chung khi nhiều agent.
4. Chỉ có Claude adapter; chưa có OpenAI/Gemini/Codex.
5. Streaming chỉ cho text; tool args gửi trọn một lần (`TOOL_CALL_ARGS` một delta).
6. Chưa có prompt caching, chưa có compaction cho hội thoại dài.
7. UI: chưa render Markdown (brief hiển thị dạng text thô), chưa có chọn model/tài khoản, chưa quản lý
   (thêm/sửa) skill/MCP từ UI, chưa đổi tên/xóa thread.
8. Transcript JSONL của v0.1 không đọc được bởi v0.2 (định dạng message đổi sang trung lập).
9. `caniuse-lite` (CC-BY-4.0, dev dependency gián tiếp của Vite) cần người dùng duyệt theo chính sách license.
10. Commit trên máy staging chưa push được (xem mục 7).

## 6. Lệnh chạy

```bash
cd /srv/aikingbot-staging/aiking-core
bun install
bun test                 # 83 test, offline
bun run typecheck        # Core + shell
bun run demo             # demo CLI media pipeline (offline); --deny để thấy từ chối; --live tốn credits
bun run app              # build UI rồi chạy gateway + UI: http://127.0.0.1:4317 (offline demo model)
bun run app:dev          # chạy gateway với UI đã build sẵn
bun run app -- --live    # dùng Claude API (cần credentials, TỐN CREDITS — hỏi người dùng trước)
bunx vite --config apps/shell/vite.config.ts   # dev server UI :5173, proxy /api → :4317
```

Biến môi trường: `AIKING_DATA_DIR` (mặc định `.aiking/data`: `aiking.db` + `render-jobs/`), `AIKING_PORT`
(mặc định 4317). Gateway chỉ nghe 127.0.0.1; xem từ máy khác thì dùng SSH tunnel
(`ssh -L 4317:127.0.0.1:4317 <host>`), không mở port ra ngoài.

Thử nhanh: chọn "Media Producer", gửi "15-second TikTok ad for our matte black tumbler, queue it for render",
bấm Approve ở thẻ approval.

## 7. Git

- Commit: `4956f16` (v0.1) → `99230f4` (v0.2a) → commit v0.2 hybrid (xem `git log`).
- Remote `origin` = `git@github.com:aikingcorp-spec/AIKINGX_Bot.git`. Deploy key của máy staging trước đây
  chỉ có quyền đọc; nếu `git push -u origin claude/aiking-core-rnd` bị từ chối thì người dùng phải push
  (hoặc cấp key có quyền ghi). Kiểm tra `git status -sb` để biết commit nào chưa lên remote.

## 8. Nhiệm vụ tiếp theo (theo thứ tự đề xuất)

1. **Resume approval bền vững**: bảng `pending_runs` (messages tạm, tool call chờ, interrupt id, hạn); khi
   khởi động lại, resume chạy tiếp từ tool call đó. Lưu quyết định approval vào lịch sử.
2. **Electron wrapper** cho Windows: main process khởi động gateway (Bun binary hoặc chuyển gateway sang
   Node) và mở `BrowserWindow` tới 127.0.0.1; build trên CI Windows (máy staging không build được Windows).
3. UI: render Markdown (cần thư viện MIT, ví dụ `marked` + sanitize), chọn model/provider, đổi tên/xóa thread,
   trạng thái agent trên sidebar cho mọi agent (hiện chỉ agent đang chọn).
4. Provider thứ hai (OpenAI hoặc Gemini) qua `ModelClient`, dùng chung test shape như `test/model-providers.test.ts`.
5. MCP hub dùng chung giữa các agent; cấu hình MCP/skill theo agent; quản lý từ UI.
6. Background jobs: hàng đợi job trong SQLite (bảng `jobs`, worker trong process), resume sau restart.
7. Computer runtime (phase sau): đánh giá `agent-computer/` của CopilotKit OpenBot (MIT, Playwright) chạy như
   một MCP server/service riêng, tách khỏi remote desktop.
8. Prompt caching cho Claude adapter (system + tools ổn định), compaction cho hội thoại dài.

## 9. Tài liệu liên quan

- `README.md` — module, cách thêm provider, khai báo capability, quyền.
- `docs/v0.2-architecture.md` — báo cáo đối chiếu 5 nguồn, quyết định stack UI, ma trận yêu cầu.
- `PROVENANCE.md`, `docs/third-party-licenses.tsv` — nguồn gốc code và giấy phép dependency.
- Nghiên cứu (ngoài repo, chỉ trên staging): `/srv/aikingbot-staging/research/` (clone của 5 repo + bản giải nén
  OpenBot v0.1.11).
