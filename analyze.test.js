const test = require('node:test');
const assert = require('node:assert');
const { analyze, summarize, displayWidth } = require('../lib/analyze');
const { parseRobots } = require('../lib/site');
const { isPrivateIp, parseUrl } = require('../lib/net');

const GOOD = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">
<title>台北咖啡廳推薦|城市咖啡指南</title>
<meta name="description" content="整理台北最值得一去的咖啡廳,提供營業時間、價位、氣氛與交通資訊,幫你快速找到適合工作與聚會的好店。">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="https://example.com/cafe"><link rel="icon" href="/f.ico">
<meta property="og:title" content="t"><meta property="og:description" content="d"><meta property="og:image" content="i"><meta property="og:url" content="u">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">{"@context":"https://schema.org"}</script></head>
<body><h1>台北咖啡廳推薦</h1><h2>信義區</h2><img src="a.jpg" alt="咖啡" width="10" height="10">
<a href="/about">關於我們</a><a href="https://other.com/x">外部</a><p>${'台北咖啡廳很棒。'.repeat(80)}</p></body></html>`;

const find = (r, id) => r.items.find(i => i.id === id);

test('良好頁面:高分且無錯誤', () => {
  const r = analyze(GOOD, { url: 'https://example.com/cafe', keyword: '咖啡廳' });
  const s = summarize(r.items);
  assert.equal(s.bad, 0, JSON.stringify(r.items.filter(i => i.s === 'bad')));
  assert.ok(s.score >= 90, 'score=' + s.score);
  assert.equal(find(r, 'h1').s, 'ok');
  assert.equal(find(r, 'kwtitle').s, 'ok');
  assert.deepEqual(r.links, ['https://example.com/about', 'https://other.com/x']);
});

test('空白頁面:抓出關鍵錯誤並附修正建議', () => {
  const r = analyze('<html><body><img src="x.png"><a href="/x">點此</a></body></html>', { url: 'http://example.com/' });
  for (const id of ['title', 'desc', 'h1', 'viewport', 'https']) assert.equal(find(r, id).s, 'bad', id);
  assert.ok(find(r, 'title').fix.includes('<title>'));
  assert.equal(find(r, 'alt').s, 'warn');
  assert.equal(find(r, 'anchors').s, 'warn');
  assert.ok(summarize(r.items).score < 40);
});

test('noindex 與多個 H1 與壞掉的 JSON-LD', () => {
  const r = analyze('<html><head><meta name="ROBOTS" content="noindex"><script type="application/ld+json">{bad</script></head><body><h1>a</h1><h1>b</h1><h4>x</h4></body></html>', {});
  assert.equal(find(r, 'noindex').s, 'bad');
  assert.equal(find(r, 'h1').s, 'warn');
  assert.equal(find(r, 'ld').s, 'bad');
  assert.equal(find(r, 'hskip').s, 'warn');
});

test('中文標題以顯示寬度計算', () => {
  assert.equal(displayWidth('abc'), 3);
  assert.equal(displayWidth('台北'), 4);
  const long = analyze(`<title>${'台'.repeat(40)}</title>`, {});
  assert.equal(find(long, 'title').s, 'warn');
});

test('關鍵字密度過高會警告', () => {
  const r = analyze(`<title>x</title><body>${'seo '.repeat(50)}</body>`, { keyword: 'seo' });
  assert.equal(find(r, 'kwdensity').s, 'warn');
});

test('伺服器指標', () => {
  const r = analyze('<title>x</title>', { status: 200, ms: 2500, bytes: 5000, headers: {}, chain: [{ url: 'a', status: 301 }, { url: 'b', status: 302 }] });
  assert.equal(find(r, 'ttfb').s, 'bad');
  assert.equal(find(r, 'gzip').s, 'warn');
  assert.equal(find(r, 'redirect').s, 'warn');
});

test('robots.txt 解析', () => {
  assert.equal(parseRobots('User-agent: *\nDisallow: /').blocked, true);
  assert.equal(parseRobots('User-agent: *\nDisallow: /admin\n').blocked, false);
  assert.equal(parseRobots('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow:').blocked, false);
  assert.deepEqual(parseRobots('Sitemap: https://a.com/s.xml').sitemaps, ['https://a.com/s.xml']);
});

test('SSRF 防護:內網位址被拒絕', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1']) assert.ok(isPrivateIp(ip), ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) assert.ok(!isPrivateIp(ip), ip);
  assert.throws(() => parseUrl('http://127.0.0.1/'));
  assert.throws(() => parseUrl('http://[::1]/'));
  assert.throws(() => parseUrl('file:///etc/passwd'));
});
