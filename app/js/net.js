(function (global) {
  'use strict';

  var C = global.HC.crypto;
  var store = global.HC.store;

  var RETRY_MAX = 3;
  var RETRY_INTERVAL = 10000;

  var ws = null;
  var hbTimer = null;
  var retryTimer = null;
  var retryCount = 0;
  var manualClose = false;
  var lastSyncTs = 0;
  var gaveUp = false;

  function S() { return store.S; }

  function wsURL() {
    var c = S().cfg;
    return 'ws://' + c.serverAddr + ':' + c.serverPort + '/ws';
  }

  function setConn(state, msg) {
    S().conn = state;
    S().connMsg = msg || '';
    store.emit('conn');
  }

  function connect() {
    var cfg = S().cfg;
    if (!cfg.serverAddr) { setConn('needaddr', '还没填电脑地址'); return; }
    if (!store.hasKey()) { setConn('nokey', '还没生成密钥'); return; }

    disconnect(true);
    manualClose = false;
    setConn('connecting', '正在连接 ' + cfg.serverAddr + '…');

    try {
      ws = new WebSocket(wsURL());
    } catch (e) {
      setConn('off', '连不上：' + e.message);
      scheduleRetry();
      return;
    }

    ws.onopen = function () {
      retryCount = 0;
      doHello();
    };

    ws.onmessage = function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      handleFrame(m);
    };

    ws.onclose = function () {
      stopHeartbeat();
      if (manualClose) return;
      setConn('off', '已断开 · 点击重连');
      scheduleRetry();
    };

    ws.onerror = function () {

    };
  }

  function disconnect(silent) {
    manualClose = true;
    stopHeartbeat();
    clearTimeout(retryTimer);
    retryTimer = null;
    if (ws) {
      try { ws.onclose = null; ws.close(); } catch (e) {}
      ws = null;
    }
    if (!silent) setConn('idle', '已断开');
  }

  function scheduleRetry() {
    if (manualClose) return;
    clearTimeout(retryTimer);

    if (retryCount >= RETRY_MAX) {
      gaveUp = true;
      setConn('offline', '连不上服务端，已停止尝试');
      store.emit('gaveup');
      return;
    }

    retryCount++;
    setConn('off', '已断开 · ' +
      (retryCount <= RETRY_MAX
        ? '第 ' + retryCount + '/' + RETRY_MAX + ' 次重连，10 秒后试'
        : '正在重连…'));
    retryTimer = setTimeout(connect, RETRY_INTERVAL);
  }

  function manualReconnect() {
    gaveUp = false;
    retryCount = 0;
    disconnect(true);
    connect();
  }

  function hasGivenUp() { return gaveUp; }
  function retryLeft() { return Math.max(0, RETRY_MAX - retryCount); }

  function rawSend(obj) {
    if (!ws || ws.readyState !== 1) return false;
    try {
      ws.send(JSON.stringify(C.seal(S().kEnc, S().kMac, obj)));
      return true;
    } catch (e) { return false; }
  }

  function handleFrame(m) {
    if (!m) return;

    if (m.t && m.v === undefined) {
      switch (m.t) {
        case 'err':
          if (m.code === 'BADKEY') {
            setConn('badkey', '密码不对');
            manualClose = true;
          } else if (m.code === 'NOPAIR') {
            setConn('nopair', '等待放行');

            if (global.HC.ui && global.HC.ui.toast) {
              global.HC.ui.toast('已经连上服务端了。\n' + (global.HC.whereApprove ? global.HC.whereApprove() : '等电脑上放行') + '。', 6000);
            }
            if (global.HC.ui && global.HC.ui.vibrate) global.HC.ui.vibrate(2);
          } else if (m.code === 'APPROVED') {
            setConn('connecting', '已批准，正在连接…');
            manualClose = false;
            setTimeout(function () { if (ws) ws.close(); }, 200);
          } else {
            store.emit('err', m);
          }
          break;
      }
      return;
    }

    var inner = C.open(S().kEnc, S().kMac, m);
    if (!inner) {

      setConn('badkey', '解不开服务端的数据（密钥可能变了）');
      manualClose = true;
      return;
    }

    dispatch(inner);
  }

  function dispatch(m) {
    switch (m.t) {
      case 'welcome':   onWelcome(m); break;
      case 'ack':       onAck(m); break;
      case 'msg':       onMsg(m.msg); break;
      case 'batch':     onBatch(m); break;
      case 'peers':
        if (m.remarks) store.setRemarks(m.remarks);
        onPeers(m.peers);
        break;
      case 'presence':  onPresence(m); break;
      case 'read':      onRead(m); break;
      case 'read.ok':   onReadOk(m); break;
      case 'typing':    onTyping(m); break;

      case 'pong':      lastPongAt = Date.now(); break;

      case 'profile.ok':
        store.emit('profile');
        break;

      case 'group.ok':
        store.emit('group');
        break;

      case 'burn':      break;
      case 'burned':    break;
      case 'recalled':  onRecalled(m); break;
      case 'knock':     onKnock(m); break;
      case 'knock.ok':  onKnockOk(m); break;
      case 'search.r':  store.emit('search', m); break;
      case 'err':
        if (m.code === 'NOTFOUND') global.HC.ui && global.HC.ui.toast('会话不存在');

        if (m.code === 'TOOFAST' && m.cid) markFail(m.cid, 'toofast');
        if (m.code === 'TOOBIG' && global.HC.ui) global.HC.ui.toast(m.msg || '文件太大了');

        store.emit('err', m);
        break;
    }
  }

  function guessDeviceName() {
    try {
      if (global.plus && plus.device && plus.device.model) return plus.device.model;
    } catch (e) {}
    try {
      var ua = navigator.userAgent || '';
      var m = ua.match(/\(([^)]+)\)/);
      if (m) {
        var parts = m[1].split(';').map(function (x) { return x.trim(); });
        for (var i = parts.length - 1; i >= 0; i--) {
          var seg = parts[i];
          if (!seg) continue;
          if (/Android|Linux|Windows|Mac OS|iPhone|iPad|Build|wv|U;|en-|zh-/i.test(seg)) continue;
          if (seg.length < 2 || seg.length > 24) continue;
          return seg;
        }
      }
      if (/iPhone/i.test(navigator.userAgent)) return 'iPhone';
      if (/iPad/i.test(navigator.userAgent)) return 'iPad';
      if (/Android/i.test(navigator.userAgent)) return '安卓手机';
    } catch (e) {}
    return '新手机';
  }

  function isLocalClient() {
    try {
      var h = String((global.location && global.location.hostname) || '');
      return h === '127.0.0.1' || h === 'localhost' || h === '::1';
    } catch (e) { return false; }
  }

  function doHello() {
    var cfg = S().cfg;
    rawSend({
      t: 'hello',
      deviceId: store.ensureDeviceId(),
      name: cfg.name || guessDeviceName(),
      ver: 1,
      local: isLocalClient()
    });
    startHeartbeat();
  }

  function onWelcome(m) {
    var cfg = S().cfg;

    if (m.dlk) S().dlToken = String(m.dlk);

    setConn('on', '已连接');
    retryCount = 0;
    gaveUp = false;

    if (m.userId) { cfg.userId = m.userId; }
    if (m.serverName) { cfg.serverName = m.serverName; }
    if (m.serverVer) { cfg.serverVer = m.serverVer; }
    if (m.archive) { S().serverStats = m.archive; }

    if (m.serverTime) lastSyncTs = m.serverTime;

    store.save();
    if (m.remarks) store.setRemarks(m.remarks);
    store.mergeConvs(m.convs || []);
    onPeers(m.peers || []);

    store.emit('welcome');

    if (m.maxSeq && Number(m.maxSeq) > lastSeq()) {
      var behind = Number(m.maxSeq) - lastSeq();
      if (behind > 0) {
        console.log('[net] 服务端已到 ' + m.maxSeq + ' 号，本地才 ' +
                    lastSeq() + ' 号 —— 差 ' + behind + ' 条，开始补');
      }
    }

    syncAll();

    flushPending();
  }

  function onPeers(list) {
    S().peers = list || [];
    store.emit('peers');
  }

  function onPresence(m) {
    var p = store.peerOf(m.userId);
    if (p) p.online = !!m.online;
    if (m.lastSeen) { if (p) p.lastSeen = m.lastSeen; }
    store.emit('peers');
  }

  function onMsg(msg) {
    if (!msg) return;

    if (msg.seq) noticeGap(msg.seq);

    var before = (S().msgs[msg.conv] || []).length;

    var merged = store.addMsg(msg, { silent: true });
    var isNew = (S().msgs[msg.conv] || []).length > before;

    var c = store.convOf(msg.conv);
    if (c) {
      c.lastMsg = {
        kind: msg.kind,
        preview: previewOf(msg),
        ts: msg.ts,
        from: msg.from
      };

      if (isNew && msg.from !== S().cfg.userId && S().current !== msg.conv) {
        c.unread = (c.unread || 0) + 1;
      }
    }
    store.recomputeUnread();
    store.emit('convs');

    if (isNew && msg.from !== S().cfg.userId && S().current !== msg.conv) {
      notify(msg);
    }

    store.emit('msg', msg);
  }

  function previewOf(msg) {
    var tag = kindTag(msg.kind);
    if (tag) return tag;
    var s = String(msg.body == null ? '' : msg.body).replace(/\s+/g, ' ').trim();
    return s.length > 40 ? s.slice(0, 40) + '…' : s;
  }

  function kindTag(kind) {
    if (kind === 'image') return '[图片]';
    if (kind === 'file')  return '[文件]';
    if (kind === 'voice') return '[语音]';
    return '';
  }

  function notify(msg) {
    var who = store.userById(msg.from).name || '有人';
    var text = who + '：' + previewOf(msg);

    if (global.HC.ui) global.HC.ui.vibrate(S().cfg.vibrate);

    if (global.HC.notify) {
      global.HC.notify.push('Home Chat', text, { conv: msg.conv });
    }
  }

  function onBatch(m) {
    var list = m.msgs || [];

    var freshFromOthers = 0;

    for (var i = 0; i < list.length; i++) {
      var msg = list[i];

      if (msg.seq) noteSeq(msg.seq);
      var before = (S().msgs[msg.conv] || []).length;
      store.addMsg(msg, { silent: true });
      var c = store.convOf(msg.conv);
      var isFresh = (S().msgs[msg.conv] || []).length > before;
      if (c && msg.from !== S().cfg.userId && S().current !== msg.conv) {
        if (isFresh) c.unread = (c.unread || 0) + 1;
        if (isFresh && msg.from !== S().cfg.userId) freshFromOthers++;
      }
    }

    if (m.remarks) store.setRemarks(m.remarks);
    if (m.convs) store.mergeConvs(m.convs);
    store.recomputeUnread();
    store.emit('convs');
    store.emit('msg');
    store.emit('batch', m);

    if (freshFromOthers > 0 && global.HC.ui) {
      global.HC.ui.vibrate(S().cfg.vibrate);
    }

    if (m.why !== 'push' && m.why !== 'hist' && syncAll._done) {
      syncAll._done(!!m.more, m.maxSeq);
    }
  }

  function newCid() {
    return 'c' + Date.now().toString(36) + C.toHex(C.randomBytes(3));
  }

  function sendText(convId, body, peerId, burn) {
    body = String(body == null ? '' : body);
    if (!body.trim()) return null;

    burn = Math.max(0, Math.min(3600, Math.round(Number(burn) || 0)));

    var cid = newCid();
    var ts = Date.now();

    var st = netState();
    var bad = (st !== 'ok');

    var local = {
      id: null, cid: cid, conv: convId, from: S().cfg.userId,
      kind: 'text', body: body, meta: null, ts: ts,
      status: bad ? 'fail' : 'sending',
      failReason: bad ? st : '',
      burn: burn, burnAt: 0
    };
    store.addMsg(local);

    var frame = { t: 'send', cid: cid, conv: convId, to: peerId, kind: 'text', body: body, ts: ts, burn: burn };

    if (bad) {

      store.queueMsg(frame);
    } else {
      var ok = rawSend(frame);
      if (!ok) store.queueMsg(frame);
    }

    updateConvPreview(convId, { kind: 'text', preview: body, ts: ts, from: S().cfg.userId });

    setTimeout(function () {
      if (S().msgs[convId]) {
        var arr = S().msgs[convId];
        for (var i = 0; i < arr.length; i++) {
          if (arr[i].cid === cid && arr[i].status === 'sending') {
            arr[i].status = 'fail';

            arr[i].failReason = netState() === 'neterr' ? 'neterr' : 'serverdown';
            store.emit('msg');
          }
        }
      }
    }, 10000);

    return cid;
  }

  function sendFileMsg(convId, peerId, kind, name, meta) {
    var cid = newCid();
    var ts = Date.now();
    store.addMsg({
      id: null, cid: cid, conv: convId, from: S().cfg.userId,
      kind: kind, body: name, meta: meta, ts: ts, status: 'sent'
    });

    updateConvPreview(convId, { kind: kind, preview: kindTag(kind) || '[文件]', ts: ts, from: S().cfg.userId });
    return cid;
  }

  function updateConvPreview(convId, lastMsg) {
    var c = store.convOf(convId);
    if (c) { c.lastMsg = lastMsg; S().convs.sort(function (a, b) {
      return ((b.lastMsg && b.lastMsg.ts) || 0) - ((a.lastMsg && a.lastMsg.ts) || 0);
    }); }
    store.emit('convs');
  }

  function markFail(cid, reason) {
    if (!cid) return;
    Object.keys(S().msgs).forEach(function (conv) {
      var arr = S().msgs[conv] || [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].cid === cid && arr[i].status !== 'sent') {
          arr[i].status = 'fail';
          arr[i].failReason = reason;
        }
      }
    });
    store.dropQueued(cid);
    store.emit('msg');
    store.emit('convs');
  }

  function retry(convId, m) {
    if (!m || !m.cid) return false;

    var st = netState();
    var frame = {
      t: 'send', cid: m.cid, conv: convId, to: peerIdOfConv(convId),
      kind: 'text', body: m.body, ts: Date.now(),
      burn: m.burn || 0,
    };

    if (st !== 'ok') {
      store.queueMsg(frame);
      m.status = 'fail';
      m.failReason = st;
      store.emit('msg');
      return false;
    }

    m.status = 'sending';
    m.failReason = '';
    store.emit('msg');

    if (!rawSend(frame)) store.queueMsg(frame);

    setTimeout(function () {
      var arr = S().msgs[convId] || [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].cid === m.cid && arr[i].status === 'sending') {
          arr[i].status = 'fail';
          arr[i].failReason = netState() === 'neterr' ? 'neterr' : 'serverdown';
          store.emit('msg');
        }
      }
    }, 10000);

    return true;
  }

  function peerIdOfConv(convId) {
    try {
      var c = store.convOf(convId);
      if (!c) return null;
      if (c.type === 'group') return null;
      var p = c.peer;
      if (p && p.id) return p.id;
      var arr = c.members || [];
      for (var i = 0; i < arr.length; i++) {
        var x = arr[i];
        if (typeof x === 'string' && x !== S().cfg.userId) return x;
        if (x && x.id && x.id !== S().cfg.userId) return x.id;
      }
      return null;
    } catch (e) { return null; }
  }

  function onAck(m) {

    var found = null;
    Object.keys(S().msgs).forEach(function (conv) {
      var arr = S().msgs[conv];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].cid === m.cid) { found = conv; break; }
      }
    });

    if (found && m.conv && found !== m.conv) {
      store.migrateConv(found, m.conv);
      found = m.conv;
    }

    var arr = (found && S().msgs[found]) || [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].cid === m.cid) {
        arr[i].id = m.msgId || arr[i].id;
        arr[i].ts = m.ts || arr[i].ts;
        arr[i].status = 'sent';
        arr[i].failReason = '';
      }
    }

    store.dropQueued(m.cid);
    store.emit('msg');
    store.emit('convs');
  }

  function onRead(m) {
    var arr = S().msgs[m.conv] || [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].from === S().cfg.userId && (arr[i].ts || 0) <= m.ts) arr[i].status = 'read';
    }

    var c = store.convOf(m.conv);
    if (c) c.peerReadTs = Math.max(c.peerReadTs || 0, m.ts);
    store.emit('msg');
  }

  function onReadOk(m) {
    var c = store.convOf(m.conv);
    if (c && m.ts) c.lastReadTs = Math.max(c.lastReadTs || 0, m.ts);
    store.setUnread(m.conv, 0);
    store.emit('convs');
  }

  function onTyping(m) {
    store.emit('typing', m);
  }

  function onRecalled(m) {
    var list = S().msgs[m.conv];
    if (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === m.msgId) {
          list[i].revoked = true;
          list[i].body = '';
          list[i].meta = null;
        }
      }
    }

    var c = store.convOf(m.conv);
    if (c && c.lastMsg) {
      var last = list && list[list.length - 1];
      if (last && last.id === m.msgId) {
        c.lastMsg = { kind: 'text', preview: '撤回了一条消息', ts: last.ts, from: last.from };
      }
    }
    store.emit('msg');
    store.emit('convs');
  }

  function onKnock(m) {

    if (global.HC.ui) {
      global.HC.ui.vibrate(3);
      global.HC.ui.toast((m.fromName || '有人') + ' 敲了敲你', 2600);
    }
    store.emit('knock', m);
  }

  function onKnockOk(m) {
    if (global.HC.ui) {
      global.HC.ui.toast(m.online ? '敲到了' : '他不在线，等会上线看不到这个', 2600);
    }
  }

  function search(q) {
    return rawSend({ t: 'search', q: q, limit: 60 });
  }
  function recall(convId, msgId) {
    return rawSend({ t: 'recall', conv: convId, msgId: msgId });
  }
  function knock(peerId) {
    return rawSend({ t: 'knock', to: peerId });
  }

  function netState() {

    if (global.plus && plus.networkinfo && plus.networkinfo.getCurrentType) {
      try {
        var t = plus.networkinfo.getCurrentType();
        if (t === 0 || t === plus.networkinfo.CONNECTION_NONE) return 'neterr';

        return S().conn === 'on' ? 'ok' : 'serverdown';
      } catch (e) {}
    }

    try {
      if (global.navigator && global.navigator.onLine === false) return 'neterr';
    } catch (e) {}

    return S().conn === 'on' ? 'ok' : 'serverdown';
  }

  function netStateText() {
    var st = netState();
    if (st === 'neterr') return '目前无网络可用';
    if (st === 'serverdown') return '服务端已断开';
    return '';
  }

  function lastSeq() { return Number(S().cfg.lastSeq) || 0; }

  function noteSeq(seq) {
    var n = Number(seq) || 0;
    if (!n) return;
    if (n > lastSeq()) {
      S().cfg.lastSeq = n;
      seqDirty = true;
      scheduleSeqSave();
    }
  }

  var seqDirty = false;
  var seqSaveTimer = null;
  function scheduleSeqSave() {
    if (seqSaveTimer) return;
    seqSaveTimer = setTimeout(function () {
      seqSaveTimer = null;
      if (!seqDirty) return;
      seqDirty = false;
      try { store.save(); } catch (e) {}
      reportSeen();
    }, 1500);
  }

  function reportSeen() {
    if (S().conn !== 'on') return;
    rawSend({ t: 'seen', seq: lastSeq() });
  }

  var syncing = false;
  var syncAgain = false;

  function healthCheck() {
    if (!ws || ws.readyState !== 1) { forceReconnect('回来时连接已经不在'); return; }
    var t0 = lastPongAt;
    rawSend({ t: 'ping' });
    setTimeout(function () {
      if (lastPongAt > t0) {

        syncAll();
      } else {
        forceReconnect('回来时 ping 没回应');
      }
    }, 3000);
  }

  var SYNC_MAX_PAGES = 8;

  function syncAll() {
    if (S().conn !== 'on') return;
    if (syncing) { syncAgain = true; return; }

    syncing = true;
    var pages = 0;

    function ask() {
      pages++;
      rawSend({ t: 'sync', sinceSeq: lastSeq(), limit: 300 });
    }

    syncAll._done = function (more, maxSeq) {
      if (more && pages < SYNC_MAX_PAGES) {

        setTimeout(ask, 0);
        return;
      }

      var skipped = 0;
      if (more && maxSeq && maxSeq > lastSeq()) {

        skipped = maxSeq - lastSeq();
        noteSeq(maxSeq);
        try {
          console.warn('[net] 未读消息太多（还剩 ' + skipped +
                       ' 条），已跳到最新。更早的往上翻可以看到。');
        } catch (e) {}
      }

      syncing = false;
      if (syncAgain) { syncAgain = false; syncAll(); return; }
      reportSeen();
      if (skipped > 0) store.emit('convs');
    };

    ask();
  }

  var gapTimer = null;
  function noticeGap(seq) {
    var n = Number(seq) || 0;
    if (!n) return;

    var have = lastSeq();
    noteSeq(n);

    if (have && n > have + 1) {

      var gapAt = n;
      if (gapTimer) clearTimeout(gapTimer);
      gapTimer = setTimeout(function () {
        gapTimer = null;
        if (lastSeq() > gapAt) return;
        syncAll();
      }, 400);
    }
  }
  function pullHistory(convId, before) {
    return rawSend({ t: 'hist', conv: convId, before: before || 0, limit: 30 });
  }

  function markRead(convId) {
    var c = store.convOf(convId);
    var ts = Date.now();
    store.setUnread(convId, 0);
    rawSend({ t: 'read', conv: convId, ts: ts });
    if (c) c.lastReadTs = ts;
  }

  function typing(convId) {
    rawSend({ t: 'typing', conv: convId });
  }

  function flushPending() {
    if (!S().pending.length) return;
    var items = S().pending.slice();
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var ok = rawSend({
        t: 'send', cid: it.cid, conv: it.conv, to: it.to,
        kind: it.kind, body: it.body, meta: it.meta, ts: it.ts,
        burn: it.burn || 0,
      });
      if (ok) store.dropQueued(it.cid);
    }
  }

  function sayBye() {
    if (!ws || ws.readyState !== 1) return;
    try { rawSend({ t: 'bye' }); } catch (e) {}
  }

  var lastPongAt = 0;

  function startHeartbeat() {
    stopHeartbeat();
    lastPongAt = Date.now();
    var beats = 0;

    hbTimer = setInterval(function () {

      if (Date.now() - lastPongAt > 12000 * 2.5) {
        console.warn('[net] 心跳没回应，判定连接已死，强制重连');
        forceReconnect('心跳超时');
        return;
      }

      rawSend({ t: 'ping' });

      if (++beats % 5 === 0) reportSeen();
    }, 12000);
  }

  function stopHeartbeat() {
    if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
  }

  function forceReconnect(why) {
    try { console.warn('[net] 重连原因：' + why); } catch (e) {}
    stopHeartbeat();
    try {
      if (ws) { ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null; ws.close(); }
    } catch (e) {}
    ws = null;
    retryCount = 0;
    gaveUp = false;
    setConn('off', '连接已断开 · 正在重连');
    setTimeout(function () { connect(); }, 300);
  }

  function createGroup(name, members) {
    return rawSend({ t: 'group.create', name: name, members: members });
  }
  function renameGroup(convId, name, avatar) {
    return rawSend({ t: 'group.rename', conv: convId, name: name, avatar: avatar });
  }
  function addGroupMembers(convId, members) {
    return rawSend({ t: 'group.add', conv: convId, members: members });
  }
  function leaveGroup(convId) {
    return rawSend({ t: 'group.leave', conv: convId });
  }
  function setProfile(avatar) {
    return rawSend({ t: 'profile.set', avatar: avatar });
  }
  function setRemark(peerId, name) {
    return rawSend({ t: 'remark.set', peer: peerId, name: name });
  }

  global.HC.net = {
    connect: connect,
    search: search,
    recall: recall,
    knock: knock,
    createGroup: createGroup,
    renameGroup: renameGroup,
    addGroupMembers: addGroupMembers,
    leaveGroup: leaveGroup,
    setProfile: setProfile,
    setRemark: setRemark,
    disconnect: disconnect,
    isOn: function () { return S().conn === 'on'; },
    send: rawSend,
    sendText: sendText,
    sendFileMsg: sendFileMsg,
    syncAll: syncAll,
    pullHistory: pullHistory,
    markRead: markRead,

    __testAck: onAck,
    __testRead: onRead,
    sayBye: sayBye,
    healthCheck: healthCheck,
    retry: retry,
    netState: netState,
    netStateText: netStateText,
    previewOf: previewOf,
    kindTag: kindTag,
    typing: typing,

    manualReconnect: manualReconnect,
    hasGivenUp: hasGivenUp,
    retryLeft: retryLeft,
    RETRY_MAX: RETRY_MAX
  };
})(typeof window !== 'undefined' ? window : this);
