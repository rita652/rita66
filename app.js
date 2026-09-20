const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ICON = { ok: '✓', warn: '!', bad: '✕', info: 'i' };
const SORT = { bad: 0, warn: 1, info: 2, ok: 3 };
let lastReport = null, batchData = [];

// ---------- 分頁 ----------
document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === t));
  for (const m of ['single', 'batch', 'history']) $('#p-' + m).classList.toggle('hidden', m !== t.dataset.m);
  $('#err').textContent = '';
  if (t.dataset.m === 'history') renderHistory();
});

// ---------- 歷史紀錄 ----------
const store = {
  get() { try { return JSON.parse(localStorage.getItem('seo-history') || '[]'); } catch { return []; } },
  add(e) { try { const h = this.get(); h.unshift(e); localStorage.setItem('seo-history', JSON.stringify(h.slice(0, 50))); } catch {} },
};
function renderHistory() {
  const h = store.get();
  $('#histList').innerHTML = h.length ? h.map((e, i) =>
    `<div class="hist" data-i="${i}"><span>${esc(e.url)}</span><span>${e.score} 分 · ${new Date(e.at).toLocaleString('zh-TW')}</span></div>`).join('')
    : '<p class="hint">尚無紀錄。</p>';
  document.querySelectorAll('.hist').forEach(el => el.onclick = () => {
    $('#url').value = h[el.dataset.i].url;
    document.querySelector('.tab[data-m=single]').click();
  });
}

// ---------- API ----------
async function api(path, opt) {
  const r = await fetch(path, opt);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || '請求失敗 ' + r.status);
  return j;
}
const post = (p, body) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// ---------- 報告 ----------
function renderReport(d, { psi, prevScore } = {}) {
  lastReport = d;
  const s = d.summary, color = s.score >= 80 ? 'var(--ok)' : s.score >= 60 ? 'var(--warn)' : 'var(--bad)';
  const delta = prevScore == null ? '' : (() => { const x = s.score - prevScore; return `<span class="delta" style="color:${x >= 0 ? 'var(--ok)' : 'var(--bad)'}">${x >= 0 ? '▲' : '▼'} ${Math.abs(x)}(上次 ${prevScore})</span>`; })();
  const problems = d.items.filter(i => i.s === 'bad' || i.s === 'warn').sort((a, b) => SORT[a.s] - SORT[b.s] || b.weight - a.weight);
  const groups = [...new Set(d.items.map(i => i.group))];
  const i = d.info;
  const domain = (() => { try { return new URL(d.url).host; } catch { return d.url; } })();

  let h = `<div class="actions no-print"><button class="btn" id="expCsv">匯出 CSV</button><button class="btn" onclick="print()">列印 / 存成 PDF</button></div>`;
  h += `<div class="card score"><div class="ring" style="--p:${s.score};--c:${color}"><span>${s.score}</span></div>
    <div class="sum"><h2 style="margin-bottom:6px">${s.score >= 80 ? '表現優秀 👍' : s.score >= 60 ? '尚可,還有改善空間' : '需要優先改善'}${delta}</h2>
    <span class="b">✅ 通過 ${s.ok}</span><span class="b">⚠️ 建議 ${s.warn}</span><span class="b">❌ 錯誤 ${s.bad}</span>
    <div class="hint">${esc(d.url)}${d.truncated ? '<br>⚠️ 網頁過大,僅分析前 3 MB' : ''}</div></div></div>`;
  if (psi) h += psiHtml(psi);
  if (problems.length) h += `<div class="card prio"><h2>🎯 優先修正</h2><ol>${problems.slice(0, 5).map(p => `<li>${esc(p.title)}</li>`).join('')}</ol></div>`;

  h += `<div class="card"><h2>預覽</h2>
    <div class="serp"><div class="u">${esc(domain)}</div><div class="t">${esc(i.title || '(無標題)')}</div><div class="d">${esc(i.description || '(無描述,搜尋引擎將自行擷取內文)')}</div></div>
    <div class="share">${i.ogImage ? `<img src="${esc(i.ogImage)}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : '<img alt="">'}
    <div><small class="hint">${esc(domain)}</small><b>${esc(i.ogTitle || i.title || '(無標題)')}</b><span class="hint">${esc(i.ogDescription || i.description || '')}</span></div></div></div>`;

  for (const g of groups) {
    const its = d.items.filter(x => x.group === g).sort((a, b) => SORT[a.s] - SORT[b.s] || b.weight - a.weight);
    h += `<div class="card"><h2>${esc(g)}</h2>${its.map(x => `<div class="item"><div class="dot ${x.s}">${ICON[x.s]}</div><div class="body"><b>${esc(x.title)}</b>
      ${x.detail ? `<small>${esc(x.detail)}</small>` : ''}${x.fix ? `<details><summary>如何修正</summary><pre>${esc(x.fix)}</pre></details>` : ''}</div></div>`).join('')}</div>`;
  }
  $('#result').innerHTML = h;
  $('#result').classList.remove('hidden');
  $('#expCsv').onclick = () => downloadCsv([d], 'seo-report.csv');
  $('#result').scrollIntoView({ behavior: 'smooth' });
}

function psiHtml(p) {
  const c = v => v >= 90 ? 'var(--ok)' : v >= 50 ? 'var(--warn)' : 'var(--bad)';
  return `<div class="card"><h2>⚡ Core Web Vitals(PageSpeed · ${p.strategy === 'mobile' ? '行動版' : '桌機版'})</h2><div class="psi">
    <div><b style="color:${c(p.performance)}">${p.performance}</b><span>效能分數</span></div>
    <div><b style="color:${c(p.seo)}">${p.seo}</b><span>Lighthouse SEO</span></div>
    ${Object.entries(p.metrics).map(([k, v]) => `<div><b>${esc(v.value)}</b><span>${k}</span></div>`).join('')}</div></div>`;
}

// ---------- CSV ----------
function downloadCsv(reports, name) {
  const cell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows = [['網址', '分組', '狀態', '權重', '項目', '說明', '修正建議']];
  for (const r of reports) for (const i of r.items) rows.push([r.url, i.group, i.s, i.weight, i.title, i.detail, i.fix]);
  const blob = new Blob(['﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  a.click(); URL.revokeObjectURL(a.href);
}

// ---------- 單頁 ----------
async function withBusy(btn, fn) {
  $('#err').textContent = ''; btn.disabled = true; const old = btn.textContent; btn.textContent = '檢測中…';
  try { await fn(); } catch (e) { $('#err').textContent = e.message; } finally { btn.disabled = false; btn.textContent = old; }
}
$('#goSingle').onclick = e => withBusy(e.target, async () => {
  const url = $('#url').value.trim();
  if (!url) throw new Error('請輸入網址');
  $('#batchBox').classList.add('hidden');
  const psiP = $('#optPsi').checked ? api('/api/psi?url=' + encodeURIComponent(url)).catch(err => ({ error: err.message })) : null;
  const d = await post('/api/analyze', { url, keyword: $('#kw').value, checkLinks: $('#optLinks').checked });
  const prev = store.get().find(h => h.url === d.url);
  renderReport(d, { prevScore: prev?.score });
  store.add({ url: d.url, score: d.summary.score, at: Date.now() });
  if (psiP) {
    const p = await psiP;
    if (p.error) $('#err').textContent = 'PageSpeed 取得失敗:' + p.error + '\n(匿名呼叫有額度限制,可設定環境變數 PSI_API_KEY)';
    else renderReport(d, { psi: p, prevScore: prev?.score });
  }
});
$('#url').addEventListener('keydown', e => e.key === 'Enter' && $('#goSingle').click());

// ---------- 批次 ----------
$('#goBatch').onclick = e => withBusy(e.target, async () => {
  const site = $('#siteUrl').value.trim();
  if (!site) throw new Error('請輸入網站網址');
  const sm = await post('/api/sitemap', { url: site });
  batchData = [];
  $('#result').classList.add('hidden');
  $('#batchBox').classList.remove('hidden');
  const tb = $('#batchTbl tbody'); tb.innerHTML = '';
  $('#batchTitle').textContent = `批次結果(0/${sm.urls.length}${sm.total > sm.urls.length ? `,sitemap 共 ${sm.total} 頁,僅檢測前 ${sm.urls.length}` : ''})`;
  let next = 0, done = 0;
  const worker = async () => {
    while (next < sm.urls.length) {
      const u = sm.urls[next++];
      const tr = document.createElement('tr'); tb.appendChild(tr);
      try {
        const d = await post('/api/analyze', { url: u, site: false });
        batchData.push(d);
        tr.className = 'click';
        tr.innerHTML = `<td class="u">${esc(u)}</td><td>${d.summary.score}</td><td>${d.summary.bad}</td><td>${d.summary.warn}</td>`;
        tr.onclick = () => renderReport(d);
      } catch (err) { tr.innerHTML = `<td class="u">${esc(u)}</td><td colspan="3" style="color:var(--bad)">${esc(err.message)}</td>`; }
      $('#batchTitle').textContent = $('#batchTitle').textContent.replace(/\(\d+\//, `(${++done}/`);
      await new Promise(r => setTimeout(r, 4500)); // 2 個 worker 約每分鐘 26 次,低於伺服器每分鐘 30 次的速率限制
    }
  };
  await Promise.all([worker(), worker()]);
});
$('#exportBatch').onclick = () => batchData.length && downloadCsv(batchData, 'seo-batch.csv');
