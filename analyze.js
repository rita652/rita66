const { JSDOM } = require('jsdom');

const CJK = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/;
const GENERIC_ANCHORS = new Set(['點此', '點這裡', '點擊這裡', '點我', '更多', '了解更多', '閱讀更多', 'click here', 'here', 'read more', 'more', 'learn more']);

// 顯示寬度:中日韓字元算 2、其餘算 1(搜尋結果以像素截斷,中文字約為英文的兩倍寬)
function displayWidth(s) {
  let w = 0;
  for (const ch of s) w += CJK.test(ch) ? 2 : 1;
  return w;
}

function countUnits(text) {
  const cjk = (text.match(/[一-鿿぀-ヿ가-힣]/g) || []).length;
  const latin = (text.replace(/[一-鿿぀-ヿ가-힣]/g, ' ').match(/[\p{L}\p{N}]+/gu) || []).length;
  return cjk + latin;
}

function summarize(items) {
  const scored = items.filter(i => i.s !== 'info');
  const val = { ok: 1, warn: 0.5, bad: 0 };
  const total = scored.reduce((a, i) => a + i.weight, 0) || 1;
  const got = scored.reduce((a, i) => a + i.weight * val[i.s], 0);
  return {
    score: Math.round((got / total) * 100),
    ok: items.filter(i => i.s === 'ok').length,
    warn: items.filter(i => i.s === 'warn').length,
    bad: items.filter(i => i.s === 'bad').length,
  };
}

function analyze(html, opt = {}) {
  const { document } = new JSDOM(html).window;
  let base = null;
  try { base = new URL(opt.url); } catch {}
  const items = [];
  const add = (group, id, s, weight, title, detail = '', fix = '') => items.push({ group, id, s, weight, title, detail, fix });
  const $ = sel => document.querySelector(sel);
  const attr = (sel, a) => ($(sel)?.getAttribute(a) || '').trim();
  const meta = n => attr(`meta[name="${n}" i]`, 'content');
  const prop = n => attr(`meta[property="${n}" i]`, 'content');
  const headers = opt.headers || {};

  // ---------- 伺服器與效能 ----------
  const G0 = '伺服器與效能';
  if (opt.status != null) {
    opt.status === 200
      ? add(G0, 'status', 'ok', 3, 'HTTP 狀態碼 200')
      : add(G0, 'status', 'bad', 3, `HTTP 狀態碼 ${opt.status}`, '', '確保正式頁面回傳 200;已搬家的頁面請用 301 轉址。');
  }
  if (opt.ms != null) {
    opt.ms < 800 ? add(G0, 'ttfb', 'ok', 2, `伺服器回應快速(${opt.ms} ms)`)
      : add(G0, 'ttfb', opt.ms < 2000 ? 'warn' : 'bad', 2, `伺服器回應偏慢(${opt.ms} ms)`, '建議 800 ms 以內。', '啟用快取(CDN / 頁面快取)、優化資料庫查詢與伺服器資源。');
  }
  if (opt.bytes != null) {
    const kb = Math.round(opt.bytes / 1024);
    opt.bytes > 1_000_000 ? add(G0, 'size', 'warn', 1, `HTML 體積過大(${kb} KB)`, '', '移除行內大量資料、延遲載入非首屏內容。')
      : add(G0, 'size', 'ok', 1, `HTML 體積正常(${kb} KB)`);
  }
  if (opt.headers) {
    headers['content-encoding']
      ? add(G0, 'gzip', 'ok', 1, `已啟用壓縮(${headers['content-encoding']})`)
      : add(G0, 'gzip', 'warn', 1, '未啟用 gzip / brotli 壓縮', '', '在伺服器或 CDN 開啟 gzip 或 brotli。');
    /noindex/i.test(headers['x-robots-tag'] || '')
      ? add(G0, 'xrobots', 'bad', 3, 'HTTP 標頭 X-Robots-Tag 含 noindex', headers['x-robots-tag'], '移除 X-Robots-Tag: noindex 標頭。') : null;
  }
  if (opt.chain?.length) {
    opt.chain.length > 1
      ? add(G0, 'redirect', 'warn', 1, `轉址 ${opt.chain.length} 次才到達目的頁`, opt.chain.map(c => `${c.status} ${c.url}`).join('\n'), '讓舊網址直接 301 到最終網址,減少轉址跳數。')
      : add(G0, 'redirect', 'ok', 1, '轉址 1 次(正常)', opt.chain[0].url + ' → ' + opt.finalUrl);
  }

  // ---------- 基本設定 ----------
  const G1 = '基本設定';
  const title = ($('title')?.textContent || '').trim();
  const desc = meta('description');
  const tw = displayWidth(title);
  if (!title) add(G1, 'title', 'bad', 3, '缺少 <title>', '', '<title>主要關鍵字|品牌名稱</title>');
  else if (tw < 20 || tw > 60) add(G1, 'title', 'warn', 3, `標題長度不理想(顯示寬度 ${tw},約 ${title.length} 字)`, `建議寬度 20–60(中文約 10–30 字),太長會在搜尋結果被截斷。\n目前:${title}`, '調整為簡潔且包含主要關鍵字的標題。');
  else add(G1, 'title', 'ok', 3, `標題長度良好(${title.length} 字)`, title);

  const dw = displayWidth(desc);
  if (!desc) add(G1, 'desc', 'bad', 2, '缺少 meta description', '沒有描述時,搜尋引擎會自行擷取內文,較不可控。', '<meta name="description" content="用 50–80 字說明此頁內容與價值">');
  else if (dw < 60 || dw > 160) add(G1, 'desc', 'warn', 2, `描述長度不理想(顯示寬度 ${dw},約 ${desc.length} 字)`, `建議寬度 60–160(中文約 30–80 字)。\n目前:${desc}`, '調整描述長度,並自然帶入關鍵字與行動呼籲。');
  else add(G1, 'desc', 'ok', 2, `描述長度良好(${desc.length} 字)`, desc);

  const canon = attr('link[rel="canonical" i]', 'href');
  canon ? add(G1, 'canonical', 'ok', 2, '已設定 canonical', canon)
    : add(G1, 'canonical', 'warn', 2, '未設定 canonical', '可避免參數網址造成重複內容。', `<link rel="canonical" href="${opt.url || 'https://example.com/page'}">`);

  const lang = document.documentElement?.getAttribute('lang');
  lang ? add(G1, 'lang', 'ok', 1, `已設定語系 lang="${lang}"`) : add(G1, 'lang', 'warn', 1, '<html> 未設定 lang', '', '<html lang="zh-TW">');
  $('meta[name="viewport" i]') ? add(G1, 'viewport', 'ok', 2, '已設定 viewport(行動裝置友善)')
    : add(G1, 'viewport', 'bad', 2, '缺少 viewport meta', '影響行動版顯示與排名。', '<meta name="viewport" content="width=device-width, initial-scale=1">');
  const hasCharset = $('meta[charset]') || /charset/i.test(attr('meta[http-equiv="content-type" i]', 'content')) || /charset/i.test(headers['content-type'] || '');
  hasCharset ? add(G1, 'charset', 'ok', 1, '已宣告字元編碼') : add(G1, 'charset', 'warn', 1, '未宣告字元編碼', '', '<meta charset="UTF-8">');
  const robots = meta('robots');
  /noindex/i.test(robots) ? add(G1, 'noindex', 'bad', 3, 'robots meta 設為 noindex', '此頁不會被搜尋引擎收錄!\n' + robots, '移除 noindex,或改成 <meta name="robots" content="index, follow">')
    : add(G1, 'noindex', 'ok', 3, '允許被搜尋引擎索引', robots || '未設定 robots meta(預設可索引)');
  if (base) base.protocol === 'https:' ? add(G1, 'https', 'ok', 2, '使用 HTTPS') : add(G1, 'https', 'bad', 2, '未使用 HTTPS', 'HTTPS 是排名因素,且瀏覽器會標示「不安全」。', '申請 SSL 憑證(例如 Let\'s Encrypt)並將 HTTP 301 轉到 HTTPS。');
  $('link[rel~="icon" i]') ? add(G1, 'favicon', 'ok', 1, '已設定 favicon') : add(G1, 'favicon', 'warn', 1, '未偵測到 favicon', '', '<link rel="icon" href="/favicon.ico">');

  // ---------- 標題結構 ----------
  const G2 = '標題結構';
  const heads = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  const h1s = heads.filter(h => h.tagName === 'H1');
  const h1Text = (h1s[0]?.textContent || '').replace(/\s+/g, ' ').trim();
  if (h1s.length === 1) add(G2, 'h1', 'ok', 3, '有且僅有一個 H1', h1Text);
  else if (!h1s.length) add(G2, 'h1', 'bad', 3, '缺少 H1', '', '<h1>頁面主標題(包含主要關鍵字)</h1>');
  else add(G2, 'h1', 'warn', 3, `有 ${h1s.length} 個 H1`, h1s.map(h => h.textContent.trim()).join('\n'), '保留一個 H1,其餘改為 H2。');
  let skip = false, prev = 0;
  for (const h of heads) { const l = +h.tagName[1]; if (prev && l > prev + 1) skip = true; prev = l; }
  skip ? add(G2, 'hskip', 'warn', 1, '標題層級跳級(例如 H2 直接接 H4)', '', '依序使用 H1 → H2 → H3,不要為了樣式而跳級。')
    : add(G2, 'hskip', 'ok', 1, `標題層級正常(共 ${heads.length} 個標題)`);
  const emptyH = heads.filter(h => !h.textContent.trim()).length;
  if (emptyH) add(G2, 'hempty', 'warn', 1, `${emptyH} 個標題是空的`, '', '移除空白標題標籤。');
  if (title && h1Text && title === h1Text) add(G2, 'titleh1', 'info', 0, 'Title 與 H1 完全相同', '', '可讓 H1 與 Title 略有差異,涵蓋更多關鍵字變化。');

  // ---------- 結構化資料(先取出再移除 script) ----------
  const ldBlocks = [...document.querySelectorAll('script[type="application/ld+json"]')];
  const ldBad = ldBlocks.filter(s => { try { JSON.parse(s.textContent); return false; } catch { return true; } }).length;

  // ---------- 內容與連結 ----------
  const G3 = '內容與連結';
  document.querySelectorAll('script,style,noscript,template').forEach(e => e.remove());
  const text = ((document.body || document.documentElement)?.textContent || '').replace(/\s+/g, ' ').trim();
  const words = countUnits(text);
  words < 300 ? add(G3, 'words', 'warn', 2, `內容偏少(約 ${words} 字)`, '', '補充有價值、能回答使用者搜尋意圖的內容(建議 300 字以上)。')
    : add(G3, 'words', 'ok', 2, `內容量充足(約 ${words} 字)`);

  const imgs = [...document.querySelectorAll('img')];
  const noAlt = imgs.filter(i => !(i.getAttribute('alt') || '').trim());
  const longAlt = imgs.filter(i => (i.getAttribute('alt') || '').length > 125);
  const noSize = imgs.filter(i => !(i.getAttribute('width') && i.getAttribute('height')));
  const srcs = a => a.slice(0, 3).map(i => i.getAttribute('src') || '(無 src)').join('\n');
  if (!imgs.length) add(G3, 'alt', 'ok', 2, '頁面沒有圖片');
  else {
    noAlt.length ? add(G3, 'alt', 'warn', 2, `${noAlt.length}/${imgs.length} 張圖片缺少 alt`, srcs(noAlt), '<img src="..." alt="用一句話描述圖片內容">(純裝飾圖可用 alt="")')
      : add(G3, 'alt', 'ok', 2, `所有圖片(${imgs.length})皆有 alt`);
    if (longAlt.length) add(G3, 'altlong', 'warn', 1, `${longAlt.length} 張圖片 alt 過長`, '建議 125 字元以內。', '精簡 alt,避免堆砌關鍵字。');
    noSize.length ? add(G3, 'imgsize', 'warn', 1, `${noSize.length} 張圖片未指定 width/height`, srcs(noSize), '加上寬高屬性可避免版面位移(CLS),提升 Core Web Vitals。')
      : add(G3, 'imgsize', 'ok', 1, '圖片皆指定寬高');
  }

  const anchors = [...document.querySelectorAll('a[href]')];
  let internal = 0, external = 0, empty = 0, generic = 0;
  const linkSet = new Set();
  for (const a of anchors) {
    const href = a.getAttribute('href').trim();
    if (!href || href === '#' || /^(javascript|mailto|tel):/i.test(href)) { if (!href || href === '#' || /^javascript:/i.test(href)) empty++; continue; }
    if (GENERIC_ANCHORS.has(a.textContent.trim().toLowerCase())) generic++;
    try {
      const u = new URL(href, base || 'http://placeholder.invalid');
      if (!/^https?:$/.test(u.protocol)) continue;
      const same = base ? u.host === base.host : u.host === 'placeholder.invalid';
      same ? internal++ : external++;
      if (base) { u.hash = ''; linkSet.add(u.href); }
    } catch {}
  }
  add(G3, 'links', empty ? 'warn' : 'ok', 1, `連結:內部 ${internal}、外部 ${external}`, empty ? `另有 ${empty} 個空連結(# 或 javascript:)` : '', empty ? '空連結請補上真實網址,或改用 <button>。' : '');
  if (generic) add(G3, 'anchors', 'warn', 1, `${generic} 個連結文字過於籠統(如「點此」「更多」)`, '', '錨文字應描述目標頁面,例如「查看 SEO 檢測教學」。');

  // ---------- 社群分享 ----------
  const G4 = '社群分享';
  const ogMissing = ['og:title', 'og:description', 'og:image', 'og:url'].filter(p => !prop(p));
  ogMissing.length === 0 ? add(G4, 'og', 'ok', 1, 'Open Graph 標籤完整')
    : add(G4, 'og', 'warn', 1, ogMissing.length === 4 ? '缺少 Open Graph 標籤' : '缺少 OG 標籤:' + ogMissing.join('、'), '分享到 Facebook / LINE 時預覽會不佳。',
      '<meta property="og:title" content="...">\n<meta property="og:description" content="...">\n<meta property="og:image" content="https://.../cover.jpg">\n<meta property="og:url" content="...">');
  meta('twitter:card') ? add(G4, 'tw', 'ok', 1, '已設定 Twitter Card', meta('twitter:card'))
    : add(G4, 'tw', 'warn', 1, '未設定 Twitter Card', '', '<meta name="twitter:card" content="summary_large_image">');

  // ---------- 進階 ----------
  const G5 = '進階';
  if (ldBad) add(G5, 'ld', 'bad', 2, `${ldBad} 個 JSON-LD 格式錯誤`, '', '用 Google 的「豐富結果測試」修正 JSON 語法。');
  else if (ldBlocks.length) add(G5, 'ld', 'ok', 2, `已加入結構化資料(JSON-LD × ${ldBlocks.length})`);
  else add(G5, 'ld', 'warn', 2, '未偵測到結構化資料', '可爭取搜尋結果的豐富摘要(星等、FAQ、麵包屑等)。', '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"品牌名稱","url":"https://example.com"}</script>');
  const hl = document.querySelectorAll('link[rel="alternate" i][hreflang]').length;
  hl ? add(G5, 'hreflang', 'ok', 1, `已設定 hreflang(${hl})`) : add(G5, 'hreflang', 'info', 0, '未使用 hreflang', '單一語系網站可忽略。');

  // ---------- 關鍵字 ----------
  const kw = (opt.keyword || '').trim();
  if (kw) {
    const G6 = `關鍵字「${kw}」`;
    const lk = kw.toLowerCase(), has = s => (s || '').toLowerCase().includes(lk);
    has(title) ? add(G6, 'kwtitle', 'ok', 3, '標題包含關鍵字') : add(G6, 'kwtitle', 'bad', 3, '標題未包含關鍵字', '', `<title>${kw}|品牌名稱</title>`);
    has(h1Text) ? add(G6, 'kwh1', 'ok', 2, 'H1 包含關鍵字') : add(G6, 'kwh1', 'warn', 2, 'H1 未包含關鍵字', '', `<h1>${kw}…</h1>`);
    has(desc) ? add(G6, 'kwdesc', 'ok', 1, '描述包含關鍵字') : add(G6, 'kwdesc', 'warn', 1, '描述未包含關鍵字');
    if (base) has(decodeURIComponent(base.pathname)) ? add(G6, 'kwurl', 'ok', 1, '網址包含關鍵字') : add(G6, 'kwurl', 'info', 0, '網址未包含關鍵字', '', '網址盡量簡短並含關鍵字(英文或拼音)。');
    const occ = text.toLowerCase().split(lk).length - 1;
    const density = words ? (occ * Math.max(1, countUnits(kw)) / words) * 100 : 0;
    const d = density.toFixed(2);
    if (!occ) add(G6, 'kwdensity', 'bad', 2, '內文完全沒有出現關鍵字', '', '在內文自然地提及關鍵字與相關詞。');
    else if (density < 0.5) add(G6, 'kwdensity', 'warn', 2, `關鍵字出現 ${occ} 次,密度偏低(${d}%)`, '一般建議 0.5%–3%。', '在重要段落自然增加關鍵字與同義詞。');
    else if (density > 3) add(G6, 'kwdensity', 'warn', 2, `關鍵字出現 ${occ} 次,密度偏高(${d}%)`, '可能被視為關鍵字堆砌。', '改用同義詞與自然語句。');
    else add(G6, 'kwdensity', 'ok', 2, `關鍵字出現 ${occ} 次,密度 ${d}%`);
  }

  return {
    items,
    links: [...linkSet],
    info: {
      url: opt.url || '', title, description: desc, canonical: canon, h1: h1Text, words,
      ogTitle: prop('og:title'), ogDescription: prop('og:description'), ogImage: prop('og:image'),
    },
  };
}

module.exports = { analyze, summarize, displayWidth, countUnits };
