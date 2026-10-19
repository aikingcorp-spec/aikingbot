const $ = (id) => document.getElementById(id);
const show = (id, on) => { const e = $(id); if (e) e.classList.toggle("hidden", !on); };
const msg = (id, text, ok) => {
  const e = $(id);
  if (!e) return;
  e.textContent = text;
  e.className = "message " + (ok ? "ok" : "err");
};
const state = {
  accounts: [],
  proxies: [],
  recentLogIssues: [],
  settingsLoaded: false,
  webhooksLoaded: false,
  activeTab: "accounts",
};
let lastLogs = [];
const LOGS_PAGE = 10;
let logsShown = LOGS_PAGE;
let drawerToken = 0;

function setBusy(buttonSelector, busy) {
  const btn = document.querySelector(buttonSelector);
  if (!btn) return;
  btn.disabled = busy;
  btn.classList.toggle("is-busy", busy);
}

function setTab(name) {
  state.activeTab = name;
  for (const tab of ["accounts", "logs", "settings", "proxies"]) {
    const panel = $("tab_" + tab);
    const button = $("tab_" + tab + "_btn");
    if (panel) panel.classList.toggle("active", tab === name);
    if (button) button.classList.toggle("active", tab === name);
  }
  if (name === "logs") loadLogs();
  if (name === "settings") {
    loadSettings();
    loadWebhooks();
  }
  if (name === "proxies") loadProxies();
}

window.setTab = setTab;

async function api(path, opts = {}) {
  // Only declare a JSON body when one is actually sent. A body-less request (e.g. DELETE)
  // with Content-Type: application/json makes Fastify reject it with 400 (empty JSON body).
  const headers = { ...(opts.body ? { "Content-Type": "application/json" } : {}), ...(opts.headers || {}) };
  const res = await fetch(path, { ...opts, headers });
  let body = null;
  try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body };
}

async function boot() {
  const { body } = await api("/admin/api/auth-status");
  if (body && body.needsSetup) { show("setupView", true); return; }
  if (body && body.authed) { showDash(); return; }
  show("loginView", true);
}

async function doSetup() {
  const username = $("su_user").value.trim();
  const password = $("su_pass").value;
  const { status, body } = await api("/admin/api/setup", { method: "POST", body: JSON.stringify({ username, password }) });
  if (status === 200) { show("setupView", false); showDash(); }
  else msg("setupMsg", (body && body.error) === "weak" ? "Mật khẩu cần ≥ 8 ký tự." : "Không tạo được admin.", false);
}

async function doLogin() {
  const username = $("li_user").value.trim();
  const password = $("li_pass").value;
  const { status, body } = await api("/admin/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
  if (status === 200) { show("loginView", false); showDash(); }
  else msg("loginMsg", (body && body.error) || "Đăng nhập thất bại.", false);
}

async function logout() {
  await api("/admin/api/logout", { method: "POST" });
  location.reload();
}

async function checkChatwootToken() {
  const el = $("chatwootTokenBanner");
  if (!el) return;
  const { status, body } = await api("/admin/api/chatwoot/status");
  const configured = status === 200 && body && body.tokenConfigured === true;
  if (configured) { el.classList.add("hidden"); el.innerHTML = ""; return; }
  el.innerHTML = '<span>⚠️ Chưa cấu hình Chatwoot API token — note/reaction/self-capture & cảnh báo lỗi sẽ không hoạt động.</span>' +
    '<button class="button" type="button" onclick="setTab(\'settings\')">Vào Cấu hình</button>';
  el.classList.remove("hidden");
}

function showDash() {
  show("dash", true);
  show("logoutBtn", true);
  show("sessionState", true);
  loadProxies();
  setTab("accounts");
  loadAccounts();
  loadLogs({ quiet: true });
  checkChatwootToken();
}

async function loadWebhooks() {
  const { status, body } = await api("/admin/api/webhooks");
  if (status !== 200 || !body) return;
  $("wh_chatwoot").value = body.chatwoot || "";
  $("wh_oa").value = body.oa || "";
  state.webhooksLoaded = true;
}

async function copyWebhook(id) {
  const el = $(id);
  try { await navigator.clipboard.writeText(el.value); msg("whMsg", "Đã copy.", true); }
  catch { el.select(); msg("whMsg", "Nhấn Ctrl/Cmd+C để copy.", false); }
}

async function loadSettings() {
  const { body } = await api("/admin/api/settings");
  if (!body) return;
  for (const key of ["chatwoot_base_url", "chatwoot_account_id", "zalo_oa_app_id", "zalo_oa_oauth_redirect", "alert_telegram_enabled", "alert_telegram_chat_id", "alert_webhook_enabled", "alert_webhook_url", "alert_reconnecting_threshold_sec", "alert_cooldown_sec"]) {
    $("cfg_" + key).value = typeof body[key] === "string" ? body[key] : "";
  }
  for (const key of ["chatwoot_api_access_token", "zalo_oa_app_secret", "zalo_oa_secret_key", "alert_telegram_bot_token"]) {
    const set = body[key] && body[key].set;
    $("cfg_" + key).placeholder = set ? "•••••• (đang đặt — để trống nếu giữ nguyên)" : "(chưa đặt)";
  }
  state.settingsLoaded = true;
}

async function saveSettings() {
  const payload = {};
  for (const key of ["chatwoot_base_url", "chatwoot_account_id", "chatwoot_api_access_token", "zalo_oa_app_id", "zalo_oa_app_secret", "zalo_oa_secret_key", "zalo_oa_oauth_redirect", "alert_telegram_enabled", "alert_telegram_bot_token", "alert_telegram_chat_id", "alert_webhook_enabled", "alert_webhook_url", "alert_reconnecting_threshold_sec", "alert_cooldown_sec"]) {
    payload[key] = $("cfg_" + key).value;
  }
  const { status } = await api("/admin/api/settings", { method: "POST", body: JSON.stringify(payload) });
  if (status !== 200) { msg("cfgMsg", "Lưu thất bại.", false); return; }
  msg("cfgMsg", "Đã lưu. Đang khởi động lại...", true);
  pollHealth();
}

async function testChatwootConnection() {
  const m = $("cwTestMsg");
  if (m) { m.textContent = "Đang kiểm tra..."; m.className = "message"; }
  const { status, body } = await api("/admin/api/chatwoot/accounts");
  if (!m) return;
  if (status === 200 && Array.isArray(body)) {
    m.textContent = "Kết nối OK — token hợp lệ.";
    m.className = "message ok";
  } else {
    m.textContent = "Không kết nối được. Kiểm tra Base URL + API token. Lưu config rồi thử lại.";
    m.className = "message err";
  }
}
window.testChatwootConnection = testChatwootConnection;

function openDrawer(title, bodyHtml, actionsHtml = "") {
  drawerToken += 1;
  $("drawer").innerHTML = `<div class="drawer-header">
    <div><h3>${escapeHtml(title)}</h3></div>
    <button class="button button-secondary" type="button" onclick="closeDrawer()">Đóng</button>
  </div>${bodyHtml}${actionsHtml ? `<div class="drawer-actions">${actionsHtml}</div>` : ""}`;
  show("drawerBackdrop", true);
  show("drawer", true);
  return drawerToken;
}

function closeDrawer() {
  drawerToken += 1;
  $("drawer").innerHTML = "";
  show("drawerBackdrop", false);
  show("drawer", false);
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("drawer").classList.contains("hidden")) {
    closeDrawer();
  }
});

function isActiveDrawer(token) {
  return token === drawerToken;
}

function isQrImageDataUrl(value) {
  return typeof value === "string" && /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function proxySelectOptions() {
  const none = '<option value="">Không dùng proxy</option>';
  const opts = state.proxies.map((p) =>
    `<option value="${Number(p.id)}">${escapeHtml(p.label)} (${escapeHtml(p.protocol)})</option>`
  ).join("");
  return none + opts;
}

function openAddAccountPanel() {
  openDrawer("Thêm tài khoản", `
    <label for="newType">Loại tài khoản</label>
    <select id="newType">
      <option value="personal">Cá nhân (QR)</option>
      <option value="oa">Official Account</option>
    </select>
    <label for="newLabel">Nhãn</label>
    <input id="newLabel" placeholder="Ví dụ: Sales OA" />
    <label for="newProxy">Proxy</label>
    <select id="newProxy">${proxySelectOptions()}</select>
    <div id="addInboxFields">
      <label for="newChatwootAccountId">Chatwoot Account ID</label>
      <input id="newChatwootAccountId" type="number" inputmode="numeric" min="1" step="1" placeholder="vd: 1 — số trong URL /app/accounts/…/" />
      <label for="newInboxIdent">Inbox identifier</label>
      <input id="newInboxIdent" placeholder="inbox_identifier từ Chatwoot" />
      <label for="newInboxId">Inbox ID</label>
      <input id="newInboxId" placeholder="Số nguyên dương (từ URL inbox)" />
      <details class="muted" style="margin-top:8px">
        <summary>Cách tạo inbox trong Chatwoot</summary>
        <p>1. Vào đúng Chatwoot account muốn nhận tin → Settings → Inboxes → Add Inbox → chọn <strong>API</strong>.</p>
        <p>2. Ở ô <strong>Webhook URL</strong> dán giá trị "Chatwoot inbox webhook" (tab Cấu hình). Bắt buộc — thiếu thì agent trả lời sẽ không về được Zalo.</p>
        <p>3. Tạo xong, mở inbox → lấy <code>inbox_identifier</code> và Inbox ID (số trong URL) điền vào đây.</p>
      </details>
    </div>
    <div id="addMsg" class="message"></div>
  `, `<button class="button button-secondary" type="button" onclick="closeDrawer()">Hủy</button>
      <button id="saveNewAccountBtn" class="button button-primary" type="button" onclick="createAccount()">Thêm</button>`);
}

window.closeDrawer = closeDrawer;
window.openAddAccountPanel = openAddAccountPanel;

function parseOptionalPositiveInt(value) {
  if (value === "") return null;
  if (!/^[1-9]\d*$/.test(value)) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

async function pollHealth() {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try { const r = await fetch("/healthz", { cache: "no-store" }); if (r.ok) { location.reload(); return; } } catch { /* down */ }
  }
  msg("cfgMsg", "Bridge chưa sống lại — kiểm tra container.", false);
}

async function loadAccounts() {
  const box = $("accounts");
  box.innerHTML = '<div class="empty-state">Đang tải tài khoản...</div>';
  const { status, body } = await api("/admin/api/accounts");
  if (status !== 200 || !Array.isArray(body)) {
    box.innerHTML = '<div class="empty-state error">Không tải được tài khoản.</div>';
    renderAccountSummary([]);
    return;
  }
  state.accounts = body;
  renderAccountSummary(body);
  renderAccounts(body);
  renderAccountOptions(body);
}

const STATUS_BADGE = {
  connected: { label: "● Đã kết nối", cls: "ok" },
  pending_qr: { label: "Chờ đăng nhập", cls: "warn" },
  reconnecting: { label: "Đang kết nối lại…", cls: "warn" },
  expired: { label: "Hết hạn", cls: "off" },
  logged_out: { label: "Đã đăng xuất", cls: "off" },
};

function statusBadge(status) {
  const b = STATUS_BADGE[status] || { label: status, cls: "off" };
  return `<span class="badge ${b.cls}">${escapeHtml(b.label)}</span>`;
}

function renderAccountSummary(accounts) {
  const connected = accounts.filter((a) => a.status === "connected").length;
  const needsAction = accounts.filter((a) => a.status !== "connected").length;
  const missingInboxIds = accounts.filter((a) => a.chatwootInboxIdentifier && !a.chatwootInboxId).length;
  const issueLogs = state.recentLogIssues.filter((l) => Number(l.level) >= 40);
  const recentIssues = issueLogs.length;
  $("accountSummary").innerHTML = [
    summaryCard("Tổng tài khoản", accounts.length),
    summaryCard("Đã kết nối", connected),
    summaryCard("Cần xử lý", needsAction),
    summaryCard("Cảnh báo/lỗi", recentIssues),
  ].join("");
  const inboxNotice = missingInboxIds > 0
    ? [`<div class="notice"><span class="notice-text">${missingInboxIds} tài khoản có inbox identifier nhưng thiếu Inbox ID. Outbound routing cần Inbox ID.</span></div>`]
    : [];
  const logNotices = issueLogs.slice(0, 3).map((l) => {
    const text = `${escapeHtml(logLevelMeta(l.level).t)} · ${escapeHtml(l.event || "event")} · ${escapeHtml(l.msg || "")}`;
    const id = Number(l.id);
    const close = Number.isFinite(id)
      ? `<button class="notice-close" type="button" title="Đã xử lý — ẩn cảnh báo này" onclick="dismissIssue(${id})">×</button>`
      : "";
    return `<div class="notice"><span class="notice-text">${text}</span>${close}</div>`;
  });
  $("recentIssues").innerHTML = inboxNotice.concat(logNotices).join("");
}

function summaryCard(label, value) {
  return `<div class="summary-card"><span class="muted">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

// Mark a dashboard warning/error notice handled; persisted server-side so it never returns.
window.dismissIssue = async (id) => {
  const n = Number(id);
  if (!Number.isFinite(n)) return;
  try {
    const { status } = await api(`/admin/api/logs/${n}/dismiss`, { method: "POST" });
    if (status === 200) {
      await loadLogs({ quiet: true }); // re-fetch undismissed issues + re-render summary
    } else {
      msg("accountMsg", "Không ẩn được cảnh báo. Thử lại.", false);
    }
  } catch {
    msg("accountMsg", "Không ẩn được cảnh báo. Thử lại.", false);
  }
};

function renderAccounts(accounts) {
  const box = $("accounts");
  if (accounts.length === 0) {
    box.innerHTML = '<div class="empty-state">Chưa có tài khoản nào. Bấm "Thêm tài khoản" để bắt đầu.</div>';
    return;
  }
  const rows = accounts.map((a) => accountRow(a)).join("");
  box.innerHTML = `<table class="account-table">
    <thead><tr><th>Tài khoản</th><th>Trạng thái</th><th>Inbox</th><th>OA</th><th>Chatwoot acct</th><th>Thao tác</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function accountRow(a) {
  const type = a.type === "oa" ? "OA" : "Cá nhân";
  const missingId = a.chatwootInboxIdentifier && !a.chatwootInboxId;
  const inbox = [
    `<div>${escapeHtml(a.chatwootInboxIdentifier || "—")}</div>`,
    `<div class="${missingId ? "text-danger" : "muted"}">ID: ${escapeHtml(a.chatwootInboxId ?? "—")}</div>`,
  ].join("");
  const oa = a.zaloOaId ? escapeHtml(a.zaloOaId) : "—";
  const proxyBadge = (a.type !== "oa" && a.proxyPending)
    ? ' <span class="badge warn">Cần áp dụng proxy</span>'
    : "";
  const cwAcct = a.chatwootAccountId ?? "(mặc định)";
  return `<tr>
    <td><strong>#${escapeHtml(a.id)} ${escapeHtml(a.label)}</strong><div class="muted">${type}</div></td>
    <td>${statusBadge(a.status)}${proxyBadge}</td>
    <td>${inbox}</td>
    <td>${oa}</td>
    <td>${escapeHtml(cwAcct)}</td>
    <td><div class="row-actions">${accountActions(a)}</div></td>
  </tr>`;
}

function accountActions(a) {
  const id = safeAccountId(a.id);
  if (!id) return '<button class="button button-secondary" type="button" disabled>ID không hợp lệ</button>';
  const edit = `<button class="button button-secondary" type="button" onclick="openEditAccountPanel(${id})">Sửa</button>`;
  const del = `<button class="button button-danger" type="button" onclick="openDeletePanel(${id})">Xóa</button>`;
  const applyProxyBtn = (a.type !== "oa" && a.proxyPending)
    ? `<button class="button button-secondary" type="button" onclick="applyProxy(${id})">Áp dụng proxy</button>`
    : "";
  if (a.type === "oa") {
    return `<a href="/admin/oa/connect?accountId=${id}"><button class="button button-primary" type="button">Kết nối OA</button></a>` +
      `<button class="button button-secondary" type="button" onclick="openInfoCardPanel(${id})">Xin thông tin</button>` +
      edit + del;
  }
  return `<button class="button button-primary" type="button" onclick="openQrPanel(${id})">Quét QR</button>` + applyProxyBtn + edit + del;
}

function renderAccountOptions(accounts) {
  const sel = $("logAccount");
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Mọi tài khoản</option>' +
    accounts.map((a) => `<option value="${escapeHtml(a.id)}">#${escapeHtml(a.id)} ${escapeHtml(a.label)}</option>`).join("");
  sel.value = cur;
}

function safeAccountId(id) {
  const n = Number(id);
  return Number.isSafeInteger(n) && n > 0 ? String(n) : "";
}

function findAccount(id) {
  return state.accounts.find((a) => Number(a.id) === Number(id));
}

function editProxySelectOptions(currentProxyId) {
  const none = '<option value="">Không dùng proxy</option>';
  const opts = state.proxies.map((p) => {
    const selected = Number(p.id) === Number(currentProxyId) ? ' selected' : '';
    return `<option value="${Number(p.id)}"${selected}>${escapeHtml(p.label)} (${escapeHtml(p.protocol)})</option>`;
  }).join("");
  return none + opts;
}

function openEditAccountPanel(id) {
  const a = findAccount(id);
  if (!a) { msg("accountMsg", "Không tìm thấy tài khoản.", false); return; }
  openDrawer(`Sửa #${a.id}`, `
    <label for="e_label">Nhãn</label>
    <input id="e_label" value="${escapeHtml(a.label)}" />
    <label for="e_chatwootAccountId">Chatwoot Account ID</label>
    <input id="e_chatwootAccountId" type="number" inputmode="numeric" min="1" step="1" value="${a.chatwootAccountId == null ? "" : escapeHtml(String(a.chatwootAccountId))}" />
    <label for="e_ident">Inbox identifier</label>
    <input id="e_ident" value="${escapeHtml(a.chatwootInboxIdentifier || "")}" />
    <label for="e_iid">Inbox ID</label>
    <input id="e_iid" value="${a.chatwootInboxId == null ? "" : escapeHtml(String(a.chatwootInboxId))}" />
    <label for="editProxy">Proxy</label>
    <select id="editProxy">${editProxySelectOptions(a.proxyId)}</select>
    <p class="muted">Đổi inbox chỉ ảnh hưởng tin mới. Để chuyển sang Chatwoot account khác: tạo inbox API ở account đó (đặt webhook URL), rồi dán identifier + Inbox ID mới vào đây và chọn account đích. Nếu có identifier thì Inbox ID là bắt buộc.</p>
    <div id="e_msg" class="message"></div>
  `, `<button class="button button-secondary" type="button" onclick="closeDrawer()">Hủy</button>
      <button id="saveAccountBtn" class="button button-primary" type="button" onclick="saveAccount(${a.id})">Lưu</button>`);
}

async function openQrPanel(id) {
  const token = openDrawer("Quét QR", `<div id="qrPanel" class="empty-state">Đang lấy QR...</div>`);
  const { status, body } = await api(`/admin/api/accounts/${id}/login`, { method: "POST" });
  const panel = $("qrPanel");
  if (!isActiveDrawer(token) || !panel) return;
  if (status === 200 && body && isQrImageDataUrl(body.qrImageBase64)) {
    const img = document.createElement("img");
    img.alt = "QR đăng nhập Zalo";
    img.className = "qr-image";
    img.src = body.qrImageBase64;
    panel.replaceChildren(img);
  } else {
    panel.innerHTML = '<div class="empty-state error">Không lấy được QR.</div>';
  }
}

function openDeletePanel(id) {
  const a = findAccount(id);
  if (!a) { msg("accountMsg", "Không tìm thấy tài khoản.", false); return; }
  openDrawer("Xóa tài khoản", `
    <p>Bạn chắc chắn muốn xóa <strong>${escapeHtml(a.label)}</strong>?</p>
    <p class="muted">Hành động này xóa tài khoản khỏi bridge và gỡ session liên quan.</p>
    <div id="delMsg" class="message"></div>
  `, `<button class="button button-secondary" type="button" onclick="closeDrawer()">Hủy</button>
      <button id="confirmDeleteBtn" class="button button-danger" type="button" onclick="confirmDelete(${a.id})">Xóa</button>`);
}

async function openInfoCardPanel(id) {
  const token = openDrawer("Cấu hình xin thông tin", `<div id="infoCardPanel" class="empty-state">Đang tải...</div>`);
  const { status, body } = await api(`/admin/api/accounts/${id}/info-card`);
  const panel = $("infoCardPanel");
  if (!isActiveDrawer(token) || !panel) return;
  const c = status === 200 && body ? body : { enabled: false, title: "", subtitle: "", imageUrl: "" };
  panel.innerHTML = `
    <label class="check-row"><input type="checkbox" id="ic_en" ${c.enabled ? "checked" : ""} /><span>Bật gửi tự động</span></label>
    <label for="ic_title">Tiêu đề</label><input id="ic_title" maxlength="100" value="${escapeHtml(c.title)}" />
    <label for="ic_sub">Mô tả</label><input id="ic_sub" maxlength="500" value="${escapeHtml(c.subtitle)}" />
    <label for="ic_img">URL ảnh</label><input id="ic_img" value="${escapeHtml(c.imageUrl)}" placeholder="https://..." />
    <div id="ic_msg" class="message"></div>
    <div class="drawer-actions"><button class="button button-secondary" type="button" onclick="closeDrawer()">Đóng</button><button id="saveInfoCardBtn" class="button button-primary" type="button" onclick="saveInfoCard(${id})">Lưu</button></div>
  `;
}

window.openEditAccountPanel = openEditAccountPanel;
window.openQrPanel = openQrPanel;
window.openDeletePanel = openDeletePanel;
window.openInfoCardPanel = openInfoCardPanel;

window.saveAccount = async (id) => {
  const token = drawerToken;
  const payload = {};
  const label = $("e_label").value.trim();
  const ident = $("e_ident").value.trim();
  const iid = $("e_iid").value.trim();
  const proxyVal = $("editProxy") ? $("editProxy").value : "";
  if (label) payload.label = label;
  payload.proxyId = proxyVal ? Number(proxyVal) : null;
  if (ident) payload.chatwootInboxIdentifier = ident;
  if (ident && iid === "") {
    const m = $("e_msg");
    m.textContent = "Inbox ID phải là số nguyên dương.";
    m.className = "message err";
    return;
  }
  const parsedIid = parseOptionalPositiveInt(iid);
  if (parsedIid === undefined) { const m = $("e_msg"); m.textContent = "Inbox ID phải là số nguyên dương."; m.className = "message err"; return; }
  if (parsedIid !== null) payload.chatwootInboxId = parsedIid;
  const eAcctEl = $("e_chatwootAccountId");
  const eAcct = parseOptionalPositiveInt(eAcctEl ? eAcctEl.value : "");
  if (eAcct === undefined) { const m = $("e_msg"); m.textContent = "Chatwoot Account ID không hợp lệ."; m.className = "message err"; return; }
  if (eAcct !== null) payload.chatwootAccountId = eAcct;
  setBusy("#saveAccountBtn", true);
  let result;
  try {
    result = await api(`/admin/api/accounts/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
  } catch {
    const m = $("e_msg");
    if (isActiveDrawer(token) && m) {
      setBusy("#saveAccountBtn", false);
      m.textContent = "Lưu thất bại.";
      m.className = "message err";
    }
    return;
  }
  const { status, body } = result;
  if (status === 200) {
    if (isActiveDrawer(token)) closeDrawer();
    msg("accountMsg", "Đã lưu tài khoản.", true);
    loadAccounts();
  }
  else {
    const m = $("e_msg");
    if (!isActiveDrawer(token) || !m) return;
    setBusy("#saveAccountBtn", false);
    const errMap = {
      invalid_chatwoot_inbox_id: "Inbox ID phải là số nguyên dương.",
      chatwoot_inbox_id_required: "Inbox ID phải là số nguyên dương.",
      invalid_chatwoot_account_id: "Chatwoot Account ID không hợp lệ.",
    };
    m.textContent = (status === 400 && body && errMap[body.error]) || (status === 400 ? "Inbox identifier không hợp lệ." : "Lưu thất bại.");
    m.className = "message err";
  }
};

window.saveInfoCard = async (id) => {
  const token = drawerToken;
  const payload = {
    enabled: $("ic_en").checked,
    title: $("ic_title").value.trim(),
    subtitle: $("ic_sub").value.trim(),
    imageUrl: $("ic_img").value.trim(),
  };
  setBusy("#saveInfoCardBtn", true);
  let result;
  try {
    result = await api(`/admin/api/accounts/${id}/info-card`, { method: "PUT", body: JSON.stringify(payload) });
  } catch {
    const m = $("ic_msg");
    if (isActiveDrawer(token) && m) {
      setBusy("#saveInfoCardBtn", false);
      m.textContent = "Lưu thất bại.";
      m.className = "message err";
    }
    return;
  }
  const { status, body } = result;
  const m = $("ic_msg");
  if (!isActiveDrawer(token) || !m) return;
  if (status === 200) {
    closeDrawer();
    msg("accountMsg", "Đã lưu cấu hình xin thông tin.", true);
  }
  else {
    setBusy("#saveInfoCardBtn", false);
    const errMap = { image_required_when_enabled: "Bật thì phải có URL ảnh.", image_url_invalid: "URL ảnh phải bắt đầu http(s)://", title_too_long: "Tiêu đề quá dài.", subtitle_too_long: "Mô tả quá dài." };
    m.textContent = (body && errMap[body.error]) || "Lưu thất bại.";
    m.className = "message err";
  }
};

async function createAccount() {
  const token = drawerToken;
  const type = $("newType").value;
  const label = $("newLabel").value.trim();
  const chatwootInboxIdentifier = $("newInboxIdent").value.trim();
  const iid = $("newInboxId").value.trim();
  const proxyVal = $("newProxy") ? $("newProxy").value : "";
  if (!label) { msg("addMsg", "Cần nhãn.", false); return; }
  if (!chatwootInboxIdentifier) { msg("addMsg", "Cần inbox identifier (tạo inbox API trong Chatwoot trước).", false); return; }
  if (!iid) { msg("addMsg", "Cần Inbox ID.", false); return; }
  const parsedIid = parseOptionalPositiveInt(iid);
  if (parsedIid === undefined || parsedIid === null) { msg("addMsg", "Inbox ID phải là số nguyên dương.", false); return; }
  const payload = { label, chatwootInboxIdentifier, chatwootInboxId: parsedIid };
  if (proxyVal) payload.proxyId = Number(proxyVal);
  const cwAcctEl = $("newChatwootAccountId");
  const cwAcct = parseOptionalPositiveInt(cwAcctEl ? cwAcctEl.value : "");
  if (cwAcct === undefined) { msg("addMsg", "Chatwoot Account ID không hợp lệ.", false); return; }
  if (cwAcct !== null) payload.chatwootAccountId = cwAcct;
  const endpoint = type === "oa" ? "/admin/api/accounts/oa" : "/admin/api/accounts";
  setBusy("#saveNewAccountBtn", true);
  let result;
  try {
    result = await api(endpoint, { method: "POST", body: JSON.stringify(payload) });
  } catch {
    if (isActiveDrawer(token) && $("addMsg")) {
      setBusy("#saveNewAccountBtn", false);
      msg("addMsg", "Thêm thất bại.", false);
    }
    return;
  }
  const { status, body } = result;
  if (status === 200) {
    if (isActiveDrawer(token)) closeDrawer();
    msg("accountMsg", "Đã thêm tài khoản.", true);
    loadAccounts();
  } else {
    const errMap = {
      chatwoot_inbox_identifier_required: "Cần inbox identifier.",
      chatwoot_inbox_id_required: "Cần Inbox ID hợp lệ.",
      invalid_chatwoot_inbox_id: "Inbox ID phải là số nguyên dương.",
      invalid_chatwoot_account_id: "Chatwoot Account ID không hợp lệ.",
      invalid_proxy_id: "Proxy không hợp lệ.",
    };
    if (isActiveDrawer(token) && $("addMsg")) {
      setBusy("#saveNewAccountBtn", false);
      msg("addMsg", (body && errMap[body.error]) || "Thêm thất bại.", false);
    }
  }
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

const LOG_LEVEL = { 30: { t: "info", c: "info" }, 40: { t: "warn", c: "warn" }, 50: { t: "error", c: "err" } };

function logLevelMeta(level) {
  return LOG_LEVEL[level] || { t: String(level), c: "off" };
}

async function loadLogs(opts = {}) {
  const level = opts.quiet ? "" : ($("logLevel") ? $("logLevel").value : "");
  const accountId = opts.quiet ? "" : ($("logAccount") ? $("logAccount").value : "");
  const qs = new URLSearchParams({ limit: opts.quiet ? "20" : "300" });
  if (opts.quiet) qs.set("excludeDismissed", "1");
  if (level && !opts.quiet) qs.set("level", level);
  if (accountId && !opts.quiet) qs.set("accountId", accountId);
  const { status, body } = await api("/admin/api/logs?" + qs.toString());
  if (status !== 200 || !Array.isArray(body)) {
    if (!opts.quiet) msg("logsMsg", "Không tải được logs.", false);
    return;
  }
  if (opts.quiet) {
    state.recentLogIssues = body;
    renderAccountSummary(state.accounts);
    return;
  }
  lastLogs = body;
  logsShown = LOGS_PAGE;
  renderAccountSummary(state.accounts);
  if (!opts.quiet) {
    msg("logsMsg", `${body.length} dòng.`, true);
    renderLogs();
  }
}

window.showMoreLogs = () => { logsShown += LOGS_PAGE; renderLogs(); };

function renderLogs() {
  const box = $("logsBox");
  if (lastLogs.length === 0) { box.innerHTML = '<p class="mut">Chưa có log nào.</p>'; return; }
  const rows = lastLogs.slice(0, logsShown);
  const remaining = lastLogs.length - rows.length;
  const head = "<tr><th>Thời gian</th><th>Mức</th><th>Account</th><th>Event</th><th>Message</th></tr>";
  const body = rows.map((r) => {
    const m = logLevelMeta(r.level);
    const rowCls = r.level >= 50 ? "lvl-err" : r.level >= 40 ? "lvl-warn" : "";
    const ctx = r.context && Object.keys(r.context).length
      ? `<details><summary>Context</summary><pre class="logctx">${escapeHtml(JSON.stringify(r.context, null, 2))}</pre></details>`
      : "";
    return `<tr class="${rowCls}">` +
      `<td>${escapeHtml(new Date(r.ts).toLocaleString())}</td>` +
      `<td><span class="badge ${m.c}">${escapeHtml(m.t)}</span></td>` +
      `<td>${escapeHtml(r.accountId ?? "—")}</td>` +
      `<td>${escapeHtml(r.event || "—")}</td>` +
      `<td>${escapeHtml(r.msg || "")}${ctx}</td></tr>`;
  }).join("");
  const more = remaining > 0
    ? `<div class="row" style="margin-top:8px"><button class="button button-secondary" type="button" onclick="showMoreLogs()">Tải thêm (còn ${remaining})</button></div>`
    : "";
  box.innerHTML = `<table class="logs-table"><thead>${head}</thead><tbody>${body}</tbody></table>${more}`;
}

function logsAsText() {
  return lastLogs.map((r) => {
    const m = logLevelMeta(r.level);
    const ctx = r.context && Object.keys(r.context).length ? " " + JSON.stringify(r.context) : "";
    return `${new Date(r.ts).toISOString()} [${m.t}] acct=${r.accountId ?? "-"} ${r.event || "-"}: ${r.msg || ""}${ctx}`;
  }).join("\n");
}

async function copyLogs() {
  try { await navigator.clipboard.writeText(logsAsText()); msg("logsMsg", "Đã copy.", true); }
  catch { msg("logsMsg", "Trình duyệt chặn copy — dùng Export.", false); }
}

function exportLogs() {
  const blob = new Blob([JSON.stringify(lastLogs, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "zca-logs.json";
  a.click();
  URL.revokeObjectURL(url);
}

window.confirmDelete = async (id) => {
  const token = drawerToken;
  setBusy("#confirmDeleteBtn", true);
  let result;
  try {
    result = await api(`/admin/api/accounts/${id}`, { method: "DELETE" });
  } catch {
    const m = $("delMsg");
    if (isActiveDrawer(token) && m) {
      setBusy("#confirmDeleteBtn", false);
      m.textContent = "Xóa thất bại.";
      m.className = "message err";
    }
    return;
  }
  const { status } = result;
  if (status === 200) {
    if (isActiveDrawer(token)) closeDrawer();
    msg("accountMsg", "Đã xóa tài khoản.", true);
    loadAccounts();
    return;
  }
  const m = $("delMsg");
  if (!isActiveDrawer(token) || !m) return;
  setBusy("#confirmDeleteBtn", false);
  m.textContent = status === 404 ? "Không tìm thấy tài khoản." : "Xóa thất bại.";
  m.className = "message err";
};

// ── Proxy CRUD ──────────────────────────────────────────────────────────────

async function loadProxies() {
  const box = $("proxies");
  if (box) box.innerHTML = '<div class="empty-state">Đang tải proxy...</div>';
  const { status, body } = await api("/admin/api/proxies");
  if (status !== 200 || !body || !Array.isArray(body.proxies)) {
    if (box) box.innerHTML = '<div class="empty-state error">Không tải được danh sách proxy.</div>';
    return;
  }
  state.proxies = body.proxies;
  renderProxies(body.proxies);
}

function renderProxies(proxies) {
  const box = $("proxies");
  if (!box) return;
  if (proxies.length === 0) {
    box.innerHTML = '<div class="empty-state">Chưa có proxy nào. Bấm "Thêm proxy" để bắt đầu.</div>';
    return;
  }
  const rows = proxies.map((p) => proxyRow(p)).join("");
  box.innerHTML = `<table class="account-table">
    <thead><tr><th>Nhãn</th><th>Loại</th><th>Host:Port</th><th>Auth</th><th>Số TK dùng</th><th>Thao tác</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function proxyRow(p) {
  const pid = Number(p.id);
  const usageCount = state.accounts.filter((a) => Number(a.proxyId) === pid).length;
  const auth = p.username ? escapeHtml(p.username) : "—";
  return `<tr>
    <td><strong>${escapeHtml(p.label)}</strong></td>
    <td>${escapeHtml(p.protocol)}</td>
    <td>${escapeHtml(p.host)}:${escapeHtml(String(p.port))}</td>
    <td>${auth}</td>
    <td>${escapeHtml(String(usageCount))}</td>
    <td><div class="row-actions">
      <button class="button button-secondary" type="button" onclick="openEditProxyPanel(${pid})">Sửa</button>
      <button class="button button-danger" type="button" onclick="deleteProxy(${pid})">Xóa</button>
    </div></td>
  </tr>`;
}

function openAddProxyPanel() {
  openDrawer("Thêm proxy", `
    <label for="px_label">Nhãn</label>
    <input id="px_label" placeholder="Ví dụ: VPS HCM" />
    <label for="px_protocol">Loại</label>
    <select id="px_protocol">
      <option value="http">http</option>
      <option value="https">https</option>
      <option value="socks5">socks5</option>
    </select>
    <label for="px_host">Host</label>
    <input id="px_host" placeholder="proxy.example.com" />
    <label for="px_port">Port</label>
    <input id="px_port" type="number" min="1" max="65535" placeholder="1080" />
    <label for="px_username">Username (tùy chọn)</label>
    <input id="px_username" autocomplete="off" />
    <label for="px_password">Password (tùy chọn)</label>
    <input id="px_password" type="password" autocomplete="new-password" />
    <div id="px_msg" class="message"></div>
  `, `<button class="button button-secondary" type="button" onclick="closeDrawer()">Hủy</button>
      <button id="saveNewProxyBtn" class="button button-primary" type="button" onclick="createProxy()">Thêm</button>`);
}

function openEditProxyPanel(id) {
  const p = state.proxies.find((x) => Number(x.id) === Number(id));
  if (!p) { return; }
  openDrawer(`Sửa proxy #${Number(p.id)}`, `
    <label for="epx_label">Nhãn</label>
    <input id="epx_label" value="${escapeHtml(p.label)}" />
    <label for="epx_protocol">Loại</label>
    <select id="epx_protocol">
      <option value="http"${p.protocol === "http" ? " selected" : ""}>http</option>
      <option value="https"${p.protocol === "https" ? " selected" : ""}>https</option>
      <option value="socks5"${p.protocol === "socks5" ? " selected" : ""}>socks5</option>
    </select>
    <label for="epx_host">Host</label>
    <input id="epx_host" value="${escapeHtml(p.host)}" />
    <label for="epx_port">Port</label>
    <input id="epx_port" type="number" min="1" max="65535" value="${escapeHtml(String(p.port))}" />
    <label for="epx_username">Username (tùy chọn)</label>
    <input id="epx_username" autocomplete="off" value="${escapeHtml(p.username || "")}" />
    <label for="epx_password">Password</label>
    <input id="epx_password" type="password" autocomplete="new-password" placeholder="${p.hasPassword ? "(để trống nếu giữ nguyên)" : "(chưa đặt)"}" />
    <div id="epx_msg" class="message"></div>
  `, `<button class="button button-secondary" type="button" onclick="closeDrawer()">Hủy</button>
      <button id="saveProxyBtn" class="button button-primary" type="button" onclick="saveProxy(${Number(p.id)})">Lưu</button>`);
}

async function createProxy() {
  const token = drawerToken;
  const label = $("px_label").value.trim();
  const protocol = $("px_protocol").value;
  const host = $("px_host").value.trim();
  const port = $("px_port").value.trim();
  const username = $("px_username").value.trim();
  const password = $("px_password").value;
  if (!label) { msg("px_msg", "Cần nhãn.", false); return; }
  if (!host) { msg("px_msg", "Cần host.", false); return; }
  if (!port || isNaN(Number(port)) || Number(port) < 1 || Number(port) > 65535) {
    msg("px_msg", "Port phải là số từ 1–65535.", false); return;
  }
  const payload = {
    label,
    protocol,
    host,
    port: Number(port),
    username: username || null,
    password: password || null,
  };
  setBusy("#saveNewProxyBtn", true);
  let result;
  try {
    result = await api("/admin/api/proxies", { method: "POST", body: JSON.stringify(payload) });
  } catch {
    if (isActiveDrawer(token) && $("px_msg")) {
      setBusy("#saveNewProxyBtn", false);
      msg("px_msg", "Thêm thất bại.", false);
    }
    return;
  }
  const { status, body } = result;
  if (status === 200 || status === 201) {
    if (isActiveDrawer(token)) closeDrawer();
    loadProxies();
  } else {
    if (!isActiveDrawer(token) || !$("px_msg")) return;
    setBusy("#saveNewProxyBtn", false);
    msg("px_msg", (body && body.error) || "Thêm proxy thất bại.", false);
  }
}

async function saveProxy(id) {
  const token = drawerToken;
  const pid = Number(id);
  const label = $("epx_label").value.trim();
  const protocol = $("epx_protocol").value;
  const host = $("epx_host").value.trim();
  const port = $("epx_port").value.trim();
  const username = $("epx_username").value.trim();
  const password = $("epx_password").value;
  if (!label) { msg("epx_msg", "Cần nhãn.", false); return; }
  if (!host) { msg("epx_msg", "Cần host.", false); return; }
  if (!port || isNaN(Number(port)) || Number(port) < 1 || Number(port) > 65535) {
    msg("epx_msg", "Port phải là số từ 1–65535.", false); return;
  }
  const payload = {
    label,
    protocol,
    host,
    port: Number(port),
    username: username || null,
  };
  // Chỉ gửi password khi user nhập — empty giữ nguyên mật khẩu cũ
  if (password) payload.password = password;
  setBusy("#saveProxyBtn", true);
  let result;
  try {
    result = await api(`/admin/api/proxies/${pid}`, { method: "PATCH", body: JSON.stringify(payload) });
  } catch {
    if (isActiveDrawer(token) && $("epx_msg")) {
      setBusy("#saveProxyBtn", false);
      msg("epx_msg", "Lưu thất bại.", false);
    }
    return;
  }
  const { status, body } = result;
  if (status === 200) {
    if (isActiveDrawer(token)) closeDrawer();
    loadProxies();
  } else {
    if (!isActiveDrawer(token) || !$("epx_msg")) return;
    setBusy("#saveProxyBtn", false);
    msg("epx_msg", (body && body.error) || "Lưu proxy thất bại.", false);
  }
}

async function deleteProxy(id) {
  const pid = Number(id);
  const { status, body } = await api(`/admin/api/proxies/${pid}`, { method: "DELETE" });
  if (status === 409 && body && body.error === "proxy_in_use") {
    const names = Array.isArray(body.accounts) ? body.accounts.map((a) => a.label).join(", ") : "";
    const confirmed = confirm(`Proxy đang được dùng bởi: ${names}. Gỡ khỏi các tài khoản này và xóa proxy?`);
    if (!confirmed) return;
    const { status: s2, body: b2 } = await api(`/admin/api/proxies/${pid}?confirm=1`, { method: "DELETE" });
    if (s2 === 200) {
      loadProxies();
      loadAccounts();
    } else {
      alert((b2 && b2.error) || "Xóa proxy thất bại.");
      loadProxies();
    }
    return;
  }
  if (status === 200) {
    loadProxies();
    loadAccounts();
  } else {
    alert((body && body.error) || "Xóa proxy thất bại.");
    loadProxies();
  }
}

async function applyProxy(id) {
  if (!confirm("Áp dụng proxy mới sẽ kết nối lại tài khoản qua IP mới — Zalo có thể yêu cầu quét QR lại. Tiếp tục?")) return;
  const { status, body } = await api(`/admin/api/accounts/${Number(id)}/apply-proxy`, { method: "POST" });
  if (status === 200) {
    await loadAccounts();
  } else {
    msg("accountMsg", (body && body.error) || "Áp dụng proxy thất bại.", false);
    await loadAccounts();
  }
}

window.loadProxies = loadProxies;
window.openAddProxyPanel = openAddProxyPanel;
window.openEditProxyPanel = openEditProxyPanel;
window.createProxy = createProxy;
window.saveProxy = saveProxy;
window.deleteProxy = deleteProxy;
window.applyProxy = applyProxy;

boot();
