'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const nodeCrypto = require('crypto');

const C   = require('./crypto');
const cfg = require('./config');

let bad = 0, good = 0;

function ok(cond, label, extra) {
  if (cond) { good++; console.log(`  \x1b[32m✔\x1b[0m ${label}${extra ? '  \x1b[90m' + extra + '\x1b[0m' : ''}`); }
  else { bad++; console.log(`  \x1b[31m✘\x1b[0m ${label}${extra ? '  ' + extra : ''}`); }
}

function hex(b) { return Buffer.from(b).toString('hex'); }

console.log('\n\x1b[1mHome Chat 交叉验证：手机端 JS 加密 ⇄ 服务端 Node 加密\x1b[0m\n');

const hc1Path = path.join(cfg.ROOT, 'app', 'js', 'hc1.js');
if (!fs.existsSync(hc1Path)) {
  console.error('  ✘ 找不到 ' + hc1Path);
  process.exit(1);
}

const src = fs.readFileSync(hc1Path, 'utf8');

const sandbox = {
  console: console,
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  crypto: {
    getRandomValues: (arr) => {
      const b = nodeCrypto.randomBytes(arr.length);
      for (let i = 0; i < arr.length; i++) arr[i] = b[i];
      return arr;
    },
  },
};
sandbox.window = sandbox;

vm.createContext(sandbox);
try {
  vm.runInContext(src, sandbox, { filename: 'app/js/hc1.js' });
} catch (e) {
  console.error('  \x1b[31m✘ 手机端 hc1.js 跑不起来：' + e.message + '\x1b[0m');
  process.exit(1);
}

const JS = sandbox.HC && sandbox.HC.crypto;
if (!JS) { console.error('  ✘ hc1.js 没有导出 HC.crypto'); process.exit(1); }
console.log('  \x1b[90m手机端代码已载入沙箱，导出 ' + Object.keys(JS).length + ' 个函数\x1b[0m\n');

console.log('  \x1b[1m① 手机端自己的自检（标准测试向量）\x1b[0m');
{
  const r = JS.selfTest();
  ok(r.ok, '手机端 selfTest() 全部通过');
  if (!r.ok) for (const f of r.fails) console.log('      \x1b[31m→ ' + f + '\x1b[0m');
  ok(!r.weakRandom, '手机端拿到了真正的随机数源（不是 Math.random 兜底）');
}

console.log('\n  \x1b[1m② 密钥派生是否一致（PBKDF2）\x1b[0m');
{
  const iters = 2000;
  const pwd = cfg.PASSWORD;

  const t0 = Date.now();
  const nodeKey = C.deriveMaster(pwd, iters);
  const nodeMs = Date.now() - t0;

  const t1 = Date.now();
  const jsKey = JS.deriveMaster(pwd, iters);
  const jsMs = Date.now() - t1;

  ok(hex(nodeKey) === hex(jsKey), '主密钥逐字节相同',
     `服务端 ${nodeMs}ms / 手机端 ${jsMs}ms`);

  const nk = C.subkeys(nodeKey);
  const jk = JS.subkeys(jsKey);
  ok(hex(nk.kEnc) === hex(jk.kEnc), 'kEnc（加密子密钥）相同');
  ok(hex(nk.kMac) === hex(jk.kMac), 'kMac（签名子密钥）相同');
}

console.log('\n  \x1b[1m③ 双向加解密（真正要命的一环）\x1b[0m');
{
  const nodeKey = C.deriveMaster(cfg.PASSWORD, 1000);
  const jsKey   = JS.deriveMaster(cfg.PASSWORD, 1000);
  const nk = C.subkeys(nodeKey);
  const jk = JS.subkeys(jsKey);

  const msg = {
    t: 'send', cid: 'cx1', conv: 'c_test',
    kind: 'text', body: '吃饭了 🍚 今天回来吗？', ts: 1736000000000,
  };
  const fromPhone = JS.seal(jk.kEnc, jk.kMac, msg);
  const atServer  = C.open(nk.kEnc, nk.kMac, fromPhone);
  ok(atServer && JSON.stringify(atServer) === JSON.stringify(msg),
     '手机加密 → 服务端解密', '含中文和 Emoji');

  const reply = { t: 'msg', msg: { id: 'm1', body: '马上到', kind: 'text' } };
  const fromServer = C.seal(nk.kEnc, nk.kMac, reply);
  const atPhone    = JS.open(jk.kEnc, jk.kMac, fromServer);
  ok(atPhone && JSON.stringify(atPhone) === JSON.stringify(reply),
     '服务端加密 → 手机解密');

  ok(Object.keys(fromPhone).sort().join(',') === 'c,m,n,v',
     '信封字段结构一致', Object.keys(fromPhone).join(','));

  const wrongJs = JS.subkeys(JS.deriveMaster('999999', 1000));
  ok(C.open(nk.kEnc, nk.kMac, JS.seal(wrongJs.kEnc, wrongJs.kMac, msg)) === null,
     '手机用错密码 → 服务端拒绝');

  const wrongNode = C.subkeys(C.deriveMaster('999999', 1000));
  ok(JS.open(jk.kEnc, jk.kMac, C.seal(wrongNode.kEnc, wrongNode.kMac, reply)) === null,
     '服务端用错密码 → 手机拒绝');
}

console.log('\n  \x1b[1m④ 图片 / 文件的分块加密（二进制）\x1b[0m');
{
  const nodeKey = C.deriveMaster(cfg.PASSWORD, 1000);
  const jsKey   = JS.deriveMaster(cfg.PASSWORD, 1000);
  const nk = C.subkeys(nodeKey);
  const jk = JS.subkeys(jsKey);

  const chunk = nodeCrypto.randomBytes(cfg.MAX_CHUNK);

  const sealedByPhone = JS.sealBytes(jk.kEnc, jk.kMac, new Uint8Array(chunk));
  const openedAtServer = C.openRaw(nk.kEnc, nk.kMac, sealedByPhone);
  ok(openedAtServer && openedAtServer.length === chunk.length &&
     openedAtServer.equals(chunk),
     `手机加密 ${(chunk.length / 1024).toFixed(0)}KB 分块 → 服务端完整还原`);

  const sealedByServer = C.sealBuf(nk.kEnc, nk.kMac, chunk);
  const openedAtPhone  = JS.openBytes(jk.kEnc, jk.kMac, sealedByServer);
  ok(openedAtPhone && Buffer.from(openedAtPhone).equals(chunk),
     `服务端加密 ${(chunk.length / 1024).toFixed(0)}KB 分块 → 手机完整还原`);

  const raw = Buffer.from(sealedByServer.c, 'base64');
  raw[Math.floor(raw.length / 2)] ^= 0x01;
  sealedByServer.c = raw.toString('base64');
  ok(JS.openBytes(jk.kEnc, jk.kMac, sealedByServer) === null,
     '改过中间一个字节 → 手机检测出来并拒绝');
}

console.log('\n  \x1b[1m⑤ 密钥流按块寻址（大文件分块上传依赖这个性质）\x1b[0m');
{
  const nodeKey = C.deriveMaster(cfg.PASSWORD, 1000);
  const jsKey   = JS.deriveMaster(cfg.PASSWORD, 1000);
  const nk = C.subkeys(nodeKey);
  const jk = JS.subkeys(jsKey);

  const nonce = new Uint8Array(16);
  for (let i = 0; i < 16; i++) nonce[i] = i * 3;

  const nodeKs = C.keystream(nk.kEnc, Buffer.from(nonce), 128, 0);
  const jsKs   = JS.keystream(jk.kEnc, nonce, 128, 0);
  ok(hex(nodeKs) === hex(jsKs), '两端密钥流逐字节相同（偏移 0，128 字节）');

  const nodeKs2 = C.keystream(nk.kEnc, Buffer.from(nonce), 32, 2);
  const jsKs2   = JS.keystream(jk.kEnc, nonce, 32, 2);
  ok(hex(nodeKs2) === hex(jsKs2), '两端密钥流逐字节相同（偏移 2，32 字节）');
  ok(hex(nodeKs.slice(64, 96)) === hex(nodeKs2), '偏移 2 的块 = 偏移 0 的第 3 块（寻址正确）');
}

console.log('\n  \x1b[1m⑥ 手机端性能（在你手机上大概也是这个量级）\x1b[0m');
{
  const iters = cfg.PBKDF2_ITERATIONS;

  const t0 = Date.now();
  JS.deriveMaster(cfg.PASSWORD, iters);
  const ms = Date.now() - t0;

  const secs = (ms / 1000).toFixed(1);
  ok(true, `PBKDF2 跑满 ${iters.toLocaleString()} 轮耗时 ${ms}ms（${secs} 秒）`);

  if (ms > 8000) {
    console.log('      \x1b[33m⚠ 电脑上都要 ' + secs + ' 秒，手机会更久。' +
                '建议把 config.js 里的 PBKDF2_ITERATIONS 调小到 100000。\x1b[0m');
  } else {
    console.log('      \x1b[90m注意：这是电脑的速度，手机通常是 1.5~3 倍时间。' +
                '反正只在第一次配对时算一次。\x1b[0m');
  }

  const jsKey = JS.deriveMaster(cfg.PASSWORD, 1000);
  const jk = JS.subkeys(jsKey);
  const t1 = Date.now();
  for (let i = 0; i < 100; i++) {
    JS.open(jk.kEnc, jk.kMac, JS.seal(jk.kEnc, jk.kMac, { body: '吃饭了，今天回来吗' }));
  }
  const ms2 = Date.now() - t1;
  ok(true, `100 条文字消息加解密往返 ${ms2}ms（单条 ${(ms2 / 100).toFixed(2)}ms）`);
}

console.log('');
if (bad === 0) {
  console.log('\x1b[32m\x1b[1m  ══════════════════════════════════════════════════\x1b[0m');
  console.log('\x1b[32m\x1b[1m   全部通过 —— 手机端和服务端的加密是兼容的。\x1b[0m');
  console.log('\x1b[32m\x1b[1m   手机能解开服务端的数据，服务端也能解开手机的。\x1b[0m');
  console.log('\x1b[32m\x1b[1m  ══════════════════════════════════════════════════\x1b[0m');
  console.log(`\n  ${good} 项通过，0 项失败\n`);
  process.exit(0);
} else {
  console.log('\x1b[31m\x1b[1m  ' + bad + ' 项失败 —— 加密层不兼容，先别往下走。\x1b[0m');
  console.log('\x1b[31m  把上面的红字发给开发者。\x1b[0m\n');
  process.exit(1);
}
