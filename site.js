const { request } = require('./net');

function parseRobots(text) {
  const sitemaps = [];
  let blocked = false, agents = [], groupHasRule = false, groupDisallowAll = false, groupAllow = false;
  const flush = () => { if (agents.includes('*') && groupDisallowAll && !groupAllow) blocked = true; };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'sitemap') { sitemaps.push(v); continue; }
    if (k === 'user-agent') {
      if (groupHasRule) { flush(); agents = []; groupHasRule = groupDisallowAll = groupAllow = false; }
      agents.push(v.toLowerCase());
    } else if (k === 'disallow' || k === 'allow') {
      groupHasRule = true;
      if (k === 'disallow' && v === '/') groupDisallowAll = true;
      if (k === 'allow' && v) groupAllow = true;
    }
  }
  flush();
  return { blocked, sitemaps };
}

async function siteInfo(origin) {
  const info = { robots: null, sitemapUrl: null, sitemapOk: false };
  try {
    const r = await request(origin + '/robots.txt', { timeout: 6000, maxBytes: 300_000 });
    if (r.status === 200 && !/<html/i.test(r.body.slice(0, 500))) info.robots = parseRobots(r.body);
  } catch {}
  const candidates = [...(info.robots?.sitemaps || []), origin + '/sitemap.xml'];
  for (const c of candidates.slice(0, 3)) {
    try {
      const r = await request(c, { method: 'HEAD', timeout: 6000 });
      if (r.status === 200) { info.sitemapUrl = c; info.sitemapOk = true; break; }
    } catch {}
  }
  return info;
}

function siteItems(info, origin) {
  const items = [];
  const add = (s, weight, title, detail = '', fix = '') => items.push({ group: '網站層級', id: 'site', s, weight, title, detail, fix });
  if (!info.robots) {
    add('warn', 1, '找不到 robots.txt', origin + '/robots.txt', 'User-agent: *\nAllow: /\nSitemap: ' + origin + '/sitemap.xml');
  } else if (info.robots.blocked) {
    add('bad', 3, 'robots.txt 封鎖了所有搜尋引擎', '偵測到 User-agent: * 搭配 Disallow: /', '移除 "Disallow: /",或只封鎖不想被收錄的目錄。');
  } else add('ok', 1, 'robots.txt 存在且未封鎖全站');
  info.sitemapOk
    ? add('ok', 1, '找到 sitemap', info.sitemapUrl)
    : add('warn', 1, '找不到 sitemap.xml', '', '建立 sitemap.xml,並在 robots.txt 加上 "Sitemap: ' + origin + '/sitemap.xml"。');
  return items;
}

async function checkLinks(urls, { limit = 25, concurrency = 5 } = {}) {
  const list = urls.slice(0, limit), broken = [];
  let i = 0;
  async function worker() {
    while (i < list.length) {
      const u = list[i++];
      try {
        let r = await request(u, { method: 'HEAD', timeout: 6000 });
        if ([403, 404, 405, 501].includes(r.status)) r = await request(u, { method: 'GET', timeout: 6000, maxBytes: 20_000 });
        if (r.status >= 400) broken.push(`${r.status} ${u}`);
      } catch (e) { broken.push(`失敗(${e.message}) ${u}`); }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  const total = list.length;
  const skipped = urls.length - total;
  const note = skipped > 0 ? `(僅抽查前 ${total} 個連結)` : '';
  return [broken.length
    ? { group: '內容與連結', id: 'deadlinks', s: 'bad', weight: 2, title: `發現 ${broken.length} 個失效連結${note}`, detail: broken.join('\n'), fix: '修正或移除失效連結,內部頁面搬家請設定 301 轉址。' }
    : { group: '內容與連結', id: 'deadlinks', s: 'ok', weight: 2, title: `未發現失效連結${note}`, detail: '', fix: '' }];
}

module.exports = { parseRobots, siteInfo, siteItems, checkLinks };
