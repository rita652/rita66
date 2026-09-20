const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let sites = [], editingId = null;
const last = s => s.history[s.history.length - 1];
const color = v => v >= 80 ? 'var(--ok)' : v >= 60 ? 'var(--warn)' : 'var(--bad)';

async function api(path, method = 'GET', body) {
  const r = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    .catch(() => { throw new Error(location.protocol === 'file:' ? '請不要直接開啟檔案。先執行 npm start,再用 http://127.0.0.1:3000 開啟本頁。' : '無法連線到伺服器,請確認 npm start 是否正在執行。'); });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || '請求失敗 ' + r.status);
  return j;
}
async function load() {
  const d = await api('/api/sites');
  sites = d.sites;
  const fill = (sel, arr) => { if (sel.options.length <= 1) arr.forEach(v => sel.add(new Option(v, v))); };
  fill($('#fStatus'), d.statuses); fill($('#fType'), d.types);
  const f = $('#form');
  if (!f.type.options.length) { d.types.forEach(v => f.type.add(new Option(v, v))); d.statuses.forEach(v => f.status.add(new Option(v, v))); }
  render();
}

function render() {
  const scanned = sites.filter(s => last(s));
  const avg = scanned.length ? Math.round(scanned.reduce((a, s) => a + last(s).score, 0) / scanned.length) : '-';
  const low = scanned.filter(s => last(s).score < 60).length;
  $('#stats').innerHTML = [['網站總數', sites.length], ['平均分數', avg], ['低於 60 分', low], ['尚未檢測', sites.length - scanned.length]]
    .map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');

  const q = $('#q').value.trim().toLowerCase(), fs = $('#fStatus').value, ft = $('#fType').value;
  const rows = sites.filter(s => (!fs || s.status === fs) && (!ft || s.type === ft) &&
    (!q || [s.name, s.url, s.owner, s.department, ...s.keywords].join(' ').toLowerCase().includes(q)))
    // 分數最低的排前面,未檢測的排最前面(最需要處理)
    .sort((a, b) => (last(a)?.score ?? -1) - (last(b)?.score ?? -1));

  $('#tbl tbody').innerHTML = rows.map(s => {
    const l = last(s), p = s.history[s.history.length - 2];
    const d = l && p ? l.score - p.score : null;
    return `<tr data-id="${s.id}">
      <td><b>${esc(s.name)}</b> <span class="pill">${esc(s.status)}</span><div class="m"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a> · ${esc(s.type)}</div></td>
      <td>${esc(s.owner) || '-'}<div class="m">${esc(s.department)}</div></td>
      <td>${l ? `<span class="sc" style="background:${color(l.score)}">${l.score}</span>${d ? `<span class="m" style="color:${d > 0 ? 'var(--ok)' : 'var(--bad)'}"> ${d > 0 ? '▲' : '▼'}${Math.abs(d)}</span>` : ''}` : '<span class="m">未檢測</span>'}
        ${s.lastError ? `<div class="m" style="color:var(--bad)">檢測失敗:${esc(s.lastError.message)}</div>` : ''}</td>
      <td>${l ? `${l.bad} / ${l.warn}` : '-'}</td>
      <td class="m">${l ? new Date(l.at).toLocaleDateString('zh-TW') : '-'}</td>
      <td style="white-space:nowrap"><button class="link" data-a="scan">檢測</button><button class="link" data-a="detail">詳情</button><button class="link" data-a="edit">編輯</button><button class="link del" data-a="del">刪除</button></td></tr>`;
  }).join('');
  $('#empty').textContent = sites.length ? (rows.length ? '' : '沒有符合條件的網站。') : '還沒有登記任何網站,按「新增網站」開始。';
}

function spark(h) {
  if (h.length < 2) return '';
  const w = 240, ht = 50, pts = h.map((x, i) => `${(i / (h.length - 1)) * w},${ht - (x.score / 100) * ht}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${ht}" width="100%" height="60" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="var(--pri)" stroke-width="2"/></svg>`;
}
function showDetail(s) {
  const l = last(s);
  $('#detail').innerHTML = `<h2>${esc(s.name)}</h2><div class="m">${esc(s.url)}</div>
    ${s.keywords.length ? `<p>關鍵字:${s.keywords.map(esc).join('、')}</p>` : ''}${s.notes ? `<p class="m">${esc(s.notes)}</p>` : ''}
    ${l ? `<h2 style="margin-top:14px">分數趨勢(${s.history.length} 次)</h2>${spark(s.history)}
      <h2 style="margin-top:14px">待處理問題</h2>${s.lastIssues.length ? s.lastIssues.map(i => `<div class="item"><div class="dot ${i.s}">${i.s === 'bad' ? '✕' : '!'}</div><div class="body"><b>${esc(i.title)}</b><small>${esc(i.group)}</small>${i.fix ? `<details><summary>如何修正</summary><pre>${esc(i.fix)}</pre></details>` : ''}</div></div>`).join('') : '<p class="m">沒有待處理問題 🎉</p>'}
      <p><a href="index.html?url=${encodeURIComponent(s.url)}&kw=${encodeURIComponent(s.keywords[0] || '')}">查看完整檢測報告 →</a></p>` : '<p class="m">尚未檢測,請先按「檢測」。</p>'}`;
  $('#dlgDetail').showModal();
}

async function scan(id, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '檢測中…'; }
  const s = await api(`/api/sites/${id}/scan`, 'POST');
  sites = sites.map(x => x.id === id ? s : x);
  render();
}

$('#tbl').addEventListener('click', async e => {
  const b = e.target.closest('button[data-a]'); if (!b) return;
  const id = b.closest('tr').dataset.id, s = sites.find(x => x.id === id);
  $('#err').textContent = '';
  try {
    if (b.dataset.a === 'scan') await scan(id, b);
    else if (b.dataset.a === 'detail') showDetail(s);
    else if (b.dataset.a === 'edit') openForm(s);
    else if (b.dataset.a === 'del' && confirm(`確定刪除「${s.name}」與其檢測紀錄?`)) { await api('/api/sites/' + id, 'DELETE'); await load(); }
  } catch (err) { $('#err').textContent = err.message; render(); }
});

function openForm(s) {
  editingId = s?.id || null;
  const f = $('#form');
  $('#formTitle').textContent = s ? '編輯網站' : '新增網站';
  $('#formErr').textContent = '';
  for (const k of ['name', 'url', 'owner', 'department', 'notes']) f[k].value = s?.[k] || '';
  f.keywords.value = (s?.keywords || []).join(', ');
  f.type.value = s?.type || '官網'; f.status.value = s?.status || '營運中';
  $('#dlgForm').showModal();
}
$('#add').onclick = () => openForm();
$('#cancel').onclick = () => $('#dlgForm').close();
$('#closeDetail').onclick = () => $('#dlgDetail').close();
$('#form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const body = Object.fromEntries(['name', 'url', 'owner', 'department', 'type', 'status', 'keywords', 'notes'].map(k => [k, f[k].value]));
  const wasNew = !editingId;
  try {
    const saved = editingId ? await api('/api/sites/' + editingId, 'PUT', body) : await api('/api/sites', 'POST', body);
    $('#dlgForm').close(); await load();
    if (wasNew) scan(saved.id).catch(() => {}); // 新增後自動檢測一次
  } catch (err) { $('#formErr').textContent = err.message; }
});

for (const id of ['#q', '#fStatus', '#fType']) $(id).addEventListener('input', render);

$('#scanAll').onclick = async e => {
  const btn = e.target, targets = sites.filter(s => s.status !== '停用');
  if (!targets.length) return;
  btn.disabled = true; $('#err').textContent = '';
  for (let i = 0; i < targets.length; i++) {
    btn.textContent = `檢測中 ${i + 1}/${targets.length}`;
    try { await scan(targets[i].id); } catch (err) { $('#err').textContent = err.message; }
    await new Promise(r => setTimeout(r, 2500)); // 配合伺服器速率限制
  }
  btn.disabled = false; btn.textContent = '全部重新檢測';
};

$('#csv').onclick = () => {
  const cell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows = [['名稱', '網址', '類型', '狀態', '負責人', '部門', '關鍵字', 'SEO分數', '錯誤', '建議', '最近檢測', '備註']];
  for (const s of sites) { const l = last(s); rows.push([s.name, s.url, s.type, s.status, s.owner, s.department, s.keywords.join('、'), l?.score ?? '', l?.bad ?? '', l?.warn ?? '', l?.at ?? '', s.notes]); }
  const blob = new Blob(['﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'sites-seo.csv' });
  a.click(); URL.revokeObjectURL(a.href);
};

load().catch(e => { $('#err').textContent = e.message; });
