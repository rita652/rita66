const http = require('http');
const fs = require('fs');
const path = require('path');
const { fetchPage, request, parseUrl } = require('./lib/net');
const { analyze, summarize } = require('./lib/analyze');
const { siteInfo, siteItems, checkLinks } = require('./lib/site');
const store = require('./lib/store');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1'; // 預設只開放本機;對外部署請自行設定 HOST 並注意濫用風險
const PSI_KEY = process.env.PSI_API_KEY || '';
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

// 簡易速率限制:每個 IP 每分鐘 30 次
const hits = new Map();
function limited(ip) {
  const now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < 60_000);
  arr.push(now); hits.set(ip, arr);
  return arr.length > 30;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < 60_000)) hits.delete(k); }, 60_000).unref();

function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 10_000) { reject(new Error('請求內容過大')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { reject(new Error('JSON 格式錯誤')); } });
  });
}
function normalizeUrl(u) {
  u = String(u || '').trim();
  if (!u) throw new Error('請輸入網址');
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return parseUrl(u).href;
}

async function handleAnalyze(body) {
  const url = normalizeUrl(body.url);
  const page = await fetchPage(url);
  const ct = page.headers['content-type'] || '';
  if (ct && !/html|xml/i.test(ct)) throw new Error(`此網址不是網頁(Content-Type: ${ct})`);
  const origin = new URL(page.finalUrl).origin;
  const result = analyze(page.body, {
    url: page.finalUrl, keyword: body.keyword, headers: page.headers, status: page.status,
    ms: page.ms, bytes: page.bytes, chain: page.chain, finalUrl: page.finalUrl,
  });
  const extra = await Promise.all([
    body.site === false ? [] : siteInfo(origin).then(i => siteItems(i, origin)),
    body.checkLinks ? checkLinks(result.links) : [],
  ]);
  const items = [...result.items, ...extra.flat()];
  return { url: page.finalUrl, requestedUrl: url, fetchedAt: new Date().toISOString(), truncated: page.truncated, info: result.info, items, summary: summarize(items) };
}

async function handleSitemap(body) {
  const origin = new URL(normalizeUrl(body.url)).origin;
  const locs = x => [...x.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/gi)].map(m => m[1].replace(/&amp;/g, '&'));
  let xml = (await request(origin + '/sitemap.xml', { timeout: 10000, maxBytes: 5_000_000 })).body;
  if (!/<urlset|<sitemapindex/i.test(xml)) throw new Error('找不到 sitemap.xml');
  let urls = locs(xml);
  if (/<sitemapindex/i.test(xml)) {
    const all = [];
    for (const child of urls.slice(0, 3)) {
      try { all.push(...locs((await request(child, { timeout: 10000, maxBytes: 5_000_000 })).body)); } catch {}
    }
    urls = all;
  }
  urls = urls.filter(u => { try { return new URL(u).origin === origin; } catch { return false; } });
  return { total: urls.length, urls: urls.slice(0, 50) };
}

async function handlePsi(q) {
  const url = normalizeUrl(q.get('url'));
  const strategy = q.get('strategy') === 'desktop' ? 'desktop' : 'mobile';
  const api = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed?' +
    new URLSearchParams({ url, strategy, locale: 'zh-TW' }) + '&category=performance&category=seo' + (PSI_KEY ? '&key=' + PSI_KEY : '');
  const r = await fetch(api, { signal: AbortSignal.timeout(60_000) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message?.slice(0, 200) || 'PageSpeed API 錯誤 ' + r.status);
  const lh = j.lighthouseResult, a = lh.audits, cat = lh.categories;
  const m = id => ({ value: a[id]?.displayValue || '-', score: a[id]?.score });
  return {
    strategy,
    performance: Math.round((cat.performance?.score ?? 0) * 100),
    seo: Math.round((cat.seo?.score ?? 0) * 100),
    metrics: { LCP: m('largest-contentful-paint'), CLS: m('cumulative-layout-shift'), TBT: m('total-blocking-time'), FCP: m('first-contentful-paint'), SI: m('speed-index') },
    field: j.loadingExperience?.overall_category || null,
  };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  try {
    if (u.pathname.startsWith('/api/')) {
      if (limited(req.socket.remoteAddress)) return send(res, 429, { error: '請求太頻繁,請稍後再試' });
      if (u.pathname === '/api/analyze' && req.method === 'POST') return send(res, 200, await handleAnalyze(await readJson(req)));
      if (u.pathname === '/api/sitemap' && req.method === 'POST') return send(res, 200, await handleSitemap(await readJson(req)));
      if (u.pathname === '/api/psi' && req.method === 'GET') return send(res, 200, await handlePsi(u.searchParams));
      // ----- 網站管理 -----
      if (u.pathname === '/api/sites' && req.method === 'GET') return send(res, 200, { sites: store.list(), types: store.TYPES, statuses: store.STATUSES });
      if (u.pathname === '/api/sites' && req.method === 'POST') return send(res, 200, store.create(await readJson(req)));
      const m = /^\/api\/sites\/([\w-]+)(\/scan)?$/.exec(u.pathname);
      if (m) {
        const id = m[1];
        if (m[2] && req.method === 'POST') {
          const site = store.get(id);
          if (!site) return send(res, 404, { error: '找不到此網站' });
          try {
            const report = await handleAnalyze({ url: site.url, keyword: site.keywords[0], checkLinks: false });
            return send(res, 200, store.recordScan(id, report));
          } catch (e) { store.recordError(id, e.message); return send(res, 200, store.get(id)); }
        }
        if (req.method === 'PUT') return send(res, 200, store.update(id, await readJson(req)));
        if (req.method === 'DELETE') { store.remove(id); return send(res, 200, { ok: true }); }
      }
      return send(res, 404, { error: 'Not found' });
    }
    const file = path.normalize(path.join(PUBLIC, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname)));
    if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) {
    send(res, 400, { error: e.message || String(e) });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`SEO 檢測工具已啟動:http://${HOST}:${PORT}`));
}
module.exports = { server };
