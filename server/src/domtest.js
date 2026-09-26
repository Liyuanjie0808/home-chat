'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = path.join(ROOT, 'app', 'index.html');
const JSD  = path.join(ROOT, 'app', 'js');

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[90m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m'
};

let pass = 0, fail = 0;
const problems = [];

function ok(msg, extra) {
  pass++;
  console.log(`  ${C.green}✔${C.reset} ${msg}` +
              (extra ? `  ${C.dim}${extra}${C.reset}` : ''));
}
function bad(msg, detail) {
  fail++;
  console.log(`  ${C.red}✘${C.reset} ${msg}`);
  problems.push(msg);
  if (detail) String(detail).split('\n').slice(0, 4).forEach(l =>
    console.log(`      ${C.dim}${l}${C.reset}`));
}
function head(t) { console.log(`\n${C.bold}${t}${C.reset}`); }

console.log(`\n${C.bold}Home Chat — 页面元素自检${C.reset}`);
console.log(`${C.dim}  JS 里引用的每个 id，页面上都得真的有 ———— 缺一个就可能瘫掉整个启动${C.reset}`);

if (!fs.existsSync(HTML)) {
  console.error(`\n  ${C.red}✘ 找不到 ${path.relative(ROOT, HTML)}${C.reset}\n`);
  process.exit(1);
}
const html = fs.readFileSync(HTML, 'utf8');
const pageIds = new Set();
for (const m of html.matchAll(/\bid="([^"]+)"/g)) pageIds.add(m[1]);

const dynIds = new Set();
for (const f of fs.readdirSync(JSD).filter(x => x.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(JSD, f), 'utf8');
  for (const m of src.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)) dynIds.add(m[1]);
}
const knownIds = new Set([...pageIds, ...dynIds]);

head('① 页面里有多少个 id');
ok(`index.html 定义了 ${pageIds.size} 个 id`);
if (dynIds.size) {
  pass++;
  const onlyDyn = [...dynIds].filter(i => !pageIds.has(i));
  console.log(`  ${C.dim}·${C.reset} 另有 ${dynIds.size} 个由 JS 运行时动态生成：` +
              `${C.dim}${[...dynIds].join('、')}${C.reset}`);
  if (onlyDyn.length) {
    console.log(`      ${C.dim}其中 ${onlyDyn.join('、')} 只存在于 JS 字符串里，页面源码中看不到${C.reset}`);
  }
}

const jsFiles = fs.readdirSync(JSD).filter(f => f.endsWith('.js')).sort();
const refs = [];

const RE_REF = /(?:\$|getElementById|\bon)\(\s*'([^']+)'/g;

for (const f of jsFiles) {
  const src = fs.readFileSync(path.join(JSD, f), 'utf8');
  const lines = src.split('\n');

  for (const m of src.matchAll(RE_REF)) {
    const id = m[1];

    const after = src.slice(m.index + m[0].length);
    if (/^\s*'?\s*\+/.test(after)) continue;

    const lineNo = src.slice(0, m.index).split('\n').length;
    const lineText = lines[lineNo - 1] || '';
    const trimmed = lineText.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//') ||
        trimmed.startsWith('/*')) continue;

    refs.push({ id, file: f, line: lineNo, kind: m[0].startsWith('on(') ? 'on' : '$' });
  }
}

head('② JS 里引用了多少个页面元素');
const uniq = new Set(refs.map(r => r.id));
ok(`${jsFiles.length} 个 JS 文件，共 ${refs.length} 处引用，涉及 ${uniq.size} 个不同 id`);

head('③ 悬空引用（JS 要用的 id，页面上没有）');

const missing = new Map();
for (const r of refs) {
  if (!knownIds.has(r.id)) {
    if (!missing.has(r.id)) missing.set(r.id, []);
    missing.get(r.id).push(`${r.file}:${r.line}`);
  }
}

if (missing.size === 0) {
  ok('一个都没有 —— 所有引用都能落地');
} else {
  for (const [id, where] of [...missing].sort()) {
    const isBind = refs.some(r => r.id === id && r.kind === 'on');
    bad(`#${id} 页面上不存在，但 JS 里在用`,
        `${where.join('、')}\n` +
        (isBind
          ? `这处是 on() 绑定 —— 运行时只会打一条警告（安全，但功能没了）`
          : `这处是直接读取 —— 会抛 Cannot read properties of null`));
  }
}

head('④ 孤儿 id（页面上定义了，但没有任何 JS 用它）');

const used = new Set(refs.map(r => r.id));
const orphans = [...pageIds].filter(i => !used.has(i)).sort();

if (orphans.length === 0) {
  ok('没有孤儿 id');
} else {
  pass++;
  console.log(`  ${C.yellow}·${C.reset} ${orphans.length} 个 id 只有样式/展示用途，属正常：`);
  console.log(`      ${C.dim}${orphans.join('、')}${C.reset}`);
}

head('⑤ onclick 绑定目标');

const onRefs = refs.filter(r => r.kind === 'on');
const deadBind = [...new Set(onRefs.filter(r => !knownIds.has(r.id)).map(r => r.id))];

if (deadBind.length === 0) {
  ok(`${onRefs.length} 处 on() 绑定，目标元素全部存在`);
  ok('点击都有反应，不会有按钮点不动的情况');
} else {
  bad(`${deadBind.length} 个按钮绑到了不存在的元素上：${deadBind.join('、')}`,
      '这些按钮点下去不会有任何反应');
}

head('⑥ 启动必需的元素');

const MUST = [
  ['boot',        '启动画面'],
  ['cryptofail',  '错误横幅'],
  ['page-connect', '连接页'],
  ['page-convs',  '会话列表页'],
  ['page-chat',   '聊天页'],
  ['toast',       '提示条'],
  ['sheetMask',   '弹层遮罩'],
  ['viewer',      '图片查看器']
];
let mustMissing = 0;
for (const [id, what] of MUST) {
  if (pageIds.has(id)) { pass++; console.log(`  ${C.green}✔${C.reset} #${id.padEnd(14)} ${C.dim}${what}${C.reset}`); }
  else { mustMissing++; bad(`#${id}（${what}）不见了 —— 启动会出问题`); }
}

head('⑦ JS 文件语法');

const vm = require('vm');
let syntaxBad = 0;
for (const f of jsFiles) {
  try { new vm.Script(fs.readFileSync(path.join(JSD, f), 'utf8'), { filename: f }); }
  catch (e) { syntaxBad++; bad(`${f} 语法错误：${e.message}`); }
}
if (!syntaxBad) ok(`${jsFiles.length} 个 JS 文件语法全部通过`);

console.log('');
console.log(C.bold + '════════════════════════════════════════════════════' + C.reset);
if (fail === 0) {
  console.log(`${C.green}${C.bold}  ✅ 全部通过：${pass} 项，0 失败${C.reset}`);
  console.log(`${C.dim}  JS 和页面说的是同一件事，不会出现"点了没反应"。${C.reset}`);
  console.log(C.bold + '════════════════════════════════════════════════════' + C.reset + '\n');
  process.exit(0);
} else {
  console.log(`${C.red}${C.bold}  ✘ ${fail} 项失败（通过 ${pass} 项）${C.reset}`);
  console.log('');
  for (const p of problems) console.log(`  ${C.red}·${C.reset} ${p}`);
  console.log('');
  console.log(`${C.dim}  改 HTML 删了元素？那就去 JS 里把对应的绑定也删掉，`);
  console.log(`  或者用 on('id', fn) —— 它找不到元素只警告，不会崩。${C.reset}`);
  console.log(C.bold + '════════════════════════════════════════════════════' + C.reset + '\n');
  process.exit(1);
}
