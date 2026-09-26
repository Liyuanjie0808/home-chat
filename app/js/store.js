(function (global) {
  'use strict';

  var LS_KEY   = 'homechat.state.v1';

  var CLIENT_VERSION = '2.6';

  var DEVELOPER = 'tim-lyj';

  var listeners = [];

  var S = {

    cfg: {
      serverAddr: '',
      serverPort: 8787,
      serverName: '',
      pwd: '',
      deviceId: '',
      userId: '',
      name: '',
      dark: false,
      big: false,
      vibrate: 2,
      quick: [],
      avatar: null,
      secure: true,
      autoQuit: true,

      lastSeq: 0,

    notifyState: 'unknown',

      session: null
    },

    masterKey: null,
    kEnc: null,
    kMac: null,

    dlToken: '',
    conn: 'idle',
    connMsg: '',
    peers: [],
    convs: [],
    msgs: {},
    current: null,
    draft: {},
    remarks: {},
    tab: 'convs',
    lastSearch: null,
    lastBatch: null,
    pending: [],
    unreadTotal: 0
  };

  function save() {
    try {
      var c = S.cfg;
      localStorage.setItem(LS_KEY, JSON.stringify({
        serverAddr: c.serverAddr, serverPort: c.serverPort, serverName: c.serverName,
        pwd: c.pwd, deviceId: c.deviceId, userId: c.userId, name: c.name,
        dark: c.dark, big: c.big, vibrate: c.vibrate, quick: c.quick,
        avatar: c.avatar, secure: c.secure,
        autoQuit: c.autoQuit,
        lastSeq: c.lastSeq || 0,
        session: c.session || null,
        masterKey: S.masterKey ? global.HC.crypto.b64enc(S.masterKey) : ''
      }));
    } catch (e) {  }

    if (c.deviceId) setCookie('hc_device', c.deviceId, 3650);
  }

  function load() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return false;
      var o = JSON.parse(raw);
      Object.keys(o).forEach(function (k) {
        if (k === 'masterKey') return;
        if (S.cfg.hasOwnProperty(k)) S.cfg[k] = o[k];
        else if (k === 'quick') S.cfg.quick = o[k] || [];
      });
      if (o.masterKey) {
        S.masterKey = global.HC.crypto.b64dec(o.masterKey);
      }

      if (!S.cfg.deviceId) {
        var ck = getCookie('hc_device');
        if (ck && ck.indexOf('dev-') === 0) S.cfg.deviceId = ck;
      }
      return true;
    } catch (e) { return false; }
  }

  function reset() {
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
  }

  function setCookie(k, v, days) {
    try {
      var d = new Date();
      d.setTime(d.getTime() + (days || 3650) * 864e5);
      document.cookie = k + '=' + encodeURIComponent(v) +
        ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
    } catch (e) {}
  }

  function getCookie(k) {
    try {
      var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + k + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : '';
    } catch (e) { return ''; }
  }

  function ensureDeviceId() {
    if (S.cfg.deviceId) return S.cfg.deviceId;

    var fromCookie = getCookie('hc_device');
    if (fromCookie && fromCookie.indexOf('dev-') === 0) {
      S.cfg.deviceId = fromCookie;
      save();
      return S.cfg.deviceId;
    }

    var r = global.HC.crypto.randomBytes(8);
    S.cfg.deviceId = 'dev-' + global.HC.crypto.toHex(r);
    save();
    return S.cfg.deviceId;
  }

  function setMasterKey(mk) {
    S.masterKey = mk;
    var sk = global.HC.crypto.subkeys(mk);
    S.kEnc = sk.kEnc;
    S.kMac = sk.kMac;
    save();
  }

  function hasKey() { return !!(S.masterKey && S.kEnc && S.kMac); }

  function on(fn) { listeners.push(fn); return fn; }

  function emit(what, data) {

    if (what === 'search') S.lastSearch = data;
    if (what === 'batch') S.lastBatch = data;
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](what, S); } catch (e) {  }
    }
  }

  var MAX_LOCAL = 300;

  function addMsg(m, opts) {
    if (!m || !m.conv) return null;
    if (!S.msgs[m.conv]) S.msgs[m.conv] = [];
    var list = S.msgs[m.conv];

    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i].id && m.id && list[i].id === m.id) return list[i];
      if (list[i].cid && m.cid && list[i].cid === m.cid) {

        for (var k in m) {
          if (Object.prototype.hasOwnProperty.call(m, k)) list[i][k] = m[k];
        }
        return list[i];
      }
    }

    list.push(m);

    list.sort(function (a, b) {
      var d = (a.ts || 0) - (b.ts || 0);
      if (d) return d;
      return (a.seq || 0) - (b.seq || 0);
    });
    if (list.length > MAX_LOCAL) list.splice(0, list.length - MAX_LOCAL);
    if (!opts || !opts.silent) emit('msg');
    return m;
  }

  function msgsOf(conv) { return S.msgs[conv] || []; }

  function convOf(id) {
    for (var i = 0; i < S.convs.length; i++) if (S.convs[i].id === id) return S.convs[i];
    return null;
  }

  function peerOf(id) {
    for (var i = 0; i < S.peers.length; i++) if (S.peers[i].id === id) return S.peers[i];
    return null;
  }

  function displayName(id) {
    if (S.remarks && S.remarks[id]) return S.remarks[id];
    var p = peerOf(id);
    return (p && p.name) || '?';
  }

  function setRemarks(map) {
    if (!map || typeof map !== 'object') return;
    S.remarks = map;
    emit('peers');
  }

  function clearMsgs(convId) {
    if (!convId) return;
    S.msgs[convId] = [];
    emit('msg');
    emit('convs');
  }

  function dropConv(convId) {
    for (var i = 0; i < S.convs.length; i++) {
      if (S.convs[i].id === convId) { S.convs.splice(i, 1); break; }
    }
    delete S.msgs[convId];
    save();
    emit('convs');
  }

  function isGroup(convId) {
    var c = convOf(convId);
    return !!(c && c.type === 'group');
  }

  function userById(id) {
    if (id === S.cfg.userId) return { id: id, name: S.cfg.name || '我', avatar: S.cfg.avatar || null };
    var p = peerOf(id);
    if (!p) return { id: id, name: '?' };

    if (S.remarks && S.remarks[id]) {
      return { id: id, name: S.remarks[id], avatar: p.avatar || null, realName: p.name, online: p.online };
    }
    return p;
  }

  function peerInConv(convId) {
    var c = convOf(convId);
    if (!c || !c.peer) return null;
    return c.peer;
  }

  function recomputeUnread() {
    var n = 0;
    for (var i = 0; i < S.convs.length; i++) n += (S.convs[i].unread || 0);
    S.unreadTotal = n;
  }

  function setUnread(convId, n) {
    var c = convOf(convId);
    if (c) { c.unread = n; recomputeUnread(); emit('convs'); }
  }

  function mergeConvs(list) {
    if (!list) return;
    S.convs = list;
    recomputeUnread();
    emit('convs');
  }

  function queueMsg(item) {
    S.pending.push(item);
    emit('pending');
  }

  function dropQueued(cid) {
    for (var i = S.pending.length - 1; i >= 0; i--) {
      if (S.pending[i].cid === cid) S.pending.splice(i, 1);
    }
    emit('pending');
  }

  var DEFAULT_QUICK = [
    '我在忙，等下说',
    '吃饭了',
    '帮我开下门',
    '我睡了，晚安',
    '马上到',
    '有事找你，方便吗',
    '现在不方便说话',
    '好的',
    '收到'
  ];

  function quickPhrases() {
    return (S.cfg.quick && S.cfg.quick.length) ? S.cfg.quick : DEFAULT_QUICK;
  }

  function archiveSize() { return 0; }

  function migrateConv(from, to) {
    if (!from || !to || from === to) return false;

    if (S.msgs[from] && S.msgs[from].length) {
      if (!S.msgs[to]) S.msgs[to] = [];
      S.msgs[to] = S.msgs[to].concat(S.msgs[from]);
      S.msgs[to].sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
      delete S.msgs[from];
    }

    for (var i = 0; i < S.pending.length; i++) {
      if (S.pending[i].conv === from) S.pending[i].conv = to;
    }

    if (S.draft && S.draft[from] != null) {
      S.draft[to] = S.draft[from];
      delete S.draft[from];
    }

    if (S.current === from) S.current = to;

    var c = convOf(from);
    if (c) c.id = to;

    emit('msg');
    return true;
  }

  global.HC = global.HC || {};
  global.HC.CLIENT_VERSION = CLIENT_VERSION;
  global.HC.DEVELOPER = DEVELOPER;

  function env() {
    if (global.plus) return 'app';
    try {
      var h = String((global.location && global.location.hostname) || '');
      if (h === '127.0.0.1' || h === 'localhost' || h === '::1') return 'local';
    } catch (e) {}
    return 'lan';
  }

  function isApp()   { return env() === 'app'; }
  function isLocal() { return env() === 'local'; }

  /**
   * 新设备被拦下来的时候，告诉用户"去哪儿放行"。
   *
   * 以前写的是"请家裡人在电脑上点【同意】" —— 两个毛病：
   *   1. 用了繁体字「裡」，跟其他文案不一致
   *   2. 只说"电脑上"，没说在哪个窗口点，用户根本找不到
   * 现在写清楚是双击哪个文件。
   */
  function whereApprove() {
    if (env() === 'local') {
      return '在电脑上双击「打开服务监控.command」，' +
             '待批准那里有你这台设备，点【同意】';
    }
    return '让家里人在电脑上双击「打开服务监控.command」，' +
           '待批准那里点【同意】。也可以看电脑上那个黑窗口，按 Y 再回车';
  }

  function canRecord() {
    var e = env();
    if (e === 'app')   return { ok: true,  why: '' };
    if (e === 'local') return { ok: true,  why: '' };
    return { ok: false, why: '浏览器录音需要 https 或本机地址。' +
                             '手机上从局域网打开会被浏览器拦掉 —— 打包成 App 就能用了。' };
  }

  function whereArchive() {
    return isLocal() ? '这台电脑的浏览器里（加密的）'
                     : (isApp() ? '这个 App 里（加密的）' : '这个浏览器里（加密的）');
  }

  global.HC.env = env;
  global.HC.isApp = isApp;
  global.HC.isLocalClient = isLocal;
  global.HC.whereApprove = whereApprove;
  global.HC.canRecord = canRecord;
  global.HC.whereArchive = whereArchive;
  global.HC.store = {
    S: S,
    save: save, load: load, reset: reset,
    archiveSize: archiveSize,
    ensureDeviceId: ensureDeviceId, getCookie: getCookie, setCookie: setCookie,
    setMasterKey: setMasterKey, hasKey: hasKey,
    on: on, emit: emit,
    addMsg: addMsg, msgsOf: msgsOf, convOf: convOf, peerOf: peerOf,
    userById: userById, peerInConv: peerInConv,
    displayName: displayName, setRemarks: setRemarks, isGroup: isGroup,
    clearMsgs: clearMsgs, dropConv: dropConv,
    migrateConv: migrateConv,
    setUnread: setUnread, recomputeUnread: recomputeUnread, mergeConvs: mergeConvs,
    queueMsg: queueMsg, dropQueued: dropQueued,
    quickPhrases: quickPhrases,
    DEFAULT_QUICK: DEFAULT_QUICK
  };
})(typeof window !== 'undefined' ? window : this);
