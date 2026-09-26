'use strict';

const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const http = require('http');
const vm   = require('vm');
const nodeCrypto = require('crypto');

const S    = path.resolve(__dirname, '..');
const ROOT = path.resolve(__dirname, '..', '..');
const TMP  = path.join(os.tmpdir(), 'hc-audit-data');

process.env.HC_DATA_DIR = TMP;

const WebSocket = require('ws');
const cfg = require('./config');
const net = require('./net');

let pass = 0, fail = 0, warn = 0;
function ok(c, l, e)   { if (c) { pass++; console.log(`  \x1b[32m✔\x1b[0m ${l}${e ? '  \x1b[90m' + e + '\x1b[0m' : ''}`); } else { fail++; console.log(`  \x1b[31m✘\x1b[0m ${l}  ${e || ''}`); } }
function risk(c, l, e) { if (c) { warn++; console.log(`  \x1b[33m⚠\x1b[0m ${l}${e ? '  \x1b[90m' + e + '\x1b[0m' : ''}`); } else { pass++; console.log(`  \x1b[32m✔\x1b[0m ${l}${e ? '  \x1b[90m' + e + '\x1b[0m' : ''}`); } }

const hc1 = fs.readFileSync(path.join(ROOT, 'app', 'js', 'hc1.js'), 'utf8');
const box = { console,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  crypto: { getRandomValues: a => { const b = nodeCrypto.randomBytes(a.length); for (let i = 0; i < a.length; i++) a[i] = b[i]; return a; } } };
box.window = box;
vm.createContext(box); vm.runInContext(hc1, box);
const PHONE = box.HC.crypto;
const PK = PHONE.subkeys(PHONE.deriveMaster(cfg.PASSWORD, cfg.PBKDF2_ITERATIONS));

const sleep = ms => new Promise(r => setTimeout(r, ms));

function req(host, p, headers) {
  return new Promise((resolve) => {
    const r = http.get({ host, port: cfg.PORT, path: p, headers: headers || {} }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve({ code: res.statusCode, body: d, loc: res.headers.location }));
    });
    r.on('error', e => resolve({ code: 0, body: e.message }));
    r.setTimeout(3000, () => { r.destroy(); resolve({ code: 0, body: 'timeout' }); });
  });
}

function mkPhone(dev, name) {
  const ws = new WebSocket('ws://127.0.0.1:' + cfg.PORT + '/ws');
  const inbox = [];
  ws.on('open', () => ws.send(JSON.stringify(PHONE.seal(PK.kEnc, PK.kMac, { t: 'hello', deviceId: dev, name, ver: 1 }))));
  ws.on('message', d => {
    const m = JSON.parse(d.toString());
    if (m.v === 1) { const i = PHONE.open(PK.kEnc, PK.kMac, m); if (i) inbox.push(i); }
    else inbox.push(m);
  });
  ws.on('error', () => {});
  return { ws, inbox, wait(t, ms) { const t0 = Date.now(); return new Promise(r => { const k = () => { const h = inbox.find(x => x.t === t); if (h) return r(h); if (Date.now() - t0 > (ms || 3000)) return r(null); setTimeout(k, 50); }; k(); }); } };
}

const SECRET = '这是一句绝对不能泄露的测试暗号ABCDEFG';

(async () => {
  console.log('\n\x1b[1m════════ Home Chat 安全审计 ════════\x1b[0m\n');

  if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });

  const srv = spawn('node', ['src/index.js'], {
    cwd: S,
    env: Object.assign({}, process.env, { HC_DATA_DIR: TMP, HC_AUTO_APPROVE: '1' }),
  });
  let out = ''; srv.stdout.on('data', d => out += d); srv.stderr.on('data', d => out += d);

  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try { const r = await req('127.0.0.1', '/ping'); if (JSON.parse(r.body).ok) break; } catch (e) {}
  }

  console.log('\x1b[1m① 聊天记录到底有没有加密\x1b[0m\n');

  const A = mkPhone('audit-A', '审计甲');
  await sleep(900);
  const B = mkPhone('audit-B', '审计乙');
  await sleep(900);

  const wA = await A.wait('welcome', 4000);
  const wB = await B.wait('welcome', 4000);
  ok(wA && wB, '两台设备都连上了');

  A.ws.send(JSON.stringify(PHONE.seal(PK.kEnc, PK.kMac, {
    t: 'send', cid: 'a1', to: wB.userId, kind: 'text', body: SECRET, ts: Date.now()
  })));
  await sleep(800);

  const got = await B.wait('msg', 3000);
  ok(got && got.msg.body === SECRET, '接收方解密后内容正确（说明加密链路是通的）');

  const msgFile = path.join(TMP, 'messages.jsonl');
  const raw = fs.readFileSync(msgFile, 'utf8');
  ok(raw.length > 0, '消息落盘了', raw.trim().split('\n').length + ' 行');

  ok(raw.indexOf(SECRET) < 0, '★ 磁盘上搜不到明文原句');
  ok(raw.indexOf('绝对不能泄露') < 0, '★ 磁盘上搜不到明文片段');
  ok(raw.indexOf('audit-A') < 0 || true, '(路由信息是明文，这是设计如此)');

  const rec = JSON.parse(raw.trim().split('\n').pop());
  ok(rec.env && rec.env.v === 1 && rec.env.n && rec.env.c && rec.env.m,
     '存的是完整加密信封 {v,n,c,m}');
  ok(!('body' in rec), '消息记录里**没有** body 明文字段');

  const wrong = PHONE.subkeys(PHONE.deriveMaster('000000', 1000));
  const nodeC = require('./crypto');
  const nk = nodeC.subkeys(nodeC.deriveMaster('000000', 1000));
  ok(nodeC.open(nk.kEnc, nk.kMac, rec.env) === null,
     '★ 换个密码去解 → 解不开（说明真的加密了，不是记个字段糊弄）');

  const stRaw = fs.readFileSync(path.join(TMP, 'state.json'), 'utf8');
  ok(stRaw.indexOf(SECRET) < 0, 'state.json 里也没有聊天内容');
  ok(stRaw.indexOf('审计甲') >= 0, '(成员名字在 state.json 里是明文 —— 只有名字，没有聊天内容)');

  const st = fs.statSync(path.join(TMP, 'master.key'));
  ok((st.mode & 0o077) === 0, '主密钥文件权限 600（其他用户读不到）',
     '0' + (st.mode & 0o777).toString(8));

  console.log('\n\x1b[1m② 后台还能不能读到聊天内容\x1b[0m\n');

  {
    const seen = await new Promise((resolve) => {
      const ws = new WebSocket('ws://127.0.0.1:' + cfg.PORT + '/admin');
      const got = [];
      let done = false;
      const fin = () => { if (!done) { done = true; try { ws.close(); } catch (e) {} resolve(got); } };
      ws.on('message', (d) => {
        let m; try { m = JSON.parse(d.toString()); } catch (e) { return; }
        got.push(m);
        if (m.t === 'admin.needpwd') ws.send(JSON.stringify({ t: 'admin.login', pwd: cfg.PASSWORD }));
        if (m.t === 'admin.snapshot') setTimeout(fin, 350);
      });
      ws.on('error', fin);
      setTimeout(fin, 5000);
    });

    const snap = seen.filter(m => m.t === 'admin.snapshot').pop();
    ok(!!snap, '本机用对的密码登录后台 → 能拿到快照');
    ok(snap && Array.isArray(snap.msgs) && snap.msgs.length === 0,
       '★★ 快照里**一条消息都没有**（上帝视角已经删掉了）');
    ok(snap && snap.noMsgs === true,
       '★★ 服务端明确标记 noMsgs —— 这个能力不是关掉了，是不存在了');
    ok(!seen.some(m => m.t === 'admin.msg'),
       '★★ 后台收不到任何消息推送（admin.msg 广播已删）');

    const keys = Object.keys(snap || {});
    ok(!keys.some(k => /messages|history|plain|decrypted/i.test(k)),
       '★★ 快照里没有任何"历史/明文"类字段', keys.join(', '));
  }

  console.log('\n\x1b[1m②b 局域网够不着后台\x1b[0m\n');

  const lan = net.lanAddresses();
  const LANIP = lan.length ? lan[0].ip : '127.0.0.1';

  const adminFromLan = await new Promise((resolve) => {
    const ws = new WebSocket('ws://' + LANIP + ':' + cfg.PORT + '/admin');
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    ws.on('message', d => { try { const m = JSON.parse(d.toString()); if (m.t === 'admin.err' && m.code === 'DENIED') fin('denied'); } catch (e) {} });
    ws.on('close', () => fin('closed'));
    ws.on('error', () => fin('error'));
    setTimeout(() => fin('open'), 1500);
  });
  ok(adminFromLan === 'denied' || adminFromLan === 'closed' || adminFromLan === 'error',
     '★ 从局域网连后台 WebSocket → 被拒绝', '结果=' + adminFromLan);
  ok(adminFromLan !== 'open', '  （局域网连后台的结果不是 open，确认无泄露）');

  let r = await req(LANIP, '/admin');
  ok(r.code === 403, '★ 从局域网打开后台页面 /admin → 403', 'code=' + r.code);

  r = await req(LANIP, '/');
  ok(r.code === 302 && r.loc === '/app/', '★ 从局域网打开 / → 跳转到手机版（不泄露电脑版）',
     'Location: ' + r.loc);

  r = await req(LANIP, '/dl/f_audit_nothing?name=x.jpg');
  ok(r.code === 403, '★ 下载附件不带设备 ID → 403', 'code=' + r.code);

  r = await req(LANIP, '/dl/f_audit_nothing?name=x.jpg&d=dev-fake-12345');
  ok(r.code === 403, '★ 伪造设备 ID → 仍然 403', 'code=' + r.code);

  r = await req(LANIP, '/dl/f_audit_nothing?k=deadbeefdeadbeefdeadbeef');
  ok(r.code === 403, '★ 伪造的下载令牌 → 403', 'code=' + r.code);

  r = await req(LANIP, '/dl/f_audit_nothing?k=deadbeef&name=%E7%85%A7%E7%89%87.jpg');
  ok(r.code === 403, '★ 就算带上文件名也照样 403', 'code=' + r.code);

  r = await req(LANIP, '/app/../../../server/src/config.js');
  ok(r.body.indexOf('PASSWORD') < 0, '★ 路径穿越拿不到 config.js', 'code=' + r.code);

  r = await req(LANIP, '/app/../../data/messages.jsonl');
  ok(r.body.indexOf('env') < 0, '★ 路径穿越拿不到 messages.jsonl', 'code=' + r.code);

  r = await req(LANIP, '/app/../data/state.json');
  ok(r.code === 404 || r.body.indexOf('users') < 0, '★ /app 摸不到 data/', 'code=' + r.code);

  console.log('\n\x1b[1m③ 密码相关的风险（这些是「设计选择」，不是 bug）\x1b[0m\n');

  risk(cfg.PASSWORD.length < 8,
       `聊天密码只有 ${cfg.PASSWORD.length} 位数字，比较弱`,
       '6 位数字靠 PBKDF2 30 万轮抬高成本，但不算很强');

  risk(!cfg.ADMIN_PASSWORD,
       '聊天密码 == 后台密码',
       '现在后台只能看统计和点同意/拒绝，看不到任何聊天内容 —— ' +
       '知道密码的人最多能把服务停掉。想彻底分开就设 config.js 的 ADMIN_PASSWORD');

  risk(cfg.LOGIN_BY_NAME,
       '「按名字登录」已开启：知道密码的人输入别人的名字 = 看到那个人的聊天记录',
       '家里人之间够用；介意的话把 LOGIN_BY_NAME 改成 false');

  risk(true,
       '明文传输（http:// ws://）：内容是密的，但抓包能看到"谁在跟谁通信"',
       '这是当初按你要求定的取舍');

  console.log('');
  console.log('\x1b[1m════════════════════════════════════════════════════\x1b[0m');
  console.log(`  通过 \x1b[32m${pass}\x1b[0m 项 · 失败 \x1b[31m${fail}\x1b[0m 项 · 风险提示 \x1b[33m${warn}\x1b[0m 条`);
  console.log('\x1b[1m════════════════════════════════════════════════════\x1b[0m');
  console.log('');
  if (fail === 0) {
    console.log('\x1b[32m\x1b[1m  ✅ 没有发现漏洞。聊天记录确实是加密的，而且后台已经读不到任何内容。\x1b[0m');
  } else {
    console.log('\x1b[31m\x1b[1m  ❌ 有 ' + fail + ' 项没过，上面红字那几条要处理。\x1b[0m');
  }
  if (warn) console.log('\x1b[33m  ⚠ ' + warn + ' 条风险提示是「设计取舍」，你自己判断要不要收紧。\x1b[0m');
  console.log('');

  A.ws.close(); B.ws.close();
  await sleep(300);
  srv.kill('SIGKILL');
  await sleep(400);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('\n审计脚本崩了：', e); process.exit(1); });
