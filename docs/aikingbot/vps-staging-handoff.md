# AIKINGBOT — Bàn giao VPS staging, website, downloads, updater

Cập nhật: 2026-10-15 ~05:20 UTC. VPS `srv1866690` (72.62.255.70, Ubuntu 24.04, 4 vCPU, 15 GB RAM, ~47 GB trống).
Không chứa secret. Phiên làm việc dừng sớm theo yêu cầu (tiết kiệm token) — mục "Việc tiếp theo" là thứ tự đề xuất.

## Kiểm tra tiếp nối 2026-10-15

Tài liệu bên dưới giữ lịch sử triển khai ban đầu. Hiện `/downloads/release.json` đã được publish cho **rc.1**, CI run
`38678359992`, commit `8b98a366a099fbfed71ba23208d6e2c64c271149`. File EXE thực tế: 251959193 bytes, SHA-256
`c3bd03ecbd32d2dfd2569a6c741c735086eb9ea306396856e160a1196f885ff9`; đã đối chiếu với manifest và HTTP Range trả 206.
Đây không phải hash của artifact run 17. `/api/health` staging trả 200 và request pairing công khai chưa đăng nhập vẫn trả 403.
Chưa thay installer/feed hay triển khai production trong phiên tiếp nối.

Source tiếp nối giữ nguyên 8 commit Claude, bắt đầu tại `e1f445b`; provider continuation đầu tiên là `d824c2e`.
Xem [provider onboarding verification](provider-onboarding-verification.md) và [capability parity matrix](capability-parity-matrix.md)
để biết các gate mới. Runtime/dependency download thật đã được kiểm tra riêng; live OAuth/model reply và Windows vật lý vẫn cần nghiệm thu.

## 1. Đang chạy (đã kiểm chứng qua domain công khai)

| Thành phần | URL / vị trí | Trạng thái |
| --- | --- | --- |
| Website VI (mặc định) / EN | https://aikingbot.srv1866690.hstgr.cloud/ · `/en/` · `/docs/` · `/en/docs/` | 200, Let's Encrypt, hreflang/canonical/OG/sitemap |
| Web app + pairing | https://aikingbot-app.srv1866690.hstgr.cloud/ · `/pair` | 200, health OK, API từ xa 403 khi chưa ghép nối |
| Lối tắt | `https://aikingbot.…/app` → web app, `/pair` → trang ghép nối | 302 |
| Downloads | `https://aikingbot.…/downloads/` | Hạ tầng sẵn sàng, **chưa có installer** (404 cho đến khi publish) |
| Update feed Windows | `https://aikingbot.…/updates/windows/latest.yml` | Hạ tầng sẵn sàng, chưa có release |

DNS: wildcard `*.srv1866690.hstgr.cloud` đã trỏ về VPS (A + AAAA) nên không cần chỉnh DNS. Chuyển sang
`aikingbot.aikingx.com` sau: thêm bản ghi tại PA Vietnam rồi đổi host trong 2 file env bên dưới.

Định tuyến: Traefik có sẵn (`/docker/traefik`, host network, ACME HTTP-01) nhận route qua **docker labels** của
container mới; không sửa file nào của Traefik hay dịch vụ khác. Trước/sau triển khai, `aikingx.com`,
`api.aikingx.com`, `forge.*`, `hermes-*` trả cùng status code (baseline: `/srv/aikingbot-staging/backups/baseline-20261015/`).
OpenBot production (`/opt/OpenBot`), Signal/TURN staging (`/srv/aikingbot-staging/deploy`, project `aikingbot-staging`) không bị chạm.

## 2. Bố trí trên VPS

```
/srv/aikingbot-staging/
  aikingbot-main/                 worktree nhánh AIKINGBOT (commit bàn giao này)
  server/
    aikingbot.env                 env server (600) — COMPOSE_PROJECT_NAME=aikingbot-app-staging, COMPOSE_FILE=compose.yaml:compose.traefik.yaml
    releases/0.3.0-rc.1-837918b/  bundle server đã giải nén (SHA-256 5c2965322c09d62c8f78da3fb8dcacfc3bb679c7bf4e2880084080089126d52c)
    current -> releases/…         symlink bản đang chạy
  server-data/                    dữ liệu server (uid 10001, 700)
  web/                            gốc web: site/{builds,current}, downloads/, updates/windows/
  web-deploy/                     compose + Caddyfile + web.env cho website (project aikingbot-web-staging)
  .secrets/browser-admin-state.json   phiên trình duyệt admin đã ghép nối (600) — xóa khi không cần
```

Container: `aikingbot-app-staging-{aikingbot,edge}` (edge Caddy giữ netns, publish 127.0.0.1:18080),
`aikingbot-web-staging-web-1` (Caddy tĩnh, read-only, 127.0.0.1:18090). Restart `unless-stopped`, log json-file xoay vòng,
healthcheck cả hai. Image server `aikingbot-server:0.3.0-rc.1-837918b` (có agent browser).

Lệnh thường dùng:

```sh
cd /srv/aikingbot-staging/server/current/deploy
docker compose --env-file aikingbot.env ps                       # COMPOSE_FILE nằm trong env
docker compose --env-file aikingbot.env logs -f aikingbot
docker compose --env-file aikingbot.env restart aikingbot        # in mã ghép nối admin mới vào log
docker compose --env-file aikingbot.env logs aikingbot | grep -A3 'pairing code'
cd /srv/aikingbot-staging/web-deploy && docker compose --env-file web.env ps
bash /srv/aikingbot-staging/aikingbot-main/deploy/aikingbot-web/scripts/publish-site.sh /srv/aikingbot-staging/aikingbot-main /srv/aikingbot-staging/web
```

Ghép nối: `OMB_LOOPBACK_TRUST=service` nên lệnh `pair` trong container bị từ chối (đúng thiết kế). Mã admin chỉ in khi app
khởi động (dùng 1 lần, 5 phút). Thiết bị tiếp theo: từ thiết bị admin → Settings → Remote access.

## 3. Đã thêm vào repo (commit này)

- `apps/website/` — website tĩnh song ngữ, không dependency: `i18n/vi.json`, `i18n/en.json` (build **fail nếu lệch key**),
  `site.config.json` (origin, appUrl, danh sách locale — thêm ngôn ngữ = thêm JSON + 1 dòng), `render.mjs`, `build.mjs`
  (asset fingerprint, sitemap có hreflang, robots, 404 theo locale), `assets/` (Inter OFL có subset tiếng Việt, logo AIKING,
  OG 1200×630, 2 ảnh chụp thật từ staging: chat, Marketplace). Thông tin phát hành đọc từ `/downloads/release.json`
  lúc build **và** lúc chạy trên trình duyệt → publish release không cần build lại site.
- `deploy/aikingbot-web/` — `compose.yaml` (Caddy + Traefik labels), `Caddyfile` (Range/resumable, Content-Length,
  MIME .exe/.zip/.deb/.AppImage/.yml, cache: file theo version `immutable`, `release.json`/`latest.yml` `no-cache`,
  CSP/HSTS, không nén file nhị phân), `scripts/publish-release.mjs` (xác minh SHA-256 bắt buộc, staging rồi rename
  atomic, sinh `latest.yml` sha512 cho electron-updater, hard link vào `updates/windows/`, `rollback`, `status`, giữ 3 bản),
  `scripts/publish-site.sh` (build vào `site/builds/<id>`, đổi symlink atomic, giữ 5 bản).
- `deploy/aikingbot-server/compose.traefik.yaml` — overlay route hostname qua Traefik có sẵn.

## 4. Việc tiếp theo (theo thứ tự)

1. **Quyền GitHub** (blocker): máy VPS chỉ có deploy key read-only, repo private ⇒ không push, không tải artifact CI.
   Cần một trong: thêm lại `~/.ssh/aikingbot_ro.pub` làm deploy key **có quyền ghi**, hoặc fine-grained PAT
   (Contents RW + Actions Read) đặt ở `/srv/aikingbot-staging/.secrets/github.token`.
2. **Phát hành installer lên VPS**: artifact run `38678359992` hết hạn **2026-10-29**. Tải `installers-windows`, tạo
   SHA256SUMS từ bảng SHA trong HANDOFF.md, rồi:
   `node deploy/aikingbot-web/scripts/publish-release.mjs publish /srv/aikingbot-staging/web <thư-mục-file> --sums SHA256SUMS --commit 8b98a366a099fbfed71ba23208d6e2c64c271149 --ci-run 38678359992`
   Kiểm tra: `curl -I -r 0-99 https://aikingbot.…/downloads/0.3.0-rc.1/AIKINGBOT-0.3.0-rc.1-setup.exe` (206 + Content-Range).
3. **Feed cập nhật mặc định trong app** (chưa làm): hiện `electron/updater.mjs` (patch trong
   `apps/desktop-foundation/shipping-patches.mjs`) chỉ bật khi có biến môi trường `AIKING_UPDATE_FEED`. Đề xuất: đọc thêm feed
   mặc định nhúng lúc build (ví dụ `aiking/update-feed.json` sinh từ biến CI `AIKING_DEFAULT_UPDATE_FEED`,
   mặc định `https://aikingbot.srv1866690.hstgr.cloud/updates/windows/`), `AIKING_UPDATE_FEED=off` để tắt; sửa test
   `overrides/electron/aiking-updater.test.mjs`; bump version `0.3.0-rc.2` trong `shipping-patches.mjs`.
   Upstream đã có sẵn coordinator (tự kiểm tra sau 15 s và mỗi giờ, tải nền, tiến trình, nút Restart, Settings → Check).
   NSIS `oneClick`, per-user ⇒ cài lặng không cần admin. electron-builder đang `publish = null` nên không sinh
   `latest.yml`/blockmap — `publish-release.mjs` tự sinh `latest.yml` (không có blockmap ⇒ tải đầy đủ, vẫn đúng).
   rc.1 không có feed ⇒ người dùng cài đè rc.2 một lần; từ rc.2 trở đi tự cập nhật.
4. **Code signing**: installer chưa ký. electron-updater chỉ kiểm chữ ký khi cấu hình `publisherName`; không đặt ⇒ cập nhật
   chưa ký vẫn chạy (xác thực bằng sha512 trong `latest.yml` qua HTTPS). SmartScreen cảnh báo ở lần tải/cài đầu tiên.
   Hướng giải quyết: chứng chỉ OV/EV hoặc Azure Trusted Signing, ký trong CI, sau đó đặt `publisherName`.
5. **CI → VPS tự động**: workflow `publish-vps.yml` (workflow_dispatch + environment cần duyệt) tải artifact của run xanh,
   tạo SHA256SUMS, `rsync` lên `/srv/aikingbot-staging/incoming/<run>` bằng key SSH riêng (public key thêm vào
   `~aiking-deploy/.ssh/authorized_keys` với `command=` giới hạn), rồi gọi `publish-release.mjs publish … --sums` (xác minh
   hash phía VPS, rename atomic). Cần secret `VPS_SSH_KEY`, `VPS_HOST`.
6. **Kiểm thử còn lại** (bỏ qua để tiết kiệm token): gửi việc tới agent có phản hồi (cần API key — xem dưới), gỡ skill
   Marketplace, Voice (cần STT/TTS), backup/restore server, restart server với app Windows đã ghép nối, nâng cấp rc.2→rc.3
   trên Windows thật. Checklist Windows: tải từ `/downloads/`, so SHA-256, cài (SmartScreen → Run anyway), mở app, ghép nối
   với web app (Settings → Remote access), cài/gỡ 1 skill, restart server rồi kiểm tra app tự kết nối lại, chờ banner update.
7. Backup dữ liệu server: thư mục data thuộc uid 10001 ⇒ chạy `backup.sh` qua container hoặc thêm cron bằng
   `docker run --rm -v /srv/aikingbot-staging/server-data:/d …`; chưa lên lịch.

## 5. Kết quả kiểm thử đã chạy

- Server bundle build trên VPS từ `837918b` (sạch), `server-smoke.mjs` **15/15 pass**.
- Docker stack healthy; HTTPS Let's Encrypt cho cả 2 hostname; HSTS; remote API 403 khi chưa ghép nối.
- Ghép nối trình duyệt admin qua `/pair#code=…` thành công; phiên giữ được qua restart container.
- Marketplace: danh sách Agents/Apps/Skills hiển thị; **cài skill "TikTok hook writer" cho agent Basil → trạng thái
  Added/On**. Kiểm tra sau reload và gỡ skill chưa hoàn tất (dừng theo yêu cầu).
- Website: `/`, `/en/`, `/docs/`, `/en/docs/`, sitemap 200; 404 theo locale; không lỗi JS (chỉ 404 `release.json` khi chưa publish).
- Model cục bộ (Ollama qwen2.5:1.5b) đã thử rồi **gỡ hoàn toàn**: prompt agent ~14.7k token, CPU prefill quá chậm
  (timeout 180 s). Không dùng model CPU trên VPS này.

## 6. Vấn đề phát hiện (chưa sửa)

- CLI trong server vẫn tên `openmausbot` (log: "another device later: openmausbot pair"), `/api/health` trả
  `{"app":"openmausbot"}`, trang pair hiện "Version unknown on linux" — thiếu branding/version trong bundle server.
- Credentials cần anh cung cấp: API key (Anthropic cho AIKING Core, hoặc OpenAI/OpenRouter/xAI) để agent trả lời thật;
  STT/TTS cho Voice; chứng chỉ ký Windows; GitHub write/PAT.
