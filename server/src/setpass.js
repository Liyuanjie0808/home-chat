'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const C = require('./crypto');

const argv = process.argv.slice(2);
function argVal(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}

const ROOT = path.resolve(__dirname, '..', '..');
const DATA = argVal('--data') || process.env.HC_DATA_DIR || path.join(ROOT, 'data');

const MSG_FILE  = path.join(DATA, 'messages.jsonl');
const KEY_FILE  = path.join(DATA, 'master.key');
const LOCAL_CFG = path.join(DATA, 'config.local.json');

const ITERATIONS = 300000;

const W = 62;
function rule(c) { console.log('  ' + (c || '-').repeat(W)); }
function ok(s)   { console.log('  \x1b[32m✔\x1b[0m ' + s); }
function warn(s) { console.log('  \x1b[33m!\x1b[0m ' + s); }
function bad(s)  { console.log('  \x1b[31m✘\x1b[0m ' + s); }
function dim(s)  { console.log('  \x1b[90m' + s + '\x1b[0m'); }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lineQueue = [];
let pendingAsk = null;

rl.on('line', function (l) {
  if (pendingAsk) { const f = pendingAsk; pendingAsk = null; f(String(l).trim()); }
  else lineQueue.push(String(l).trim());
});

function ask(q) {
  if (q) process.stdout.write(q);
  if (lineQueue.length) {
    const v = lineQueue.shift();
    if (q) process.stdout.write(v ? '(已输入)' : '');
    return Promise.resolve(v);
  }
  return new Promise(function (res) { pendingAsk = res; });
}

function askHidden(q) {
  return new Promise(function (res) {
    const stdin = process.stdin;
    process.stdout.write(q);

    if (stdin.isTTY && stdin.setRawMode) {
      const wasRaw = stdin.isRaw;
      stdin.setRawMode(true);
      stdin.resume();

      let buf = '';
      const onData = function (ch) {
        const s = ch.toString('utf8');
        for (const c of s) {
          if (c === '\r' || c === '\n') {
            stdin.removeListener('data', onData);
            stdin.setRawMode(wasRaw || false);
            stdin.pause();
            process.stdout.write('\n');
            return res(buf);
          }
          if (c === '\u0003') { process.stdout.write('\n'); process.exit(1); }
          if (c === '\u007f' || c === '\b') { buf = buf.slice(0, -1); continue; }
          buf += c;
        }
      };
      stdin.on('data', onData);
      return;
    }

    ask('').then(res);
  });
}

/** 确认词：大小写都收，中英文都收 */
function isYes(v) {
  return /^(y|yes|是|好|确定|确认|ok|okay|1|对|嗯)$/i.test(String(v == null ? '' : v).trim());
}

function readJson(f, dflt) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return dflt; }
}

function writeLocalCfg(obj) {
  fs.mkdirSync(path.dirname(LOCAL_CFG), { recursive: true });
  fs.writeFileSync(LOCAL_CFG, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
  try { fs.chmodSync(LOCAL_CFG, 0o600); } catch (e) {}
}

function checkStrength(pw) {
  const p = [];
  if (pw.length < 8) p.push('少于 8 位');
  if (/^\d+$/.test(pw)) p.push('全是数字');
  if (/^(.)\1+$/.test(pw)) p.push('全是同一个字符');
  if (/^(1234|abcd|qwer|password|admin)/i.test(pw)) p.push('太常见了');
  return p;
}

function serverRunning() {
  try {
    const out = require('child_process').execSync(
      'lsof -nP -iTCP:8787 -sTCP:LISTEN -t 2>/dev/null || true', { encoding: 'utf8' });
    return out.trim().length > 0;
  } catch (e) { return false; }
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const a = path.join(from, name), b = path.join(to, name);
    if (fs.statSync(a).isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}

async function pickPassword(label, oldPwd) {
  for (let i = 0; i < 3; i++) {
    const a = await askHidden('  ' + label + '： ');
    if (!a) { bad('不能是空的。'); continue; }
    const b = await askHidden('  再输一遍： ');
    if (a !== b) { bad('两次输的不一样，重来。'); console.log(''); continue; }
    if (a === oldPwd) { warn('跟现在的一样，等于没改。'); console.log(''); continue; }
    const weak = checkStrength(a);
    if (weak.length) {
      console.log('');
      warn('这个密码有点弱： ' + weak.join('、'));
      const go = await ask('  就用这个？(y/N) ');
      if (!isYes(go)) { console.log(''); continue; }
    }
    return a;
  }
  return null;
}

(async function main() {

  console.log('');
  rule('=');
  console.log('  Home Chat - 改密码');
  rule('=');
  console.log('');
  console.log('  数据目录： ' + DATA);
  console.log('');
  console.log('  这里要管两个密码：');
  console.log('    1) 聊天密码 - 家里人手机连上来要输的那个');
  console.log('    2) 后台密码 - 打开监控面板要输的那个');
  console.log('');
  dim('  两个可以设成一样（省事），也可以分开（更安全）。');
  console.log('');

  if (!fs.existsSync(DATA)) {
    bad('找不到数据目录：' + DATA);
    dim('服务端至少跑过一次才会有这个目录。');
    rl.close();
    process.exit(1);
  }

  if (serverRunning()) {
    warn('服务端好像还在跑（8787 端口被占着）。');
    console.log('');
    dim('  改密码要把所有聊天记录重新加密一遍，最好先停掉服务端。');
    console.log('');
    const go = await ask('  还是要继续吗？(y/N) ');
    if (!isYes(go)) {
      console.log('');
      dim('  先双击「停止HomeChat.command」把服务端停掉，再回来跑这个。');
      console.log('');
      rl.close();
      process.exit(0);
    }
    console.log('');
  }

  const localCfg = readJson(LOCAL_CFG, {});
  let oldPwd = process.env.HC_PASSWORD || localCfg.password || '';

  if (!oldPwd) {
    warn('没找到现在用的密码（data/config.local.json 里没记）。');
    console.log('');
    dim('  请输入一次，用来解开现有记录。');
    console.log('');
    oldPwd = await askHidden('  现在的聊天密码： ');
    if (!oldPwd) { bad('没输入，退出。'); rl.close(); process.exit(1); }
    console.log('');
  }

  console.log('  正在用旧密码算钥匙（PBKDF2 跑 30 万轮，要一两秒）…');
  const oldMaster = C.deriveMaster(oldPwd, ITERATIONS);
  const oldK = C.subkeys(oldMaster);
  console.log('');

  if (fs.existsSync(KEY_FILE)) {
    const onDisk = fs.readFileSync(KEY_FILE);
    if (onDisk.length === 32 && onDisk.equals(oldMaster)) {
      ok('密码对得上服务器上的钥匙');
      console.log('');
    } else {
      bad('这个密码跟 data/master.key 对不上。');
      console.log('');
      dim('  意思是：服务器上的记录不是用这个密码加密的。');
      console.log('');
      const go = await ask('  还是要继续吗？（继续的话，原先的记录会解不开）(y/N) ');
      if (!isYes(go)) { console.log(''); rl.close(); process.exit(0); }
      console.log('');
    }
  }

  let msgLines = [];
  if (fs.existsSync(MSG_FILE)) {
    msgLines = fs.readFileSync(MSG_FILE, 'utf8').split('\n').filter(Boolean);
  }

  let canOpen = 0, cannotOpen = 0;
  for (const l of msgLines) {
    let m; try { m = JSON.parse(l); } catch (e) { continue; }
    if (C.open(oldK.kEnc, oldK.kMac, m.env)) canOpen++;
    else cannotOpen++;
  }

  console.log('  现有的聊天记录： ' + msgLines.length + ' 条');
  if (msgLines.length) {
    ok('能解开的： ' + canOpen + ' 条');
    if (cannotOpen) warn('解不开的： ' + cannotOpen + ' 条（原样保留，不动它）');
  }
  console.log('');

  if (msgLines.length && canOpen === 0) {
    bad('一条都解不开 - 密码肯定不对。');
    dim('  建议先把 data/ 整个备份一份再折腾。');
    console.log('');
    rl.close();
    process.exit(1);
  }

  console.log('  == 第 1 步：聊天密码 ==');
  console.log('');
  dim('  建议：8 位以上，别只用数字。好记又不好猜的办法：');
  dim('        一句话的拼音首字母 + 几个数字，比如 wanshangchifan2026');
  console.log('');

  const newPwd = await pickPassword('新的聊天密码', oldPwd);
  if (!newPwd) { bad('没设成，退出。'); rl.close(); process.exit(1); }

  console.log('');
  console.log('  == 第 2 步：后台密码（监控面板）==');
  console.log('');
  console.log('    后台密码就是打开「监控面板」时要输的那个。');
  console.log('');
  dim('    - 跟聊天密码一样 -> 省事，知道聊天密码的人就能看后台');
  dim('    - 单独设一个     -> 更安全，只有你自己能看后台');
  console.log('');

  const sep = await ask('  要单独设一个后台密码吗？(y/N) ');
  let newAdmin = null;

  if (isYes(sep)) {
    console.log('');
    newAdmin = await pickPassword('新的后台密码', localCfg.adminPassword || '');
    if (!newAdmin) { warn('没设成，那就跟聊天密码用同一个。'); }
  } else {
    console.log('');
    dim('  好，后台密码跟聊天密码一样。');
  }

  console.log('');
  rule();
  console.log('');
  console.log('  要开始了。会做这几件事：');
  console.log('');
  console.log('    1) 把 ' + DATA + ' 整个备份一份');
  console.log('    2) 用旧钥匙解开 ' + canOpen + ' 条消息，用新钥匙重新封上');
  console.log('    3) 换掉 data/master.key');
  console.log('    4) 把两个新密码写进 data/config.local.json');
  console.log('');

  const go = await ask('  开始？(y/N) ');
  if (!isYes(go)) { console.log(''); dim('  什么都没改。'); rl.close(); process.exit(0); }

  console.log('');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backup = DATA + '.备份-' + stamp;
  try {
    copyDir(DATA, backup);
    ok('备份好了： ' + backup);
  } catch (e) {
    bad('备份失败：' + e.message);
    dim('  没有备份就不敢往下走。');
    rl.close();
    process.exit(1);
  }
  console.log('');

  const newMaster = C.deriveMaster(newPwd, ITERATIONS);
  const newK = C.subkeys(newMaster);

  let rewrote = 0, failed = 0;
  const out = [];

  for (const l of msgLines) {
    let m; try { m = JSON.parse(l); } catch (e) { continue; }
    const dec = C.open(oldK.kEnc, oldK.kMac, m.env);
    if (!dec) { out.push(l); failed++; continue; }
    try {
      m.env = C.seal(newK.kEnc, newK.kMac, dec);
      out.push(JSON.stringify(m));
      rewrote++;
    } catch (e) { out.push(l); }
  }

  const tmp = MSG_FILE + '.rekey';
  try {
    fs.writeFileSync(tmp, out.length ? out.join('\n') + '\n' : '');
    fs.renameSync(tmp, MSG_FILE);
    ok('重新加密完成： ' + rewrote + ' 条换了新钥匙' +
       (failed ? '，' + failed + ' 条解不开原样留着' : ''));
  } catch (e) {
    bad('写 messages.jsonl 失败：' + e.message);
    dim('  原文件没动，备份也在：' + backup);
    rl.close();
    process.exit(1);
  }
  console.log('');

  try {
    fs.writeFileSync(KEY_FILE, newMaster, { mode: 0o600 });
    try { fs.chmodSync(KEY_FILE, 0o600); } catch (e) {}
    ok('data/master.key 换好了');
  } catch (e) {
    bad('写 master.key 失败：' + e.message);
    dim('  把备份里的 messages.jsonl 拷回来就恢复原状了：' + backup);
    rl.close();
    process.exit(1);
  }

  try {
    const cfg2 = readJson(LOCAL_CFG, {});
    cfg2.password = newPwd;
    if (newAdmin) cfg2.adminPassword = newAdmin;
    else delete cfg2.adminPassword;
    cfg2.changedAt = Date.now();
    writeLocalCfg(cfg2);
    ok('两个密码都记到 data/config.local.json 了');
  } catch (e) {
    bad('写 config.local.json 失败：' + e.message);
    dim('  密码本身改成功了，但下次启动还会读旧的 -');
    dim('  手动改 ' + LOCAL_CFG + ' 就行。');
  }

  console.log('');
  rule('=');
  console.log('');
  console.log('  \x1b[32m\x1b[1m改好了\x1b[0m');
  console.log('');
  console.log('    聊天密码： ' + newPwd);
  console.log('    后台密码： ' + (newAdmin || (newPwd + '（跟聊天密码一样）')));
  console.log('');
  console.log('  接下来：');
  console.log('    1) 双击「启动HomeChat.command」重启服务端');
  console.log('    2) 每台手机用新的聊天密码重新登录一次');
  console.log('    3) 手机上的旧本地存档读不出来了（它也是用旧钥匙加密的）-');
  console.log('       不要紧，重新登录后会自动从服务端把记录拉回来');
  console.log('    4) 打开监控面板时用后台密码');
  console.log('    5) 想反悔：把备份目录改名回 data 就行');
  console.log('       ' + backup);
  console.log('');
  rule('=');
  console.log('');

  rl.close();
  process.exit(0);

})().catch(function (e) {
  console.error('\n出错了：', e && e.stack || e);
  try { rl.close(); } catch (x) {}
  process.exit(1);
});
