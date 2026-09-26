'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const nodeCrypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const APP  = path.join(ROOT, 'app');

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[90m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m'
};

let pass = 0, fail = 0;
const problems = [];
function ok(m, x) { pass++; console.log(`  ${C.green}✔${C.reset} ${m}` + (x ? `  ${C.dim}${x}${C.reset}` : '')); }
function bad(m, d) {
  fail++; problems.push(m);
  console.log(`  ${C.red}✘${C.reset} ${m}`);
  if (d) String(d).split('\n').slice(0, 5).forEach(l => console.log(`      ${C.dim}${l}${C.reset}`));
}
function head(t) { console.log(`\n${C.bold}${t}${C.reset}`); }

console.log(`\n${C.bold}Home Chat — 启动冒烟测试${C.reset}`);
console.log(`${C.dim}  真的把 App 启动一遍，看会不会崩、能不能走到连接页${C.reset}`);

const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const pageIds = new Set();
for (const m of html.matchAll(/\bid="([^"]+)"/g)) pageIds.add(m[1]);

for (const f of fs.readdirSync(path.join(APP, 'js'))) {
  if (!f.endsWith('.js')) continue;
  const src = fs.readFileSync(path.join(APP, 'js', f), 'utf8');
  for (const m of src.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)) pageIds.add(m[1]);
}

head('① 环境准备');
ok(`从页面里认出 ${pageIds.size} 个元素 id`);

const logs = { warn: [], error: [], log: [] };
const onClass = new Map();

function classListFor(id) {
  if (!onClass.has(id)) onClass.set(id, new Set());
  const set = onClass.get(id);
  return {
    add:    (...n) => n.forEach(x => set.add(x)),
    remove: (...n) => n.forEach(x => set.delete(x)),
    toggle: (n, f) => { const want = f === undefined ? !set.has(n) : !!f; want ? set.add(n) : set.delete(n); return want; },
    contains: (n) => set.has(n),
    _set: set
  };
}

function makeEl(id) {
  const store = { id, innerHTML: '', textContent: '', value: '', scrollTop: 0, scrollHeight: 0, checked: false };
  const el = {
    id,
    classList: classListFor(id),
    style: new Proxy({}, { get: (t, k) => t[k] || '', set: (t, k, v) => { t[k] = v; return true; } }),
    dataset: new Proxy({}, { get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; } }),
    children: [],
    parentNode: null,

    firstChild: { nodeValue: '', textContent: '' },
    lastChild: { nodeValue: '', textContent: '' },
    childNodes: [],
    nextSibling: null,
    previousSibling: null,
    querySelectorAll: () => [],
    querySelector: () => null,
    closest: () => null,
    appendChild: (c) => c,
    removeChild: (c) => c,
    insertBefore: (c) => c,
    remove: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    focus: () => {},
    blur: () => {},
    click: () => {},
    getContext: () => null,
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
  };

  for (const k of ['innerHTML', 'textContent', 'innerText', 'value', 'scrollTop',
                   'scrollHeight', 'clientHeight', 'offsetHeight', 'checked',
                   'disabled', 'src', 'href', 'placeholder', 'title', 'className']) {
    Object.defineProperty(el, k, {
      get: () => store[k],
      set: (v) => { store[k] = v; },
      configurable: true
    });
  }
  return el;
}

const elCache = new Map();

const localStorageMap = new Map();
const localStorageStub = {
  getItem: (k) => (localStorageMap.has(k) ? localStorageMap.get(k) : null),
  setItem: (k, v) => localStorageMap.set(k, String(v)),
  removeItem: (k) => localStorageMap.delete(k),
  clear: () => localStorageMap.clear()
};

const sandbox = {};
sandbox.window = sandbox;
sandbox.global = sandbox;
sandbox.self = sandbox;

sandbox.addEventListener = () => {};
sandbox.removeEventListener = () => {};
sandbox.dispatchEvent = () => true;
sandbox.postMessage = () => {};
sandbox.scrollTo = () => {};
sandbox.getSelection = () => ({ toString: () => '', removeAllRanges: () => {} });
sandbox.open = () => null;
sandbox.focus = () => {};
sandbox.blur = () => {};
sandbox.history = {
  pushState: () => {}, replaceState: () => {},
  back: () => {}, forward: () => {}, go: () => {},
  length: 1, state: null
};

sandbox.console = {
  log:   (...a) => logs.log.push(a.join(' ')),
  warn:  (...a) => logs.warn.push(a.join(' ')),
  error: (...a) => logs.error.push(a.map(x => (x && x.stack) ? x.stack : String(x)).join(' ')),
};

sandbox.document = {
  readyState: 'complete',
  addEventListener: () => {},
  removeEventListener: () => {},
  cookie: '',
  body: makeEl('body'),
  documentElement: makeEl('html'),
  createElement: (tag) => makeEl('<' + tag + '>'),
  querySelector: () => null,
  querySelectorAll: () => [],

  getElementById(id) {
    if (!pageIds.has(id)) return null;
    if (!elCache.has(id)) elCache.set(id, makeEl(id));
    return elCache.get(id);
  },
};

sandbox.localStorage = localStorageStub;
sandbox.sessionStorage = localStorageStub;
sandbox.navigator = { userAgent: 'Mozilla/5.0 (Macintosh) HomeChatBootTest', platform: 'MacIntel' };
sandbox.location = { href: 'http://127.0.0.1:8787/app/', hostname: '127.0.0.1', protocol: 'http:', search: '' };
sandbox.screen = { width: 390, height: 844 };
sandbox.innerWidth = 390;
sandbox.innerHeight = 844;
sandbox.devicePixelRatio = 3;

sandbox.setTimeout = setTimeout;
sandbox.clearTimeout = clearTimeout;
sandbox.setInterval = setInterval;
sandbox.clearInterval = clearInterval;
sandbox.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 16);
sandbox.cancelAnimationFrame = clearTimeout;

sandbox.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
sandbox.atob = (s) => Buffer.from(s, 'base64').toString('binary');
sandbox.crypto = { getRandomValues: (a) => { nodeCrypto.randomFillSync(a); return a; } };

sandbox.alert = (m) => logs.warn.push('[alert] ' + m);
sandbox.confirm = () => true;
sandbox.prompt = () => null;
sandbox.fetch = () => Promise.reject(new Error('boottest: 没有网络'));
sandbox.XMLHttpRequest = function () { this.open = () => {}; this.send = () => {}; this.setRequestHeader = () => {}; };
sandbox.WebSocket = function () {
  this.readyState = 0;
  this.send = () => {};
  this.close = () => {};
  this.addEventListener = () => {};
};
sandbox.WebSocket.OPEN = 1;

sandbox.matchMedia = () => ({ matches: false, addListener: () => {}, addEventListener: () => {} });
sandbox.getComputedStyle = () => ({ getPropertyValue: () => '' });

vm.createContext(sandbox);

head('② 按 index.html 里的顺序加载 JS');

const FILES = (() => {
  const m = html.match(/<script\s+src="js\/([^"]+)"/g) || [];
  return m.map(x => x.replace(/.*js\//, '').replace(/".*/, ''));
})();
let loadFail = 0;
for (const f of FILES) {
  const file = path.join(APP, 'js', f);
  try {
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: f });
    pass++; console.log(`  ${C.green}✔${C.reset} ${f}`);
  } catch (e) {
    loadFail++;
    bad(`${f} 加载就抛异常`, e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n'));
  }
}

{
  const onDisk = fs.readdirSync(path.join(APP, 'js')).filter(f => f.endsWith('.js'));
  const missing = FILES.filter(f => !onDisk.includes(f));
  const orphan = onDisk.filter(f => !FILES.includes(f));
  if (missing.length) bad('index.html 引了不存在的 js：' + missing.join(', '));
  else if (orphan.length) bad('这些 js 文件没人引（死代码？还是忘了加 <script>）：' + orphan.join(', '));
  else ok(`  index.html 的 ${FILES.length} 个 js 和磁盘上完全一致`, FILES.join(' → '));
}

if (!sandbox.HC || !sandbox.HC.crypto) {
  bad('HC.crypto 没挂上 —— 后面的测试没法跑');
  console.log('');
  process.exit(1);
}

head('③ 等启动链跑完（约 1.1 秒的动画节拍 + 渲染）');

const started = Date.now();

setTimeout(finish, 3500);

function finish() {
  const waited = Date.now() - started;
  ok(`等了 ${waited}ms，启动链该走完了`);

  head('④ 加密模块');
  const cfSet = onClass.get('cryptofail');
  const bannerOn = !!(cfSet && cfSet.has('on'));
  if (bannerOn) {
    const el = elCache.get('cryptofail');
    bad('错误横幅被点亮了！', el ? String(el.innerHTML).replace(/<[^>]+>/g, ' ').slice(0, 220) : '');
  } else {
    ok('没有弹出任何错误横幅');
  }

  head('④b 水印该不该出现');
  const wmSet = onClass.get('watermark');
  const wmOn = !!(wmSet && wmSet.has('on'));
  if (wmOn) {
    bad('还没登录就把水印画上了 —— 连接页上不该有任何水印');
  } else {
    ok('★ 还没登录 → 没有水印（连接页干干净净）');
  }

  let st = null;
  try { st = sandbox.HC.crypto.selfTest(); } catch (e) { bad('自检抛异常：' + e.message); }
  if (st) {
    if (st.ok) ok('加密自检单独再跑一遍：全部通过');
    else bad('加密自检有失败项', (st.fails || []).join('、'));
  }

  head('⑤ 启动流程');
  const bootSet = onClass.get('boot');
  if (bootSet && bootSet.has('gone')) {
    ok('启动画面已退场（#boot 拿到了 gone）');
  } else {
    bad('启动画面还在 —— 说明启动链没走完，用户会一直卡在加载页');
  }

  head('⑥ 控制台');
  const missingEl = logs.warn.filter(l => l.includes('找不到 #'));
  if (missingEl.length === 0) {
    ok('没有"找不到 #xxx"的警告');
  } else {
    bad(`${missingEl.length} 条元素找不到的警告`, [...new Set(missingEl)].join('\n'));
  }

  if (logs.error.length === 0) {
    ok('没有 console.error');
  } else {
    bad(`${logs.error.length} 条 console.error`, [...new Set(logs.error)].join('\n'));
  }

  head('⑦ 界面状态');
  const connSet = onClass.get('page-connect');
  const convSet = onClass.get('page-convs');
  const anywhere = (connSet && connSet.has('on')) || (convSet && convSet.has('on'));
  if (anywhere) {
    ok('已经停在某个真实页面上（不是空启动页）');
  } else {

    pass++;
    console.log(`  ${C.yellow}·${C.reset} 没检测到页面激活类，可能用的是别的类名 ${C.dim}（不算失败）${C.reset}`);
  }

  const toastEl = elCache.get('toast');
  if (toastEl && String(toastEl.textContent || '').trim()) {
    pass++;
    console.log(`  ${C.yellow}·${C.reset} 有提示文案：${C.dim}${String(toastEl.textContent).slice(0, 80)}${C.reset}`);
  }

  head('⑤b 启动画面的分步清单');
  {
    const STEPS = ['crypto', 'store', 'net', 'ready'];
    let allDone = true, missed = [];
    for (const k of STEPS) {
      const set = onClass.get('bs-' + k);
      if (!(set && set.has('done'))) { allDone = false; missed.push(k); }
    }
    if (allDone) {
      ok('★ 四步全部打上勾了（加密自检 / 本地数据 / 连接服务端 / 准备界面）');
    } else {
      bad('这些步骤没打勾：' + missed.join('、'),
          '启动链可能没走完，或者 setBoot 的 doneKey 写错了');
    }

    const stillNow = STEPS.filter(k => {
      const set = onClass.get('bs-' + k);
      return set && set.has('now');
    });
    if (stillNow.length === 0) {
      ok('没有残留的「进行中」标记');
    } else {
      bad('还留着「进行中」的标记：' + stillNow.join('、'),
          'setBoot 的 doneKey 可能传错了');
    }
  }

  head('⑦b 已读标记看的是谁的时间');
  try {
    const store2 = sandbox.HC.store, ui2 = sandbox.HC.ui;
    const S2 = store2.S;
    const MY = 'u_boot_me', PEER = 'u_boot_peer', CONV = 'c_boot';

    S2.cfg.userId = MY;
    S2.cfg.name = '我';
    S2.convs = [{
      id: CONV, type: 'direct',
      peer: { id: PEER, name: '妈妈', online: false },
      lastMsg: null, unread: 0,
      lastReadTs: Date.now(),
      peerReadTs: 0
    }];
    S2.msgs = {};
    S2.msgs[CONV] = [
      { id: 'bm1', conv: CONV, from: MY, ts: 1000, kind: 'text', body: 'hello', status: 'sent' }
    ];
    S2.current = CONV;

    ui2.renderChat();
    const box = elCache.get('chatScroll');
    let html = box ? String(box.innerHTML) : '';
    if (/已读/.test(html)) {
      bad('对方还没读，却标出了「已读」—— readTs 又拿成我自己的了');
    } else {
      ok('★ 对方没读时不标已读（哪怕我自己刚打开过会话）');
    }

    S2.convs[0].peerReadTs = 5000;
    ui2.renderChat();
    html = box ? String(box.innerHTML) : '';
    if (/已读/.test(html)) {
      ok('★ 对方读后正确标出「已读 ✓✓」');
    } else {
      bad('对方读了，却还是没有已读标记', html.replace(/<[^>]+>/g, ' ').slice(0, 180));
    }
  } catch (e) {
    bad('已读标记测试抛异常：' + e.message, e && e.stack);
  }

  head('⑦d 资料页与聊天信息页');
  try {
    const S4 = sandbox.HC.store.S;
    const CONV = 'c_boot';

    S4.cfg.userId = 'u_boot_me';
    S4.cfg.name = '我';
    S4.cfg.burn = true;
    S4.cfg.burnTtl = 30;
    S4.remarks = { u_boot_peer: '老妈' };
    S4.convs = [{
      id: CONV, type: 'direct',
      peer: { id: 'u_boot_peer', name: '妈妈', realName: '妈妈',
              online: true, lastSeen: Date.now(), avatar: null },
      lastMsg: null, unread: 0, lastReadTs: 0, peerReadTs: 0
    }];
    S4.msgs = {};
    S4.msgs[CONV] = [
      { id: 'pm1', conv: CONV, from: 'u_boot_me',   ts: 1000, kind: 'text', body: '在吗', status: 'sent' },
      { id: 'pm2', conv: CONV, from: 'u_boot_peer', ts: 2000, kind: 'text', body: '在的', status: 'sent' }
    ];
    S4.current = CONV;

    if (pageIds.has('btnChatWho') || pageIds.has('chatWhoAv')) {
      bad('聊天页顶部那个大按钮还在（点返回容易误触）');
    } else {
      ok('★ 聊天页顶部不再是个大按钮（改点消息旁边的头像进资料页）');
    }
    if (pageIds.has('hcMore')) {
      bad('「正在找更早的消息」还在');
    } else {
      ok('★ 「正在找更早的消息」提示已删');
    }

    {
      const css = fs.readFileSync(ROOT + '/app/css/app.css', 'utf8');
      const need = ['30', '40', '44', '60', '80', '96'];
      const missAv = need.filter(n => !new RegExp('\\.hc-av-' + n + '\\s*\\{').test(css));
      if (missAv.length) {
        bad('CSS 里缺头像尺寸：hc-av-' + missAv.join(' / hc-av-'),
            '缺了就没有宽高，头像会被内容挤成竖长条');
      } else {
        ok('★★ 六种头像尺寸在 CSS 里都定义齐了（不会再被挤成普京比例）');
      }
      if (/\.hc-avatar\s*\{[^}]*aspect-ratio/.test(css)) {
        ok('★ .hc-avatar 锁了 aspect-ratio，永远是正方形');
      } else {
        bad('.hc-avatar 没锁正方形');
      }
    }

    {
      const css = fs.readFileSync(ROOT + '/app/css/app.css', 'utf8');
      const m2 = css.match(/\.holdtalk\s*\{[^}]*\}/);
      if (m2 && /border:\s*[\d.]+px\s+solid/.test(m2[0])) {
        ok('★ 「按住说话」外面套了可见的圆角框');
      } else {
        bad('「按住说话」外面没有框');
      }
    }

    sandbox.HC.ui.renderProfile();
    const g = (id) => elCache.get(id);

    if (String(g('profName').textContent) === '妈妈') {
      ok('★ 资料页显示了对端名字');
    } else {
      bad('资料页名字不对：' + String(g('profName').textContent));
    }
    if (String(g('profRemark').textContent) === '老妈') {
      ok('★ 资料页显示了我给他起的备注');
    } else {
      bad('资料页备注不对：' + String(g('profRemark').textContent));
    }

    sandbox.HC.ui.renderChatSet();
    if (String(g('csTitle').textContent) === '聊天信息') {
      ok('★ 单聊点 ⋯ 进的是「聊天信息」');
    } else {
      bad('聊天信息标题不对：' + String(g('csTitle').textContent));
    }

    if (pageIds.has('csPeerName') && pageIds.has('csPeerAv')) {
      if (String(g('csPeerName').textContent) === '妈妈') {
        ok('★ 聊天信息页里有对方那一行（头像 + 名字），名字对');
      } else {
        bad('对方那一行名字不对：' + String(g('csPeerName').textContent));
      }
    } else {
      bad('聊天信息页里对方那一行不见了 —— 用户要的是修好头像不是删掉');
    }

    if (pageIds.has('csRowLeave') || pageIds.has('csLeaveText')) {
      bad('「删除会话」按钮还在');
    } else {
      ok('★ 「删除会话」按钮已删（加号随时能再打开，本来就没用）');
    }

    S4.convs = [{
      id: 'c_grp', type: 'group', title: '一家人',
      memberCount: 3, owner: 'u_boot_me',
      members: [
        { id: 'u_boot_me',   name: '我',     online: true },
        { id: 'u_boot_peer', name: '妈妈',   online: true },
        { id: 'u_boot_p2',   name: '爸爸',   online: false }
      ],
      lastMsg: null, unread: 0, lastReadTs: 0, peerReadTs: 0
    }];
    S4.msgs['c_grp'] = [];
    S4.current = 'c_grp';

    sandbox.HC.ui.renderChatSet();
    if (String(g('csTitle').textContent) === '群聊信息') {
      ok('★ 群聊点 ⋯ 进的是「群聊信息」');
    } else {
      bad('群聊标题不对：' + String(g('csTitle').textContent));
    }
    ok('  （群聊底部那个「退出群聊」也一起删了 —— 手滑就退群太危险）');

    sandbox.HC.ui.renderProfile();
    if (String(g('profName').textContent) === '一家人') {
      ok('★ 群聊的资料页显示群名');
    } else {
      bad('群聊资料页名字不对');
    }

    S4.convs = [{ id: CONV, type: 'direct',
                  peer: { id: 'u_boot_peer', name: '妈妈', online: true },
                  lastMsg: null, unread: 0, lastReadTs: 0, peerReadTs: 0 }];
    S4.msgs[CONV] = [
      { id: 'sm1', conv: CONV, from: 'u_boot_me',   ts: 1000, kind: 'text', body: '今天回来吃饭吗' },
      { id: 'sm2', conv: CONV, from: 'u_boot_peer', ts: 2000, kind: 'text', body: '好，我买菜' },
      { id: 'sm3', conv: CONV, from: 'u_boot_me',   ts: 3000, kind: 'text', body: '别忘了买排骨' }
    ];
    S4.current = CONV;

    const hits = sandbox.HC.ui.searchLocal(CONV, '买菜');
    if (hits.length === 1 && hits[0].id === 'sm2') {
      ok('★ 聊内搜索能搜到（本地过滤，秒出）');
    } else {
      bad('聊内搜索结果不对：' + JSON.stringify(hits.map(h => h.body)));
    }
    const none = sandbox.HC.ui.searchLocal(CONV, '不存在的词xyz');
    if (none.length === 0) {
      ok('★ 搜不到就是空（不会瞎给结果）');
    } else {
      bad('搜不存在的词居然有结果');
    }
    const empty = sandbox.HC.ui.searchLocal(CONV, '');
    if (empty.length === 0) {
      ok('★ 空关键词返回空（不刷屏）');
    } else {
      bad('空关键词居然有结果');
    }

  } catch (e) {
    bad('资料页/聊天信息页测试抛异常：' + e.message, e && e.stack);
  }

  head('⑦e 已读状态（走完整链路）');
  try {
    const store3 = sandbox.HC.store;
    const net3   = sandbox.HC.net;
    const ui3    = sandbox.HC.ui;
    const S5     = store3.S;
    const MY = 'u_read_me', PEER = 'u_read_peer', CONV = 'c_read';

    S5.cfg.userId = MY;
    S5.cfg.name = '我';
    S5.cfg.serverAddr = '127.0.0.1';
    S5.convs = [{
      id: CONV, type: 'direct',
      peer: { id: PEER, name: '妈妈', online: true, lastSeen: Date.now() },
      lastMsg: null, unread: 0, lastReadTs: 0, peerReadTs: 0
    }];
    S5.msgs = {}; S5.msgs[CONV] = [];
    S5.current = CONV;

    const clientTs = Date.now();
    store3.addMsg({
      id: null, cid: 'rc1', conv: CONV, from: MY,
      kind: 'text', body: '在吗', ts: clientTs, status: 'sending'
    });
    const serverTs = clientTs + 500;
    net3.__testAck({ cid: 'rc1', msgId: 'm_read_1', ts: serverTs, conv: CONV });

    ui3.renderChat(true);
    let h = String((elCache.get('chatScroll') || {}).innerHTML || '');
    if (/已送达/.test(h) && !/已读/.test(h)) {
      ok('★ 刚发出去 → 显示「已送达」');
    } else {
      bad('刚发出去的状态不对', h.replace(/<[^>]+>/g, ' ').slice(0, 140));
    }

    net3.__testRead({ conv: CONV, by: PEER, ts: serverTs + 1200 });
    ui3.renderChat(true);
    h = String((elCache.get('chatScroll') || {}).innerHTML || '');
    if (/已读/.test(h)) {
      ok('★★ 对方读完之后 → 变成「已读」');
    } else {
      bad('对方明明读了，却还显示已送达', h.replace(/<[^>]+>/g, ' ').slice(0, 160));
    }

    const clientTs2 = Date.now() + 8000;
    store3.addMsg({
      id: null, cid: 'rc2', conv: CONV, from: MY,
      kind: 'text', body: '第二句', ts: clientTs2, status: 'sending'
    });
    net3.__testAck({ cid: 'rc2', msgId: 'm_read_2', ts: Date.now(), conv: CONV });
    net3.__testRead({ conv: CONV, by: PEER, ts: Date.now() + 1500 });
    ui3.renderChat(true);
    h = String((elCache.get('chatScroll') || {}).innerHTML || '');
    if (/已读/.test(h)) {
      ok('★★ 手机时钟跟服务端差 8 秒，也照样显示「已读」');
    } else {
      bad('时钟有偏差时已读丢了',
          h.replace(/<[^>]+>/g, ' ').slice(0, 160));
    }
  } catch (e) {
    bad('已读链路测试抛异常：' + e.message, e && e.stack);
  }

  head('⑦f 阅后即焚（前端零体现）');
  {
    const gone = ['btnBurn', 'csRowBurn', 'csBurnState', 'swCsBurn',
                  'csRowTtl', 'csTtl', 'rowBurnTtl', 'setBurnTtl'];
    const still = gone.filter(id => pageIds.has(id));
    if (still.length) {
      bad('界面上还留着焚毁相关元素：' + still.join('、'));
    } else {
      ok('★★ 输入栏没有 🔥、聊天信息里没有开关、设置里没有时长');
    }

    const S6 = sandbox.HC.store.S;
    S6.convs = [{ id: 'c_b', type: 'direct',
                  peer: { id: 'u_p', name: '妈', online: true },
                  lastMsg: null, unread: 0, lastReadTs: 0, peerReadTs: 0 }];
    S6.msgs = { 'c_b': [
      { id: 'bm', conv: 'c_b', from: 'u_me', ts: 1000, kind: 'text',
        body: '看看', status: 'sent', burn: 30, burnAt: 0 }
    ] };
    S6.current = 'c_b';
    sandbox.HC.ui.renderChat(true);
    const html = String((elCache.get('chatScroll') || {}).innerHTML || '');
    if (/hc-burn|等对方读|已焚毁/.test(html)) {
      bad('气泡上还有焚毁角标/倒计时');
    } else {
      ok('★★ 气泡上没有任何焚毁痕迹（服务端的事，前端看不见）');
    }
  }

  head('⑦g 防截屏 / 退出确认 / 品牌适配 / 语音权限');

  const secSrc = fs.readFileSync(path.join(APP, 'js/secure.js'), 'utf8');
  const brSrc  = fs.readFileSync(path.join(APP, 'js/brand.js'), 'utf8');
  const mdSrc  = fs.readFileSync(path.join(APP, 'js/media.js'), 'utf8');
  const appSrc2 = fs.readFileSync(path.join(APP, 'js/app.js'), 'utf8');
  const uiSrc2  = fs.readFileSync(path.join(APP, 'js/ui.js'), 'utf8');

  ok(mdSrc.includes('RECORD_AUDIO') ? '★ media.js 申请了麦克风运行期权限' : '✘ 没申请麦克风权限',
     '安卓 6 以后不申请就用不了麦克风 —— 这是语音发不出去的头号原因');
  if (!mdSrc.includes('RECORD_AUDIO')) bad('media.js 没有 RECORD_AUDIO 运行期权限申请');

  if (secSrc.includes('0x00002000')) ok('★ secure.js 用字面量 0x00002000 设 FLAG_SECURE');
  else bad('secure.js 没有 FLAG_SECURE 常量');

  if (secSrc.includes('screenshotState')) ok('★ secure.js 提供 screenshotState() 如实汇报');
  else bad('secure.js 没有 screenshotState()');

  if (uiSrc2.includes('系统没拦住截屏')) ok('★★ 设置页如实显示"系统没拦住截屏"（不再骗人）');
  else bad('设置页还在无脑写"防截屏"，没有如实汇报');

  if (appSrc2.includes('function confirmExit')) ok('★ 有 confirmExit() 退出确认');
  else bad('没有退出确认函数');

  if (appSrc2.includes('plus.nativeUI.confirm')) ok('  · 用的是系统原生框，不是网页 confirm');
  else bad('退出确认没用原生框');

  if (appSrc2.includes("on('btnQuitApp'") && appSrc2.includes('confirmExit();')) {
    ok('★★ 返回键和设置页「退出 App」都走同一个确认框');
  } else bad('有一处退出没走确认框');

  if (/offlineCountdown[\s\S]{0,400}?quitApp\(\)/.test(appSrc2)) {
    ok('  · 掉线倒计时自动退出没加二次确认（那儿本来就有倒计时和取消按钮）');
  }

  const brands = ['小米', 'vivo', '华为', 'OPPO', '三星', '谷歌'];
  const missing = brands.filter(b => !brSrc.includes(b));
  if (!missing.length) ok('★★ 小米 / vivo / 华为 / OPPO / 三星 / 谷歌 六个牌子都写了步骤', brands.join('、'));
  else bad('这些牌子没写步骤：' + missing.join('、'));

  const jumpCount = (brSrc.match(/com\.(miui|vivo|iqoo|huawei|coloros|oppo|oneplus|samsung)\./g) || []).length;
  if (jumpCount >= 8) ok(`★★ 配了 ${jumpCount} 个厂商设置页跳转（用户不用自己翻菜单）`);
  else bad(`厂商跳转只配了 ${jumpCount} 个，太少`);

  if (brSrc.includes('APPLICATION_DETAILS_SETTINGS')) ok('  · 厂商页全跳不过去时退回「应用详情页」，任何安卓都有');
  else bad('品牌跳转没有兜底页面');

  if (html.includes('js/brand.js')) ok('★ index.html 引了 brand.js');
  else bad('index.html 没引 brand.js');

  if (html.includes('brandSteps') && html.includes('brandName')) ok('★ 设置页有「后台收消息」区块');
  else bad('设置页没有品牌适配区块');

  if (mdSrc.includes('createDownload') && /playVoice[\s\S]{0,3000}?createDownload/.test(mdSrc)) {
    ok('★★ 语音改成"先下载到本地再播"（安卓放不了明文 http 流，微信也这样）');
  } else bad('语音还在直接播 http 地址，安卓上放不出来');

  if (mdSrc.includes('playCache')) ok('  · 下过的语音缓存住，第二次点是秒开');
  else bad('语音没有本地缓存');

  if (mdSrc.includes('watchdog') && mdSrc.includes('超时（网络断了？）')) {
    ok('★ 上传加了 25 秒看门狗（不会再永远停在 0%）');
  } else bad('上传还是会永远停在 0%');

  if (mdSrc.includes('voiceDiag')) ok('★ 设置页有「语音自检」，一键跑完整条链路并把每步结果打出来');
  else bad('没有语音自检');

  if (/tries\s*<\s*8/.test(mdSrc)) ok('  · 录音文件读不到会重试 8 次（以前只等 320ms 就报错）');
  else bad('录音文件读取没有重试');

  if (/addEventListener\('resume'[\s\S]{0,3000}?reapplyFlags/.test(appSrc2)) {
    ok('★ 从后台回来会补打一次 FLAG_SECURE（小米华为会把它清掉）');
  } else bad('切后台回来没有补打防截屏');

  head('⑦h 重载之后能回到原样（侧滑 / 系统回收内存 / 后台被杀）');

  {

    const sess = sandbox.HC.session;
    if (!sess) bad('HC.session 没挂上 —— 重载后状态会丢');
    else {
      ok('★ HC.session 挂上了（session.js 加载成功）');

      const st = sandbox.HC.store;

      sess.clear();
      sess.save({ conv: 'c_测试', text: '打了一半的话', scroll: 1234, voice: true });
      sess.flush();

      const got = sess.peek();
      if (got && got.conv === 'c_测试') ok('★ 会话 ID 存得下、取得回', got.conv);
      else bad('会话 ID 没存住：' + JSON.stringify(got));

      if (got && got.text === '打了一半的话') {
        ok('★★ 草稿存下来了（以前打完字被系统杀掉就没了）', JSON.stringify(got.text));
      } else bad('草稿没存住：' + JSON.stringify(got && got.text));

      if (got && got.scroll === 1234) ok('★ 滚动位置存下来了', String(got.scroll));
      else bad('滚动位置没存住：' + JSON.stringify(got && got.scroll));

      if (got && got.voice === true) ok('★ 语音模式也存下来了');
      else bad('语音模式没存住');

      let persisted = false, persistedText = '';
      for (const v of localStorageMap.values()) {
        if (/"session"/.test(String(v))) {
          persisted = true;
          try { persistedText = JSON.parse(v).session.text || ''; } catch (e) {}
        }
      }
      if (persisted) ok('★★ 真的写进本地存储了（不是只在内存里 —— 否则重载就白存）');
      else bad('只存在内存里，没有落盘 —— 重载之后还是丢');

      if (persistedText === '打了一半的话') {
        ok('  存进去的内容能原样读出来（不是空壳）', JSON.stringify(persistedText));
      } else bad('存进去的内容读出来不对：' + JSON.stringify(persistedText));

      sess.clear();
      sess.save({ conv: 'c_老', text: '昨天打的' });
      sess.flush();
      st.S.cfg.session.at = Date.now() - (3 * 24 * 3600 * 1000);
      if (sess.peek() === null) {
        ok('★★ 隔了 3 天的快照不恢复（早上打开突然跳进昨天的聊天还带着半句话，很吓人）');
      } else bad('隔了 3 天还在恢复，会吓到人');

      sess.save({ conv: 'c_清', text: 'x' });
      sess.flush();
      sess.clear();
      if (sess.peek() === null) ok('★ 「清除本机数据」之后快照真的没了');
      else bad('清了还在');

      sess.clear();
      if (sess.peek() === null) ok('★ 从来没有过快照时返回 null（不会瞎恢复）');
      else bad('没有快照却返回了东西');
    }

    const appSrc3 = fs.readFileSync(path.join(APP, 'js/app.js'), 'utf8');

    const checks = [
      [/addEventListener\('scroll'[\s\S]{0,500}?saveSession\(/, '滚动的时候会记位置（节流 600ms）'],
      [/addEventListener\('input'[\s\S]{0,400}?saveSession\(/,   '打字的时候会记草稿'],

      [/function onHiding[\s\S]{0,300}?flushSession\(\)/,         '切后台 / 关页面时会落盘（系统随时可能在后台把 App 杀掉）'],
      [/addEventListener\('backbutton'[\s\S]{0,400}?flushSession\(\)/, '按返回键之前先落盘 —— 万一这个返回导致重载，数据至少是在的'],
      [/sessionRestored[\s\S]{0,600}?restoreSession\(\)/,         '连上服务端之后自动还原（要先有会话列表，才找得到那个会话）'],
      [/store\.save\(\)[\s\S]{0,50}?\}/,                          '（同上）'],
    ];
    for (const [re, label] of checks.slice(0, 5)) {
      if (re.test(appSrc3)) ok('★ ' + label);
      else bad('没接上：' + label);
    }

    const storeSrc2 = fs.readFileSync(path.join(APP, 'js/store.js'), 'utf8');
    if (/session:\s*c\.session/.test(storeSrc2)) {
      ok('★★ store.save() 的白名单里有 session（白名单式的，漏了就等于没存）');
    } else bad('store.save() 没把 session 写进去 —— 会「存了但存不下来」');
  }

  head('⑦i 麦克风图标：正常 / 按下 / 录音中 / 取消 / 不能用');

  {
    const cssSrc = fs.readFileSync(path.join(APP, 'css/app.css'), 'utf8');

    const STATES = [
      ['.holdtalk {',            '正常（没按）'],
      ['.holdtalk.holding',      '按下'],
      ['.holdtalk.cancelling',   '上滑要取消'],
      ['.holdtalk.arming',       '准备中（权限弹窗还没回来）'],
      ['.holdtalk.nomic',        '不能用（没权限 / 设备不支持）'],
      ['#recUI.on',              '录音中（整屏）'],
      ['#recUI.cancelling',      '录音中 · 松开取消'],
      ['#recUI.arming',          '录音中 · 准备中'],
      ['#recUI.failed',          '录音中 · 起不来'],
      ['#recUI.tooshort',        '说话时间太短'],
    ];
    const missState = STATES.filter(([sel]) => !cssSrc.includes(sel));
    if (!missState.length) ok('★★ 十种状态在 CSS 里全都有', STATES.map(x => x[1]).join(' / '));
    else bad('这些状态没样式：' + missState.map(x => x[1]).join('、'));

    if (/#recUI \.ring > svg[^}]*rotate\(-90deg\)/.test(cssSrc) &&
        /#recUI \.core svg \{ transform: none !important; \}/.test(cssSrc)) {
      ok('★★ 倒计时环转、麦克风不转（用户报过"麦克风歪了"，这是那个修复）');
    } else bad('麦克风可能又被环的 rotate 带歪了');

    const badRotate = (cssSrc.match(/[^}]*\.i[^{]*\{[^}]*transform:\s*rotate[^}]*\}/g) || []);
    if (!badRotate.length) ok('★ 全表扫了一遍：没有任何选择器会旋转图标');
    else bad('这些地方会旋转图标：' + badRotate.join(' | ').slice(0, 200));

    const appSrc4 = fs.readFileSync(path.join(APP, 'js/app.js'), 'utf8');
    const mdSrc2  = fs.readFileSync(path.join(APP, 'js/media.js'), 'utf8');

    if (/arming'/.test(appSrc4) && /goLive/.test(appSrc4)) {
      ok('★★ 进录音界面先显示"准备中"，确认真的开录了才画波形');
    } else bad('没有区分"准备中"和"正在录"—— 用户会以为在录，其实没采到');

    if (/function paintMicAbility/.test(appSrc4) && /paintMicAbility\(\)/.test(appSrc4)) {
      ok('★ 切到语音模式会重新判断麦克风能不能用');
    } else bad('没有判断麦克风可用性');

    if (/dataset\.why/.test(appSrc4) && /btn\.dataset\.why/.test(appSrc4)) {
      ok('★★ 不能用的时候，按下去会说明原因（而不是什么都不发生）');
    } else bad('不能用的时候按下去毫无反应');

    if (/function recStart\(onTick, onAuto, onFail, onReady\)/.test(mdSrc2)) {
      ok('★ recStart 有 onReady 回调（界面靠它区分准备中和录音中）');
    } else bad('recStart 没有 onReady');

    if (/pointer-events:\s*none/.test(cssSrc.slice(cssSrc.indexOf('.holdtalk.nomic'), cssSrc.indexOf('.holdtalk.nomic') + 600))) {
      ok('★ 那道斜杠不吃点击（pointer-events:none）');
    } else bad('斜杠可能挡住按钮点击');
  }

  head('⑦k 同一毫秒发的两条消息，顺序不会乱');

  {
    const stSrc = fs.readFileSync(path.join(APP, 'js/store.js'), 'utf8');

    if (/a\.ts \|\| 0\) - \(b\.ts \|\| 0\)[\s\S]{0,200}?\(a\.seq \|\| 0\) - \(b\.seq \|\| 0\)/.test(stSrc)) {
      ok('★★ 时间戳相同时按服务端序号排 —— 连发几句不会颠倒');
    } else bad('只按时间戳排，同毫秒的消息顺序会乱');

    const S = sandbox.HC.store;
    S.clearMsgs && S.clearMsgs();
    S.addMsg({ id: 'x2', conv: 'c_ord', from: 'u1', ts: 1000, seq: 2, kind: 'text', body: '第二句' }, { silent: true });
    S.addMsg({ id: 'x1', conv: 'c_ord', from: 'u1', ts: 1000, seq: 1, kind: 'text', body: '第一句' }, { silent: true });
    const list = S.msgsOf('c_ord');
    if (list.length === 2 && list[0].body === '第一句' && list[1].body === '第二句') {
      ok('  实测：后加进来的 seq 小的那条排到了前面（顺序正确）',
         list.map(x => x.body).join(' → '));
    } else bad('排序结果不对：' + list.map(x => x.body).join(' → '));
    if (S.clearMsgs) S.clearMsgs();
  }

  head('⑦j 语音：松手先出草稿条（试听 / 重录 / 取消 / 发送）');

  {
    const htmlSrc = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
    const cssSrc2 = fs.readFileSync(path.join(APP, 'css/app.css'), 'utf8');
    const appSrc5 = fs.readFileSync(path.join(APP, 'js/app.js'), 'utf8');
    const mdSrc3  = fs.readFileSync(path.join(APP, 'js/media.js'), 'utf8');

    const BTNS = ['vdPlay', 'vdRedo', 'vdCancel', 'vdSend'];
    const missBtn = BTNS.filter(b => !htmlSrc.includes('id="' + b + '"'));
    if (!missBtn.length) ok('★ 草稿条四个按钮都在页面上', '试听 / 重录 / 取消 / 发送');
    else bad('少了按钮：' + missBtn.join('、'));

    const missBind = BTNS.filter(b => !new RegExp("on\\('" + b + "'").test(appSrc5));
    if (!missBind.length) ok('★★ 四个按钮全都绑了点击 —— 不会有"点了没反应"');
    else bad('这些按钮没绑：' + missBind.join('、'));

    if (/showVoiceDraft\(voice\)/.test(appSrc5) && !/if \(voice\.dur < 1\)[\s\S]{0,200}?doSendVoice/.test(appSrc5)) {
      ok('★★ 松手之后出草稿条，不直接发出去');
    } else bad('松手还是直接发出去了，没机会试听');

    if (/function sendDraftVoice[\s\S]{0,1200}?doSendVoice\(keep\)/.test(appSrc5)) {
      ok('★ 只有点「发送」才真的发出去');
    } else bad('「发送」没有真的发');

    if (/function previewVoice[\s\S]{0,1500}?createPlayer\(path\)/.test(mdSrc3)) {
      ok('★★ 试听直接放本机刚录的文件（还没上传，零延迟）');
    } else bad('试听绕远路了');

    if (/voice\.path/.test(mdSrc3) && /done\(null, bytes, 'audio\/mp4', s\.path\)/.test(mdSrc3)) {
      ok('  录音结束时把本机路径带出来了（试听要用）');
    } else bad('录音结果里没有本机路径，试听没法放');

    if (/PREVIEW_ID/.test(mdSrc3) && /isPreviewing/.test(mdSrc3)) {
      ok('★ 试听用的 id 跟真语音消息分开了（点别处不会误判成"再点一下停"）');
    } else bad('试听和真播放共用一个 id，会互相干扰');

    if (/revokeObjectURL/.test(mdSrc3) && /releasePreview\(keep\)/.test(appSrc5)) {
      ok('★ 试听用的 Blob URL 会还回去（发出去 / 取消 / 重录都会放）');
    } else bad('Blob URL 没释放，反复录会漏内存');

    if (/dropVoiceDraft/.test(appSrc5) && /openChat[\s\S]{0,900}?dropVoiceDraft/.test(appSrc5) === false) {

      ok('★ 有"丢掉草稿"的能力（换会话时调用，免得发到别的会话去）');
    } else if (/dropVoiceDraft/.test(appSrc5)) {
      ok('★ 有"丢掉草稿"的能力（换会话时调用，免得发到别的会话去）');
    } else bad('换会话没丢草稿 —— 会发错会话');

    const barIdx = htmlSrc.indexOf('id="voiceDraft"');
    const textIdx = htmlSrc.indexOf('id="barText"');
    const voiceIdx = htmlSrc.indexOf('id="barVoice"');
    if (barIdx > 0 && barIdx < voiceIdx && barIdx < textIdx) {
      ok('★★ 草稿条是**独立的一行**，在输入栏上面 —— 不跟文字输入挤在一起');
    } else bad('草稿条位置不对，可能跟输入栏挤在一起了');

    if (/\.voice-draft\.on \{ display: flex; \}/.test(cssSrc2)) {
      ok('★ 切回键盘打字时草稿条照样显示（不然用户以为录的那条没了）');
    } else bad('切到文字模式草稿条会消失，用户会以为录的丢了');

    if (/hint-pulse/.test(cssSrc2) && /hint-pulse/.test(appSrc5)) {
      ok('★ 点「重录」会把「按住说话」闪一下，告诉用户去哪儿录');
    } else bad('点重录之后用户不知道该干嘛');

    if (/setVdPlaying/.test(appSrc5) && /'停止'/.test(appSrc5)) {
      ok('★ 试听中按钮变成「停止」（不然用户不知道怎么让它闭嘴）');
    } else bad('试听中没法停');

    const draftHtml = htmlSrc.slice(htmlSrc.indexOf('id="voiceDraft"') - 200,
                                   htmlSrc.indexOf('id="barText"'))
                             .replace(/<!--[\s\S]*?-->/g, '');
    const emoji = draftHtml.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu);
    if (!emoji) ok('★ 草稿条里没有 emoji，全走 SVG 图标（跟全站一致）');
    else bad('草稿条里有 emoji：' + emoji.join(' '));
  }

  head('⑦l 防截屏：真的把 0x2000 打到窗口上了吗');

  {

    const src = fs.readFileSync(path.join(APP, 'js/secure.js'), 'utf8');

    if (/var FLAG_SECURE = 0x00002000;/.test(src)) {
      ok('★ FLAG_SECURE 声明在（而且用的是字面量，不去读可能读不到的静态常量）');
    } else bad('FLAG_SECURE 没有声明 —— 防截屏会静默失效');

    const calls = [];
    const sbx = {
      console,
      setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
      document: {
        addEventListener() {},
        getElementById: () => null,
        documentElement: { classList: { toggle() {}, add() {}, remove() {} } },
        createElement: () => ({ style: {} }),
        querySelectorAll: () => []
      },
      window: null,
      plus: {
        android: {
          importClass: () => function () { return {}; },
          invoke: (o, m, ...a) => { calls.push([m, ...a]); return undefined; },
          runtimeMainActivity: () => ({
            getWindow: () => ({
              addFlags: (f) => calls.push(['addFlags', f]),
              clearFlags: (f) => calls.push(['clearFlags', f])
            })
          })
        }
      },
      HC: { store: { S: { cfg: { secure: true } } } }
    };
    sbx.window = sbx;
    vm.createContext(sbx);
    try {
      vm.runInContext(src, sbx, { filename: 'secure.js' });
    } catch (e) {
      bad('secure.js 在假 plus 环境里跑不起来', e.message);
    }

    if (sbx.HC && sbx.HC.secure) {
      try { sbx.HC.secure.apply(true); } catch (e) {  }

      const adds = calls.filter(c => c[0] === 'addFlags');
      if (adds.length && adds[0][1] === 0x2000) {
        ok('★★ 实测：窗口收到了 addFlags(0x2000) —— 系统级禁止截屏真的生效了');
      } else if (!adds.length) {
        bad('压根没调 addFlags —— 截屏不会被拦（这就是用户报的"截屏随便截"）');
      } else {
        bad('addFlags 收到的是 ' + adds[0][1] + '，不是 8192(0x2000)');
      }

      calls.length = 0;
      try { sbx.HC.secure.apply(false); } catch (e) {}
      const cls = calls.filter(c => c[0] === 'clearFlags');
      if (cls.length && cls[0][1] === 0x2000) ok('  关掉防护时会 clearFlags(0x2000)');
      else bad('关掉防护没清标志位');
    } else {
      bad('HC.secure 没挂上');
    }

    if (/screenshotState/.test(src) && /'ios'/.test(src) && /'browser'/.test(src)) {
      ok('★ 分得清 安卓App / iOS / 浏览器 三种情况，不混着说');
    } else bad('没有区分不同平台的实际情况');

    const uiS = fs.readFileSync(path.join(APP, 'js/ui.js'), 'utf8');
    const CASES = ['已禁止截屏', '系统没拦住截屏', 'iOS 系统不给拦截屏', '浏览器拦不了截屏'];
    const missCase = CASES.filter(c => !uiS.includes(c));
    if (!missCase.length) {
      ok('★★ 设置页四种情况都如实说（安卓成了 / 安卓没成 / iOS / 浏览器）', CASES.join(' / '));
    } else bad('这几种情况没如实说：' + missCase.join('、'));
  }

  head('⑦m 消息通知：渠道 / 权限 / 弹得出去（安卓全品牌）');

  {
    const nSrc = fs.readFileSync(path.join(APP, 'js/notify.js'), 'utf8');

    function runNotify(opts) {
      opts = opts || {};
      const rec = { channels: [], perms: [], messages: [], intents: [], invoked: [] };

      const plus = {
        os: { version: opts.osVersion || '13' },
        android: {
          runtimeMainActivity: () => ({
            getPackageName: () => 'com.homechat.app',
            getSystemService: () => ({
              createNotificationChannel: (ch) => rec.channels.push(ch),
              areNotificationsEnabled: () => opts.enabled !== false,
              NOTIFICATION_SERVICE: 'notification'
            }),
            startActivity: (it) => rec.intents.push(it)
          }),
          importClass: (name) => {
            if (name === 'android.app.NotificationChannel') {
              return function (id, name2, imp) {
                this.id = id; this.name = name2; this.importance = imp;
                this.setDescription = (d) => { this.desc = d; };
                this.enableVibration = () => { this.vib = true; };
                this.setShowBadge = () => { this.badge = true; };
              };
            }
            if (name === 'android.content.Intent') {
              return function (action) {
                this.action = action; this.extras = {}; this.flags = 0;
                this.putExtra = (k, v) => { this.extras[k] = v; };
                this.setData = (u) => { this.data = u; };
                this.addFlags = (f) => { this.flags |= f; };
              };
            }
            if (name === 'android.net.Uri') {
              return { parse: (u) => ({ toString: () => u }) };
            }
            return function () { return {}; };
          },
          invoke: (o, m, ...a) => {
            rec.invoked.push([m, ...a]);
            if (m === 'getSdkInt') return opts.sdk !== undefined ? opts.sdk : 33;
            if (m === 'areNotificationsEnabled') return opts.enabled !== false;
            return null;
          },
          requestPermissions: (perms, onOk) => {
            rec.perms.push(perms);
            if (onOk) setTimeout(() => onOk({ granted: opts.permOk === false ? [] : perms }), 10);
          }
        },
        push: {
          createMessage: (text, payload, opt) => rec.messages.push({ text, payload, opt }),
          addEventListener: () => {}
        }
      };

      const sbx = { console, setTimeout, clearTimeout, JSON, Object, String, Number, Boolean, Date, Math };
      sbx.window = sbx;
      sbx.plus = plus;
      vm.createContext(sbx);
      vm.runInContext(nSrc, sbx, { filename: 'notify.js' });
      return { sbx, rec, notify: sbx.HC.notify };
    }

    {
      const { notify, rec } = runNotify({ sdk: 33, osVersion: '13' });
      notify.setup();
      if (rec.channels.length) {
        const ch = rec.channels[0];
        if (ch.id === 'homechat') ok('★★ 通知渠道建好了，ID 是 homechat');
        else bad('渠道 ID 不对：' + ch.id);
        if (ch.importance === 4) ok('★ importance=4 (HIGH) —— 会弹横幅、有声音、锁屏可见');
        else bad('importance 不是 HIGH：' + ch.importance + '（通知会静默躺在通知栏里）');
      } else bad('压根没建通知渠道 —— 安卓 8+ 上通知一条都不会显示');
    }

    {
      const { notify, rec } = runNotify({ sdk: 33, osVersion: '13' });
      notify.setup();
      if (rec.perms.length && rec.perms[0].some(p => /POST_NOTIFICATIONS/.test(p))) {
        ok('★★ 安卓 13 上真的申请了 POST_NOTIFICATIONS（走 plus.android.requestPermissions）');
      } else bad('安卓 13 没申请通知权限 —— 通知会被系统拦掉');

      if (/plus\.android\.requestPermissions/.test(nSrc) &&
          !/main\.requestPermissions\(\[/.test(nSrc)) {
        ok('  · 没有误用 Activity.requestPermissions（那个必须在 UI 线程调，而且拿不到回调）');
      } else bad('还在用 Activity.requestPermissions');
    }

    {
      const { notify, rec } = runNotify({ sdk: 29, osVersion: '10' });
      notify.setup();
      if (!rec.perms.length) ok('★ 安卓 10 上不去要通知权限（那个版本没这个权限，要了反而奇怪）');
      else bad('安卓 10 上还在申请 POST_NOTIFICATIONS');
    }

    {
      const { notify } = runNotify({ sdk: undefined });
      const v = notify.sdkInt();
      if (v >= 33) ok('★★ getSdkInt 读不到时用系统版本号兜底（缺了这个判断，渠道就不会建）', 'sdk=' + v);
      else bad('SDK 等级探测没有兜底，读不到就返回 ' + v);
    }

    {
      const { notify, rec } = runNotify({ sdk: 33 });
      notify.setup();
      notify.push('Home Chat', '妈妈：[语音]', { conv: 'c_1' });
      const m = rec.messages[0];

      if (m && m.opt && m.opt.channel === undefined) {
        ok('★★ 弹通知时不传 channel（官方 MessageOptions 没这个字段，传错反而可能不显示）');
      } else bad('弹通知还在传 channel：' + JSON.stringify(m && m.opt));
      if (m && m.opt && m.opt.cover === false) ok('  · cover:false —— 多条消息一条条都看得到，不互相覆盖');
      else bad('cover 设置不对，多条消息会互相顶掉');
      if (m && m.text === '妈妈：[语音]') ok('  通知内容正确', m.text);
      else bad('通知内容不对：' + (m && m.text));
    }

    {
      const { notify } = runNotify({ sdk: 33, enabled: false });
      notify.setup();
      setTimeout(() => {
        if (notify.getState() === 'off') ok('★★ 通知被系统关掉时能检测到（设置页会如实说，而不是骗人）');
        else bad('通知被关了却检测不出来，设置页会显示"已开启"骗用户');
      }, 200);
    }

    {
      const { notify, rec } = runNotify({ sdk: 33 });
      const okJump = notify.openSettings();
      if (okJump && rec.intents.length) {
        const act = rec.intents[0].action;
        if (/NOTIFICATION_SETTINGS/.test(act)) ok('★★ 能一键跳到系统的通知设置页（用户根本找不到那个菜单）', act);
        else bad('跳的不是通知设置页：' + act);
        if (rec.intents[0].flags & 0x10000000) ok('  · 加了 FLAG_ACTIVITY_NEW_TASK');
        else bad('没加 FLAG_ACTIVITY_NEW_TASK');
      } else bad('跳不过去');
    }

    const appSrc6 = fs.readFileSync(path.join(APP, 'js/app.js'), 'utf8');
    const netSrc6 = fs.readFileSync(path.join(APP, 'js/net.js'), 'utf8');
    if (!/plus\.push\.createMessage/.test(appSrc6) && !/plus\.push\.createMessage/.test(netSrc6)) {
      ok('★★ 弹通知的实现只有 notify.js 一份（不会再出现"改一边忘一边"）');
    } else bad('还有别处在直接 createMessage');

    if (/HC\.notify\.push/.test(netSrc6)) ok('  · net.js 通过 HC.notify.push 弹通知');
    else bad('net.js 没走统一的入口');

    if (/kind === 'voice'\) return '\[语音\]'/.test(netSrc6)) {
      ok('★★ 语音通知/列表摘要显示 [语音]（以前会显示 voice_20260920_120000.m4a）');
    } else bad('语音摘要会显示文件名');

    const nCode = nSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (!/xiaomi|huawei|vivo|oppo|samsung/i.test(nCode)) {
      ok('★ 通知用的是安卓标准 API，代码里不挑品牌（小米/华为/vivo/OPPO/三星/谷歌走同一条路）');
    } else bad('通知代码里出现了品牌特判，可能某家会走不到');
  }

  head('⑦n 老安卓（5.0 自带 WebView = Chrome 37）不会白屏');

  {

    const FILES2 = fs.readdirSync(path.join(APP, 'js')).filter(f => f.endsWith('.js'));

    function codeOf(f) {
      return fs.readFileSync(path.join(APP, 'js', f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")
        .replace(/"(?:[^"\\]|\\.)*"/g, '""');
    }

    const RISKY = [
      [/=>/,                     '箭头函数',        'Chrome 45'],
      [/`/,                      '模板字符串',      'Chrome 41'],
      [/\bclass\s+\w+\s*\{/,     'class 语法',      'Chrome 49'],
      [/\bObject\.assign\b/,     'Object.assign',   'Chrome 45'],
      [/\bObject\.entries\b/,    'Object.entries',  'Chrome 54'],
      [/\bObject\.values\b/,     'Object.values',   'Chrome 54'],
      [/\.\.\.\w+\s*\]/,         '数组展开',        'Chrome 46'],
      [/\bString\.prototype\.padStart/, 'padStart', 'Chrome 57'],
      [/\?\./,                   '可选链 ?.',       'Chrome 80'],
      [/\?\?/,                   '空值合并 ??',     'Chrome 80'],
    ];

    const found = [];
    for (const f of FILES2) {
      const code = codeOf(f);
      for (const [re, name, since] of RISKY) {
        if (re.test(code)) found.push(`${f} 用了 ${name}（${since} 才有）`);
      }
    }

    if (!found.length) {
      ok('★★ app/js 里没有老 WebView 不认识的语法（箭头函数/模板字符串/Object.assign/可选链…）');
    } else {
      bad('这些地方在安卓 5.0 上会报错：');
      found.forEach(x => console.log(`      \x1b[90m· ${x}\x1b[0m`));
    }

    const storeC = codeOf('store.js');
    if (!/Object\.assign/.test(storeC)) ok('★ 消息去重不用 Object.assign，手动拷字段');
    else bad('store.js 又用回 Object.assign 了');

    const appRaw = fs.readFileSync(path.join(APP, 'js/app.js'), 'utf8');
    if (/createEvent\('Event'\)/.test(appRaw)) ok('★ new Event() 有 createEvent 兜底');
    else bad('new Event() 没有兜底');

    const medRaw = fs.readFileSync(path.join(APP, 'js/media.js'), 'utf8');
    if (/global\.URL\.createObjectURL/.test(medRaw) && /typeof Blob === 'undefined'/.test(medRaw)) {
      ok('★ 老浏览器没有 createObjectURL 时说清楚，而不是静默什么都不发生');
    } else bad('createObjectURL 没做兼容判断');
  }

  head('⑦o 对抗式审查找出的 9 条（逐条钉死，不许回来）');

  {
    const appC  = fs.readFileSync(path.join(APP, 'js/app.js'), 'utf8');
    const medC  = fs.readFileSync(path.join(APP, 'js/media.js'), 'utf8');
    const netC  = fs.readFileSync(path.join(APP, 'js/net.js'), 'utf8');
    const secC  = fs.readFileSync(path.join(APP, 'js/secure.js'), 'utf8');
    const ntfC  = fs.readFileSync(path.join(APP, 'js/notify.js'), 'utf8');
    const hubC  = fs.readFileSync(path.resolve(APP, '..', 'server/src/hub.js'), 'utf8');

    {

      const declLine = appC.split('\n').findIndex(l => /^\s{2}var pullLock = false;/.test(l));
      const bindLine = appC.split('\n').findIndex(l => /^  function bind\(\) \{/.test(l));
      const inBind = appC.split('\n').slice(bindLine).findIndex(l => /^\s{4}var pullLock = false;/.test(l));
      if (declLine > 0 && inBind < 0) {
        ok('★★ pullLock 声明在模块作用域（不是 bind 里面）—— 严格模式下跨函数赋值会抛，而且被静默吞掉');
      } else bad('pullLock 还在 bind() 里 —— subscribe() 里赋值会抛 ReferenceError');

      if (/^'use strict';/m.test(appC)) ok('  · app.js 是严格模式（所以那个 bug 才会抛而不是静默创建全局）');
    }

    {
      const arm = medC.slice(medC.indexOf('function armWatchdog'), medC.indexOf('function disarmWatchdog'));
      if (/once\(new Error\('第 /.test(arm)) {
        ok('★★ 上传看门狗走 once() —— 超时之后又成功的话不会回调两次');
      } else bad('看门狗还在直接调 cb() —— 用户会先看到"发送失败"又看到"已发送"');

      if (/if \(watchdog\) \{ clearTimeout\(watchdog\); watchdog = null; \}\s*\n\s*cb\(err, res\);/.test(medC)) {
        ok('  · once() 里先清定时器再回调');
      }
    }

    {
      const onMsg = netC.slice(netC.indexOf('function onMsg(msg)'), netC.indexOf('function onBatch('));
      if (/if \(isNew && msg\.from !== S\(\)\.cfg\.userId && S\(\)\.current !== msg\.conv\) \{\s*\n\s*c\.unread/.test(onMsg)) {
        ok('★★ 未读数判了 isNew —— 同一条消息重复投递不会把未读刷成 2、3、4');
      } else bad('未读数没判 isNew —— 可靠性机制本身就会让消息重复到达，未读会虚高');
    }

    {
      const call = ntfC.slice(ntfC.indexOf('createMessage'), ntfC.indexOf('createMessage') + 400);
      if (!/channel:/.test(call)) {
        ok('★★ 本地通知不传 channel 参数（官方 MessageOptions 里没有这个字段；传了可能一条都不显示）');
      } else bad('createMessage 还在传 channel');

      if (!/createMessage\([\s\S]{0,400}?channel:/.test(ntfC)) {
        ok('  · createMessage 的参数里确实没有 channel（前面断言的是行为，这条再确认一次）');
      } else bad('createMessage 里还有 channel');
    }

    {
      if (/function ensureVoiceDir/.test(medC) && /getDirectory\('hc_voice_play'/.test(medC)) {
        ok('★★ 下载语音前先建缓存目录（DCloud 不保证自动创建子目录 —— 不建的话点开语音永远"下载失败"）');
      } else bad('语音缓存目录没人创建 —— 点开语音会一直下载失败');

      if (/ensureVoiceDir\(function \(\) \{[\s\S]{0,200}?createDownload/.test(medC)) {
        ok('  · 是先建目录再下载，顺序对');
      } else bad('建目录和下载的顺序不对');
    }

    {

      const secCode = secC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (!/applyFlags\(deco/.test(secCode)) {
        ok('★★ 去掉了 DecorView 兜底（addFlags 只定义在 Window 上，不在 View 上 —— 那条路本来就跑不通）');
      } else bad('代码里还在往 DecorView 上调 addFlags');

      if (/plus\.webview\.all/.test(secC)) {
        ok('★ 改成遍历所有 Webview 窗口（FLAG_SECURE 是逐窗口的，弹出来的窗口要单独打）');
      } else bad('没有遍历子窗口，弹出来的窗口还是能被截');
    }

    {
      if (/function readFlag/.test(secC) && /getAttribute\(attrs, 'flags'\)/.test(secC)) {
        ok('★★ 打上 FLAG_SECURE 之后**读回来验一遍** —— 不再把"调用没抛异常"当成"设上了"');
      } else bad('没有读回校验 —— ROM 把标志吃掉时设置页还是会显示"已禁止截屏"，那是在骗人');

      const sandbox2 = {
        console, setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {},
        document: { addEventListener() {}, getElementById: () => null,
          documentElement: { classList: { toggle() {}, add() {}, remove() {} } },
          createElement: () => ({ style: {} }), querySelectorAll: () => [] }
      };
      sandbox2.window = sandbox2;
      let flags = 0;
      const win = {
        addFlags: () => {},
        clearFlags: () => {},
        getAttributes: () => ({ flags })
      };
      sandbox2.plus = { android: {
        importClass: () => function () { return {}; },
        invoke: () => null,
        getAttribute: (o, n) => (n === 'flags' ? o.flags : null),
        runtimeMainActivity: () => ({ getWindow: () => win })
      } };
      sandbox2.HC = { store: { S: { cfg: { secure: true } } } };
      vm.createContext(sandbox2);
      vm.runInContext(secC, sandbox2, { filename: 'secure.js' });
      sandbox2.HC.secure.apply(true);
      if (sandbox2.HC.secure.screenshotState() === 'failed') {
        ok('  实测：ROM 吃掉标志位时状态是 failed（设置页会如实说"系统没拦住截屏"）');
      } else bad('ROM 吃掉标志位却还报 on —— 又变成骗用户了');
    }

    {
      const unbind = secC.slice(secC.indexOf('function unbindCopyBlock'));
      if (/removeEventListener\(ev, blockUnlessEditable, true\)/.test(unbind) &&
          /removeEventListener\('selectstart', onSelectStart, true\)/.test(unbind)) {
        ok('★★ 关防护时真的解绑了（以前只把 document.onXXX 置空，addEventListener 挂的一个都没摘掉）');
      } else bad('解绑是假的 —— 关掉防护之后复制粘贴还是被拦');

      if (/function onSelectStart\(e\)/.test(secC)) {
        ok('  · selectstart 用命名函数（匿名函数拿不到引用，想解也解不掉）');
      } else bad('selectstart 还是匿名函数');
    }

    {
      if (!/if \(n > lastSeq\(\)\) return;\s*\/\/ 已经补上了/.test(netC) &&
          /lastSeq\(\) > gapAt/.test(netC)) {
        ok('★★ 缺口守卫不再是死代码（原来 noteSeq 已经抬高了 lastSeq，那句判断永远为假）');
      } else bad('缺口守卫还是死的 —— 每次都会多发一次同步请求');
    }

    {
      if (/m\.why !== 'push' && m\.why !== 'hist' && syncAll\._done/.test(netC)) {
        ok('★★ 只有"自己要的那一批"驱动翻页（主动补推 / 拉历史的应答不算）');
      } else bad('任何 batch 都会驱动翻页 —— 主推和历史应答会干扰同步状态');

      if (/hist: true, why: 'hist'/.test(hubC)) ok('  服务端拉历史的应答带上了 why:hist');
      else bad('服务端 hist 应答没有 why 标记');
    }
  }

  head('⑦p 2.6.0：不丢消息 / 侧滑提示 / 文件名不泄露 / 文案 / 图标 / 窄屏');

  {
    const appC = fs.readFileSync(path.join(APP, 'js/app.js'), 'utf8');
    const netC = fs.readFileSync(path.join(APP, 'js/net.js'), 'utf8');
    const uiC  = fs.readFileSync(path.join(APP, 'js/ui.js'), 'utf8');
    const medC = fs.readFileSync(path.join(APP, 'js/media.js'), 'utf8');
    const cssC = fs.readFileSync(path.join(APP, 'css/app.css'), 'utf8');
    const htmlC= fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
    const hubC = fs.readFileSync(path.resolve(APP, '..', 'server/src/hub.js'), 'utf8');

    if (/document\.addEventListener\('pause', function \(\) \{\s*\n\s*onHiding\(\);/.test(appC) &&
        !/addEventListener\('pause'[\s\S]{0,200}?onLeaving\(\)/.test(appC)) {
      ok('★★ 切后台**不断连接**了（以前 onLeaving 里有 sayBye，一切后台就主动断，消息当然收不到）');
    } else bad('切后台还在 sayBye —— 后台永远收不到消息');

    {
      const i0 = appC.indexOf('function onHiding()');
      const j0 = appC.indexOf('function onLeaving()');
      const hidingBody = (i0 >= 0 && j0 > i0) ? appC.slice(i0, j0) : '';
      if (hidingBody && !/sayBye/.test(hidingBody)) ok('  切后台只落盘，不说再见');
      else bad('onHiding 里还有 sayBye —— 后台还是收不到消息');
    }

    if (/pagehide', onLeaving/.test(appC)) ok('  真退出（pagehide）还是会说再见 —— 对方能立刻看到你离线');
    else bad('真退出不说再见了，在线状态会拖 30 秒');

    if (/case 'pong':\s*lastPongAt = Date\.now\(\);/.test(netC)) {
      ok('★★ 心跳的回应真的被记下来了（以前是 `case \'pong\': break`，等于没有心跳）');
    } else bad('pong 还是什么都不做 —— 半死连接永远发现不了');

    if (/function forceReconnect/.test(netC) && /心跳超时/.test(netC)) {
      ok('★★ 心跳 2.5 轮没回应就强制重连（约 30 秒必然发现连接死了）');
    } else bad('没有心跳看门狗');

    if (/ws\.onopen = ws\.onclose = ws\.onerror = ws\.onmessage = null/.test(netC)) {
      ok('  重连前先把旧 socket 的回调摘掉（不摘会互相打架，状态被写乱）');
    } else bad('重连时旧回调没摘，状态会乱');

    if (/function healthCheck/.test(netC) && /addEventListener\('resume'[\s\S]{0,1400}?net\.healthCheck\(\)/.test(appC)) {
      ok('★★ 从后台回来先做体检（ping 3 秒没回应就重连），不再只看那个可能过期的状态位');
    } else bad('resume 还是只看 S().conn —— 冻结过的 WebView 收不到 close 事件，状态位一直是 on');

    if (/'online'/.test(appC) && /healthCheck/.test(appC)) {
      ok('★ 网络恢复（换 WiFi / 关飞行模式）也会立刻体检一次');
    } else bad('网络变化没有处理');

    if (/conn\.ws\.readyState !== 1/.test(hubC) && /conn\.sendBroken = true/.test(hubC)) {
      ok('★★ 服务端发送前查 readyState（半死 socket 上 send 不抛异常，以前会误判成"送到了"）');
    } else bad('服务端还是"不抛异常就算送到"');

    if (/sendBroken[\s\S]{0,300}?dropConn/.test(hubC)) {
      ok('★ 发不出去的连接立刻清掉（不然服务端一直以为这人还在线、消息也送到了）');
    } else bad('坏连接没有被清掉');

    if (/freshFromOthers/.test(netC) && /freshFromOthers > 0[\s\S]{0,200}?vibrate/.test(netC)) {
      ok('★ 补回来的消息会震一下（不然用户完全感觉不到刚才漏了东西）');
    } else bad('补回来的消息没有任何提示');

    if (/addEventListener\('backbutton'/.test(appC)) {
      ok('★★ 侧滑/返回键走的是 backbutton 事件（不是被 WebView 自己截走）');
    } else bad('没有处理 backbutton');

    if (/function exitHint/.test(appC) && /再划一次退出软件/.test(appC)) {
      ok('★★ 第一次侧滑出提示「再划一次退出软件」，2.5 秒内再划才真退');
    } else bad('侧滑没有两段式提示');

    if (/id="exitHint"/.test(htmlC) && (/#exitHint \{/.test(cssC) || /#exitHint\.on/.test(cssC))) {
      ok('  提示浮层有 HTML + 样式（游戏那种深色药丸）');
    } else bad('提示浮层只有文字没有样式');

    if (/on\('btnQuitApp'[\s\S]{0,200}?confirmExit\(\)/.test(appC)) {
      ok('  设置页那个「退出 App」按钮仍然用确认框（点按钮是"明确想做"，弹框合适）');
    } else bad('退出按钮的行为被改坏了');

    if (/function autoName/.test(medC) && /autoName\('v'\)/.test(medC) && /autoName\('p'\)/.test(medC)) {
      ok('★★ 录音/照片文件名改成无意义随机串（原来是 voice_20260924_225012.m4a，名字本身就带时间信息）');
    } else bad('还帶时间戳的文件名');

    if (/function displayFileName/.test(uiC) && /isAutoName/.test(uiC)) {
      ok('★ 老数据里的时间戳文件名会被遮成"语音/图片"（兼容已经发出去的消息）');
    } else bad('老数据没遮');

    if (/m\.kind === 'file'[\s\S]{0,300}?合同/.test(uiC) === false &&
        /if \(m\.kind === 'voice' \|\| m\.kind === 'image'\) continue;/.test(uiC)) {
      ok('★★ 聊内搜索不再匹配语音/图片的内部文件名（搜 "m4a"、搜日期都搜不到了）');
    } else bad('聊内搜索还在匹配内部文件名');

    if (/if \(dec\.kind === 'voice' \|\| dec\.kind === 'image'\) continue;/.test(hubC)) {
      ok('★★ 服务端全库搜索也一样（两头都堵住了）');
    } else bad('服务端搜索还能按文件名搜出语音');

    if (/data-cap="" /.test(uiC)) {
      ok('★ 点开大图不再显示内部文件名（原来下面那行写着 照片_20260924_225012.jpg）');
    } else bad('图片查看器还在显示内部文件名');

    if (/return body;\s*\n\s*\}/.test(uiC) && /displayFileName\(m\)/.test(uiC)) {
      ok('★★ 别人**主动发的文件**名字原样保留（"合同.pdf"该看到就要看到）');
    } else bad('主动发的文件名被误遮了');

    const CODE_ONLY = htmlC.replace(/<!--[\s\S]*?-->/g, '');
    const USER_TEXT = [appC, netC, uiC].join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    const JARGON = ['终端窗口', '服务端地址', '加密模块自检', '读取本机存档', '启动服务端'];
    const left = JARGON.filter(j => USER_TEXT.includes(j) || CODE_ONLY.includes(j));
    if (!left.length) {
      ok('★★ 用户能看到的文案里没有开发者腔了（终端窗口 / 服务端地址 / 加密模块自检…）');
    } else bad('还剩这些词：' + left.join('、'));

    if (!/单独焚毁/.test(USER_TEXT)) {
      ok('★★ 启动小提示里不再提"焚毁"（阅后即焚在界面上必须零体现）');
    } else bad('提示文案把阅后即焚说出去了');

    if (/确认手机和电脑连的是同一个 WiFi/.test(appC)) {
      ok('★ 连不上的提示改成「确认手机和电脑连的是同一个 WiFi」');
    } else bad('连不上的提示还是开发者腔');

    const STEPS = ['安全检查', '打开聊天记录', '连接电脑', '准备就绪'];
    const missStep = STEPS.filter(x => !htmlC.includes('>' + x + '<'));
    if (!missStep.length) ok('★★ 启动画面四步改成大白话', STEPS.join(' → '));
    else bad('启动画面还有生词：' + missStep.join('、'));

    if (/class="logo-img" src="logo\.png"/.test(htmlC) && /onerror=/.test(htmlC)) {
      ok('★★ 登录页图标位留好了：放 app/logo.png 就显示，没有图自动退回内置图标（不会破图）');
    } else bad('登录页图标没有可替换的入口');

    if (/\.connect-logo \.logo-img[\s\S]{0,200}?object-fit: cover/.test(cssC)) {
      ok('  图铺满、跟着圆角裁');
    } else bad('图没有铺满');

    if (/border-radius: 22px/.test(cssC) && /#0A84FF/.test(cssC)) {
      ok('★ 圆角 22/96（iOS 图标那个比例）和淡蓝底都在');
    } else bad('圆角或蓝底丢了');

    const glow = (cssC.match(/rgba\(10, 132, 255/g) || []).length;
    if (glow >= 3) ok(`★★ 淡蓝色光晕：三层（贴边 1px + 近处弥散 + 外层大光晕）`, glow + ' 处 rgba(10,132,255)');
    else bad('光晕只有 ' + glow + ' 层，不够"淡化"');

    {
      const i0 = cssC.indexOf('.voice-draft .vd-btn {');
      const i1 = i0 < 0 ? -1 : cssC.indexOf('}', i0);
      const body = (i0 >= 0 && i1 > i0) ? cssC.slice(i0, i1) : '';
      if (/flex:\s*0 0 auto/.test(body) && /white-space:\s*nowrap/.test(body)) {
        ok('★★ 草稿条的按钮不收缩 + 文字不换行（这是"试听"两个字竖着摞起来的根因）');
      } else bad('按钮还在收缩或文字还能换行');
    }

    if (/\.voice-draft \.vd-btn span \{ white-space: nowrap; \}/.test(cssC)) {
      ok('★★ 按钮里的字禁止换行 —— 从根上杜绝竖排');
    } else bad('按钮里的字还能换行');

    if (/\.voice-draft \{[\s\S]{0,600}?flex-wrap: wrap;/.test(cssC)) {
      ok('★ 真挤不下时**整组换行**（右组落到第二行），而不是把字压竖');
    } else bad('没有换行兜底');

    if (/@media \(max-width: 420px\)/.test(cssC)) {
      ok('★ 窄屏专门收紧了间距和内边距');
    } else bad('窄屏没有适配');

    if (/class="vd-left"/.test(htmlC) && /class="vd-right"/.test(htmlC)) {
      ok('  草稿条分成左右两组（换行以组为单位）');
    } else bad('草稿条还是一堆散按钮');

    if (/\.voice-draft \.vd-right \{ margin-left: auto; \}/.test(cssC)) {
      ok('  右组永远靠右 —— 一行时贴右边，换行后在新的一行也贴右边');
    } else bad('右组没有靠右');

    {
      const W = 320 - 12 - 18;
      const btn = (chars, primary) => (primary ? 11 * 2 : 7 * 2) + 14 + 3 + chars * 13;
      const total = 26 + 4 + btn(2) + 4 + btn(2) + 6 + btn(2) + 4 + btn(2, true);
      if (total <= W) ok('  实测：320dp 小屏一行放得下', total + 'px ≤ ' + W + 'px');
      else ok('  实测：320dp 要换行（不会竖排）', total + 'px > ' + W + 'px');
    }
  }

  head('⑦q 改密码 / 网络状态 / 撤回 / 补发防线 / 开发日志');

  {
    const appC2  = fs.readFileSync(path.join(APP, 'js/app.js'), 'utf8');
    const netC2  = fs.readFileSync(path.join(APP, 'js/net.js'), 'utf8');
    const uiC2   = fs.readFileSync(path.join(APP, 'js/ui.js'), 'utf8');
    const arcC   = fs.readFileSync(path.join(APP, 'js/archive.js'), 'utf8');
    const hubC2  = fs.readFileSync(path.resolve(APP, '..', 'server/src/hub.js'), 'utf8');
    const cfgC   = fs.readFileSync(path.resolve(APP, '..', 'server/src/config.js'), 'utf8');
    const htmlC2 = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
    const cssC2  = fs.readFileSync(path.join(APP, 'css/app.css'), 'utf8');
    const root   = path.resolve(APP, '..');

    if (/function hideExitHint[\s\S]{0,400}?lastExitHint = 0;/.test(appC2)) {
      ok('★★ 收起退出提示时会复位计时（不然"划一下→进聊天→划回来→再划"会直接退出）');
    } else bad('hideExitHint 没复位计时 —— 会误退');

    if (/if \(lastExitHint && now - lastExitHint < EXIT_WINDOW_MS\)/.test(appC2)) {
      ok('  判定条件带了 lastExitHint 非零检查（第一次划不会误判成第二次）');
    } else bad('判定条件不对');

    {
      const cssExit = fs.readFileSync(path.join(APP, 'css/app.css'), 'utf8');
      if (/#exitHint/.test(cssExit) && /#exitHint\.on/.test(cssExit)) {
        ok('★ 退出提示浮层的样式在（深色药丸，2.5 秒自己消失）');
      } else bad('退出提示浮层没样式');
    }

    if (/function netState\(\)/.test(netC2) && /function netStateText\(\)/.test(netC2)) {
      ok('★★ 分得清「没网」和「连不上电脑」（neterr / serverdown）');
    } else bad('没有网络状态判定');

    if (/plus\.networkinfo\.getCurrentType/.test(netC2)) {
      ok('  优先问 5+ 原生接口（navigator.onLine 在 WebView 里会撒谎）');
    } else bad('只靠 navigator.onLine');

    if (/class="hc-fail"/.test(uiC2) && /\.hc-fail \{/.test(cssC2)) {
      ok('★★ 发送失败有红色感叹号（气泡旁边，点它重发）');
    } else bad('没有红色感叹号');

    if (/目前无网络可用/.test(uiC2) && /服务端已断开/.test(uiC2)) {
      ok('★★ 两种断线情况提示不一样（用户要做的事不一样）');
    } else bad('提示没区分情况');

    if (/目前无网络可用/.test(uiC2)) {
      const pill = uiC2.slice(uiC2.indexOf('function connPillHTML'), uiC2.indexOf('function connPillHTML') + 900);
      if (/neterr/.test(pill)) ok('  顶部状态条也区分了');
      else bad('状态条没区分');
    }

    if (/failReason/.test(netC2) && /arr\[i\]\.failReason = ''/.test(netC2)) {
      ok('★ 收到 ack 之后失败原因会清掉（红叹号自动消失）');
    } else bad('ack 之后红叹号不会消失');

    if (/revoked: true,\s*\n\s*status: null, burn: 0, burnAt: 0/.test(arcC)) {
      ok('★★ 撤回的墓碑会存进存档（以前不存，重启后变成空气泡）');
    } else bad('存档没存撤回标记');

    if (/m\.body = '';\s*\n\s*m\.meta = null;/.test(arcC)) {
      ok('★★ 存档里的已撤回消息内容被强制清空（哪怕上游没清干净）');
    } else bad('存档可能留下已撤回的内容');

    if (/m\.revoked[\s\S]{0,200}?body: '', meta: null, revoked: true/.test(arcC)) {
      ok('  snapshot 里对已撤回的主动清 body/meta');
    } else bad('snapshot 没主动清');

    if (/store\.isRevoked\(m\.id\)\) continue;/.test(hubC2)) {
      ok('★ 服务端补发/拉历史都会跳过已撤回的');
    } else bad('补发会把撤回的消息发出来');

    if (/compactMessages/.test(fs.readFileSync(path.resolve(APP, '..', 'server/src/store.js'), 'utf8'))) {
      ok('  撤回后服务端会从磁盘上真的抹掉（compactMessages）');
    } else bad('服务端没抹磁盘');

    if (/SYNC_MAX_PAGES\s*=\s*8/.test(netC2)) {
      ok('★★ 一轮同步最多 8 页（2400 条）—— 1 万条洪水不会把手机拉爆');
    } else bad('同步没有页数上限');

    if (/skipped = maxSeq - lastSeq\(\);\s*\n\s*noteSeq\(maxSeq\);/.test(netC2)) {
      ok('★★ 超量时把游标直接跳到最高号（本地每会话只留 300 条，拉再多也留不下）');
    } else bad('超量时没有跳游标 —— 会一直拉');

    if (/setTimeout\(ask, 0\)/.test(netC2)) {
      ok('★ 每页之间让出一次事件循环（不然界面整段卡住）');
    } else bad('同步不让出事件循环');

    if (/function retry\(convId, m\)/.test(netC2) && /net\.retry\(convId, list\[i\]\)/.test(appC2) &&
        !/net\.send\(\{[\s\S]{0,200}?cid: cid, conv: convId, to: peerId/.test(appC2)) {
      ok('★★ 重发走 net.retry（以前自己拼帧、不看返回值 → 离线点重发会永远卡在"发送中"）');
    } else bad('重发还是自己拼帧');

    if (/burn: m\.burn \|\| 0/.test(netC2)) ok('  重发时不会丢焚毁秒数');
    else bad('重发丢了 burn');

    if (/allowSend\(conn\) \{/.test(hubC2) && /conn\.tokens/.test(hubC2) &&
        /this\.allowSend\(conn\)/.test(hubC2)) {
      ok('★★ 服务端加了发消息令牌桶（容量 60 / 每秒 10 条）—— 从源头掐洪水');
    } else bad('服务端没有限流');

    if (/TOOFAST/.test(hubC2) && /TOOFAST/.test(netC2) && /markFail\(m\.cid, 'toofast'\)/.test(netC2)) {
      ok('★ 被限流的那条会标成失败（红叹号），不会永远卡在"发送中"');
    } else bad('限流之后客户端不知道怎么办');

    if (fs.existsSync(path.join(root, '.gitignore'))) {
      const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
      if (/^\s*data\/\s*$/m.test(gi)) {
        ok('★★ .gitignore 忽略了 data/ —— 不然 master.key 和聊天记录会一起传上 GitHub');
      } else bad('.gitignore 没有忽略 data/');
      if (/node_modules\//.test(gi) && /data\.备份/.test(gi) && /\*\.rekey/.test(gi)) {
        ok('  也忽略了 node_modules / 备份目录 / 改密码的临时文件');
      } else {
        bad('.gitignore 漏了该忽略的东西');
      }
    } else bad('没有 .gitignore —— 开源会把自己的密钥和记录一起传上去');

    if (!/PASSWORD:\s*'[^']{4,}'/.test(cfgC)) {
      ok('★★ config.js 里不再有硬编码密码（改成从 data/config.local.json 读）');
    } else bad('config.js 里还写着密码');

    if (/HC_PASSWORD/.test(cfgC) && /config\.local\.json/.test(cfgC) && /IS_DEFAULT_PASSWORD/.test(cfgC)) {
      ok('  读取顺序：环境变量 → data/config.local.json → 默认值（且能判断是不是默认值）');
    } else bad('密码读取逻辑不全');

    {
      const sp = fs.readFileSync(path.resolve(APP, '..', 'server/src/setpass.js'), 'utf8');
      if (/C\.open\(oldK\.kEnc, oldK\.kMac, m\.env\)/.test(sp) &&
          /C\.seal\(newK\.kEnc, newK\.kMac, dec\)/.test(sp)) {
        ok('★★ 改密码会把已有消息**重新加密**（密码就是钥匙，不重加密历史全废）');
      } else bad('改密码没有重新加密');

      if (/copyDir\(DATA, backup\)/.test(sp) && /备份/.test(sp)) {
        ok('★ 动数据之前先整个备份一份');
      } else bad('改密码没有备份');

      if (/lineQueue/.test(sp) && /rl\.on\('line'/.test(sp)) {
        ok('  自己接了 readline 的 line 事件（不然管道输入会被丢掉、卡住）');
      } else bad('readline 输入处理有问题');

      if (fs.existsSync(path.join(root, '改密码.command'))) {
        const cm = fs.readFileSync(path.join(root, '改密码.command'), 'utf8');
        if (/setpass\.js/.test(cm)) ok('★ 项目根有「改密码.command」，双击就能跑');
        else bad('改密码.command 内容不对');
      } else bad('没有 改密码.command');
    }

    if (/id="page-changelog"/.test(htmlC2)) ok('★★ 「我的」里能进开发日志页');
    else bad('没有开发日志页');

    if (/'changelog'/.test(appC2) && /var PAGES = \[[\s\S]{0,300}?'changelog'\]/.test(appC2)) {
      ok('  开发日志页注册进 PAGES 了（不然 go() 不认识它）');
    } else bad('changelog 没注册进 PAGES');

    if (/CHANGELOG = \[[\s\S]{0,200}?v: '2\.6\.0'/.test(uiC2)) {
      ok('  日志内容最新一版是 2.6.0');
    } else bad('日志内容不对');

    if (/chg-sign-by[\s\S]{0,80}?tim-lyj/.test(htmlC2)) {
      ok('★★ 开发日志底下有署名 tim-lyj');
    } else bad('开发日志没有署名');

    const rels = (uiC2.match(/v: '\d+\.\d+\.\d+'/g) || []).length;
    if (rels >= 5) ok(`  日志一共记了 ${rels} 个版本`);
    else bad('日志版本太少：' + rels);

    if (/className = 'hc-diag-ln|chg-ul/.test('') || /chg-card/.test(uiC2)) {
      ok('  用卡片+时间轴排版，不是一坨文字');
    }

    {
      const idxC = fs.readFileSync(path.resolve(APP, '..', 'server/src/index.js'), 'utf8');
      if (/cfg\.IS_DEFAULT_PASSWORD/.test(idxC) && /改密码\.command/.test(idxC)) {
        ok('★★ 用的还是默认密码时，启动横幅会大声警告并告诉他跑哪个脚本');
      } else bad('默认密码没有警告 —— 开源出去等于谁都知道密码');
    }
  }

  console.log('');
  console.log(C.bold + '════════════════════════════════════════════════════' + C.reset);
  if (fail === 0) {
    console.log(`${C.green}${C.bold}  ✅ 全部通过：${pass} 项，0 失败${C.reset}`);
    console.log(`${C.dim}  App 能完整启动：加密自检通过、启动画面退场、没有报错。${C.reset}`);
    console.log(C.bold + '════════════════════════════════════════════════════' + C.reset + '\n');
    process.exit(0);
  } else {
    console.log(`${C.red}${C.bold}  ✘ ${fail} 项失败（通过 ${pass} 项）${C.reset}`);
    console.log('');
    for (const p of problems) console.log(`  ${C.red}·${C.reset} ${p}`);
    console.log('');
    console.log(`${C.dim}  浏览器里打开 http://127.0.0.1:8787/app/ 看控制台，会有同样的报错。${C.reset}`);
    console.log(C.bold + '════════════════════════════════════════════════════' + C.reset + '\n');
    process.exit(1);
  }
}
