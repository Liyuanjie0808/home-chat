'use strict';

const C     = require('./crypto');
const cfg   = require('./config');
const store = require('./store');
const filecache = require('./filecache');
const net   = require('./net');
const nodeCrypto = require('crypto');

function previewOf(inner) {
  if (!inner) return '';
  switch (inner.kind) {
    case 'image': return '[图片]';
    case 'file':  return '[文件]';
    default: {
      const s = String(inner.body == null ? '' : inner.body).replace(/\s+/g, ' ').trim();
      return s.length > 40 ? s.slice(0, 40) + '…' : s;
    }
  }
}

function clip(s, n) {
  const v = String(s == null ? '' : s);
  return v.length > n ? v.slice(0, n) : v;
}

class Hub {

  constructor(keys) {
    this.masterKey = keys.masterKey;
    this.kEnc      = keys.kEnc;
    this.kMac      = keys.kMac;
    this.password  = keys.password;
    this.adminKey  = keys.adminKey || keys.masterKey;

    this.startedAt = Date.now();

    this.devices = new Map();

    this.pendingConns = new Map();

    this.byUser  = new Map();

    this.admins  = new Set();

    this.macConns = 0;

    this.dlTokens = new Map();

    this.samples = { at: [], rss: [], burnArmed: [], burnWaiting: [], msgToday: [], online: [] };

    this.servers = {};
    this.timers  = [];
    this.shuttingDown = false;
  }

  info() {
    return {
      name: cfg.SERVER_NAME,
      ip: net.primaryIP(),
      port: cfg.PORT,
      ver: 1,
      users: store.getState().users.map(u => ({
        id: u.id, name: u.name, avatar: u.avatar || null, role: u.role,
      })),
    };
  }

  registerServers(obj) { this.servers = Object.assign(this.servers, obj); }

  takeSample() {
    const h = this.samples;
    const bs = store.burnStats();
    h.at.push(Date.now());
    h.rss.push(+(process.memoryUsage().rss / 1024 / 1024).toFixed(1));
    h.burnArmed.push(bs.armed);
    h.burnWaiting.push(bs.waiting);
    h.msgToday.push(store.msgToday());
    h.online.push(this.byUser.size);

    const MAX = 120;
    for (const k of Object.keys(h)) if (h[k].length > MAX) h[k].shift();
  }

  isLocalIp(ip) {
    const s = String(ip || '').replace(/^::ffff:/, '');
    return s === '127.0.0.1' || s === '::1' || s === 'localhost';
  }

  issueDlToken(deviceId) {
    const t = nodeCrypto.randomBytes(12).toString('hex');
    this.dlTokens.set(t, { deviceId, at: Date.now() });

    const cut = Date.now() - cfg.DL_TOKEN_TTL_MS;
    for (const [k, v] of this.dlTokens) if (v.at < cut) this.dlTokens.delete(k);

    return t;
  }

  resolveDlToken(token) {
    const key = String(token || '');
    if (!key) return null;
    const r = this.dlTokens.get(key);
    if (!r) return null;
    if (Date.now() - r.at > cfg.DL_TOKEN_TTL_MS) { this.dlTokens.delete(key); return null; }
    return r.deviceId;
  }

  dropDlTokens(deviceId) {
    for (const [k, v] of this.dlTokens) if (v.deviceId === deviceId) this.dlTokens.delete(k);
  }

  handleDevice(ws, req) {
    const conn = {
      kind: 'device',
      ws,
      ip: String(req.socket.remoteAddress || '').replace(/^::ffff:/, ''),
      deviceId: null,
      deviceName: '',
      userId: null,
      authed: false,
      pending: false,
      alive: true,
      lastSeen: Date.now(),
      connectedAt: Date.now(),
    };

    ws.on('message', (data) => {
      try {
        this.onDeviceFrame(conn, data);
      } catch (e) {

        store.log('[hub] 处理手机帧出错：' + e.message);
        console.error('\n  ✘ 手机帧处理异常，堆栈：\n' + (e.stack || e) + '\n');
      }
    });
    ws.on('close', () => this.dropConn(conn));
    ws.on('error', () => this.dropConn(conn));
    ws.on('pong', () => { conn.alive = true; conn.lastSeen = Date.now(); });

    store.log(`[hub] 手机接入 ${conn.ip}`);
  }

  onDeviceFrame(conn, data) {
    if (this.shuttingDown) return;
    conn.lastSeen = Date.now();
    conn.alive = true;

    let env;
    try { env = JSON.parse(data.toString('utf8')); }
    catch (e) { return; }

    const inner = C.open(this.kEnc, this.kMac, env);
    if (!inner || typeof inner !== 'object') {
      this.sendPlain(conn, { t: 'err', code: 'BADKEY', msg: '密码不对，或数据被改动过' });
      return;
    }

    if (inner.t === 'hello') { this.onHello(conn, inner); return; }

    if (!conn.authed) {
      this.sendPlain(conn, { t: 'err', code: 'NOPAIR', msg: '设备还没入册' });
      return;
    }

    this.dispatch(conn, inner);
  }

  onHello(conn, inner) {
    const deviceId = clip(inner.deviceId, 64);
    const name     = clip(inner.name, 32) || '一台新设备';

    if (!deviceId) {
      this.sendPlain(conn, { t: 'err', code: 'BADDEVICE', msg: '缺少设备标识' });
      return;
    }

    conn.deviceId   = deviceId;
    conn.deviceName = name;

    let user = null;
    if (inner.local === true && this.macUserId) {
      const mac = store.findUserById(this.macUserId);
      if (mac) {
        if (mac.deviceId !== deviceId) store.updateUser(mac.id, { deviceId: deviceId });
        user = store.findUserById(mac.id);
        store.log(`[hub] 本机客户端接入 → 认成「${mac.name}」`);
      }
    }

    if (!user) user = store.findUserByDevice(deviceId);

    if (!user) {
      const back = store.findUserByIpName(conn.ip, name);
      if (back) {
        store.log(`[hub] 设备 ID 变了，但和「${back.name}」的 IP+型号对得上 → 认回来`);
        store.updateUser(back.id, { deviceId: deviceId });
        user = store.findUserById(back.id);
      }
    }

    if (!user && cfg.LOGIN_BY_NAME) {
      const byName = store.findUserByName(name);
      if (byName) {
        store.log(`[hub] 「${name}」按名字登录 → 认回 ${byName.id}`);
        store.updateUser(byName.id, { deviceId: deviceId });
        user = store.findUserById(byName.id);
      }
    }

    if (!user) {
      if (cfg.AUTO_APPROVE) {

        user = store.createUser({
          name: name,
          deviceId: deviceId,
          role: 'member',
        });
        store.removePending(deviceId);
        store.log(`[hub] 新成员入册：「${name}」 (${conn.ip})`);
        this.adminBroadcast({ t: 'admin.pending', devices: store.getState().pending });
      } else {

        conn.pending = true;

        this.pendingConns.set(deviceId, conn);
        store.addPending(deviceId, name, conn.ip);
        this.sendPlain(conn, { t: 'err', code: 'NOPAIR', msg: '这台设备还没入册，要在电脑上放行' });
        this.adminBroadcast({ t: 'admin.pending', devices: store.getState().pending });
        store.log(`[hub] 新设备待批准：${name} (${conn.ip})`);

        if (typeof this.onPending === 'function') {
          try { this.onPending({ deviceId, name, ip: conn.ip }); } catch (e) {}
        }
        return;
      }
    }

    const old = this.devices.get(deviceId);
    if (old && old !== conn) {
      try { old.ws.close(4001, '已在别处登录'); } catch (e) {}
      this.untrackUser(old);
    }

    this.finishAuth(conn, deviceId, user);
  }

  finishAuth(conn, deviceId, user) {

    const prevSeen = (store.findUserById(user.id) || {}).lastSeen || 0;

    conn.userId  = user.id;
    conn.authed  = true;
    conn.pending = false;
    conn.deviceId = deviceId;

    this.pendingConns.delete(deviceId);
    this.devices.set(deviceId, conn);
    this.trackUser(conn);

    store.removePending(deviceId);

    this.sendEnc(conn, {
      t: 'welcome',
      userId: user.id,
      serverTime: Date.now(),
      serverName: cfg.SERVER_NAME,
      serverVer: cfg.VERSION,
      autoApprove: !!cfg.AUTO_APPROVE,
      archive: {
        msgTotal: store.stats().msgTotal,
        bytes: store.stats().msgBytes,
      },
      peers: this.peerList(),
      remarks: this.remarksFor(user.id),
      convs: this.convListFor(user.id),

      maxSeq: store.getState().seq,

      dlk: this.issueDlToken(deviceId),
    });

    if (cfg.PUSH_MISSED) this.pushMissed(user, prevSeen);

    store.updateUser(user.id, {
      lastSeen: Date.now(),
      lastIp: conn.ip,
      deviceName: conn.deviceName || user.deviceName || user.name,
    });

    this.broadcastPresence();
    this.adminBroadcast({ t: 'admin.presence', userId: user.id, online: true, lastSeen: Date.now() });
    store.log(`[hub] ${user.name} 上线 (${conn.ip})`);
  }

  approveDevice(deviceId, name) {
    const id = clip(deviceId, 64);
    if (!id) return null;

    let user = store.findUserByDevice(id);
    if (!user) {
      user = store.createUser({
        name: clip(name, 32) || '新成员',
        deviceId: id,
        role: 'member',
      });
    }
    store.removePending(id);
    store.log(`[hub] 批准设备 ${id} → ${user.name}`);

    const pc = this.pendingConns.get(id);
    if (pc) {
      this.finishAuth(pc, id, user);
      store.log(`[hub] ${user.name} 已就地放行，不用重连`);
    } else {
      store.log('[hub] 那台设备当前不在线，下次它连上就会直接通过');
    }

    this.adminBroadcast({ t: 'admin.pending', devices: store.getState().pending });
    this.adminBroadcast(this.snapshot());
    return user;
  }

  rejectDevice(deviceId) {
    const id = clip(deviceId, 64);
    if (!id) return false;

    const dc = this.pendingConns.get(id) || this.devices.get(id);
    this.pendingConns.delete(id);
    store.removePending(id);
    if (dc) { try { dc.ws.close(4004, '被拒绝'); } catch (e) {} }
    store.log(`[hub] 已拒绝设备 ${id}`);
    this.adminBroadcast({ t: 'admin.pending', devices: store.getState().pending });
    return true;
  }

  pushMissed(user, prevSeen) {
    const now = Date.now();

    const since = Math.max((prevSeen || 0) - 60000, now - 7 * 24 * 3600 * 1000);

    let raw;
    try { raw = store.since(since, 300); } catch (e) { return; }

    const msgs = [];
    for (const m of raw) {
      if (m.from === user.id) continue;
      if (store.isRevoked(m.id)) continue;
      const c = store.findConv(m.conv);
      if (!c || c.members.indexOf(user.id) < 0) continue;
      const dec = C.open(this.kEnc, this.kMac, m.env);
      if (!dec) continue;
      msgs.push({
        id: m.id, conv: m.conv, from: m.from, seq: m.seq, ts: m.ts,
        kind: dec.kind, body: dec.body, meta: dec.meta || null,
        missed: true,
      });
    }

    if (!msgs.length) return;

    this.pushToUser(user.id, {
      t: 'batch',
      msgs,
      convs: this.convListFor(user.id),
      catchup: true,
    });
    store.log(`[hub] 给 ${user.name} 补发 ${msgs.length} 条离线消息`);
  }

  dropConn(conn) {
    if (conn.kind === 'admin') {
      this.admins.delete(conn);
      store.log('[hub] 后台端断开');

      if (conn.authed) this.macConns = Math.max(0, this.macConns - 1);
      return;
    }
    if (conn.deviceId && this.devices.get(conn.deviceId) === conn) {
      this.devices.delete(conn.deviceId);
    }
    if (conn.deviceId && this.pendingConns.get(conn.deviceId) === conn) {
      this.pendingConns.delete(conn.deviceId);
    }
    this.untrackUser(conn);
    if (conn.userId) {
      const u = store.findUserById(conn.userId);
      store.updateUser(conn.userId, { lastSeen: Date.now() });
      this.broadcastPresence();
      this.adminBroadcast({ t: 'admin.presence', userId: conn.userId, online: false, lastSeen: Date.now() });
      if (u) store.log(`[hub] ${u.name} 离线`);
    }
  }

  trackUser(conn) {
    if (!conn.userId) return;
    if (!this.byUser.has(conn.userId)) this.byUser.set(conn.userId, new Set());
    this.byUser.get(conn.userId).add(conn);
  }

  untrackUser(conn) {
    if (!conn.userId) return;
    const s = this.byUser.get(conn.userId);
    if (!s) return;
    s.delete(conn);
    if (s.size === 0) this.byUser.delete(conn.userId);
  }

  isOnline(userId) {
    if (this.macUserId && userId === this.macUserId) return true;
    return this.byUser.has(userId);
  }

  dispatch(conn, inner) {
    switch (inner.t) {
      case 'ping':
        this.sendEnc(conn, { t: 'pong', ts: Date.now() });
        break;

      case 'send':
        this.onSend(conn, inner);
        break;

      case 'bye': {
        const c = this.devices.get(conn.deviceId);
        if (c === conn) this.devices.delete(conn.deviceId);
        try { conn.ws.close(4006, '客户端说再见了'); } catch (e) {}
        this.dropConn(conn);
        break;
      }

      case 'sync':
        this.onSync(conn, inner);
        break;

      case 'hist':
        this.onHist(conn, inner);
        break;

      case 'read':
        this.onRead(conn, inner);
        break;

      case 'typing':
        this.onTyping(conn, inner);
        break;

      case 'seen':           this.onSeen(conn, inner);          break;

      case 'recall':         this.onRecall(conn, inner);        break;
      case 'knock':          this.onKnock(conn, inner);         break;
      case 'search':         this.onSearch(conn, inner);        break;

      case 'group.create':   this.onGroupCreate(conn, inner);   break;
      case 'group.rename':   this.onGroupRename(conn, inner);   break;
      case 'group.add':      this.onGroupAdd(conn, inner);      break;
      case 'group.leave':    this.onGroupLeave(conn, inner);    break;
      case 'profile.set':    this.onProfileSet(conn, inner);    break;
      case 'remark.set':     this.onRemarkSet(conn, inner);     break;

      default:
        this.sendEnc(conn, { t: 'err', code: 'BADTYPE', msg: '不认识的消息类型：' + clip(inner.t, 20) });
    }
  }

  resolveConv(fromUid, inner) {

    if (inner.to) {
      const peer = store.findUserById(clip(inner.to, 32));
      if (!peer || peer.id === fromUid) return null;
      return store.ensureDirectConv(fromUid, peer.id);
    }
    if (inner.conv) {
      const c = store.findConv(clip(inner.conv, 40));
      if (c && c.members.indexOf(fromUid) >= 0) return c;
    }
    return null;
  }

  allowSend(conn) {
    const now = Date.now();
    const CAP = 60, RATE = 10;

    if (conn.tokens === undefined) {
      conn.tokens = CAP;
      conn.tokenAt = now;
    }
    const dt = (now - conn.tokenAt) / 1000;
    if (dt > 0) {
      conn.tokens = Math.min(CAP, conn.tokens + dt * RATE);
      conn.tokenAt = now;
    }

    if (conn.tokens < 1) return false;
    conn.tokens -= 1;
    return true;
  }

  onSend(conn, inner) {

    if (!this.allowSend(conn)) {
      this.sendEnc(conn, {
        t: 'err', code: 'TOOFAST',
        msg: '发得太快了，缓一缓',
        cid: inner && inner.cid,
      });

      conn.floodCount = (conn.floodCount || 0) + 1;
      if (conn.floodCount === 20 || conn.floodCount % 200 === 0) {
        store.log(`[hub] ${(store.findUserById(conn.userId) || {}).name || '?'} ` +
                  `发消息过快，已拦下 ${conn.floodCount} 条`);
      }
      return;
    }

    let isNewConv = false;
    if (inner.to) {
      const pp = store.findUserById(clip(inner.to, 32));
      if (pp) isNewConv = !store.findConv(store.directConvId(conn.userId, pp.id));
    }

    const conv = this.resolveConv(conn.userId, inner);
    if (!conv) {
      this.sendEnc(conn, { t: 'err', code: 'NOTFOUND', msg: '会话不存在' });
      return;
    }

    const cid = clip(inner.cid, 40);

    if (cid) {
      const dup = store.isDuplicate(cid);
      if (dup) {
        const last = store.lastMessage(conv.id);
        this.sendEnc(conn, { t: 'ack', cid, msgId: last ? last.id : null, ts: last ? last.ts : Date.now(), dup: true, conv: conv.id });
        return;
      }
    }

    const kind = ['text', 'image', 'file', 'voice', 'system'].indexOf(inner.kind) >= 0 ? inner.kind : 'text';

    const burn = Math.max(0, Math.min(3600, Math.round(Number(inner.burn) || 0)));

    const env  = C.seal(this.kEnc, this.kMac, {
      kind,
      body: clip(inner.body, 8000),
      meta: inner.meta || null,
      burn,
    });

    const msg = store.appendMessage({ conv: conv.id, from: conn.userId, env });

    if (burn > 0) {
      store.addBurn(msg.id, { conv: conv.id, sec: burn, ts: msg.ts, from: conn.userId });
    }

    this.sendEnc(conn, { t: 'ack', cid, msgId: msg.id, ts: msg.ts, conv: conv.id, seq: msg.seq });

    this.pushToUser(conn.userId, { t: 'msg', msg: {
      id: msg.id, conv: conv.id, from: conn.userId, seq: msg.seq, ts: msg.ts,
      kind, body: clip(inner.body, 8000), meta: inner.meta || null,
      burn, burnAt: 0,
    } });

    const out = {
      t: 'msg',
      msg: {
        id: msg.id, conv: conv.id, from: conn.userId, seq: msg.seq, ts: msg.ts,
        kind, body: clip(inner.body, 8000), meta: inner.meta || null,
        burn, burnAt: 0,
      },
    };

    for (const uid of conv.members) {
      if (uid === conn.userId) continue;
      this.pushToUser(uid, out);
    }

    if (isNewConv) {
      this.sendEnc(conn, { t: 'batch', msgs: [], convs: this.convListFor(conn.userId) });
    }
  }

  onSeen(conn, inner) {
    const seq = Number(inner.seq) || 0;
    const u = store.findUserById(conn.userId);
    if (!u) return;
    if (seq > (u.seenSeq || 0)) {
      u.seenSeq = seq;
      u.seenAt = Date.now();
      store.touchState();
    }

    conn.seenSeq = seq;
  }

  checkGaps() {
    const maxSeq = store.getState().seq;
    const now = Date.now();
    const STALE = 8000;

    for (const [userId, conns] of this.byUser) {
      if (!conns || !conns.size) continue;

      const u = store.findUserById(userId);
      if (!u) continue;

      const seen = u.seenSeq || 0;
      if (maxSeq - seen <= 0) continue;

      const lastSign = Math.max(u.seenAt || 0, conns.values().next().value.connectedAt || 0);
      if (now - lastSign < STALE) continue;

      for (const conn of conns) {

        if (now - (conn.lastGapPush || 0) < 15000) continue;
        conn.lastGapPush = now;
        store.log(`[hub] ${u.name} 报到 ${seen} 号，服务端已到 ${maxSeq} 号 —— 差 ${
          maxSeq - seen} 条，主动补推`);
        this.pushRange(conn, seen);
      }
    }
  }

  pushRange(conn, fromSeq) {
    try { this.onSync(conn, { sinceSeq: fromSeq, limit: 300 }, 'push'); }
    catch (e) { store.log('[hub] 补推失败：' + e.message); }
  }

  onSync(conn, inner, why) {
    const useSeq = inner.sinceSeq !== undefined && inner.sinceSeq !== null;
    let raw, more = false, maxSeq = 0;

    const mine = (m) => {
      const c = store.findConv(m.conv);
      if (!c || c.members.indexOf(conn.userId) < 0) return false;
      if (m.from === conn.userId) return false;
      if (store.isRevoked(m.id)) return false;
      return true;
    };

    if (useSeq) {
      const r = store.sinceSeq(Number(inner.sinceSeq) || 0, Number(inner.limit) || 300, mine);
      raw = r.msgs; more = r.more; maxSeq = r.maxSeq;
    } else {
      raw = store.since(Number(inner.since) || 0, 500);
    }

    const msgs = [];
    for (const m of raw) {

      const c = store.findConv(m.conv);
      if (!c || c.members.indexOf(conn.userId) < 0) continue;
      if (m.from === conn.userId) continue;
      if (store.isRevoked(m.id)) continue;
      const dec = C.open(this.kEnc, this.kMac, m.env);
      if (!dec) continue;
      msgs.push({
        id: m.id, conv: m.conv, from: m.from, seq: m.seq, ts: m.ts,
        kind: dec.kind, body: dec.body, meta: dec.meta || null,
        ...this.burnFields(m.id, dec),
      });
    }

    const batch = {
      t: 'batch', msgs,
      convs: this.convListFor(conn.userId),
      why: why || 'sync',
      maxSeq: useSeq ? maxSeq : undefined,
      more: useSeq ? more : undefined,
    };
    this.sendEnc(conn, batch);
  }

  onHist(conn, inner) {
    const convId = clip(inner.conv, 40);
    const c = store.findConv(convId);
    if (!c || c.members.indexOf(conn.userId) < 0) {
      this.sendEnc(conn, { t: 'err', code: 'NOTFOUND', msg: '会话不存在' });
      return;
    }
    const limit  = Math.min(Math.max(Number(inner.limit) || cfg.HISTORY_PAGE, 1), 100);
    const before = Number(inner.before) || Number.MAX_SAFE_INTEGER;
    const raw = store.history(convId, before, limit);

    const msgs = [];
    for (const m of raw) {
      if (store.isRevoked(m.id)) continue;
      const dec = C.open(this.kEnc, this.kMac, m.env);
      if (!dec) continue;
      msgs.push({
        id: m.id, conv: m.conv, from: m.from, seq: m.seq, ts: m.ts,
        kind: dec.kind, body: dec.body, meta: dec.meta || null,
        ...this.burnFields(m.id, dec),
      });
    }

    this.sendEnc(conn, { t: 'batch', msgs, conv: convId, hist: true, why: 'hist' });
  }

  burnFields(msgId, dec) {
    const b = store.getBurn(msgId);
    return {
      burn:   (dec && Number(dec.burn)) || 0,
      burnAt: (b && b.at) || 0,
    };
  }

  onRead(conn, inner) {
    const convId = clip(inner.conv, 40);
    const c = store.findConv(convId);
    if (!c || c.members.indexOf(conn.userId) < 0) return;

    const ts = Math.max(Number(inner.ts) || 0, Date.now());
    store.setReadTs(conn.userId, convId, ts);

    const armed = store.armBurns(convId, conn.userId, ts);
    for (const a of armed) {
      for (const uid of c.members) {
        this.pushToUser(uid, { t: 'burn', conv: convId, msgId: a.msgId, burnAt: a.burnAt });
      }
    }
    if (armed.length) {
      store.log(`[burn] ${(store.findUserById(conn.userId) || {}).name || '?'} 读了 ` +
                `${armed.length} 条待焚消息，开始倒计时`);
    }

    for (const uid of c.members) {
      if (uid === conn.userId) continue;
      this.pushToUser(uid, { t: 'read', conv: convId, by: conn.userId, ts });
    }

    this.sendEnc(conn, { t: 'read.ok', conv: convId, ts });

    this.adminBroadcast({ t: 'admin.read', conv: convId, by: conn.userId, ts });
  }

  checkBurns() {
    const due = store.dueBurns(Date.now());
    if (!due.length) return 0;

    for (const d of due) {
      store.burnMessage(d.msgId);
      const c = store.findConv(d.conv);
      const out = { t: 'burned', conv: d.conv, msgId: d.msgId };
      if (c) for (const uid of c.members) this.pushToUser(uid, out);
      this.adminBroadcast({ t: 'admin.burned', conv: d.conv, msgId: d.msgId });
    }
    store.log(`[burn] 焚毁了 ${due.length} 条消息`);
    return due.length;
  }

  onTyping(conn, inner) {
    const convId = clip(inner.conv, 40);
    const c = store.findConv(convId);
    if (!c || c.members.indexOf(conn.userId) < 0) return;
    for (const uid of c.members) {
      if (uid === conn.userId) continue;
      this.pushToUser(uid, { t: 'typing', conv: convId, from: conn.userId });
    }
  }

  onRecall(conn, inner) {
    const msgId = clip(inner.msgId, 40);
    const r = store.revokeMessage(msgId, conn.userId);

    if (!r.ok) {
      const why = {
        NOMSG:   '找不到这条消息',
        NOTMINE: '只能撤回自己发的消息',
        TOOLATE: '超过 2 分钟了，撤不回来了',
      }[r.why] || '撤不了';
      this.sendEnc(conn, { t: 'err', code: 'RECALL_' + r.why, msg: why });
      return;
    }

    const conv = store.findConv(r.msg.conv);
    if (!conv) return;

    const out = { t: 'recalled', conv: conv.id, msgId: msgId, by: conn.userId };
    for (const uid of conv.members) this.pushToUser(uid, out);
    this.adminBroadcast({ t: 'admin.recall', conv: conv.id, msgId, by: conn.userId });
    store.log(`[hub] ${(store.findUserById(conn.userId) || {}).name || '?'} 撤回了一条消息`);
  }

  onKnock(conn, inner) {
    const toId = clip(inner.to, 32);
    const to = store.findUserById(toId);
    if (!to) { this.sendEnc(conn, { t: 'err', code: 'NOTFOUND', msg: '找不到这个人' }); return; }

    const me = store.findUserById(conn.userId) || { name: '?' };
    const n = this.pushToUser(to.id, {
      t: 'knock', from: conn.userId, fromName: me.name, ts: Date.now(),
    });

    if (n > 0) {
      this.sendEnc(conn, { t: 'knock.ok', to: to.id, online: true });
      store.log(`[hub] ${me.name} 敲了敲 ${to.name}`);
    } else {

      this.sendEnc(conn, { t: 'knock.ok', to: to.id, online: false });
    }
  }

  onSearch(conn, inner) {
    const q = String(inner.q == null ? '' : inner.q).trim().slice(0, 40);
    if (q.length < 1) { this.sendEnc(conn, { t: 'search.r', q: q, hits: [] }); return; }

    const limit = Math.min(Math.max(Number(inner.limit) || 50, 1), 200);
    const lower = q.toLowerCase();

    let raw;
    try { raw = store.since(0, 1500); } catch (e) { raw = []; }

    const hits = [];
    for (let i = raw.length - 1; i >= 0 && hits.length < limit; i--) {
      const m = raw[i];
      if (store.isRevoked(m.id)) continue;
      const c = store.findConv(m.conv);
      if (!c || c.members.indexOf(conn.userId) < 0) continue;

      const dec = C.open(this.kEnc, this.kMac, m.env);
      if (!dec) continue;

      if (dec.kind === 'voice' || dec.kind === 'image') continue;

      const body = String(dec.body == null ? '' : dec.body);
      if (body.toLowerCase().indexOf(lower) < 0) continue;

      const sender = store.findUserById(m.from) || {};
      hits.push({
        id: m.id, conv: m.conv, from: m.from, ts: m.ts,
        kind: dec.kind, body: body,
        senderName: store.getRemark(conn.userId, m.from) || sender.name || '?',
        convTitle: c.type === 'group'
          ? (c.title || '群聊')
          : (store.getRemark(conn.userId, c.members.find(x => x !== conn.userId)) ||
             (store.findUserById(c.members.find(x => x !== conn.userId)) || {}).name || '?'),
        isGroup: c.type === 'group',
      });
    }

    this.sendEnc(conn, { t: 'search.r', q: q, hits: hits, scanned: raw.length });
  }

  onGroupCreate(conn, inner) {
    const name = clip(inner.name, 24) || '新群聊';
    const list = Array.isArray(inner.members) ? inner.members.slice(0, 50) : [];

    const c = store.createGroup(conn.userId, name, list);
    store.log(`[hub] ${(store.findUserById(conn.userId) || {}).name || '?'} 建了群「${c.title}」（${c.members.length} 人）`);

    this.postSystem(c.id, `${(store.findUserById(conn.userId) || {}).name || '?'} 创建了群聊`);

    for (const uid of c.members) {
      this.pushToUser(uid, { t: 'batch', msgs: [], convs: this.convListFor(uid) });
    }
    this.sendEnc(conn, { t: 'group.ok', conv: c.id, action: 'create' });
  }

  onGroupRename(conn, inner) {
    const c = store.findConv(clip(inner.conv, 40));
    if (!c || c.type !== 'group' || c.members.indexOf(conn.userId) < 0) return;
    if (c.owner !== conn.userId) {

      this.sendEnc(conn, { t: 'err', code: 'DENIED', msg: '只有群主能改群名' });
      return;
    }
    store.updateGroup(c.id, { title: inner.name, avatar: inner.avatar });
    store.log(`[hub] 群「${c.title}」改名`);
    for (const uid of c.members) {
      this.pushToUser(uid, { t: 'batch', msgs: [], convs: this.convListFor(uid) });
    }
    this.sendEnc(conn, { t: 'group.ok', conv: c.id, action: 'rename' });
  }

  onGroupAdd(conn, inner) {
    const c = store.findConv(clip(inner.conv, 40));
    if (!c || c.type !== 'group' || c.members.indexOf(conn.userId) < 0) return;
    const before = c.members.slice();
    store.addGroupMembers(c.id, Array.isArray(inner.members) ? inner.members : []);
    const added = c.members.filter(u => before.indexOf(u) < 0);
    if (added.length) {
      const names = added.map(u => (store.findUserById(u) || {}).name || '?').join('、');
      this.postSystem(c.id, `${names} 加入了群聊`);
    }
    for (const uid of c.members) {
      this.pushToUser(uid, { t: 'batch', msgs: [], convs: this.convListFor(uid) });
    }
  }

  onGroupLeave(conn, inner) {
    const c = store.findConv(clip(inner.conv, 40));
    if (!c || c.type !== 'group' || c.members.indexOf(conn.userId) < 0) return;
    const me = (store.findUserById(conn.userId) || {}).name || '?';
    const still = c.members.filter(u => u !== conn.userId);
    store.removeGroupMember(c.id, conn.userId);
    this.postSystem(c.id, `${me} 退出了群聊`);
    this.pushToUser(conn.userId, { t: 'batch', msgs: [], convs: this.convListFor(conn.userId) });
    for (const uid of still) {
      this.pushToUser(uid, { t: 'batch', msgs: [], convs: this.convListFor(uid) });
    }
  }

  postSystem(convId, text) {
    const c = store.findConv(convId);
    if (!c) return null;
    const env = C.seal(this.kEnc, this.kMac, { kind: 'system', body: text, meta: null });
    const msg = store.appendMessage({ conv: convId, from: c.owner || c.members[0], env });
    const out = { t: 'msg', msg: {
      id: msg.id, conv: convId, from: msg.from, seq: msg.seq, ts: msg.ts,
      kind: 'system', body: text, meta: null,
    } };
    for (const uid of c.members) this.pushToUser(uid, out);
    return msg;
  }

  onProfileSet(conn, inner) {
    let av = inner.avatar;
    if (typeof av !== 'string') return;

    if (av.length > 100 * 1024) {
      this.sendEnc(conn, { t: 'err', code: 'TOOBIG', msg: '头像太大了' });
      return;
    }
    if (av && av.indexOf('data:image/') !== 0) av = null;

    store.updateUser(conn.userId, { avatar: av || null });
    store.log(`[hub] ${(store.findUserById(conn.userId) || {}).name || '?'} 换了头像`);
    this.broadcastPresence();
    this.sendEnc(conn, { t: 'profile.ok' });
    this.adminBroadcast(this.snapshot());
  }

  onRemarkSet(conn, inner) {
    const peerId = clip(inner.peer, 32);
    if (!peerId || !store.findUserById(peerId)) return;
    store.setRemark(conn.userId, peerId, inner.name);
    store.log(`[hub] 备注已更新（只有自己可见）`);

    this.sendEnc(conn, { t: 'batch', msgs: [], convs: this.convListFor(conn.userId), remarks: this.remarksFor(conn.userId) });
  }

  remarksFor(userId) {
    const out = {};
    const all = (store.getState().remarks || {})[userId] || {};
    for (const k of Object.keys(all)) out[k] = all[k];
    return out;
  }

  postFileMessage(fromUid, peerUid, kind, fileId, name, size, mime, extra, burnSecs) {
    const conv = store.ensureDirectConv(fromUid, peerUid);
    const meta = Object.assign({ fileId, size, mime }, extra || {});
    const burn = Math.max(0, Math.min(3600, Math.round(Number(burnSecs) || 0)));
    const env = C.seal(this.kEnc, this.kMac, { kind, body: name, meta, burn });
    const msg = store.appendMessage({ conv: conv.id, from: fromUid, env });

    if (burn > 0) {
      store.addBurn(msg.id, { conv: conv.id, sec: burn, ts: msg.ts, from: fromUid });
    }

    const out = {
      t: 'msg',
      msg: {
        id: msg.id, conv: conv.id, from: fromUid, seq: msg.seq, ts: msg.ts,
        kind, body: name, meta, burn, burnAt: 0,
      },
    };
    this.pushToUser(peerUid, out);

    this.pushToUser(fromUid, out);
    return { msg: out.msg, conv: conv.id };
  }

  postFileToConv(convId, fromUid, kind, fileId, name, size, mime, extra, burnSecs) {
    const c = store.findConv(convId);
    if (!c) return null;
    const meta = Object.assign({ fileId, size, mime }, extra || {});
    const burn = Math.max(0, Math.min(3600, Math.round(Number(burnSecs) || 0)));
    const env = C.seal(this.kEnc, this.kMac, { kind, body: name, meta, burn });
    const msg = store.appendMessage({ conv: convId, from: fromUid, env });

    if (burn > 0) {
      store.addBurn(msg.id, { conv: convId, sec: burn, ts: msg.ts, from: fromUid });
    }

    const out = { t: 'msg', msg: {
      id: msg.id, conv: convId, from: fromUid, seq: msg.seq, ts: msg.ts,
      kind, body: name, meta,
    } };
    out.msg.burn = burn;
    out.msg.burnAt = 0;
    for (const uid of c.members) this.pushToUser(uid, out);
    return { msg: out.msg, conv: convId };
  }

  peerList() {
    return store.getState().users.map(u => {
      const dev = String(u.deviceId || '');
      return {
        id: u.id,
        name: u.name,
        avatar: u.avatar || null,
        role: u.role || 'member',
        online: this.isOnline(u.id),
        lastSeen: u.lastSeen || 0,
        joinedAt: u.createdAt || 0,

        device: dev ? (dev.length > 12 ? dev.slice(0, 6) + '…' + dev.slice(-4) : dev) : '',
        deviceName: u.deviceName || '',
        lastIp: u.lastIp || '',
        isLocal: dev === 'mac-local',
        hasAvatar: !!u.avatar,
      };
    });
  }

  convListFor(userId) {
    const convs = store.convsOfUser(userId);
    const out = [];

    for (const c of convs) {
      const readTs = store.getReadTs(userId, c.id);

      let peerReadTs = 0;
      if (c.type === 'group') {
        const others = c.members.filter(m => m !== userId);
        peerReadTs = others.length
          ? Math.min(...others.map(m => store.getReadTs(m, c.id) || 0))
          : 0;
      } else {
        const other = c.members.find(m => m !== userId);
        peerReadTs = other ? (store.getReadTs(other, c.id) || 0) : 0;
      }

      let lastMsg = null;
      const lm = store.lastMessage(c.id);
      if (lm) {
        const dec = C.open(this.kEnc, this.kMac, lm.env);
        const sender = store.findUserById(lm.from) || {};
        lastMsg = {
          kind: (dec && dec.kind) || 'text',
          preview: previewOf(dec),
          ts: lm.ts,
          from: lm.from,
          fromName: store.getRemark(userId, lm.from) || sender.name || '?',
        };
      }

      const unread = lastMsg ? store.unreadCount(c.id, userId, readTs) : 0;

      if (c.type === 'group') {
        out.push({
          id: c.id,
          type: 'group',
          title: c.title || '群聊',
          avatar: c.avatar || null,
          owner: c.owner || null,
          memberCount: c.members.length,
          members: c.members.map(id => {
            const u = store.findUserById(id) || {};
            return {
              id,
              name: store.getRemark(userId, id) || u.name || '?',
              avatar: u.avatar || null,
              online: this.isOnline(id),
            };
          }),
          lastMsg,
          unread,
          lastReadTs: readTs,
          peerReadTs,
        });
        continue;
      }

      const peerId = c.members.find(m => m !== userId);
      const peer   = store.findUserById(peerId);
      const remark = store.getRemark(userId, peerId);

      out.push({
        id: c.id,
        type: 'direct',
        peer: peer
          ? {
              id: peer.id,
              name: remark || peer.name,
              realName: peer.name,
              remark: remark || null,
              avatar: peer.avatar || null,
              online: this.isOnline(peer.id),
              lastSeen: peer.lastSeen || 0,
            }
          : { id: peerId, name: '已移除的成员', realName: '', remark: null,
              avatar: null, online: false, lastSeen: 0 },
        lastMsg,
        unread,
        lastReadTs: readTs,
        peerReadTs,
      });
    }

    out.sort((a, b) => ((b.lastMsg && b.lastMsg.ts) || 0) - ((a.lastMsg && a.lastMsg.ts) || 0));
    return out;
  }

  sendEnc(conn, obj) {
    if (!conn || !conn.ws) return false;

    if (conn.ws.readyState !== 1) {
      conn.sendBroken = true;
      return false;
    }

    var data;
    try { data = JSON.stringify(C.seal(this.kEnc, this.kMac, obj)); }
    catch (e) { return false; }

    try {
      conn.ws.send(data, function (err) {
        if (err) conn.sendBroken = true;
      });
      return true;
    } catch (e) {
      conn.sendBroken = true;
      return false;
    }
  }

  sendPlain(conn, obj) {
    try { conn.ws.send(JSON.stringify(obj)); return true; }
    catch (e) { return false; }
  }

  pushToUser(userId, obj) {
    const set = this.byUser.get(userId);
    if (!set) return 0;
    let n = 0;
    for (const c of set) if (this.sendEnc(c, obj)) n++;
    return n;
  }

  handleAdmin(ws, req) {
    const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');

    if (!net.isLocal(ip)) {
      store.log(`[hub] 拒绝非本机访问后台：${ip}`);
      try { ws.send(JSON.stringify({ t: 'admin.err', code: 'DENIED', msg: '后台只能在本机访问' })); } catch (e) {}
      try { ws.close(4003, 'forbidden'); } catch (e) {}
      return;
    }

    const conn = {
      kind: 'admin', ws, ip,
      authed: false, alive: true, lastSeen: Date.now(),
      connectedAt: Date.now(),
    };

    ws.on('message', (data) => {

      Promise.resolve()
        .then(() => this.onAdminFrame(conn, data))
        .catch((e) => { store.log('[hub] 处理后台帧出错：' + (e && e.message)); });
    });
    ws.on('close', () => this.dropConn(conn));
    ws.on('error', () => this.dropConn(conn));

    this.admins.add(conn);
    store.log('[hub] 后台端接入');

    this.adminSend(conn, { t: 'admin.needpwd' });
  }

  async onAdminFrame(conn, data) {
    conn.lastSeen = Date.now();
    let m;
    try { m = JSON.parse(data.toString('utf8')); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'admin.login') {
      if (conn.authed) { this.adminSend(conn, { t: 'admin.ok', stats: this.adminStats() }); return; }

      const pwd = String(m.pwd == null ? '' : m.pwd);
      let ok = false;
      try {

        const cand = cfg.ADMIN_PASSWORD
          ? await C.deriveAdminAsync(pwd, cfg.PBKDF2_ITERATIONS)
          : await C.deriveMasterAsync(pwd, cfg.PBKDF2_ITERATIONS);
        ok = cand.length === this.adminKey.length &&
             require('crypto').timingSafeEqual(cand, this.adminKey);
      } catch (e) { ok = false; }

      if (!ok) {
        store.log('[hub] 后台密码错误');
        this.adminSend(conn, { t: 'admin.err', code: 'BADPWD', msg: '密码不对' });
        return;
      }

      conn.authed = true;

      this.macConns++;

      this.adminSend(conn, { t: 'admin.ok', serverTime: Date.now(), stats: this.adminStats() });
      this.adminSend(conn, this.snapshot());
      return;
    }

    if (!conn.authed) {
      this.adminSend(conn, { t: 'admin.err', code: 'NEEDPWD', msg: '先登录' });
      return;
    }

    switch (m.t) {
      case 'admin.ping':

        break;

      case 'admin.hist':
      case 'admin.monitor':
        this.adminSend(conn, this.snapshot());
        break;

      case 'admin.approve':
        this.approveDevice(m.deviceId, m.name);
        break;

      case 'admin.reject':
        this.rejectDevice(m.deviceId);
        break;

      case 'admin.rename': {
        const u = store.findUserById(clip(m.userId, 32));
        if (u) { store.updateUser(u.id, { name: clip(m.name, 32) || u.name }); this.broadcastPresence(); }
        this.adminBroadcast(this.snapshot());
        break;
      }

      case 'admin.remove': {
        const u = store.findUserById(clip(m.userId, 32));
        if (u) {
          store.deleteUser(u.id);
          store.log(`[hub] 移除成员 ${u.name}`);
          const set = this.byUser.get(u.id);
          if (set) for (const c of [...set]) { try { c.ws.close(4005, '已被移除'); } catch (e) {} }
          this.broadcastPresence();
        }
        this.adminBroadcast(this.snapshot());
        break;
      }

      case 'admin.shutdown':
        store.log('[hub] 后台端点了【停止服务】，正在关闭…');
        this.adminBroadcast({ t: 'admin.bye', msg: '服务已停止' });
        setTimeout(() => this.shutdown(), 300);
        break;

      default:
        this.adminSend(conn, { t: 'admin.err', code: 'BADTYPE', msg: '不认识：' + clip(m.t, 24) });
    }
  }

  adminSend(conn, obj) {
    try { conn.ws.send(JSON.stringify(obj)); return true; }
    catch (e) { return false; }
  }

  adminBroadcast(obj) {
    for (const c of this.admins) {
      if (c.authed || obj.t === 'admin.needpwd') this.adminSend(c, obj);
    }
  }

  adminStats() {
    const st = store.stats();
    const ms = store.msgStats();

    return {

      msgTotal:    st.msgTotal,
      msgToday:    ms.today,
      msgByUser:   ms.users,
      msgByConv:   ms.convs,

      users: st.users,
      convs: st.convs,

      onlineDevices: this.devices.size,

      onlineUsers: this.byUser.size +
                   ((this.macUserId && !this.byUser.has(this.macUserId)) ? 1 : 0),
      pendingCount:  this.pendingConns.size,
      adminOnline:   this.macConns || 0,

      uptime:   Math.floor((Date.now() - this.startedAt) / 1000),
      startedAt: this.startedAt,

      burnWaiting: store.burnStats().waiting,
      burnArmed:   store.burnStats().armed,
      burnDone:    store.burnStats().burned,

      rssMB: +(process.memoryUsage().rss / 1024 / 1024).toFixed(1),

      samples: this.samples,
    };
  }

  snapshot() {
    const st = store.getState();

    return {
      t: 'admin.snapshot',
      serverTime: Date.now(),
      serverName: cfg.SERVER_NAME,
      ver: cfg.VERSION,
      ip: net.primaryIP(),
      port: cfg.PORT,
      startedAt: this.startedAt,

      stats: this.adminStats(),

      users: this.peerList(),
      pending: st.pending,

      convs: st.convs.map(c => ({
        id: c.id,
        type: c.type,
        memberCount: c.members.length,
        members: c.members.map(id => (store.findUserById(id) || { name: id }).name),
      })),

      logs: store.recentLogs(60),

      msgs: [],
      noMsgs: true,
    };
  }

  broadcastPresence() {
    const list = this.peerList();
    for (const conn of this.devices.values()) {
      if (!conn.authed) continue;

      this.sendEnc(conn, { t: 'peers', peers: list, remarks: this.remarksFor(conn.userId) });
    }
  }

  sweep() {

    for (const conn of [...this.devices.values()]) {
      if (conn.sendBroken) {
        try { conn.ws.close(4007, '发送失败，连接已失效'); } catch (e) {}
        this.dropConn(conn);
      }
    }

    const now = Date.now();
    for (const conn of [...this.devices.values()]) {
      if (now - conn.lastSeen > cfg.DEAD_AFTER) {
        store.log(`[hub] ${conn.deviceName || conn.ip} 心跳超时，断开`);
        try { conn.ws.close(4002, '心跳超时'); } catch (e) {}
        this.dropConn(conn);
      }
    }
    for (const conn of [...this.admins]) {
      if (now - conn.lastSeen > 5 * 60 * 1000) {
        try { conn.ws.close(4002, '后台空闲超时'); } catch (e) {}
        this.dropConn(conn);
      }
    }
  }

  startTimers() {
    const t1 = setInterval(() => { try { this.sweep(); } catch (e) {} }, cfg.SWEEP_INTERVAL);
    const t2 = setInterval(() => {
      if (this.admins.size) this.adminBroadcast({ t: 'admin.stats', stats: this.adminStats() });
    }, 10000);

    const t3 = setInterval(() => { try { this.checkGaps(); } catch (e) {} }, 5000);
    if (t1.unref) t1.unref();
    if (t2.unref) t2.unref();
    if (t3.unref) t3.unref();
    this.timers.push(t1, t2, t3);
  }

  shutdown(code) {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    store.log('[hub] 正在关闭服务…');

    for (const t of this.timers) { try { clearInterval(t); } catch (e) {} }
    this.timers = [];

    for (const conn of this.devices.values()) {
      try { conn.ws.close(4000, '服务已停止'); } catch (e) {}
    }
    for (const conn of this.pendingConns.values()) {
      try { conn.ws.close(4000, '服务已停止'); } catch (e) {}
    }
    for (const conn of this.admins) {
      try { conn.ws.close(4000, '服务已停止'); } catch (e) {}
    }

    store.flushState();
    store.closeMsgFile();

    try { if (this.servers.udp) this.servers.udp.close(); } catch (e) {}
    try { if (this.servers.wss) this.servers.wss.close(); } catch (e) {}
    try { if (this.servers.http) this.servers.http.close(); } catch (e) {}

    setTimeout(() => {
      store.log('[hub] 已停止。端口已释放，别人连不上了。');
      process.exit(code == null ? 0 : code);
    }, 250);
  }
}

module.exports = { Hub, previewOf };
