'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

process.env.HC_DATA_DIR = require('path').join(require('os').tmpdir(), 'hc-webtest-data');

const store = require('./store');
const net   = require('./net');
const { createHandler } = require('./http');

store.ensureDirs();

const lan = net.lanAddresses();
const LANIP = lan.length ? lan[0].ip : '127.0.0.1';

const srv = http.createServer(createHandler({ kEnc: Buffer.alloc(32), kMac: Buffer.alloc(32) }));
const PORT = 8799;

let pass = 0, fail = 0;
function ok(c, label, extra) {
  if (c) { pass++; console.log(`  \x1b[32m✔\x1b[0m ${label}${extra ? '  \x1b[90m' + extra + '\x1b[0m' : ''}`); }
  else { fail++; console.log(`  \x1b[31m✘\x1b[0m ${label}  ${extra || ''}`); }
}

function req(host, p) {
  return new Promise((resolve) => {
    const r = http.get({ host, port: PORT, path: p }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve({ code: res.statusCode, body: d, loc: res.headers.location, type: res.headers['content-type'] || '' }));
    });
    r.on('error', e => resolve({ code: 0, body: e.message, type: '' }));
    r.setTimeout(4000, () => { r.destroy(); resolve({ code: 0, body: 'timeout', type: '' }); });
  });
}

srv.listen(PORT, '0.0.0.0', async () => {
  console.log('\n\x1b[1mHome Chat 手机浏览器访问测试\x1b[0m');
  console.log(`  \x1b[90m模拟来源：${LANIP}（局域网，等同手机）\x1b[0m\n`);

  console.log('  \x1b[1m① 手机只输 IP\x1b[0m');
  let r = await req(LANIP, '/');
  ok(r.code === 302, `http://${LANIP}:${PORT}/  → 302`, 'code=' + r.code);
  ok(r.loc === '/app/', '  跳到 /app/（★ 结尾带斜杠）', 'Location: ' + r.loc);

  console.log('\n  \x1b[1m② 页面本身\x1b[0m');
  r = await req(LANIP, '/app/');
  ok(r.code === 200, 'GET /app/ → 200', 'code=' + r.code);
  ok(r.type.indexOf('text/html') >= 0, '  是 HTML', r.type);
  const html = r.body;
  ok(html.indexOf('id="boot"') >= 0, '  有启动画面');
  ok(html.indexOf('page-offline') >= 0, '  有「连不上服务端」页');

  console.log('\n  \x1b[1m③ ★ 页面引用的资源能不能取到（这个 bug 就藏在这）\x1b[0m');

  const refs = [];
  const re = /(?:href|src)\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) refs.push(m[1]);

  const assets = refs.filter(u =>
    u.indexOf('data:') !== 0 && u.indexOf('#') !== 0 && u.indexOf('http') !== 0
  );

  console.log(`  \x1b[90m页面里引用了 ${assets.length} 个本地文件\x1b[0m`);

  const base = `http://${LANIP}:${PORT}/app/`;
  let allOk = true;

  for (const rel of assets) {
    let abs;
    try { abs = new URL(rel, base); } catch (e) { abs = null; }
    if (!abs) { ok(false, `${rel} → 地址解析失败`); allOk = false; continue; }

    const res = await req(LANIP, abs.pathname);
    const good = res.code === 200 && res.body.length > 0;
    if (!good) allOk = false;
    ok(good, `${rel.padEnd(20)} → ${abs.pathname}`, `code=${res.code} ${res.body.length} 字节`);
  }

  ok(allOk, '★ 所有引用的资源都能取到（CSS/JS 不会 404）');

  console.log('\n  \x1b[1m④ 关键资源内容抽查\x1b[0m');
  r = await req(LANIP, '/app/css/tokens.css');
  ok(r.code === 200 && r.body.indexOf('--hc-tint') >= 0, 'tokens.css 有设计令牌（颜色变量）');

  r = await req(LANIP, '/app/css/app.css');
  ok(r.code === 200 && r.body.indexOf('hc-bubble') >= 0, 'app.css 有气泡样式');
  ok(r.body.indexOf('hc-bubble.tail') >= 0, 'app.css 有气泡尾巴样式');
  ok(r.body.indexOf('boot-logo') >= 0, 'app.css 有启动画面样式');
  ok(r.body.indexOf('backdrop-filter') >= 0, 'app.css 有毛玻璃');

  r = await req(LANIP, '/app/js/hc1.js');
  ok(r.code === 200 && r.body.indexOf('selfTest') >= 0, 'hc1.js 是加密层');

  r = await req(LANIP, '/app/js/app.js');
  ok(r.code === 200 && r.body.indexOf('autoDetectServer') >= 0, 'app.js 有自动识别地址');

  console.log('\n  \x1b[1m⑤ 不带斜杠的老地址\x1b[0m');
  r = await req(LANIP, '/app');
  ok(r.code === 302 && r.loc === '/app/', 'GET /app → 302 → /app/', 'Location: ' + r.loc);

  console.log('\n  \x1b[1m⑥ 电脑本机：和手机共用同一套界面\x1b[0m');
  r = await req('127.0.0.1', '/');
  ok(r.code === 302 && r.loc === '/app/', '★ 本机 / → 也跳到 /app/（不再有单独的电脑版）',
     'Location: ' + r.loc);

  r = await req('127.0.0.1', '/app/');
  ok(r.code === 200 && r.body.indexOf('id="boot"') >= 0, '  本机打开 /app/ 拿到的是同一份 HTML');

  ok(!fs.existsSync(path.join(ROOT, 'server', 'public', 'index.html')),
     '★ 旧的电脑版页面已经删掉（不会再出现两个版本不一致）');

  console.log('');
  console.log('\x1b[1m════════════════════════════════════════════════════\x1b[0m');
  if (fail === 0) {
    console.log(`\x1b[32m\x1b[1m  ✅ 全部通过：${pass} 项，0 失败\x1b[0m`);
    console.log('\x1b[32m  手机打开页面时，CSS 和 JS 都能正常加载，不会只剩裸文字。\x1b[0m');
  } else {
    console.log(`\x1b[31m\x1b[1m  ❌ ${pass} 项通过，${fail} 项失败\x1b[0m`);
  }
  console.log('\x1b[1m════════════════════════════════════════════════════\x1b[0m\n');

  srv.close();
  process.exit(fail === 0 ? 0 : 1);
});
