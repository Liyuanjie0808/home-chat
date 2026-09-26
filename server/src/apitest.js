'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const APP  = path.join(ROOT, 'app');

let pass = 0, fail = 0;
const problems = [];
function ok(m, x) {
  pass++;
  console.log(`  \x1b[32m✔\x1b[0m ${m}` + (x ? `  \x1b[90m${x}\x1b[0m` : ''));
}
function bad(m, d) {
  fail++; problems.push(m);
  console.log(`  \x1b[31m✘\x1b[0m ${m}`);
  if (d) String(d).split('\n').slice(0, 12).forEach(l => console.log(`      \x1b[90m${l}\x1b[0m`));
}
function head(t) { console.log(`\n\x1b[1m${t}\x1b[0m`); }

const FILES = fs.readdirSync(path.join(APP, 'js')).filter(f => f.endsWith('.js'));
const SRC = {};
for (const f of FILES) SRC[f] = fs.readFileSync(path.join(APP, 'js', f), 'utf8');

function stripComments(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function exportsOf(objPath) {
  const names = new Set();
  for (const f of FILES) {
    const code = stripComments(SRC[f]);

    const both = [objPath, objPath.replace(/^global\./, '')];
    const startRe = new RegExp('(?:' + both.map(x => x.replace(/\./g, '\\.')).join('|') +
                               ')\\s*=\\s*\\{', 'g');
    let m;
    while ((m = startRe.exec(code))) {

      let i = m.index + m[0].length - 1;
      let depth = 0, end = -1;
      for (let j = i; j < code.length; j++) {
        if (code[j] === '{') depth++;
        else if (code[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
      }
      if (end < 0) continue;
      const body = code.slice(i + 1, end);

      let depth2 = 0;
      let buf = '';
      const parts = [];
      for (const ch of body) {
        if (ch === '{' || ch === '[' || ch === '(') depth2++;
        else if (ch === '}' || ch === ']' || ch === ')') depth2--;
        if (ch === ',' && depth2 === 0) { parts.push(buf); buf = ''; }
        else buf += ch;
      }
      parts.push(buf);
      for (const p of parts) {
        const km = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(p);
        if (km) names.add(km[1]);
      }
    }
  }
  return names;
}

function attachedTo(objPath) {
  const names = new Set();
  const both = [objPath, objPath.replace(/^global\./, '')];
  for (const f of FILES) {
    const code = stripComments(SRC[f]);
    const re = new RegExp('(?:' + both.map(x => x.replace(/\./g, '\\.')).join('|') +
                          ')\\.([A-Za-z_$][\\w$]*)\\s*=', 'g');
    let m;
    while ((m = re.exec(code))) names.add(m[1]);
  }
  return names;
}

function attachedViaAlias(alias) {
  const names = new Set();
  for (const f of FILES) {
    const code = stripComments(SRC[f]);
    const re = new RegExp('(?:^|[^\\w$.])' + alias + '\\.([A-Za-z_$][\\w$]*)\\s*=\\s*[^=]', 'gm');
    let m;
    while ((m = re.exec(code))) names.add(m[1]);
  }
  return names;
}

const MODULES = [
  { path: 'global.HC.ui',      short: 'ui',      aliases: ['ui'] },
  { path: 'global.HC.net',     short: 'net',     aliases: ['net'] },
  { path: 'global.HC.media',   short: 'media',   aliases: ['media'] },
  { path: 'global.HC.store',   short: 'store',   aliases: ['store'] },
  { path: 'global.HC.secure',  short: 'secure',  aliases: ['sec'] },
  { path: 'global.HC.brand',   short: 'brand',   aliases: ['brand'] },
  { path: 'global.HC.session', short: 'session', aliases: ['session'] },
  { path: 'global.HC.notify',  short: 'notify',  aliases: ['NTF', 'notify'] },
  { path: 'global.HC.app',     short: 'app',     aliases: ['HC.app'] }
];

for (const m of MODULES) {
  m.exports = exportsOf(m.path);
  for (const extra of attachedTo(m.path)) m.exports.add(extra);

  for (const al of m.aliases) {
    if (/\./.test(al)) continue;
    for (const extra of attachedViaAlias(al)) m.exports.add(extra);
  }
}

const BUILTIN = new Set([
  'push', 'pop', 'shift', 'unshift', 'splice', 'slice', 'sort', 'reverse', 'concat',
  'join', 'indexOf', 'lastIndexOf', 'includes', 'find', 'findIndex', 'filter', 'map',
  'forEach', 'some', 'every', 'reduce', 'reduceRight', 'fill', 'flat', 'keys',
  'values', 'entries', 'has', 'get', 'set', 'add', 'delete', 'clear', 'size',
  'then', 'catch', 'finally', 'call', 'apply', 'bind', 'length', 'name',
  'toFixed', 'toString', 'valueOf', 'replace', 'split', 'trim', 'trimStart',
  'trimEnd', 'padStart', 'padEnd', 'repeat', 'charAt', 'charCodeAt', 'substring',
  'substr', 'toUpperCase', 'toLowerCase', 'test', 'exec', 'match', 'matchAll',
  'search', 'startsWith', 'endsWith', 'toISOString', 'getTime', 'getFullYear',
  'getMonth', 'getDate', 'getHours', 'getMinutes', 'getSeconds', 'getDay',
  'toJSON', 'toLocaleString', 'strike', 'abort', 'send', 'close', 'open'
]);

console.log('\n\x1b[1mHome Chat — 跨模块 API 核对\x1b[0m');
console.log('\x1b[90m  查"调了对方没导出的方法"—— 这类错语法检查查不出，运行时才炸\x1b[0m');

head('① 各模块导出了多少东西');

for (const m of MODULES) {
  if (m.exports.size === 0) bad(`${m.short} 一个东西都没导出（导出块没被认出来？）`);
  else console.log(`  \x1b[90m·\x1b[0m global.HC.${m.short.padEnd(8)} ${String(m.exports.size).padStart(3)} 个`);
}

head('② 扫全项目的跨模块调用');

const danglers = [];

for (const f of FILES) {
  const lines = stripComments(SRC[f]).split('\n');
  lines.forEach((line, i) => {
    for (const m of MODULES) {
      for (const al of m.aliases) {
        const esc = al.replace(/\./g, '\\.');
        const re = new RegExp('(^|[^\\w$.])' + esc + '\\.([A-Za-z_$][\\w$]*)\\s*\\(', 'g');
        let mm;
        while ((mm = re.exec(line))) {

          if (/plus\.$/.test(line.slice(0, mm.index + mm[1].length))) continue;
          const name = mm[2];
          if (m.exports.has(name)) continue;
          if (BUILTIN.has(name)) continue;

          if (new RegExp(esc + '\\.' + name + '\\s*&&').test(line)) continue;
          danglers.push(`${f}:${i + 1}  ${al}.${name}()  —— global.HC.${m.short} 里没有这个东西`);
        }
      }
    }
  });
}

{
  const appMod = MODULES.find(m => m.short === 'app');
  for (const f of FILES) {
    const lines = stripComments(SRC[f]).split('\n');
    lines.forEach((line, i) => {
      const re = /\bHC\.app\.([A-Za-z_$][\w$]*)\s*\(/g;
      let mm;
      while ((mm = re.exec(line))) {
        if (!appMod.exports.has(mm[1])) {
          danglers.push(`${f}:${i + 1}  HC.app.${mm[1]}()  —— global.HC.app 里没有这个东西`);
        }
      }
    });
  }
}

const uniq = [...new Set(danglers)];

if (!uniq.length) {
  ok('★★ 全项目跨模块调用，目标全都在 —— 没有"调了不存在的方法"');
} else {
  bad(`有 ${uniq.length} 处调了对方没导出的东西：`);
  uniq.slice(0, 25).forEach(x => console.log(`      \x1b[90m· ${x}\x1b[0m`));
  if (uniq.length > 25) console.log(`      \x1b[90m… 还有 ${uniq.length - 25} 处\x1b[0m`);
}

head('③ 已知踩过的坑，复查一遍还在不在');

{
  const hits = [];
  for (const f of FILES) {
    const code = stripComments(SRC[f]);
    const re = /\bstore\.S\s*\(/g;
    let m;
    while ((m = re.exec(code))) {
      const line = code.slice(0, m.index).split('\n').length;
      hits.push(`${f}:${line}`);
    }
  }
  if (!hits.length) ok('★★ 没有把 store.S 当函数调（S 是个对象，加括号就抛 TypeError）');
  else bad('这些地方把 store.S 当函数调了：' + hits.join('、'));
}

{
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const declared = (html.match(/<script\s+src="js\/([^"]+)"/g) || [])
                    .map(x => x.replace(/.*js\//, '').replace(/".*/, ''));
  const orphan = FILES.filter(f => !declared.includes(f));
  if (!orphan.length) ok('★★ 磁盘上每个 js 都被 index.html 引了', declared.join(' → '));
  else bad('这些 js 文件没人引（死代码，或者忘了加 <script>）：' + orphan.join('、'));

  const missing = declared.filter(f => !FILES.includes(f));
  if (!missing.length) ok('  引用的 js 文件都存在');
  else bad('index.html 引了不存在的文件：' + missing.join('、'));

  const order = declared;
  const need = { 'store.js': [], 'net.js': ['store.js'], 'media.js': ['store.js'],
                 'ui.js': ['store.js', 'media.js', 'net.js'],
                 'app.js': null,
                 'session.js': [], 'brand.js': [], 'notify.js': [] };
  const problems2 = [];
  for (const [file, deps] of Object.entries(need)) {
    if (!deps) continue;
    if (!order.includes(file)) continue;
    for (const d of deps) {
      if (order.indexOf(d) > order.indexOf(file)) problems2.push(`${file} 在 ${d} 之前加载`);
    }
  }
  if (!problems2.length) ok('  加载顺序没毛病（依赖的都在前面）');
  else bad('加载顺序有问题：' + problems2.join('；'));
}

head('④ 每个模块的顶层代码不碰别人');

{
  const badTop = [];
  for (const f of FILES) {
    const code = stripComments(SRC[f]);

    code.split('\n').forEach((line, i) => {
      if (!/^ {0,2}\S/.test(line)) return;
      if (/^\s*(function|var|let|const|\/|\*|\}|\)|\(function|'use strict'|})(\s|$)/.test(line)) return;

      const m = /\b(HC\.(ui|net|media|store|secure|brand|session|notify|app)|global\.HC\.(ui|net|media|store))\.\w+\s*[.(]/.exec(line);
      if (m && !/=\s*\{/.test(line)) badTop.push(`${f}:${i + 1}  ${line.trim().slice(0, 70)}`);
    });
  }
  if (!badTop.length) ok('★ 没有模块在加载时就调别的模块（不会有"加载顺序一变就炸"）');
  else {
    bad('这些地方在加载时就用了别的模块，加载顺序一变就炸：');
    badTop.slice(0, 10).forEach(x => console.log(`      \x1b[90m· ${x}\x1b[0m`));
  }
}

console.log('');
console.log('\x1b[1m════════════════════════════════════════════════════\x1b[0m');
if (fail === 0) {
  console.log(`\x1b[32m\x1b[1m  ✅ 全部通过：${pass} 项，0 失败\x1b[0m`);
  console.log('\x1b[90m  模块之间喊话，对方都听得懂 —— 不会"点了没反应"。\x1b[0m');
  console.log('\x1b[1m════════════════════════════════════════════════════\x1b[0m\n');
  process.exit(0);
} else {
  console.log(`\x1b[31m\x1b[1m  ✘ ${fail} 项失败（通过 ${pass} 项）\x1b[0m`);
  problems.forEach(p => console.log(`  \x1b[31m·\x1b[0m ${p}`));
  console.log('\x1b[1m════════════════════════════════════════════════════\x1b[0m\n');
  process.exit(1);
}
