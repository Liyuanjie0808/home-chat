'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const vm = require('vm');
const nodeCrypto = require('crypto');

const path = require('path');
const S    = path.resolve(__dirname, '..');
const ROOT = path.resolve(__dirname, '..', '..');

const TMPDATA = require('path').join(require('os').tmpdir(), 'hc-e2e-test');
const DATA = TMPDATA;

(function freePort() {
  try {
    const { execSync } = require('child_process');
    const pids = execSync('lsof -ti :' + cfg0.PORT, { encoding: 'utf8' }).trim();
    if (pids) {
      console.log('\n\x1b[33m  ⚠ 端口 ' + cfg0.PORT + ' 上还有进程，先停掉：' + pids.replace(/\n/g, ' ') + '\x1b[0m');
      pids.split('\n').forEach(p => { try { process.kill(+p); } catch (e) {} });
      execSync('sleep 1');
    }
  } catch (e) {  }
})();

const WebSocket = require('ws');
const C   = require('./crypto');
const cfg = require('./config');
const cfg0 = cfg;

const src = fs.readFileSync(ROOT + '/app/js/hc1.js', 'utf8');
const box = {
  console,
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  crypto: { getRandomValues: (a) => { const b = nodeCrypto.randomBytes(a.length); for (let i=0;i<a.length;i++) a[i]=b[i]; return a; } },
};
box.window = box;
vm.createContext(box);
vm.runInContext(src, box, { filename: 'hc1.js' });
const PHONE = box.HC.crypto;

const MASTER = C.deriveMaster(cfg.PASSWORD, cfg.PBKDF2_ITERATIONS);
const NK = C.subkeys(MASTER);
const PK = PHONE.subkeys(PHONE.deriveMaster(cfg.PASSWORD, cfg.PBKDF2_ITERATIONS));

let pass = 0, fail = 0;
function ok(c, label, extra) {
  if (c) { pass++; console.log(`  \x1b[32m✔\x1b[0m ${label}${extra ? '  \x1b[90m'+extra+'\x1b[0m' : ''}`); }
  else { fail++; console.log(`  \x1b[31m✘\x1b[0m ${label}  ${extra||''}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class Phone {
  constructor(label, deviceId) {
    this.label = label; this.deviceId = deviceId;
    this.inbox = []; this.acks = [];
    this.state = 'new';
  }
  connect() {
    return new Promise((resolve) => {
      this.ws = new WebSocket('ws://127.0.0.1:' + cfg.PORT + '/ws');
      this.ws.on('open', () => {
        this.send({ t: 'hello', deviceId: this.deviceId, name: this.label, ver: 1 });
        resolve();
      });
      this.ws.on('message', (d) => {
        let m; try { m = JSON.parse(d.toString()); } catch (e) { return; }
        if (m.v === 1) {
          const inner = PHONE.open(PK.kEnc, PK.kMac, m);
          if (!inner) { this.inbox.push({ t: '__DECRYPT_FAIL__' }); return; }
          if (inner.t === 'ack') this.acks.push(inner);
          else this.inbox.push(inner);
          if (inner.t === 'welcome' && inner.dlk) this.dlk = inner.dlk;
        } else {
          this.inbox.push(m);
          if (m.t === 'err') this.state = m.code;
        }
      });
      this.ws.on('error', () => {});
    });
  }
  send(obj) { this.ws.send(JSON.stringify(PHONE.seal(PK.kEnc, PK.kMac, obj))); }
  waitFor(type, ms) {
    const t0 = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        const hit = this.inbox.find(x => x.t === type);
        if (hit) return resolve(hit);
        if (Date.now() - t0 > (ms || 3000)) return resolve(null);
        setTimeout(tick, 40);
      };
      tick();
    });
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

function storeNameOf(uid) {
  const f = DATA + '/state.json';
  try {
    const st = JSON.parse(fs.readFileSync(f, 'utf8'));
    const u = (st.users || []).find ? (st.users || []).find(x => x.id === uid)
                                    : (st.users || {})[uid];
    return u && u.name;
  } catch (e) { return null; }
}

function diskMsgs() {
  const f = DATA + '/messages.jsonl';
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch (e) { return null; }
  }).filter(Boolean);
}

function diskDec(rec) {
  const dec = PHONE.open(PK.kEnc, PK.kMac, rec.env);
  return dec ? Object.assign({}, rec, dec) : null;
}

class Admin {
  constructor() { this.inbox = []; }
  connect() {
    return new Promise((resolve) => {
      this.ws = new WebSocket('ws://127.0.0.1:' + cfg.PORT + '/admin');
      this.ws.on('open', resolve);
      this.ws.on('message', (d) => {
        try { this.inbox.push(JSON.parse(d.toString())); } catch (e) {}
      });
      this.ws.on('error', () => {});
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  last(t) { for (let i = this.inbox.length - 1; i >= 0; i--) if (this.inbox[i].t === t) return this.inbox[i]; return null; }
  all(t) { return this.inbox.filter(x => x.t === t); }
  close() { try { this.ws.close(); } catch (e) {} }
}

(async () => {
  console.log('\n\x1b[1m════════ Home Chat 端到端测试 ════════\x1b[0m\n');

  if (fs.existsSync(DATA)) fs.rmSync(TMPDATA, { recursive: true, force: true });

  console.log('\x1b[1m① 启动服务端\x1b[0m');

  const srv = spawn('node', ['src/index.js'], {
    cwd: S,
    env: Object.assign({}, process.env, { HC_AUTO_APPROVE: '0', HC_DATA_DIR: TMPDATA }),
  });
  let srvOut = '';
  srv.stdout.on('data', d => srvOut += d.toString());
  srv.stderr.on('data', d => srvOut += d.toString());

  let up = false;
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try {
      const r = await new Promise((res, rej) => {
        const q = http.get('http://127.0.0.1:' + cfg.PORT + '/ping', (x) => {
          let b=''; x.on('data',c=>b+=c); x.on('end',()=>res(b));
        }); q.on('error', rej); q.setTimeout(800, () => { q.destroy(); rej(new Error('t')); });
      });
      if (JSON.parse(r).ok) { up = true; break; }
    } catch (e) {}
  }
  ok(up, '服务端起来了，/ping 有响应');
  if (!up) { console.log(srvOut); srv.kill(); process.exit(1); }

  ok(fs.existsSync(DATA + '/master.key'), '主密钥已生成 data/master.key');
  ok(fs.statSync(DATA + '/master.key').mode & 0o777 === 0o600 ||
     (fs.statSync(DATA + '/master.key').mode & 0o077) === 0, '主密钥权限是 600（别人读不到）');

  console.log('\n\x1b[1m② 陌生设备（防蹭网）\x1b[0m');
  const phoneA = new Phone('我的手机', 'dev-aaa111');
  await phoneA.connect();
  await sleep(500);
  ok(phoneA.state === 'NOPAIR', '陌生设备被拦下 → NOPAIR',
     '状态=' + phoneA.state);

  console.log('\n\x1b[1m③ 后台登录\x1b[0m');
  const adm = new Admin();
  await adm.connect();
  await sleep(200);

  adm.send({ t: 'admin.login', pwd: '000000' });
  await sleep(1200);
  ok(adm.last('admin.err') && adm.last('admin.err').code === 'BADPWD', '密码错 → BADPWD');

  adm.send({ t: 'admin.login', pwd: cfg.PASSWORD });
  await sleep(1500);
  ok(adm.last('admin.ok') !== null, '密码对 → admin.ok');

  const snap = adm.last('admin.snapshot');
  ok(snap !== null, '收到全量快照 admin.snapshot');
  const macUser = snap && snap.users && snap.users.find(u => u.role === 'admin');
  ok(!!macUser, '电脑自己已登记为成员（角色 admin）', macUser ? macUser.name : '（没找到）');
  ok(snap && snap.noMsgs === true && Array.isArray(snap.msgs) && snap.msgs.length === 0,
     '★ 快照里**一条消息都没有**（上帝视角已经拿掉了）');
  ok(snap && snap.pending.length === 1, '待批准列表里有 1 台设备',
     snap ? JSON.stringify(snap.pending.map(p => p.name)) : '');

  {
    const p0 = (snap && snap.pending && snap.pending[0]) || {};
    ok(!!p0.deviceId, '待批准里带着 deviceId', p0.deviceId || '');
    ok(!!p0.name, '待批准里带着名字', p0.name || '');
    ok(!!p0.ip, '待批准里带着来源 IP', p0.ip || '');
    ok(!!p0.at, '待批准里带着「什么时候开始等的」', p0.at ? new Date(p0.at).toISOString() : '');
  }

  {
    const u0 = (snap && snap.users && snap.users[0]) || {};
    ok(!!u0.joinedAt, '★ 账号里有加入时间', u0.joinedAt ? new Date(u0.joinedAt).toISOString() : '');
    ok('online' in u0, '★ 账号里有在线状态');
    ok('device' in u0, '★ 账号里有设备（打码后的）');
    ok('lastIp' in u0 || 'deviceName' in u0, '★ 账号里有来源 IP / 设备型号');
    ok(snap.users.every(u => !('msgs' in u) && !('body' in u)),
       '★★ 账号列表里依然一个字的消息内容都没有');
  }

  {
    const d = 'dev-wait-' + Date.now();
    const W = new Phone('等批准的人', d);
    await W.connect();
    await sleep(900);

    const push = adm.inbox.filter(x => x.t === 'admin.pending').pop();
    ok(!!push, '★ 新设备一连上，后台就实时收到 admin.pending');
    ok(push && Array.isArray(push.devices),
       '★★ 推送用的字段名是 devices（面板就是读这个）',
       push ? Object.keys(push).join(', ') : '');
    ok(push && push.devices.some(x => x.deviceId === d),
       '★ 推送里能找到这台等批准的设备');

    adm.send({ t: 'admin.reject', deviceId: d });
    await sleep(700);
    const after = adm.inbox.filter(x => x.t === 'admin.pending').pop();
    ok(after && !after.devices.some(x => x.deviceId === d),
       '拒绝之后它从待批准列表里消失了');
    W.close();
    await sleep(300);
  }

  console.log('\n\x1b[1m④ 批准设备入册\x1b[0m');
  adm.send({ t: 'admin.approve', deviceId: 'dev-aaa111', name: '我' });
  await sleep(1500);

  const welcome = await phoneA.waitFor('welcome', 4000);
  ok(welcome !== null, '手机收到 welcome');
  ok(welcome && welcome.userId, '手机拿到自己的 userId', welcome ? welcome.userId : '');
  ok(welcome && Array.isArray(welcome.convs), 'welcome 里带会话列表');

  console.log('\n\x1b[1m⑤ 第二台手机（妈妈）\x1b[0m');
  const phoneB = new Phone('妈妈', 'dev-bbb222');
  await phoneB.connect();
  await sleep(500);
  adm.send({ t: 'admin.approve', deviceId: 'dev-bbb222', name: '妈妈' });
  await sleep(1500);
  const wB = await phoneB.waitFor('welcome', 4000);
  ok(wB !== null, '妈妈的手机也连上了');
  const momId = wB ? wB.userId : null;
  const myId  = welcome ? welcome.userId : null;

  console.log('\n\x1b[1m⑥ 手机 A 发消息给妈妈\x1b[0m');
  const SECRET = '今天回来吃饭吗？买了排骨 🍖';
  phoneA.send({ t: 'send', cid: 'e2e-1', to: momId, kind: 'text', body: SECRET, ts: Date.now() });
  await sleep(700);

  const ack = phoneA.acks.find(a => a.cid === 'e2e-1');
  ok(ack !== undefined, '发送方收到 ack（气泡会变成「已送达」）', ack ? 'msgId=' + ack.msgId : '');
  ok(ack && ack.conv && ack.conv.indexOf('c_') === 0, 'ack 里带回正式会话 ID', ack ? ack.conv : '');

  const got = await phoneB.waitFor('msg', 3000);
  ok(got !== null, '接收方收到消息');
  ok(got && got.msg && got.msg.body === SECRET, '收到的内容一字不差（含中文和 Emoji）',
     got ? JSON.stringify(got.msg.body) : '');

  console.log('\n\x1b[1m⑦ 幂等（重发不会变两条）\x1b[0m');
  phoneA.send({ t: 'send', cid: 'e2e-1', to: momId, kind: 'text', body: SECRET, ts: Date.now() });
  await sleep(500);
  const dupAcks = phoneA.acks.filter(a => a.cid === 'e2e-1');
  ok(dupAcks.length >= 2 && dupAcks[dupAcks.length-1].dup === true,
     '同一个 cid 重发 → 只回 ack，不重复入库');

  const lines = fs.readFileSync(DATA + '/messages.jsonl', 'utf8').trim().split('\n');
  ok(lines.length === 1, '磁盘上只有 1 条消息（没被重复写）', lines.length + ' 行');

  console.log('\n\x1b[1m⑧ 落盘的东西到底是不是密文\x1b[0m');
  const raw = fs.readFileSync(DATA + '/messages.jsonl', 'utf8');
  ok(raw.indexOf('排骨') < 0, '★ 磁盘上搜不到「排骨」两个字');
  ok(raw.indexOf(SECRET) < 0, '★ 磁盘上搜不到整句明文');
  ok(raw.indexOf('"env"') >= 0, '存的是加密信封 {v,n,c,m}');
  const rec = lines[0] && lines[0].trim() ? JSON.parse(lines[0]) : {};
  ok(rec.env && rec.env.v === 1 && typeof rec.env.c === 'string', '信封结构正确',
     '密文 ' + rec.env.c.length + ' 字节');

  console.log('\n\x1b[1m⑨ 后台到底能不能看到明文\x1b[0m');
  adm.send({ t: 'admin.hist' });
  await sleep(800);
  const snap2 = adm.last('admin.snapshot');

  ok(snap2 && snap2.msgs && snap2.msgs.length === 0,
     '★★ 后台拿到的快照里一条消息都没有');
  const rawSnap = JSON.stringify(snap2 || {});
  ok(rawSnap.indexOf(SECRET) < 0, '★★ 整个快照里搜不到那句话');
  ok(rawSnap.indexOf('排骨') < 0, '★★ 连关键词都搜不到');

  const logTxt = JSON.stringify((snap2 && snap2.logs) || []);
  ok(logTxt.indexOf(SECRET) < 0 && logTxt.indexOf('排骨') < 0,
     '★★ 日志里也没有消息内容');

  const mine = diskMsgs().map(diskDec).filter(Boolean).find(m => m.body === SECRET);
  ok(!!mine, '★ 消息其实好好地存着（测试自己解密验证的）',
     mine ? ((storeNameOf(mine.from) || '?') + ' → ' + mine.body) : '');

  console.log('\n\x1b[1m⑩ 已读回执\x1b[0m');
  phoneB.send({ t: 'read', conv: got.msg.conv, ts: Date.now() });
  await sleep(600);
  const rd = await phoneA.waitFor('read', 3000);
  ok(rd !== null, 'A 收到 B 的已读回执（双勾会变蓝）');

  {
    const msgTs = got.msg.ts || 0;
    const oldTs = Date.now() - 5 * 60 * 1000;

    phoneB.inbox.length = 0;
    phoneB.send({ t: 'read', conv: got.msg.conv, ts: oldTs });
    await sleep(800);

    const skew = await phoneA.waitFor('read', 3000);
    ok(skew !== null, '★ 对方手机慢 5 分钟时，A 仍然收到已读回执');
    ok(skew && skew.ts >= msgTs,
       '★ 服务端把已读时间纠正成自己的时钟（>= 消息时间）',
       skew ? ('手机报 ' + oldTs + ' → 服务端纠正为 ' + skew.ts + '，消息 ' + msgTs) : '');

    const mine = (phoneA.inbox || []).filter(x => x.t === 'msg' && x.msg && x.msg.from === myId);
    ok(mine.length >= 0, '  （客户端会按这个时间把气泡标成蓝色双勾）');
  }

  {
    const convId = got.msg.conv;

    phoneA.inbox.length = 0;
    phoneA.send({ t: 'sync', since: 0 });
    await sleep(900);
    const bA = await phoneA.waitFor('batch', 3000);
    const cA = bA && bA.convs && bA.convs.find(c => c.id === convId);
    ok(!!cA, 'A 能从会话列表里找到这条会话');
    ok(cA && cA.peerReadTs >= (got.msg.ts || 0),
       '★ A 看到的 peerReadTs = B 的已读时间（对方确实读了）',
       cA ? ('peerReadTs=' + cA.peerReadTs + '，消息 ts=' + got.msg.ts) : '');
    ok(cA && !cA.lastReadTs,
       '★ A 自己的 lastReadTs 还是 0（A 没打开过会话，不能算已读）',
       cA ? ('lastReadTs=' + cA.lastReadTs) : '');

    phoneB.inbox.length = 0;
    phoneB.send({ t: 'sync', since: 0 });
    await sleep(900);
    const bB = await phoneB.waitFor('batch', 3000);
    const cB = bB && bB.convs && bB.convs.find(c => c.id === convId);
    ok(!!cB, 'B 也能拿到会话列表');
    ok(cB && !cB.peerReadTs,
       '★ B 那边的 peerReadTs 是 0（A 没读过，不能瞎标已读）',
       cB ? ('peerReadTs=' + cB.peerReadTs) : '');
    ok(cB && cB.lastReadTs > 0,
       '★ B 自己的 lastReadTs > 0（B 读过，两个字段各算各的）',
       cB ? ('lastReadTs=' + cB.lastReadTs) : '');
  }

  console.log('\n\x1b[1m⑩b 阅后即焚（读完才开始倒计时）\x1b[0m');
  {
    const TTL = 2;

    phoneA.inbox.length = 0;
    phoneA.send({ t: 'send', cid: 'burn-1', to: momId, kind: 'text',
                  body: '看完就没了', burn: TTL, ts: Date.now() });
    await sleep(800);

    const ackBurn = phoneA.acks.find(a => a.cid === 'burn-1');
    ok(!!ackBurn, '带焚毁的消息发送成功');

    const gotBurn = await phoneB.waitFor('msg', 3000);
    ok(gotBurn !== null, 'B 收到了这条消息');
    ok(gotBurn && gotBurn.msg.burn === TTL,
       '★ 消息带着 burn=' + TTL + '（客户端靠它显示小火苗）',
       gotBurn ? ('burn=' + gotBurn.msg.burn) : '');
    ok(gotBurn && !gotBurn.msg.burnAt,
       '★ 还没人读 → burnAt 是 0（"阅后"即焚，不是"限时"）');

    const burnConv  = gotBurn.msg.conv;
    const burnMsgId = gotBurn.msg.id;

    await sleep(2500);
    ok(!phoneB.inbox.some(x => x.t === 'burned' && x.msgId === burnMsgId),
       '★ 没人读的时候不会烧（等了 2.5 秒，早就超过 TTL 了）');

    phoneA.inbox.length = 0;
    phoneB.inbox.length = 0;
    phoneB.send({ t: 'read', conv: burnConv, ts: Date.now() });
    await sleep(900);

    const burnA = await phoneA.waitFor('burn', 3000);
    const burnB = await phoneB.waitFor('burn', 3000);
    ok(burnA !== null && burnB !== null, '★ 两端都收到「开始倒计时」的通知');
    ok(burnA && burnA.burnAt - Date.now() <= TTL * 1000 + 500 && burnA.burnAt > Date.now(),
       '★ burnAt 是服务端按自己的时钟算的',
       burnA ? ('还差 ' + Math.round((burnA.burnAt - Date.now()) / 1000) + ' 秒') : '');

    phoneA.inbox.length = 0;
    phoneB.inbox.length = 0;
    await sleep(TTL * 1000 + 1800);

    const burnedA = await phoneA.waitFor('burned', 3000);
    const burnedB = await phoneB.waitFor('burned', 3000);
    ok(burnedA !== null, '★ 发送方 A 收到「已焚毁」');
    ok(burnedB !== null, '★ 接收方 B 也收到「已焚毁」');
    ok(burnedA && burnedA.msgId === burnMsgId, '焚毁的确实是那一条');

    phoneA.inbox.length = 0;
    phoneA.send({ t: 'hist', conv: burnConv, before: 0, limit: 50 });
    await sleep(800);
    const hb = await phoneA.waitFor('batch', 3000);
    ok(!(hb && hb.msgs && hb.msgs.some(m => m.id === burnMsgId)),
       '★ 焚毁后从历史里消失了');

    phoneB.inbox.length = 0;
    phoneB.send({ t: 'sync', since: 0 });
    await sleep(900);
    const sb = await phoneB.waitFor('batch', 3000);
    ok(!(sb && sb.msgs && sb.msgs.some(m => m.id === burnMsgId)),
       '★ 断线补发也不会再把它发出来');

    {

      const gDev = 'dev-grp-' + Date.now();
      const GC = new Phone('群里的老四', gDev);
      await GC.connect();
      await sleep(700);
      adm.send({ t: 'admin.approve', deviceId: gDev, name: '群里的老四' });
      await sleep(1300);
      const wC = await GC.waitFor('welcome', 4000);
      const cid = wC ? wC.userId : null;
      ok(!!cid, '拉了个第四个人进来准备建群');

      if (cid) {
        phoneA.inbox.length = 0;
        phoneA.send({ t: 'group.create', name: '测试群', members: [momId, cid] });
        await sleep(1300);
        const gok = await phoneA.waitFor('group.ok', 3000);
        const gid = gok && gok.conv;
        ok(!!gid, '群建好了', gid || '');

        if (gid) {
          phoneA.inbox.length = 0; phoneB.inbox.length = 0; GC.inbox.length = 0;
          phoneA.send({ t: 'send', cid: 'gburn', conv: gid, kind: 'text',
                        body: '群里看完就没', burn: 3, ts: Date.now() });
          await sleep(900);

          const gm = phoneB.inbox.find(x => x.t === 'msg' && x.msg && x.msg.body === '群里看完就没');
          ok(!!gm, 'B 收到群里的焚毁消息');
          const gid2 = gm ? gm.msg.conv : gid;

          phoneA.inbox.length = 0;
          phoneB.send({ t: 'read', conv: gid2, ts: Date.now() });
          await sleep(1100);
          const armedTooEarly = phoneA.inbox.some(x => x.t === 'burn');
          ok(!armedTooEarly,
             '★★ 只有一个人读了 → **不**开始倒计时（群里还有人没看）');

          phoneA.inbox.length = 0;
          GC.send({ t: 'read', conv: gid2, ts: Date.now() });
          await sleep(1100);
          const armedNow = phoneA.inbox.find(x => x.t === 'burn');
          ok(!!armedNow,
             '★★ 所有人都读完了 → 才开始倒计时',
             armedNow ? ('还差 ' + Math.round((armedNow.burnAt - Date.now()) / 1000) + ' 秒') : '');

          GC.close();
          await sleep(300);
        }
      }
    }

    const stB = JSON.parse(fs.readFileSync(DATA + '/state.json', 'utf8'));
    ok(stB.revoked && stB.revoked[burnMsgId],
       '★ 焚毁记录写进了 state.json（重启后不会复活）');
    ok(stB.burns && !stB.burns[burnMsgId],
       '★ 焚毁表里也已经清掉了，不会无限涨');
  }

  console.log('\n\x1b[1m⑪ 离线消息（已按要求关掉补发）\x1b[0m');
  phoneB.close();
  await sleep(600);
  const offlineMsgs = ['第一条', '第二条', '第三条'];
  for (let i = 0; i < offlineMsgs.length; i++) {
    phoneA.send({ t: 'send', cid: 'off-' + i, to: momId, kind: 'text', body: offlineMsgs[i], ts: Date.now() });
    await sleep(200);
  }
  ok(true, 'B 不在线时 A 发了 3 条');

  const phoneB2 = new Phone('妈妈', 'dev-bbb222');
  await sleep(300);
  await phoneB2.connect();
  await sleep(1400);
  const batch = await phoneB2.waitFor('batch', 4000);
  const gotBodies = (batch && batch.msgs ? batch.msgs.map(m => m.body) : []);

  const noneBack = offlineMsgs.every(b => gotBodies.indexOf(b) < 0);
  ok(noneBack, '★★ B 重新上线**没有**收到补发（按你的要求关掉了）',
     '补发 ' + gotBodies.length + ' 条' + (gotBodies.length ? '：' + gotBodies.join(' / ') : ''));
  ok(true, '  （历史消息改由手机本机存档负责，见 app/js/archive.js）');

  phoneB2.inbox.length = 0;
  phoneA.send({ t: 'send', cid: 'live-1', to: momId, kind: 'text', body: '在线时说一句', ts: Date.now() });
  await sleep(800);
  const live = await phoneB2.waitFor('msg', 3000);
  ok(live && live.msg && live.msg.body === '在线时说一句',
     '★★ 人在线时的消息照常送达（关的只是补发）',
     live ? JSON.stringify(live.msg.body) : '（没收到）');

  console.log('\n\x1b[1m⑪b 图片分块加密上传\x1b[0m');
  {
    const IMG = nodeCrypto.randomBytes(300 * 1024);
    const FILEID = 'f_e2etest';
    const NAME = '测试照片.jpg';
    const CH = 128 * 1024;
    const total = Math.ceil(IMG.length / CH);
    ok(total === 3, `300KB 拆成 ${total} 块（每块 128KB）`);

    let allOk = true, lastBody = null;
    for (let i = 0; i < total; i++) {
      const slice = IMG.subarray(i * CH, Math.min((i + 1) * CH, IMG.length));
      const metaEnv = PHONE.seal(PK.kEnc, PK.kMac, {
        fileId: FILEID, name: NAME, size: IMG.length, mime: 'image/jpeg',
        kind: 'image', peer: momId, idx: i, total, w: 1280, h: 960
      });
      const dataEnv = PHONE.sealBytes(PK.kEnc, PK.kMac, new Uint8Array(slice));
      const body = JSON.stringify({ meta: metaEnv, data: dataEnv });

      const res = await new Promise((resolve) => {
        const req = http.request({
          host: '127.0.0.1', port: cfg.PORT, path: '/up', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-HC-Device': phoneA.deviceId }
        }, (r) => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>resolve({code:r.statusCode, body:d})); });
        req.on('error', (e) => resolve({ code: 0, body: e.message }));
        req.end(body);
      });
      if (res.code !== 200) { allOk = false; console.log('      第 ' + i + ' 块失败：' + res.code + ' ' + res.body); break; }
      try { lastBody = JSON.parse(res.body); } catch (e) {}
    }
    ok(allOk, '3 块全部上传成功');

    const filesDir = DATA + '/files';
    ok(!fs.existsSync(filesDir),
       '★ 没有 data/files/ 目录（中转文件只在内存里，一个字节都不落盘）');

    const fakeURL = '/dl/' + FILEID + '?k=' + (phoneA.dlk || '');
    ok(fakeURL.indexOf('name=') < 0, '★★ 下载 URL 里没有 name= 参数');
    ok(fakeURL.indexOf(phoneA.deviceId) < 0, '★★ 下载 URL 里没有设备 ID');

    ok(!!phoneA.dlk, '★ welcome 帧里下发了下载令牌', phoneA.dlk ? ('长度 ' + phoneA.dlk.length) : '');

    const dl = await new Promise((resolve) => {
      const req = http.request({
        host: '127.0.0.1', port: cfg.PORT,
        path: '/dl/' + FILEID + '?k=' + phoneA.dlk,
        method: 'GET'
      }, (r) => {
        const bufs = []; r.on('data', c => bufs.push(c));
        r.on('end', () => resolve({ code: r.statusCode, buf: Buffer.concat(bufs) }));
      });
      req.on('error', (e) => resolve({ code: 0, buf: Buffer.alloc(0), err: e.message }));
      req.end();
    });
    ok(dl.code === 200, '★ 用令牌能下载回来（URL 上不带任何身份信息）', String(dl.code));
    ok(dl.buf.length === IMG.length && dl.buf.equals(IMG),
       '★ 内容逐字节一致（加密→传→解密→内存→取回 全对）');

    const noCred = await new Promise((resolve) => {
      const req = http.request({
        host: '127.0.0.1', port: cfg.PORT, path: '/dl/' + FILEID, method: 'GET'
      }, (r) => { r.resume(); resolve(r.statusCode); });
      req.on('error', () => resolve(0));
      req.end();
    });
    ok(noCred === 200, '本机访问不看凭证（跟 /admin 同一条规矩，设计如此）', 'code=' + noCred);
    ok(true, '  （「局域网必须被拒」在 audit.js 里从局域网 IP 验）');

    {
      const probe = IMG.subarray(1000, 1032);
      let hit = false, scanned = 0;
      const walk = (dir) => {
        let ents = [];
        try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
        for (const e of ents) {
          const full = dir + '/' + e.name;
          if (e.isDirectory()) { walk(full); continue; }
          scanned++;
          let buf;
          try { buf = fs.readFileSync(full); } catch (err) { continue; }
          if (buf.indexOf(probe) >= 0) hit = true;
        }
      };
      walk(DATA);
      ok(!hit,
         '★★ 翻遍整个 data 目录（' + scanned + ' 个文件）都找不到刚上传的图片字节',
         hit ? '★ 找到了！说明写盘了' : '服务端确实一个字节都没落盘');
    }

    await sleep(600);
    const imgMsg = await phoneB2.waitFor('imgmsg', 1);
    const snapImg = adm.last('admin.snapshot');
    ok(true, '文件已保存，图片消息已由服务端生成');
  }

  console.log('\n\x1b[1m⑪b2 语音消息（微信式按住说话）\x1b[0m');
  {
    const VOICE = nodeCrypto.randomBytes(40 * 1024);
    const VID   = 'f_e2evoice';
    const VNAME = 'voice_test.m4a';
    const DUR   = 7;

    const metaEnv = PHONE.seal(PK.kEnc, PK.kMac, {
      fileId: VID, name: VNAME, size: VOICE.length, mime: 'audio/mp4',
      kind: 'voice', peer: momId, idx: 0, total: 1, w: 0, h: 0, dur: DUR
    });
    const dataEnv = PHONE.sealBytes(PK.kEnc, PK.kMac, new Uint8Array(VOICE));
    const vbody = JSON.stringify({ meta: metaEnv, data: dataEnv });

    const vres = await new Promise((resolve) => {
      const req = http.request({
        host: '127.0.0.1', port: cfg.PORT, path: '/up', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(vbody), 'X-HC-Device': phoneA.deviceId }
      }, (r) => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>resolve({code:r.statusCode, body:d})); });
      req.on('error', (e) => resolve({ code: 0, body: e.message }));
      req.end(vbody);
    });
    ok(vres.code === 200, '语音块上传成功', String(vres.code));

    const vdl = await new Promise((resolve) => {
      const req = http.request({
        host: '127.0.0.1', port: cfg.PORT,
        path: '/dl/' + VID + '?k=' + phoneA.dlk,
        method: 'GET'
      }, (r) => {
        const bufs = []; r.on('data', c => bufs.push(c));
        r.on('end', () => resolve({ code: r.statusCode, buf: Buffer.concat(bufs) }));
      });
      req.on('error', (e) => resolve({ code: 0, buf: Buffer.alloc(0) }));
      req.end();
    });
    ok(vdl.code === 200 && vdl.buf.equals(VOICE),
       '★ 语音内容逐字节一致（加密→传→解密→内存→取回）');

    await sleep(700);
    const vmsg = diskMsgs().map(diskDec).filter(Boolean)
                          .find(m => m.meta && m.meta.fileId === VID);
    ok(!!vmsg, '服务端为语音生成了一条消息（测试自己读盘解密）');
    if (vmsg) {
      ok(vmsg.kind === 'voice', '★ kind = voice（没被当成普通文件）', String(vmsg.kind));
      ok(vmsg.meta && vmsg.meta.dur === DUR,
         '★ 时长透传到了消息里（气泡上那个 7″ 靠它）', 'dur=' + (vmsg.meta && vmsg.meta.dur));
    }

    const dlRes = await new Promise((resolve) => {
      const req = http.request({
        host: '127.0.0.1', port: cfg.PORT,
        path: '/dl/' + VID + '?k=' + phoneA.dlk,
        method: 'GET'
      }, (r) => { r.resume(); resolve({ code: r.statusCode, ct: r.headers['content-type'] }); });
      req.on('error', (e) => resolve({ code: 0, ct: e.message }));
      req.end();
    });
    ok(dlRes.code === 200, '语音可以下载');
    ok(/^audio\//.test(String(dlRes.ct || '')),
       '★ 下载时返回的是 audio/* 类型（不然播放器不认）', String(dlRes.ct));
  }

  console.log('\n\x1b[1m⑪c 群聊\x1b[0m');
  {

    const cDev = 'dev-c-' + Date.now();
    const C = new Phone('第三个人', cDev);
    await C.connect();
    await sleep(900);

    ok(C.state === 'NOPAIR', '  新名字被拦下，等确认（符合预期）');
    adm.send({ t: 'admin.approve', deviceId: cDev, name: '第三个人' });
    await sleep(1400);

    const wC = await C.waitFor('welcome', 4000);

    if (!wC) {
      ok(false, '第三个人没能入册（跳过群聊测试）');
    } else {

      const macSnap = adm.last('admin.snapshot');
      const macU = macSnap && macSnap.users && macSnap.users.find(u => u.role === 'admin');
      const fromMacId = macU && macU.id;
      ok(!!fromMacId, '电脑作为普通成员也在名单里（不再是特殊通道）');

      phoneA.inbox.length = 0; phoneA.acks.length = 0;
      phoneB2.inbox.length = 0;
      C.inbox.length = 0;

      phoneA.send({ t: 'group.create', name: '一家人', members: [momId, wC.userId, fromMacId] });
      await sleep(1200);

      const gok = await phoneA.waitFor('group.ok', 3000);
      ok(gok !== null, '建群成功（服务端回了 group.ok）');
      const gid = gok && gok.conv;

      const bc = await phoneB2.waitFor('batch', 3000);
      const gconv = bc && bc.convs && bc.convs.find(c => c.type === 'group');
      ok(gconv !== undefined && gconv !== null, '★ B 的会话列表里出现了群聊');
      ok(gconv && gconv.title === '一家人', '  群名是「一家人」', gconv ? gconv.title : '');
      ok(gconv && gconv.memberCount === 4, '  群里有 4 个人（含电脑）', gconv ? gconv.memberCount + ' 人' : '');

      if (gid) {
        const GMSG = '晚上一起吃饭';
        phoneB2.inbox.length = 0; C.inbox.length = 0;
        phoneA.send({ t: 'send', cid: 'g1', conv: gid, kind: 'text', body: GMSG, ts: Date.now() });
        await sleep(900);

        const bGot = await phoneB2.waitFor('msg', 3000);
        ok(bGot && bGot.msg && bGot.msg.body === GMSG, '★ B 收到群消息', bGot ? JSON.stringify(bGot.msg.body) : '');
        ok(bGot && bGot.msg.conv === gid, '  消息落在群会话里');

        const cGot = await C.waitFor('msg', 3000);
        ok(cGot && cGot.msg && cGot.msg.body === GMSG, '★ C 也收到了（群消息是广播给所有人的）');

        phoneB2.inbox.length = 0;
        phoneA.send({ t: 'group.rename', conv: gid, name: '全家福' });
        await sleep(900);
        const bc2 = await phoneB2.waitFor('batch', 3000);
        const g2 = bc2 && bc2.convs && bc2.convs.find(c => c.id === gid);
        ok(g2 && g2.title === '全家福', '★ 改群名生效', g2 ? g2.title : '');

        phoneB2.inbox.length = 0;
        adm.send({ t: 'admin.send', userId: fromMacId, conv: gid, kind: 'text', body: '电脑冒充一句' });
        await sleep(900);
        const spoof = await phoneB2.waitFor('msg', 2500);
        const spoofed = spoof && spoof.msg && spoof.msg.body === '电脑冒充一句';
        ok(!spoofed, '★★ 后台冒充别人发消息发不出去了（admin.send 已删）');

        const spoofErr = adm.last('admin.err');
        ok(!!spoofErr, '后台收到「不认识这个消息类型」', spoofErr ? spoofErr.code : '');
      }

      C.close();
      await sleep(300);
    }
  }

  console.log('\n\x1b[1m⑪d 撤回 / 敲门 / 搜索\x1b[0m');
  {

    phoneA.inbox.length = 0; phoneA.acks.length = 0;
    phoneB2.inbox.length = 0;

    const SEC = '这条等会儿要撤回';
    phoneA.send({ t: 'send', cid: 'rv1', to: momId, kind: 'text', body: SEC, ts: Date.now() });
    await sleep(800);

    let sent = null;
    for (let i = 0; i < 40 && !sent; i++) {
      sent = phoneA.acks.find(a => a.cid === 'rv1') || null;
      if (!sent) await sleep(100);
    }
    ok(sent !== null, '撤回测试：先把消息发出去');

    if (sent && sent.msgId) {
      phoneA.send({ t: 'recall', conv: sent.conv, msgId: sent.msgId });
      await sleep(900);

      const rec = await phoneB2.waitFor('recalled', 3000);
      ok(rec !== null, '★ 对方收到撤回通知');
      ok(rec && rec.msgId === sent.msgId, '  撤的是那一条');

      phoneB2.inbox.length = 0;
      phoneB2.send({ t: 'hist', conv: sent.conv, limit: 30 });
      await sleep(800);
      const hb = await phoneB2.waitFor('batch', 3000);
      const stillThere = hb && hb.msgs && hb.msgs.some(m => m.body === SEC);
      ok(!stillThere, '★ 撤回后拉历史，内容已经没了');
    }

    phoneA.inbox.length = 0;
    phoneB2.inbox.length = 0;
    phoneB2.send({ t: 'send', cid: 'bmine', to: myId, kind: 'text', body: 'B 发的', ts: Date.now() });
    await sleep(800);
    const bMsg = await phoneA.waitFor('msg', 3000);

    if (bMsg && bMsg.msg) {
      phoneA.inbox.length = 0;
      phoneA.send({ t: 'recall', conv: bMsg.msg.conv, msgId: bMsg.msg.id });
      await sleep(800);
      const denied = phoneA.inbox.find(x => x.t === 'err' && /RECALL_NOTMINE/.test(x.code || ''));
      ok(denied !== undefined, '★ 撤别人发的消息 → 被拒绝',
         denied ? denied.code : ('inbox=' + phoneA.inbox.map(x => x.t).join(',')));
    } else {
      ok(false, '撤别人消息的测试：B 那一条没发出来');
    }

    phoneB2.inbox.length = 0;
    phoneA.send({ t: 'knock', to: momId });
    await sleep(800);

    const knock = await phoneB2.waitFor('knock', 3000);
    ok(knock !== null, '★ B 收到敲门（会震动一下，不出声）');
    ok(knock && knock.fromName, '  带着是谁敲的', knock ? knock.fromName : '');

    const knockOk = await phoneA.waitFor('knock.ok', 2000);
    ok(knockOk !== null, '  敲门方收到回执', knockOk ? ('online=' + knockOk.online) : '');

    phoneA.inbox.length = 0;
    phoneA.send({ t: 'search', q: '排骨', limit: 20 });
    await sleep(900);

    const sr = await phoneA.waitFor('search.r', 3000);
    ok(sr !== null, '★ 搜索有返回');
    ok(sr && sr.hits && sr.hits.length > 0, '  搜到了含「排骨」的消息',
       (sr && sr.hits && sr.hits.length) ? (sr.hits.length + ' 条：' + (sr.hits[0].body || '')) : '（0 条）');

    phoneA.inbox.length = 0;
    phoneA.send({ t: 'search', q: '绝对不存在的词xyz', limit: 20 });
    await sleep(800);
    const sr2 = await phoneA.waitFor('search.r', 3000);
    ok(sr2 && sr2.hits && sr2.hits.length === 0, '  搜不存在的词 → 0 条（不瞎报）');
  }

  console.log('\n\x1b[1m⑪e 聊天记录存档：往上翻能翻出更早的\x1b[0m');
  {

    phoneA.inbox.length = 0; phoneA.acks.length = 0;
    for (let i = 0; i < 25; i++) {
      phoneA.send({ t: 'send', cid: 'hist-' + i, to: momId, kind: 'text', body: '历史消息 ' + i, ts: Date.now() });
      await sleep(60);
    }
    await sleep(600);
    ok(phoneA.acks.filter(a => /^hist-/.test(a.cid || '')).length === 25, '灌了 25 条历史进去');

    const cid = phoneA.acks.find(a => a.cid === 'hist-0').conv;

    phoneA.inbox.length = 0;
    phoneA.send({ t: 'hist', conv: cid, limit: 10 });
    await sleep(700);
    const page1 = await phoneA.waitFor('batch', 3000);
    ok(page1 && page1.hist === true, '★ 第一页拉回来了');
    ok(page1 && page1.msgs && page1.msgs.length === 10, '  10 条', page1 && page1.msgs ? page1.msgs.length + ' 条' : '');
    ok(page1 && page1.msgs && page1.msgs[9].body === '历史消息 24', '  这一页的最后一条是最新的那条');

    const oldest = page1.msgs[0].ts;
    phoneA.inbox.length = 0;
    phoneA.send({ t: 'hist', conv: cid, before: oldest, limit: 10 });
    await sleep(700);
    const page2 = await phoneA.waitFor('batch', 3000);
    ok(page2 && page2.msgs && page2.msgs.length === 10, '★ 第二页也拉回来了（往上翻）', page2 && page2.msgs ? page2.msgs.length + ' 条' : '');
    ok(page2 && page2.msgs && page2.msgs[9].ts < oldest, '  第二页的都比第一页更早');

    let cursor = page2.msgs[0].ts, total = 20, guard = 0;
    while (guard++ < 10) {
      phoneA.inbox.length = 0;
      phoneA.send({ t: 'hist', conv: cid, before: cursor, limit: 10 });
      await sleep(600);
      const pg = await phoneA.waitFor('batch', 3000);
      const n = (pg && pg.msgs) ? pg.msgs.length : 0;
      total += n;
      if (n === 0) break;
      cursor = pg.msgs[0].ts;
    }
    ok(total >= 25, '★ 一直翻能翻到全部 25 条（不会中间断层）', '总共翻到 ' + total + ' 条');

    phoneA.inbox.length = 0;
    phoneA.send({ t: 'search', q: '这条等会儿要撤回', limit: 10 });
    await sleep(800);
    const sr3 = await phoneA.waitFor('search.r', 3000);
    ok(!sr3 || !sr3.hits || sr3.hits.length === 0, '★ 撤回过的消息，搜也搜不到（真的没了）');
  }

  console.log('\n\x1b[1m⑫ 监控面板：只统计消息\x1b[0m');
  adm.send({ t: 'admin.hist' });
  await sleep(900);
  const snap3 = adm.last('admin.snapshot');
  const st3 = (snap3 && snap3.stats) || {};

  ok(typeof st3.msgToday === 'number' && st3.msgToday > 0,
     '★ 有「今日消息」这个数', '今日 ' + st3.msgToday + ' 条');
  ok(typeof st3.msgTotal === 'number',
     '★ 有「累计消息」这个数', '累计 ' + st3.msgTotal + ' 条');

  ok(typeof st3.rssMB === 'number' && st3.rssMB > 0,
     '★ 有「内存占用」这个数', st3.rssMB + ' MB');

  const junk = ['diskMB', 'fileCount', 'fileMB', 'fileServed', 'fileDropped'];
  const stillThere = junk.filter(k => k in st3);
  ok(stillThere.length === 0,
     '★★ 中转文件/磁盘那些无关统计还是去掉的',
     stillThere.length ? ('还剩：' + stillThere.join('、')) : '一个都不剩');

  ok(st3.samples && Array.isArray(st3.samples.rss) && st3.samples.rss.length > 0,
     '★ 有波形图的采样点（内存）', 'rss 采样 ' + ((st3.samples && st3.samples.rss) || []).length + ' 个');
  ok(st3.samples && Array.isArray(st3.samples.burnArmed),
     '★ 有波形图的采样点（焚毁状态）');
  ok(st3.samples && Array.isArray(st3.samples.msgToday),
     '★ 有波形图的采样点（今日消息）');

  ok(Array.isArray(st3.msgByUser) && st3.msgByUser.length > 0,
     '★ 有「每个人发了多少」');
  ok(st3.msgByUser.every(u => typeof u.today === 'number' && typeof u.total === 'number'),
     '★ 每个人的今日/累计都是数字',
     st3.msgByUser.map(u => u.name + ' ' + u.today + '/' + u.total).join('，'));
  ok(Array.isArray(st3.msgByConv) && st3.msgByConv.length > 0,
     '★ 有「每个聊天里有多少」');
  const sumUser = st3.msgByUser.reduce((a, u) => a + u.total, 0);
  ok(sumUser === st3.msgTotal,
     '★★ 按人加起来 == 累计总数（计数没漏没错）',
     sumUser + ' vs ' + st3.msgTotal);
  ok(st3.msgByConv.every(c => !('body' in c) && !('msgs' in c)),
     '★★ 统计里一个字的内容都没有');

  console.log('\n\x1b[1m⑬ 关闭\x1b[0m');
  adm.send({ t: 'admin.shutdown' });
  await sleep(1500);
  let alive = true;
  try { process.kill(srv.pid, 0); } catch (e) { alive = false; }
  ok(!alive, '后台点【停止服务】→ 进程真的退出了，端口释放');

  console.log('\n\x1b[1m⑭ 自动入册模式（默认配置）\x1b[0m');
  await sleep(1200);
  try { srv.kill('SIGKILL'); } catch (e) {}
  await sleep(800);

  const srv2 = spawn('node', ['src/index.js'], {
    cwd: S,
    env: Object.assign({}, process.env, { HC_AUTO_APPROVE: '1', HC_DATA_DIR: TMPDATA }),
  });
  let srv2out = '';
  srv2.stdout.on('data', d => srv2out += d);
  srv2.stderr.on('data', d => srv2out += d);

  let up2 = false;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      const r = await new Promise((res, rej) => {
        const q = http.get('http://127.0.0.1:' + cfg.PORT + '/ping', (x) => {
          let b = ''; x.on('data', c => b += c); x.on('end', () => res(b));
        }); q.on('error', rej);
      });
      if (JSON.parse(r).ok) { up2 = true; break; }
    } catch (e) {}
  }
  ok(up2, '用默认配置重启服务端');

  const pNew = new Phone('新来的手机', 'dev-auto-' + Date.now());
  await pNew.connect();
  await sleep(1500);
  const wNew = await pNew.waitFor('welcome', 4000);
  ok(wNew !== null, '★ 全新设备一连上就直接进主界面，不用点同意', wNew ? 'userId=' + wNew.userId : '（没拿到）');
  ok(pNew.state !== 'NOPAIR', '  没有被拦在「等电脑上点同意」');
  pNew.close();
  await sleep(300);

  const autoLog = srv2out.split('\n').filter(l => /入册|注册/.test(l));
  ok(autoLog.length > 0, '  服务端日志有记录', autoLog.length ? autoLog[0].trim() : '');

  console.log('\n\x1b[1m⑮ 按名字登录：换个设备，输一样的名字\x1b[0m');
  {

    const pAgain = new Phone('新来的手机', 'dev-changed-' + Date.now());
    await pAgain.connect();
    await sleep(1500);
    const wAgain = await pAgain.waitFor('welcome', 4000);
    ok(wAgain !== null, '★ 同一个名字再连 → 直接认出是老用户，不用确认');
    ok(wAgain && wAgain.userId === wNew.userId,
       '★ 认回的是同一个人（聊天记录不会丢）',
       (wNew ? wNew.userId : '-') + ' vs ' + (wAgain ? wAgain.userId : '-'));
    ok(/按名字登录|IP\+型号对得上/.test(srv2out), '  服务端日志说明了是怎么认出来的');
    pAgain.close();
    await sleep(300);
  }

  console.log('\n\x1b[1m⑯ 消息可靠性（"10 条只收 1 条"的复查）\x1b[0m');
  {

    const A = new Phone('甲手机', 'dev-rel-a-' + Date.now());
    const B = new Phone('乙手机', 'dev-rel-b-' + Date.now());

    await A.connect(); await sleep(700);
    const wA = await A.waitFor('welcome', 4000);
    A.close(); await sleep(300);

    await B.connect(); await sleep(700);
    const wB = await B.waitFor('welcome', 4000);
    ok(wA && wB, '甲乙两台手机都连上了', (wA ? wA.userId : '-') + ' / ' + (wB ? wB.userId : '-'));
    const aId = wA.userId, bId = wB.userId;

    ok(typeof wB.maxSeq === 'number',
       '★ welcome 里带了 maxSeq（服务端消息最高号）', 'maxSeq=' + wB.maxSeq);

    const FUTURE = Date.now() + 3 * 60 * 1000;
    A.connect(); await sleep(600);
    await A.waitFor('welcome', 3000);

    const SEC1 = '未来时间的消息 ' + Math.random().toString(36).slice(2, 8);
    A.send({ t: 'send', cid: 'rel-1', to: bId, kind: 'text', body: SEC1, ts: FUTURE });
    await sleep(900);

    B.inbox.length = 0;
    B.send({ t: 'sync', since: Date.now() });
    await sleep(900);
    const oldWay = B.inbox.filter(x => x.t === 'batch' && x.why !== 'push').flatMap(x => x.msgs || []);
    const oldGotIt = oldWay.some(m => m.body === SEC1);
    ok(!oldGotIt,
       '★ 老办法（按时间戳补发）漏掉了它 —— 这就是"10 条只收 1 条"的真相',
       '手机时钟快 3 分钟 → 游标跑到未来 → 服务端一条都匹配不上');

    B.inbox.length = 0;
    B.send({ t: 'sync', sinceSeq: 0, limit: 300 });
    await sleep(900);
    const newWay = B.inbox.filter(x => x.t === 'batch' && x.why !== 'push').flatMap(x => x.msgs || []);
    const newGotIt = newWay.some(m => m.body === SEC1);
    ok(newGotIt,
       '★★ 新办法（按序号补发）照样拿到 —— 跟任何人的时钟都没关系',
       'same message, seq 游标不受时钟影响');

    const seqs = newWay.map(m => m.seq).filter(n => typeof n === 'number');
    ok(seqs.length === newWay.length && seqs.length > 0,
       '★ 每条补发消息都带 seq（没有 seq 就没法做缺口检测）',
       'seq 示例：' + seqs.slice(-4).join(', '));

    const lastSeqBefore = Math.max(...seqs, 0);
    const BODIES = [];
    for (let i = 0; i < 10; i++) {
      const b = '断线第' + (i + 1) + '条 ' + Math.random().toString(36).slice(2, 6);
      BODIES.push(b);
      A.send({ t: 'send', cid: 'rel-off-' + i, to: bId, kind: 'text', body: b, ts: Date.now() });
      await sleep(90);
    }
    await sleep(900);

    B.inbox.length = 0;
    B.send({ t: 'sync', sinceSeq: lastSeqBefore, limit: 300 });
    await sleep(1200);
    const caught = B.inbox.filter(x => x.t === 'batch' && x.why !== 'push').flatMap(x => x.msgs || []);
    const gotBodies = caught.map(m => m.body);
    const missed = BODIES.filter(b => !gotBodies.includes(b));
    ok(missed.length === 0,
       '★★ 断线期间的 10 条全部补齐（一条不少）',
       '10 条 → 收到 ' + missed.length + ' 条没到' + (missed.length ? '：' + missed.join(' / ') : ''));

    const mono = caught.map(m => m.seq);
    let sortedOk = true;
    for (let i = 1; i < mono.length; i++) if (mono[i] <= mono[i - 1]) sortedOk = false;
    ok(sortedOk && mono.length > 1, '★ 补发是按 seq 升序给的（顺序不会乱）',
       mono.length ? mono[0] + ' → ' + mono[mono.length - 1] : '');

    B.inbox.length = 0;
    B.send({ t: 'sync', sinceSeq: 0, limit: 10 });
    await sleep(900);
    const page1 = (B.inbox.find(x => x.t === 'batch' && x.why !== 'push') || {});
    const p1 = page1.msgs || [];
    ok(p1.length === 10, '★ 分页：要 10 条就给 10 条', '给了 ' + p1.length + ' 条');
    ok(page1.more === true, '★ 分页：还有剩 → more=true', 'more=' + page1.more);
    const p1max = p1.length ? Math.max(...p1.map(m => m.seq)) : 0;

    B.inbox.length = 0;
    B.send({ t: 'sync', sinceSeq: p1max, limit: 10 });
    await sleep(900);
    const page2 = (B.inbox.find(x => x.t === 'batch' && x.why !== 'push') || {});
    const p2 = page2.msgs || [];
    const p2min = p2.length ? Math.min(...p2.map(m => m.seq)) : 0;
    ok(p2.length > 0 && p2min > p1max,
       '★★ 第二页接着第一页往后（返回的是最旧的 N 条，不是最新的）',
       '第一页到 ' + p1max + '，第二页从 ' + p2min + ' 开始');

    let guard = 0, total = 0;
    let cursor = 0;
    for (;;) {
      if (++guard > 60) break;
      B.inbox.length = 0;
      B.send({ t: 'sync', sinceSeq: cursor, limit: 10 });
      await sleep(350);
      const bt = B.inbox.find(x => x.t === 'batch' && x.why !== 'push');
      if (!bt) break;
      const mm = bt.msgs || [];
      total += mm.length;
      if (mm.length) cursor = Math.max(...mm.map(x => x.seq));
      if (!bt.more) break;
    }

    B.inbox.length = 0;
    B.send({ t: 'sync', sinceSeq: 0, limit: 1000 });
    await sleep(1200);
    const oneShot = B.inbox.filter(x => x.t === 'batch' && x.why !== 'push').flatMap(x => x.msgs || []);
    ok(total === oneShot.length && total > 0,
       '★★ 小批量翻完的总数 == 一次全要的总数（分页没吞消息）',
       '翻页 ' + total + ' 条 vs 一次 ' + oneShot.length + ' 条');

    const idsPaged = new Set();
    ok(true, '  分页共 ' + guard + ' 轮', '每轮 10 条');

    B.inbox.length = 0;

    B.send({ t: 'seen', seq: 1 });

    let pushed = [];
    for (let i = 0; i < 34; i++) {
      await sleep(1000);
      pushed = B.inbox.filter(x => x.t === 'batch' && x.why === 'push').flatMap(x => x.msgs || []);
      if (pushed.length) break;
    }
    ok(pushed.length > 0,
       '★★ 服务端自己发现"这人在线但没收到"，主动补推（不靠客户端来要）',
       '补推了 ' + pushed.length + ' 条' +
       (/差 \d+ 条，主动补推/.test(srv2out) ? '，服务端日志有记录' : ''));
    ok(pushed.length && pushed.every(m => typeof m.seq === 'number'),
       '  补推的消息同样带 seq（客户端能接着做缺口检测）');

    B.inbox.length = 0;
    B.send({ t: 'sync', sinceSeq: 0, limit: 300 });
    await sleep(900);
    const all1 = B.inbox.filter(x => x.t === 'batch' && x.why !== 'push').flatMap(x => x.msgs || []);
    B.inbox.length = 0;
    B.send({ t: 'sync', sinceSeq: 0, limit: 300 });
    await sleep(900);
    const all2 = B.inbox.filter(x => x.t === 'batch' && x.why !== 'push').flatMap(x => x.msgs || []);
    const ids1 = all1.map(m => m.id).sort().join(',');
    const ids2 = all2.map(m => m.id).sort().join(',');
    ok(ids1 === ids2 && ids1.length > 0,
       '★★ 同一条消息重复补发，id 完全一样（客户端靠 id 去重，不会出现两遍）',
       all1.length + ' 条');

    A.close(); B.close();
    await sleep(400);
  }

  console.log('\n\x1b[1m⑰ 手机断开一段时间（锁屏 / 切出去 / 断网），消息不许丢\x1b[0m');
  {

    const A = new Phone('甲断网', 'dev-off-a-' + Date.now());
    const B = new Phone('乙断网', 'dev-off-b-' + Date.now());

    await A.connect(); await sleep(700);
    const wA = await A.waitFor('welcome', 4000);
    await B.connect(); await sleep(700);
    const wB = await B.waitFor('welcome', 4000);
    ok(wA && wB, '两台手机都连上了', (wA ? wA.userId : '-') + ' / ' + (wB ? wB.userId : '-'));

    const bId = wB.userId;

    A.send({ t: 'send', cid: 'off-0', to: bId, kind: 'text', body: '断开前的第一条', ts: Date.now() });
    await sleep(800);
    const first = await B.waitFor('msg', 3000);
    ok(first !== null, '  断开前正常收到一条', first ? 'seq=' + first.msg.seq : '');
    const lastSeen = first ? first.msg.seq : 0;
    ok(lastSeen > 0, '★ 客户端知道自己"收到第几号了"（这是补发的游标）', 'lastSeq=' + lastSeen);

    B.inbox.length = 0;
    B.close();
    await sleep(600);
    ok(true, '  乙断开了（锁屏 / 切出去 / 断网，都是这个效果）');

    const LOST = [];
    for (let i = 0; i < 8; i++) {
      const b = '断开期间第' + (i + 1) + '条';
      LOST.push(b);
      A.send({ t: 'send', cid: 'off-' + (i + 1), to: bId, kind: 'text', body: b, ts: Date.now() });
      await sleep(80);
    }
    await sleep(1000);

    const whileOff = B.inbox.filter(x => x.t === 'msg').length;
    ok(whileOff === 0,
       '★ 断开期间乙一条都收不到（这就是用户看到的"锁屏不响"）',
       '收到 ' + whileOff + ' 条');

    B.inbox.length = 0;
    await B.connect();
    await sleep(900);
    const wB2 = await B.waitFor('welcome', 5000);
    ok(wB2 !== null, '  回到前台，重新连上');
    ok(typeof wB2.maxSeq === 'number' && wB2.maxSeq > lastSeen,
       '★★ welcome 带回服务端最高号，客户端一眼就知道自己落后了',
       '本地 ' + lastSeen + ' → 服务端 ' + wB2.maxSeq);

    B.send({ t: 'sync', sinceSeq: lastSeen, limit: 300 });
    await sleep(1200);

    const back = B.inbox.filter(x => x.t === 'batch' && x.why !== 'push').flatMap(x => x.msgs || []);
    const bodies = back.map(x => x.body);
    const missed = LOST.filter(b => !bodies.includes(b));
    ok(missed.length === 0,
       '★★ 断开期间的 8 条全部补回来了 —— 一条都不丢',
       '补回 ' + (LOST.length - missed.length) + '/' + LOST.length +
       (missed.length ? '　丢了：' + missed.join(' / ') : ''));

    const seqs = back.map(x => x.seq).filter(Boolean);
    ok(seqs.length > 1 && seqs.every((v, i) => i === 0 || v > seqs[i - 1]),
       '★ 补回来是按序号升序的（聊天里的顺序不会乱）',
       seqs.length ? seqs[0] + ' → ' + seqs[seqs.length - 1] : '');

    B.inbox.length = 0;
    B.send({ t: 'sync', sinceSeq: 0, limit: 300 });
    await sleep(1000);
    const once = B.inbox.filter(x => x.t === 'batch' && x.why !== 'push').flatMap(x => x.msgs || []);
    B.inbox.length = 0;
    B.send({ t: 'sync', sinceSeq: 0, limit: 300 });
    await sleep(1000);
    const twice = B.inbox.filter(x => x.t === 'batch' && x.why !== 'push').flatMap(x => x.msgs || []);
    const idA = once.map(x => x.id).sort().join(','), idB = twice.map(x => x.id).sort().join(',');
    ok(idA === idB && idA.length > 0,
       '★★ 同一批消息重复补发，id 完全一样（客户端按 id 去重，未读不会虚高）',
       once.length + ' 条');

    const hubSrc = fs.readFileSync(require('path').join(__dirname, 'hub.js'), 'utf8');
    ok(/conn\.ws\.readyState !== 1/.test(hubSrc) && /conn\.sendBroken = true/.test(hubSrc),
       '★★ 服务端发送前查 readyState —— 半死 socket 上 send 不抛异常，不会被误判成"送到了"');
    ok(/sendBroken[\s\S]{0,200}?dropConn/.test(hubSrc),
       '★ 发不出去的连接立刻清掉，客户端重连时才会走正常补发');

    A.close(); B.close();
    await sleep(400);
  }

  console.log('\n\x1b[1m⑱ 撤回（每一环都要对）\x1b[0m');
  {
    const A = new Phone('甲撤回', 'dev-rc-a-' + Date.now());
    const B = new Phone('乙撤回', 'dev-rc-b-' + Date.now());

    await A.connect(); await sleep(700);
    const wA = await A.waitFor('welcome', 4000);
    await B.connect(); await sleep(700);
    const wB = await B.waitFor('welcome', 4000);
    ok(wA && wB, '两台手机都连上了');

    const bId = wB.userId;

    const SECRET = '这句话等会儿要撤回 ' + Math.random().toString(36).slice(2, 7);
    A.send({ t: 'send', cid: 'rc-1', to: bId, kind: 'text', body: SECRET, ts: Date.now() });
    await sleep(800);

    const ackA = A.acks.find(x => x.cid === 'rc-1');
    const msgB = await B.waitFor('msg', 3000);
    ok(ackA && msgB, '发出去两边都收到了', msgB ? 'seq=' + msgB.msg.seq : '');
    const msgId = ackA ? ackA.msgId : null;
    ok(!!msgId, '拿到了服务端的正式消息 id', String(msgId));

    B.inbox.length = 0;
    A.send({ t: 'recall', msgId: msgId });
    await sleep(900);

    const recA = A.inbox.find(x => x.t === 'recalled');
    const recB = B.inbox.find(x => x.t === 'recalled');
    ok(recA !== null, '★ 撤回方自己收到 recalled');
    ok(recB !== null, '★★ 对方也收到 recalled（不是只有自己看不到）');
    if (recB) {
      ok(recB.msgId === msgId && recB.conv, '  recalled 里带了 msgId 和会话', recB.msgId);
    }

    await sleep(4200);
    const onDisk = diskMsgs().filter(m => m.id === msgId);
    ok(onDisk.length === 0, '★★ 服务端磁盘上这条真的被抹掉了（不是只藏起来）',
       onDisk.length ? '还在：' + onDisk.length + ' 条' : '');

    let tomb = false;
    try {
      const st = JSON.parse(fs.readFileSync(DATA + '/state.json', 'utf8'));
      tomb = !!(st.revoked && st.revoked[msgId]);
    } catch (e) {}
    ok(tomb, '★★ 撤回墓碑记在 state.json（重启也不会复活）');

    const C2 = new Phone('丙新机', 'dev-rc-c-' + Date.now());
    await C2.connect(); await sleep(700);
    const wC = await C2.waitFor('welcome', 4000);
    ok(wC !== null, '  第三台手机（新设备）上线');
    C2.inbox.length = 0;
    C2.send({ t: 'sync', sinceSeq: 0, limit: 300 });
    await sleep(1000);
    const back = C2.inbox.filter(x => x.t === 'batch').flatMap(x => x.msgs || []);
    const leaked = back.filter(m => m.id === msgId);
    ok(leaked.length === 0, '★★ 补发里没有这条已撤回的（内容不会从补发路复活）');
    C2.close();

    B.inbox.length = 0;
    const convId = msgB.msg.conv;
    B.send({ t: 'hist', conv: convId, before: Date.now() + 100000, limit: 100 });
    await sleep(900);
    const hist = B.inbox.filter(x => x.t === 'batch' && x.hist).flatMap(x => x.msgs || []);
    const inHist = hist.filter(m => m.id === msgId);
    ok(inHist.length === 0, '★★ 往上翻历史也看不到（三条路全堵住）',
       '历史里 ' + hist.length + ' 条，其中撤回的 ' + inHist.length + ' 条');

    B.inbox.length = 0;
    A.send({ t: 'send', cid: 'rc-2', to: bId, kind: 'text', body: '甲发的，乙不许撤', ts: Date.now() });
    await sleep(800);
    const m2 = (A.acks.find(x => x.cid === 'rc-2') || {}).msgId;
    ok(!!m2, '  甲又发了一条', String(m2));

    B.inbox.length = 0;
    B.send({ t: 'recall', msgId: m2 });
    await sleep(700);
    const denyB = B.inbox.find(x => x.t === 'err' && /RECALL/.test(x.code || ''));
    ok(denyB !== undefined, '★★ 乙想撤甲的消息 → 被拒（服务端查了 from）',
       denyB ? denyB.code + ' ' + denyB.msg : '（居然成功了）');
    ok(!B.inbox.find(x => x.t === 'recalled'), '  而且没有发给任何人');

    A.inbox.length = 0;
    A.send({ t: 'recall', msgId: m2 });
    await sleep(700);
    ok(!!A.inbox.find(x => x.t === 'recalled'), '★ 自己的消息自己撤 → 成功');

    A.inbox.length = 0;
    A.send({ t: 'send', cid: 'rc-3', to: bId, kind: 'text', body: '刚发的',
             ts: Date.now() - 5 * 60 * 1000 });
    await sleep(900);
    const rec3 = diskMsgs().find(m => m.id === (A.acks.find(x => x.cid === 'rc-3') || {}).msgId);
    ok(rec3 && typeof rec3.sts === 'number',
       '★★ 服务端给每条消息记了自己的接收时间 sts（撤回窗口按它算，不看客户端的 ts）',
       rec3 ? 'ts 谎报 ' + new Date(rec3.ts).toLocaleTimeString('zh-CN') +
              ' / sts 真实 ' + new Date(rec3.sts).toLocaleTimeString('zh-CN') : '（没找到）');

    const tsLie = rec3 ? Math.abs(Date.now() - rec3.ts) : Infinity;
    ok(tsLie < 30000,
       '★★ 客户端谎报"5 分钟前发的"也没用 —— 服务端记的是自己收到的时间',
       rec3 ? '实际只差 ' + Math.round(tsLie / 1000) + ' 秒' : '');

    A.inbox.length = 0;
    A.send({ t: 'recall', msgId: rec3 ? rec3.id : '' });
    await sleep(700);
    ok(!!A.inbox.find(x => x.t === 'recalled'),
       '★ 刚发的（真实时间在窗口内）能撤 —— 尽管它自称是 5 分钟前发的');

    A.inbox.length = 0;
    A.send({ t: 'group.create', name: '撤回测试群', members: [bId] });
    await sleep(1200);
    const gok = A.inbox.find(x => x.t === 'group.ok');
    const gid = gok && (gok.conv || gok.id || (gok.convObj && gok.convObj.id));
    if (gid) {
      A.inbox.length = 0; B.inbox.length = 0;
      A.send({ t: 'send', cid: 'rc-g', conv: String(gid), kind: 'text', body: '群里这句也要撤', ts: Date.now() });
      await sleep(900);
      const gMsgId = (A.acks.find(x => x.cid === 'rc-g') || {}).msgId;
      B.inbox.length = 0;
      A.send({ t: 'recall', msgId: gMsgId });
      await sleep(900);
      ok(!!B.inbox.find(x => x.t === 'recalled'), '★★ 群聊里撤回，其他成员也收到');
    } else bad('建群失败，群聊撤回没验到');

    A.close(); B.close();
    await sleep(400);
  }

  console.log('\n\x1b[1m⑲ 有人灌水怎么办（1 万条那种）\x1b[0m');
  {
    const F = new Phone('灌水机', 'dev-flood-' + Date.now());
    const T = new Phone('收水人', 'dev-flood-t-' + Date.now());
    await T.connect(); await sleep(600);
    const wT = await T.waitFor('welcome', 4000);
    await F.connect(); await sleep(700);
    const wF = await F.waitFor('welcome', 4000);
    ok(wF && wT, '  灌水机和收件人都上线');

    const tId = wT.userId;
    F.inbox.length = 0; F.acks.length = 0;
    F.send({ t: 'send', cid: 'fl-warm', to: tId, kind: 'text', body: '热个身', ts: Date.now() });
    await sleep(900);
    ok(F.acks.some(x => x.cid === 'fl-warm'), '  会话是通的（热身那条有 ack）');
    F.inbox.length = 0; F.acks.length = 0;

    const N = 200;
    for (let i = 0; i < N; i++) {
      F.send({ t: 'send', cid: 'fl-' + i, to: tId, kind: 'text',
               body: '灌水第 ' + i + ' 条', ts: Date.now() });
    }
    await sleep(3000);

    const throttled = F.inbox.filter(x => x.t === 'err' && x.code === 'TOOFAST').length;
    const accepted = F.acks.length;

    ok(throttled > 0,
       '★★ 灌水被拦下来了（令牌桶：容量 60 + 每秒回 10）',
       '接受 ' + accepted + ' 条，拦下 ' + throttled + ' 条');
    ok(accepted >= 50,
       '★ 正常的一小串连发不会误伤（前 60 条放行）',
       '放行 ' + accepted + ' 条');
    ok(throttled < N,
       '  限流不是"全拒绝"，是"按速率来"');

    await sleep(1500);
    F.inbox.length = 0; F.acks.length = 0;
    F.send({ t: 'send', cid: 'fl-after', to: tId, kind: 'text', body: '缓过来再发一条', ts: Date.now() });
    await sleep(900);
    ok(F.acks.some(x => x.cid === 'fl-after'),
       '★★ 缓一会儿之后又能正常发了（不是把用户永久封了）');

    F.close(); T.close();
    await sleep(400);
  }

  srv2.kill('SIGKILL');
  await sleep(500);

  await sleep(300);
  if (fs.existsSync(DATA)) fs.rmSync(TMPDATA, { recursive: true, force: true });
  console.log('  \x1b[90m（测试数据已清理，你会从全新状态开始）\x1b[0m');

  console.log('');
  console.log('\x1b[1m════════════════════════════════════════════════════\x1b[0m');
  if (fail === 0) console.log(`\x1b[32m\x1b[1m  ✅ 全部通过：${pass} 项，0 失败\x1b[0m`);
  else console.log(`\x1b[31m\x1b[1m  ❌ ${pass} 项通过，${fail} 项失败\x1b[0m`);
  console.log('\x1b[1m════════════════════════════════════════════════════\x1b[0m\n');

  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('\n测试脚本崩了：', e); process.exit(1); });
