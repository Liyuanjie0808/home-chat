'use strict';

const C = require('./crypto');
const cfg = require('./config');

let bad = 0;

function line(ok, label, extra) {
  const mark = ok ? '\x1b[32m✔\x1b[0m' : '\x1b[31m✘\x1b[0m';
  console.log(`  ${mark} ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) bad++;
}

console.log('\n\x1b[1mHome Chat 自检\x1b[0m\n');

console.log('  加密层（SHA-256 / HMAC / PBKDF2 标准测试向量）');
const r = C.selfTest();
if (r.ok) {
  line(true, '全部测试向量通过');
} else {
  for (const f of r.fails) line(false, f);
}

console.log('\n  密钥派生（用当前配置的密码和迭代次数）');
{
  const t0 = Date.now();
  const master = C.deriveMaster(cfg.PASSWORD, cfg.PBKDF2_ITERATIONS);
  const ms = Date.now() - t0;
  line(master.length === 32, `主密钥 32 字节`, `耗时 ${ms}ms（迭代 ${cfg.PBKDF2_ITERATIONS.toLocaleString()} 次）`);
  if (ms > 3000) line(false, `密钥派生太慢（${ms}ms），建议调低 config.js 里的 PBKDF2_ITERATIONS`);

  const { kEnc, kMac } = C.subkeys(master);
  line(kEnc.length === 32 && kMac.length === 32, '加密/签名子密钥已分离派生');
  line(kEnc.toString('hex') !== kMac.toString('hex'), '两个子密钥不相同');

  const env = C.seal(kEnc, kMac, { t: 'send', body: '吃饭了' });
  const back = C.open(kEnc, kMac, env);
  line(back && back.body === '吃饭了', '真实密钥下加解密回环正确');
}

console.log('\n  边界情况');
{
  const { kEnc, kMac } = C.subkeys(C.deriveMaster(cfg.PASSWORD, 1000));
  const cases = [
    ['空字符串', ''],
    ['中文', '今天回来吃饭吗？我买了排骨 🍖'],
    ['Emoji', '👨‍👩‍👧‍👦 🎉🚀'],
    ['超长文本', '啊'.repeat(20000)],
    ['单字节', 'x'],
  ];
  for (const [label, body] of cases) {
    const back = C.open(kEnc, kMac, C.seal(kEnc, kMac, { body }));
    line(back && back.body === body, label, `${Buffer.byteLength(body, 'utf8')} 字节`);
  }

  const bin = require('crypto').randomBytes(200000);
  const back = C.openRaw(kEnc, kMac, C.sealBuf(kEnc, kMac, bin));
  line(back && back.equals(bin), '200KB 二进制回环');
}

console.log('\n  运行环境');
{
  line(Number(process.versions.node.split('.')[0]) >= 18, `Node.js ${process.versions.node}`);
  const os = require('os');
  const freeGB = (os.freemem() / 1024 / 1024 / 1024).toFixed(1);
  line(true, `平台 ${process.platform}`, `空闲内存 ${freeGB} GB`);
  line(process.memoryUsage().rss < 200 * 1024 * 1024,
       `自检进程内存 ${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)} MB`);
}

console.log('\n  依赖');
{
  try {
    require('ws');
    line(true, 'ws 已安装');
  } catch (e) {
    line(false, 'ws 未安装 —— 请先运行： npm install');
  }
}

console.log('');
if (bad === 0) {
  console.log('\x1b[32m\x1b[1m  全部通过，可以启动服务端了。\x1b[0m\n');
  process.exit(0);
} else {
  console.log(`\x1b[31m\x1b[1m  ${bad} 项失败，先别启动。\x1b[0m\n`);
  process.exit(1);
}
