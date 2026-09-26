'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const argv = process.argv.slice(2);
function argVal(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}

const ROOT = path.resolve(__dirname, '..', '..');
const DATA = argVal('--data') || process.env.HC_DATA_DIR || path.join(ROOT, 'data');

const KEEP_BACKUP = argv.indexOf('--no-backup') < 0;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lineQueue = [];
let pendingAsk = null;

rl.on('line', function (l) {
  if (pendingAsk) { const f = pendingAsk; pendingAsk = null; f(String(l).trim()); }
  else lineQueue.push(String(l).trim());
});

function ask(q) {
  if (q) process.stdout.write(q);
  if (lineQueue.length) return Promise.resolve(lineQueue.shift());
  return new Promise(function (res) { pendingAsk = res; });
}

const W = 62;
function rule(c) { console.log('  ' + (c || '─').repeat(W)); }
function ok(s)   { console.log('  \x1b[32m✔\x1b[0m ' + s); }
function warn(s) { console.log('  \x1b[33m!\x1b[0m ' + s); }
function bad(s)  { console.log('  \x1b[31m✘\x1b[0m ' + s); }
function dim(s)  { console.log('  \x1b[90m' + s + '\x1b[0m'); }

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const a = path.join(from, name), b = path.join(to, name);
    if (fs.statSync(a).isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}

function sizeOf(dir) {
  let n = 0, bytes = 0;
  (function walk(d) {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else { n++; bytes += st.size; }
    }
  })(dir);
  return { n: n, bytes: bytes };
}

function serverRunning() {
  try {
    const out = require('child_process').execSync(
      'lsof -nP -iTCP:8787 -sTCP:LISTEN -t 2>/dev/null || true', { encoding: 'utf8' });
    return out.trim().length > 0;
  } catch (e) { return false; }
}

(async function main() {

  console.log('');
  rule('═');
  console.log('  Home Chat — 清空所有数据');
  rule('═');
  console.log('');
  console.log('  数据目录： ' + DATA);
  console.log('');

  if (!fs.existsSync(DATA)) {
    warn('这个目录本来就不存在，没什么可清的。');
    console.log('');
    dim('  下次启动服务端会自动建一个干净的。');
    console.log('');
    rl.close();
    process.exit(0);
  }

  const info = sizeOf(DATA);
  if (info.n === 0) {
    ok('目录里是空的，不用清。');
    console.log('');
    rl.close();
    process.exit(0);
  }

  console.log('  现在里面有 ' + info.n + ' 个文件，' + (info.bytes / 1024).toFixed(1) + ' KB：');
  console.log('');
  for (const name of fs.readdirSync(DATA)) {
    const p = path.join(DATA, name);
    const st = fs.statSync(p);
    const what = {
      'state.json':        '家里人名单、会话、备注、已读位置',
      'config.local.json': '你这台机器自己设的密码',
      'messages.jsonl':    '全部聊天记录',
      'master.key':        '加密钥匙',
    }[name] || (st.isDirectory() ? '目录' : '文件');
    console.log('    · ' + name.padEnd(20) + what);
  }
  console.log('');

  if (serverRunning()) {
    bad('服务端还在跑（8787 端口被占着）。');
    console.log('');
    dim('  先双击「停止HomeChat.command」把它停掉，再回来跑这个。');
    dim('  带着服务在跑的时候清数据，很可能清不干净（它还在往文件里写）。');
    console.log('');
    rl.close();
    process.exit(1);
  }

  rule();
  console.log('');
  console.log('  \x1b[31m\x1b[1m清掉之后就找不回来了。\x1b[0m');
  console.log('');
  console.log('  会没有的东西：');
  console.log('    · 所有聊天记录（包括对方发来的）');
  console.log('    · 所有成员账号（家里人下次要重新连一次）');
  console.log('    · 群聊、备注名、头像');
  console.log('    · 已读位置、撤回记录、阅后即焚的登记');
  console.log('    · 加密钥匙本身');
  console.log('');
  console.log('  不会动的：');
  console.log('    · 代码、配置、密码设置（密码还是你现在那个）');
  console.log('    · 手机上的本地存档（那个在手机上，要清得在手机上清）');
  console.log('');

  if (KEEP_BACKUP) {
    dim('  （会先备份一份到 data.备份-时间戳，反悔了能改回来）');
    console.log('');
  }

  const a1 = await ask('  确定要清空吗？输入 yes 继续（大小写都行）： ');
  /* ★ 确认词要宽松。
   *   以前要求一字不差输 "YES"（还必须大写）—— 大小写不对、多个空格、
   *   或者习惯性敲个 "y" 都过不去，人就永远清不掉数据，很气人。
   *   现在大小写都收，中英文都收，前后空格自动去掉。 */
  const yes = /^(y|yes|是|好|确定|确认|ok|okay|1|对|嗯)$/i.test(String(a1 || '').trim());
  if (!yes) {
    console.log('');
    dim('  没清，什么都没动。');
    console.log('');
    rl.close();
    process.exit(0);
  }

  console.log('');

  if (KEEP_BACKUP) {
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
  }

  let gone = 0, failed = 0;
  for (const name of fs.readdirSync(DATA)) {
    const p = path.join(DATA, name);
    try {
      fs.rmSync(p, { recursive: true, force: true });
      gone++;
    } catch (e) {
      failed++;
      bad('删不掉：' + name + '（' + e.message + '）');
    }
  }

  console.log('');
  if (failed === 0) ok('清空完成，删掉了 ' + gone + ' 项');
  else warn('删掉 ' + gone + ' 项，' + failed + ' 项没删掉（看上面的提示）');

  console.log('');
  rule('═');
  console.log('');
  console.log('  \x1b[32m\x1b[1m现在是干净的初始状态了\x1b[0m');
  console.log('');
  console.log('  ① 双击「启动HomeChat.command」重新开始');
  console.log('  ② 密码还是你原来那个（密码设置没动）');
  console.log('  ③ 家里人下次打开 App 会重新连一次，跟第一次用一样');
  console.log('');
  rule('═');
  console.log('');

  rl.close();
  process.exit(0);

})().catch(function (e) {
  console.error('\n出错了：', e && e.stack || e);
  try { rl.close(); } catch (x) {}
  process.exit(1);
});
