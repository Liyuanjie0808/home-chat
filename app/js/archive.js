(function (global) {
  'use strict';

  var C     = global.HC.crypto;
  var store = global.HC.store;

  var KEY = 'hc_archive_v1';

  var MAX_PER_CONV = 800;
  var MAX_CONV     = 60;
  var WRITE_DELAY  = 1500;

  var writeTimer = null;
  var lastErr = '';

  function S() { return store.S; }

  var KV = {
    get: function (k) {
      try {
        if (global.plus && global.plus.storage) return global.plus.storage.getItem(k);
        if (global.localStorage) return global.localStorage.getItem(k);
      } catch (e) {}
      return null;
    },
    set: function (k, v) {
      try {
        if (global.plus && global.plus.storage) { global.plus.storage.setItem(k, v); return true; }
        if (global.localStorage) { global.localStorage.setItem(k, v); return true; }
      } catch (e) { lastErr = e.message || String(e); }
      return false;
    },
    del: function (k) {
      try {
        if (global.plus && global.plus.storage) { global.plus.storage.removeItem(k); return; }
        if (global.localStorage) global.localStorage.removeItem(k);
      } catch (e) {}
    }
  };

  function hasKey() {
    var s = S();
    return !!(s && s.kEnc && s.kMac);
  }

  function pickConvs() {
    var s = S();
    var convs = (s.convs || []).slice();

    convs.sort(function (a, b) {
      return ((b.lastMsg && b.lastMsg.ts) || 0) - ((a.lastMsg && a.lastMsg.ts) || 0);
    });

    return convs.slice(0, MAX_CONV).map(function (c) { return c.id; });
  }

  function snapshot() {
    var s = S();
    var out = { v: 1, at: Date.now(), msgs: {} };

    pickConvs().forEach(function (id) {
      var list = (s.msgs && s.msgs[id]) || [];
      if (!list.length) return;

      out.msgs[id] = list.slice(-MAX_PER_CONV).map(function (m) {

        if (m.revoked) {
          return {
            id: m.id, cid: m.cid, conv: m.conv, from: m.from,
            ts: m.ts, kind: m.kind,
            body: '', meta: null, revoked: true,
            status: null, burn: 0, burnAt: 0
          };
        }
        return {
          id: m.id, cid: m.cid, conv: m.conv, from: m.from,
          ts: m.ts, kind: m.kind,
          body: m.body == null ? '' : m.body,
          meta: m.meta || null,
          status: m.status || null,
          burn: m.burn || 0, burnAt: m.burnAt || 0
        };
      });
    });

    return out;
  }

  function save() {
    if (!hasKey()) return;
    if (writeTimer) return;
    writeTimer = setTimeout(function () {
      writeTimer = null;
      saveNow();
    }, WRITE_DELAY);
  }

  function saveNow() {
    if (!hasKey()) return false;

    var data = snapshot();
    var text;
    try {
      text = JSON.stringify(data);
    } catch (e) { return false; }

    var env;
    try {

      var bytes = C.utf8Encode(text);
      env = JSON.stringify(C.sealBytes(S().kEnc, S().kMac, bytes));
    } catch (e) {
      lastErr = '加密失败：' + e.message;
      return false;
    }

    if (KV.set(KEY, env)) return true;

    try {
      var convs = pickConvs();
      var half = Math.max(1, Math.floor(convs.length / 2));
      var keep = {};
      convs.slice(0, half).forEach(function (id) { keep[id] = 1; });
      Object.keys(data.msgs).forEach(function (id) {
        if (!keep[id]) delete data.msgs[id];
      });
      var small = C.utf8Encode(JSON.stringify(data));
      var env2 = JSON.stringify(C.sealBytes(S().kEnc, S().kMac, small));
      if (KV.set(KEY, env2)) {
        lastErr = '空间不够，只存下了最近一半的会话';
        return true;
      }
    } catch (e) {}

    lastErr = '存不下（' + (lastErr || '未知') + '）';
    return false;
  }

  function load() {
    var raw = KV.get(KEY);
    if (!raw) return { ok: false, convs: 0, msgs: 0, err: '还没有存档' };
    if (!hasKey()) return { ok: false, convs: 0, msgs: 0, err: '还没登录，读不了（存档是加密的）' };

    var env;
    try { env = JSON.parse(raw); } catch (e) { return { ok: false, convs: 0, msgs: 0, err: '存档坏了' }; }

    var bytes = C.openBytes(S().kEnc, S().kMac, env);
    if (!bytes || !bytes.length) {
      return { ok: false, convs: 0, msgs: 0, err: '解不开（可能换过密码）' };
    }

    var data;
    try { data = JSON.parse(C.utf8Decode(bytes)); }
    catch (e) { return { ok: false, convs: 0, msgs: 0, err: '存档内容坏了' }; }

    var s = S();
    var nConv = 0, nMsg = 0, skipped = 0;

    Object.keys(data.msgs || {}).forEach(function (id) {
      var list = data.msgs[id];
      if (!list || !list.length) return;

      var alive = list.filter(function (m) { return !!m; }).map(function (m) {
        if (m.revoked) {
          m.body = '';
          m.meta = null;
          m.revoked = true;
        }
        return m;
      });

      var now = Date.now();
      alive = alive.filter(function (m) {
        if (m.burnAt && m.burnAt <= now) { skipped++; return false; }
        return true;
      });

      if (!alive.length) return;
      s.msgs[id] = alive;
      nConv++;
      nMsg += alive.length;
    });

    if (skipped) lastErr = '有 ' + skipped + ' 条早该焚毁的，读的时候丢掉了';

    return { ok: true, convs: nConv, msgs: nMsg, err: lastErr };
  }

  function clear() {
    KV.del(KEY);
    lastErr = '';
  }

  function info() {
    var raw = KV.get(KEY);
    var s = S();
    var n = 0;
    Object.keys(s.msgs || {}).forEach(function (id) { n += (s.msgs[id] || []).length; });
    return {
      bytes: raw ? raw.length : 0,
      inMemory: n,
      err: lastErr
    };
  }

  global.HC.archive = {
    save: save,
    saveNow: saveNow,
    load: load,
    clear: clear,
    info: info,
    KEY: KEY,
    MAX_PER_CONV: MAX_PER_CONV
  };
})(typeof window !== 'undefined' ? window : this);
