# AIKINGBOT — Zalo / Chatwoot migration
Cập nhật: 19/10/2026, 16:59 Việt Nam.

**Stack độc lập đã chạy trên AIKINGBOT. Chưa đánh dấu toàn bộ migration hoàn tất: Zalo của Lisa (account 1) đã hết phiên trước migration và cần chủ tài khoản quét QR/xác nhận lại. Aimie đã có phản hồi Agent và xác nhận tin đi từ Zalo trên cuộc chat nội bộ.**

## Thành phần đã chuyển

Thư mục quản lý: `/srv/aikingbot-staging/integrations/zalo-chatwoot`.

- Service mới: `aikingbot-zalo.service`, enabled, active.
- Service tích hợp cũ `aiking-zalo.service`: stopped/disabled. Không dừng ứng dụng OpenBot.
- Chatwoot: `runtime/chatwoot`, giữ PostgreSQL, Redis, storage, tài khoản và dữ liệu.
- Zalo Bridge: `runtime/zca-bridge`, giữ database, khóa giải mã credentials và phiên đăng nhập.
- Cổng giữ nguyên: Chatwoot 3010; Zalo Bridge 4000; Lisa 3025; Aimie 3026.
- HOME và AppArmor profile riêng cho service. Không còn dùng profile/thư mục OpenBot làm trung gian chạy stack.
- Agent Lisa: `1fc1c1f2-a58d-4e96-9962-34fb8186f5fa`.
- Agent Aimie: `769f59b1-30bb-435f-8cdd-36351fa1a3fa`.
- Tạo hai session AIKINGBOT riêng bằng Owner session hợp lệ và API pairing chính thức, scope client, không admin. Không sửa database xác thực hoặc tắt authentication.
- Source lưu local tại chính thư mục tích hợp, branch `migration/aikingbot-zalo-20261019`, HEAD `edf3dbe`. Không push, CI hay ship release.

Luồng đang chạy:
**Zalo ↔ Zalo Bridge ↔ Chatwoot ↔ service queue ↔ AIKINGBOT Lisa/Aimie**.

Code daemon không import OpenBot client, không gọi OpenBot API/provider, không dùng token OpenBot. Các script/helper và Gemini fast-route cũ được lưu riêng trong checkpoint, không nằm trong entrypoint đang chạy. Dấu dữ liệu tương thích như `aimie_openbot_bridge` được giữ để chống gửi trùng khi rollback; đây không phải một dependency API.

## Giao nhận và quyền

- Queue SQLite bền vững riêng cho từng Agent; xác minh conversation thuộc đúng inbox trước xử lý và trước gửi.
- Đọc message thật từ Chatwoot; không tin ID, nội dung hoặc danh tính do webhook tự khai.
- Xác minh Zalo UID từ mapping, giữ danh mục danh tính đã có; không nâng quyền theo tên hiển thị.
- Tạo task mới ở chế độ Ask cho từng delivery; giữ nguyên các cuộc chat/thiết lập Full hiện có.
- Service tự lấy final reply có correlation ID, tự ghi về Chatwoot. Agent không phải tự nhớ gọi helper.
- Chỉ đọc lịch sử cùng conversation, loại private notes khỏi prompt khách.
- Tool permission từ luồng khách được từ chối qua API chính thức; không tự Allow hoặc cấp quyền truy cập hội thoại khác.
- Ca cần chủ quản duyệt chỉ gửi câu ghi nhận và private review note, không gửi quyết định/cam kết.
- Giữ thứ tự trong từng conversation; khóa một worker mỗi Agent, chống consumer chạy trùng.
- sendId/correlation cố định; lưu receipt cho side effect Chatwoot/Zalo. Gửi không chắc chắn được đối soát/đưa review, không phát lại mù.
- Sửa việc mất tin khi chưa có Zalo session: giữ job retry thay vì coi là done.
- Giữ dedupe của message mapping cũ khi startup/backfill.
- Nhóm: @mention, quoted reply và followup 60 giây theo UID thật; lọc self echo và hai danh tính bot tự trả lời lặp.
- Ảnh/tệp đi qua attachment API chính thức; tối đa 10 attachment, mỗi tệp tối đa 10 MiB.
- Từ chối nhận/xử lý mới khi host còn dưới 3 GiB trống.
- Các control route typing/reaction/undo của Zalo Bridge dùng quyền accounts.write có sẵn; không đổi authentication toàn VPS.

## Bằng chứng kiểm thử

| Hạng mục | Kết quả |
| --- | --- |
| Pairing AIKINGBOT | Hai session client-only hợp lệ; không dùng credential OpenBot |
| Agent thật Lisa/Aimie | Đều nhận và trả đúng marker trong phép thử nội bộ trực tiếp |
| Chatwoot thật → Agent thật → Chatwoot | Đạt cho cả hai Agent; replay cùng webhook không tạo thêm phản hồi |
| Ảnh và tệp | PNG và text file được lưu trong đúng task Agent, có phản hồi Chatwoot; inbox thử tách biệt Zalo khách |
| Queue / routing / group / policy | 17 Python tests đạt |
| ZCA inbound/outbound/worker/session | 58 tests, 6 files đạt; TypeScript build đạt |
| Receipt PostgreSQL thật | Gửi thành công/restart dùng lại receipt; timeout hoặc mất commit sau remote success không gửi lại trùng |
| Khởi động toàn bộ bridge | Đạt với database restore tạm đã xóa tài khoản Zalo/jobs; health, admin assets và từ chối control route chưa xác thực |
| Restart service thật | Queue trước/sau giữ nguyên số lượng và digest; service lên đủ |
| Backup restore | Cả hai archive PostgreSQL được restore vào database tạm, xác minh rồi dọn |

Phép thử trên tuyến Aimie đang chạy, **chỉ tại conversation nội bộ của sếp đã xác minh, không phải khách hàng**:

- Incoming mock nội bộ Chatwoot: `2976`, conversation `8`.
- Task AIKINGBOT: `88094190-4550-4602-9a75-6f89dc5c6c50`.
- Outgoing Chatwoot: `2977`, câu trả lời FAQ 217 ký tự, không phải câu ghi nhận chung.
- Zalo trả receipt thực và lưu mapping outgoing; fingerprint `f68c7d6923281aa37d520b609a00109b`.
- Không coi HTTP 200/202 là bằng chứng Agent đã xử lý xong.
- Đây là inbound mock được cho phép trong chat nội bộ và outbound Zalo thật; chưa tuyên bố quan sát tin hiển thị hoặc inbound từ điện thoại thật.

Một phép thử marker trên cấu hình production đã kích hoạt tìm hội thoại khác và yêu cầu duyệt. Quyền đó bị từ chối; Agent chọn câu ghi nhận chờ duyệt. Bằng chứng marker không đạt vẫn được giữ, không đổi thành “pass”. Phép thử FAQ riêng sau đó đã đạt với receipt Zalo thật.

Inbox/contact thử độc lập đã được dọn, chỉ xóa ID test do lượt này tạo. Demo nội bộ thật và evidence được giữ.

## Dữ liệu và dịch vụ khác

Đối chiếu snapshot trước migration với hiện tại:

- **2.954 message gốc:** số hàng và digest của nội dung/danh tính giữ nguyên.
- **23 contact gốc:** danh tính, email, số điện thoại và digest giữ nguyên.
- **428 blob gốc:** metadata/checksum giữ nguyên; đủ 428 file vật lý, không thiếu.
- Rootfs/data được đổi vị trí trên cùng filesystem, giữ nguyên inode thư mục; không nhân bản rootfs hoặc image lớn.
- Cả hai bản ghi session Zalo được giữ. Snapshot trước migration chứng minh account 1 đã expired; account 2 connected.
- 13 container khác giữ nguyên image, PID và StartedAt. OpenBot native vẫn chạy từ trước; Signal/TURN/Traefik/AIKINGBOT app không bị restart bởi migration.
- 23 trạng thái queued cũ từ trước 17/10 (Lisa 9, Aimie 14) được giữ trong queue review riêng, không phát lại.
- 10 job ZCA lỗi cũ vẫn giữ nguyên để đối soát; không mass retry.

Dung lượng cuối: khoảng **8,76 GiB trống**, ổ đĩa khoảng **95,4%** sử dụng. Không xóa release, backup quan trọng hoặc dữ liệu dịch vụ khác. Migration không thiết lập hệ thống backup định kỳ hay dọn toàn VPS; mức trống hiện tại vẫn cần theo dõi.

## Checkpoint và rollback

- PostgreSQL: custom pg_dump nhất quán giao dịch + roles, không copy PGDATA đang chạy.
- Redis: SAVE snapshot hợp lệ tại thời điểm đã quiesce ingress/worker.
- Checkpoint cutover đang dùng:
  `checkpoints/cutover-20261019T093602Z`.
- DB checkpoint tương ứng:
  `checkpoints/db-20261019T093605Z`.
- Env, wrapper, source và code cũ được giữ private để rollback.
- Hai lần health gate không đạt đã rollback thật thành công; sửa wrapper gắn cứng đường dẫn và asset SQL/admin bị thiếu trước lần chuyển cuối.
- Lượt chuyển thành công mất khoảng 12,3 giây. Đây không phải tổng gián đoạn: hai lượt thử trước đã rollback sau khoảng hai phút mỗi lượt.

Rollback, chạy root tại thư mục tích hợp:

```bash
python3 rollback.py /srv/aikingbot-staging/integrations/zalo-chatwoot/checkpoints/cutover-20261019T093602Z
```

Script chỉ dừng tích hợp mới, trả code/config/đường dẫn về stack cũ và giữ **dữ liệu hiện tại**. Không restore một database khách hàng cũ. Không chạy riêng service cũ khi dữ liệu chưa được trả về bằng rollback.

## Việc còn lại

1. Chủ tài khoản quét QR chính thức bằng **đúng tài khoản Zalo Lisa** và xác nhận đăng nhập. Đây là bước xác thực trên điện thoại; công cụ không thể tự thực hiện hoặc bỏ qua.
2. Khi Lisa connected, kiểm tra một conversation nội bộ của account 1 để có receipt Zalo thực, rồi gửi/nhận thử từ điện thoại nếu cần qualification vật lý.
3. Rà soát 23 event và 10 job lỗi lịch sử theo từng ID; không tự gửi lại khi chưa đối soát.
4. Client token hiện có scope workspace; bridge ép ràng buộc Agent/inbox và Ask. Linux UID cadu được giữ cho các runtime trích xuất. Chưa có sandbox OS/per-Agent UID hoặc token ACL từng bot; thay đổi đó cần thiết kế riêng, không được giả định là đã làm.

**Kết luận trạng thái: stack AIKINGBOT đã vận hành độc lập, dữ liệu đã xác minh bảo toàn, Aimie có outbound receipt thật; toàn bộ migration còn chờ xác thực Zalo Lisa và nghiệm thu kênh đó.**

Bằng chứng chi tiết nằm trong `evidence/`, đặc biệt:
`data-preservation.json`, `live-internal-faq.json`, `real-chatwoot-agent-pipeline.json`,
`backup-restore.json`, `service-restart.json`, `other-services-after.json`,
`pre-migration-zalo-status.json`, `legacy-review-import.json`, `final-preflight.json`.
