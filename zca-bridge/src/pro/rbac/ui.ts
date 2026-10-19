import type { FastifyInstance } from "fastify";

const USERS_HTML = `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>Người dùng — Pro</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:14px system-ui;margin:24px;max-width:720px}table{width:100%;border-collapse:collapse}
td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}input,select,button{font:inherit;padding:6px}
.row{display:flex;gap:8px;margin:12px 0;flex-wrap:wrap}</style></head><body>
<h1>Quản lý người dùng (Pro)</h1><p><a href="/admin/pro/permissions">→ Phân quyền</a></p>
<table id="t"><thead><tr><th>ID</th><th>Username</th><th>Role</th><th></th></tr></thead><tbody></tbody></table>
<div class="row"><input id="u" placeholder="username"><input id="p" type="password" placeholder="mật khẩu (≥8)">
<select id="r"><option>operator</option><option>admin</option><option>owner</option></select>
<button onclick="create()">Thêm</button></div><p id="msg"></p>
<script>
const api="/admin/api/users";
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function load(){const d=await (await fetch(api)).json();const tb=document.querySelector("#t tbody");tb.innerHTML="";
for(const u of d.users){const tr=document.createElement("tr");tr.innerHTML=
'<td>'+esc(u.id)+'</td><td>'+esc(u.username)+'</td><td>'+esc(u.role)+'</td><td><button>Xóa</button></td>';
tr.querySelector("button").onclick=()=>del(u.id);tb.appendChild(tr);}}
async function create(){const body={username:u.value,password:p.value,role:r.value};
const res=await fetch(api,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
msg.textContent=res.ok?"OK":("Lỗi: "+(await res.json()).error);if(res.ok){u.value=p.value="";load();}}
async function del(id){if(!confirm("Xóa?"))return;const res=await fetch(api+"/"+id,{method:"DELETE"});
msg.textContent=res.ok?"Đã xóa":("Lỗi: "+(await res.json()).error);load();}
load();
</script></body></html>`;

const PERMS_HTML = `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>Phân quyền — Pro</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:14px system-ui;margin:24px;max-width:720px}table{border-collapse:collapse}
td,th{border:1px solid #ddd;padding:8px}button{font:inherit;padding:6px 12px;margin-top:12px}</style></head><body>
<h1>Phân quyền (Pro)</h1><p><a href="/admin/pro/users">→ Người dùng</a></p>
<div id="grid"></div><button onclick="save()">Lưu</button> <span id="msg"></span>
<script>
const api="/admin/api/permissions";let data;
async function load(){data=await (await fetch(api)).json();const roles=data.roles;
let h='<table><tr><th>Permission</th>'+roles.map(r=>'<th>'+r+'</th>').join('')+'</tr>';
for(const k of data.editableKeys){h+='<tr><td>'+k+'</td>'+roles.map(r=>
'<td style="text-align:center"><input type="checkbox" data-role="'+r+'" data-key="'+k+'" '+
((data.matrix[r]||[]).includes(k)?'checked':'')+'></td>').join('')+'</tr>';}
h+='</table><p><small>owner luôn toàn quyền; '+data.ownerOnlyKeys.join(", ")+' chỉ owner.</small></p>';
document.getElementById("grid").innerHTML=h;}
async function save(){const roles=data.roles;for(const role of roles){const keys=[...document.querySelectorAll(
'input[data-role="'+role+'"]:checked')].map(i=>i.dataset.key);
const res=await fetch(api,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({role,keys})});
if(!res.ok){msg.textContent="Lỗi: "+(await res.json()).error;return;}}msg.textContent="Đã lưu";}
load();
</script></body></html>`;

export function registerProUi(app: FastifyInstance): void {
  app.get("/admin/pro/users", async (_req, reply) => {
    reply.header("content-type", "text/html; charset=utf-8");
    return USERS_HTML;
  });
  app.get("/admin/pro/permissions", async (_req, reply) => {
    reply.header("content-type", "text/html; charset=utf-8");
    return PERMS_HTML;
  });
}
