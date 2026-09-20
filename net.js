const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const zlib = require('zlib');

const UA = 'Mozilla/5.0 (compatible; SEOCheckerBot/1.0)';

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
  }
  return true;
}

// 解析 DNS 時就過濾內網位址,連線直接使用已驗證的 IP(防 SSRF / DNS rebinding)
function safeLookup(hostname, opts, cb) {
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    const ok = addrs.filter(a => !isPrivateIp(a.address));
    if (!ok.length) return cb(new Error('不允許存取內部網路位址'));
    if (opts && opts.all) return cb(null, ok);
    cb(null, ok[0].address, ok[0].family);
  });
}

function parseUrl(input) {
  const u = new URL(input);
  if (!/^https?:$/.test(u.protocol)) throw new Error('只支援 http / https 網址');
  if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && isPrivateIp(u.hostname.replace(/^\[|\]$/g, ''))) {
    throw new Error('不允許存取內部網路位址');
  }
  return u;
}

function decode(buf, contentType) {
  let cs = (/charset=([\w-]+)/i.exec(contentType || '') || [])[1];
  if (!cs) cs = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 2048).toString('latin1')) || [])[1];
  try { return new TextDecoder(cs || 'utf-8').decode(buf); } catch { return buf.toString('utf8'); }
}

// 單次請求,不自動跟隨轉址
function request(url, { method = 'GET', timeout = 10000, maxBytes = 3_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = parseUrl(url); } catch (e) { return reject(e); }
    const lib = u.protocol === 'https:' ? https : http;
    const t0 = Date.now();
    const req = lib.request(u, {
      method, lookup: safeLookup, timeout,
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'accept-encoding': 'gzip, deflate, br', 'accept-language': 'zh-TW,zh;q=0.9,en;q=0.8' },
    }, res => {
      const ms = Date.now() - t0;
      const out = { status: res.statusCode, headers: res.headers, ms, body: '', bytes: 0, truncated: false };
      if (method === 'HEAD') { res.resume(); return resolve(out); }
      const enc = (res.headers['content-encoding'] || '').toLowerCase();
      const stream = enc === 'gzip' ? res.pipe(zlib.createGunzip()) : enc === 'br' ? res.pipe(zlib.createBrotliDecompress()) : enc === 'deflate' ? res.pipe(zlib.createInflate()) : res;
      const chunks = [];
      stream.on('data', c => {
        out.bytes += c.length;
        if (out.bytes > maxBytes) { out.truncated = true; req.destroy(); stream.destroy(); return finish(); }
        chunks.push(c);
      });
      let done = false;
      const finish = () => { if (done) return; done = true; out.body = decode(Buffer.concat(chunks), res.headers['content-type']); resolve(out); };
      stream.on('end', finish);
      stream.on('error', e => (done ? null : (done = true, reject(e))));
    });
    req.on('timeout', () => req.destroy(new Error('連線逾時')));
    req.on('error', e => reject(e));
    req.end();
  });
}

// 跟隨轉址(最多 5 次),並記錄轉址鏈
async function fetchPage(url, opts = {}) {
  const chain = [];
  let cur = url;
  for (let i = 0; i <= 5; i++) {
    const r = await request(cur, opts);
    const loc = r.headers.location;
    if ([301, 302, 303, 307, 308].includes(r.status) && loc) {
      chain.push({ url: cur, status: r.status });
      cur = new URL(loc, cur).href;
      continue;
    }
    return { ...r, finalUrl: cur, chain };
  }
  throw new Error('轉址次數過多(超過 5 次)');
}

module.exports = { request, fetchPage, isPrivateIp, parseUrl };
