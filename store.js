const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = process.env.SITES_FILE || path.join(__dirname, '..', 'data', 'sites.json');
const TYPES = ['官網', '電商', '部落格', '活動頁', '後台/內部', '其他'];
const STATUSES = ['營運中', '建置中', '停用'];
let cache = null;

function load() {
  if (!cache) { try { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { cache = []; } }
  return cache;
}
function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, FILE);
}
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const key = u => { const x = new URL(u); return x.host.toLowerCase().replace(/^www\./, '') + x.pathname.replace(/\/$/, ''); };

// 只接受白名單欄位並驗證
function clean(input) {
  let url = str(input.url, 500);
  if (!url) throw new Error('請輸入網址');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { url = new URL(url).href; } catch { throw new Error('網址格式不正確'); }
  const name = str(input.name, 80);
  if (!name) throw new Error('請輸入網站名稱');
  const keywords = (Array.isArray(input.keywords) ? input.keywords : String(input.keywords || '').split(/[,,、\n]/))
    .map(k => str(k, 40)).filter(Boolean).slice(0, 10);
  return {
    name, url, keywords,
    owner: str(input.owner, 60), department: str(input.department, 60), notes: str(input.notes, 500),
    type: TYPES.includes(input.type) ? input.type : '其他',
    status: STATUSES.includes(input.status) ? input.status : '營運中',
  };
}

const list = () => load();
const get = id => load().find(s => s.id === id);

function create(input) {
  const data = clean(input);
  if (load().some(s => key(s.url) === key(data.url))) throw new Error('這個網址已經登記過了');
  const site = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), history: [], lastIssues: [], ...data };
  load().push(site); save();
  return site;
}
function update(id, input) {
  const s = get(id); if (!s) throw new Error('找不到此網站');
  const data = clean(input);
  if (load().some(o => o.id !== id && key(o.url) === key(data.url))) throw new Error('這個網址已經登記過了');
  Object.assign(s, data); save();
  return s;
}
function remove(id) {
  const i = load().findIndex(s => s.id === id);
  if (i < 0) throw new Error('找不到此網站');
  load().splice(i, 1); save();
}
function recordScan(id, report) {
  const s = get(id); if (!s) throw new Error('找不到此網站');
  const { score, bad, warn } = report.summary;
  s.history.push({ at: report.fetchedAt, score, bad, warn });
  s.history = s.history.slice(-30);
  s.lastIssues = report.items.filter(i => i.s === 'bad' || i.s === 'warn')
    .sort((a, b) => (a.s === 'bad' ? 0 : 1) - (b.s === 'bad' ? 0 : 1) || b.weight - a.weight)
    .slice(0, 10).map(i => ({ s: i.s, group: i.group, title: i.title, fix: i.fix }));
  s.lastError = null; save();
  return s;
}
function recordError(id, message) {
  const s = get(id); if (!s) return;
  s.lastError = { at: new Date().toISOString(), message: String(message).slice(0, 200) }; save();
}
module.exports = { list, get, create, update, remove, recordScan, recordError, TYPES, STATUSES };
