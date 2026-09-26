'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const cfg    = require('./config');

function ensureDirs() {
  for (const d of [cfg.DATA_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

const logRing = [];
function log(...args) {
  const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  logRing.push({ at: Date.now(), line });
  if (logRing.length > cfg.LOG_RING) logRing.shift();
  console.log(line);
}
function recentLogs(n) { return logRing.slice(-(n || 100)); }

let state = {
  users:   [],
  convs:   [],
  reads:   {},
  seq:     0,
  pending: [],
  remarks: {},
  revoked: {},

  burns: {},

  createdAt: Date.now(),
};

let saveTimer = null;
let dirty = false;

function loadState() {
  try {
    if (fs.existsSync(cfg.STATE_FILE)) {
      const raw = fs.readFileSync(cfg.STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      state = Object.assign(state, parsed);

      state.users   = state.users   || [];
      state.convs   = state.convs   || [];
      state.reads   = state.reads   || {};
      state.pending = state.pending || [];
      state.remarks = state.remarks || {};
      state.revoked = state.revoked || {};
      state.burns   = state.burns   || {};
      state.seq     = state.seq     || 0;
    }
  } catch (e) {
    log('[store] state.json 读不了，用空状态启动：' + e.message);
  }
  if (!state.createdAt) state.createdAt = Date.now();
}

function saveStateNow() {
  try {
    const tmp = cfg.STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, cfg.STATE_FILE);
    dirty = false;
  } catch (e) {
    log('[store] state.json 写失败：' + e.message);
  }
}

function touchState() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (dirty) saveStateNow();
  }, 500);
  if (saveTimer.unref) saveTimer.unref();
}

function flushState() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (dirty) saveStateNow();
}

function getState() { return state; }

function shortId(prefix, n) {
  return prefix + crypto.randomBytes(n || 4).toString('hex');
}

function findUserById(id)        { return state.users.find(u => u.id === id) || null; }
function findUserByDevice(did)   { return state.users.find(u => u.deviceId === did) || null; }

function findUserByName(name) {
  const n = String(name || '').trim();
  if (!n) return null;

  const cands = state.users.filter(u => String(u.name).trim() === n);
  if (!cands.length) return null;
  cands.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  return cands[0];
}

function findUserByIpName(ip, name, within) {
  if (!ip || !name) return null;
  const cutoff = Date.now() - (within || 30 * 24 * 3600 * 1000);
  const n = String(name).trim();

  const cands = state.users
    .filter(u => u.lastIp === ip &&
                 String(u.deviceName || u.name).trim() === n &&
                 (u.lastSeen || 0) >= cutoff)
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));

  return cands[0] || null;
}

function createUser({ name, deviceId, role, avatar }) {
  const u = {
    id: shortId('u_', 4),
    name: name || '未命名',
    avatar: avatar || null,
    deviceId: deviceId || null,
    role: role || 'member',
    createdAt: Date.now(),
    lastSeen: Date.now(),
  };
  state.users.push(u);
  touchState();
  return u;
}

function updateUser(id, patch) {
  const u = findUserById(id);
  if (!u) return null;
  Object.assign(u, patch);
  touchState();
  return u;
}

function deleteUser(id) {
  const i = state.users.findIndex(u => u.id === id);
  if (i >= 0) { state.users.splice(i, 1); touchState(); return true; }
  return false;
}

function directConvId(a, b) {
  const key = [a, b].sort().join('|');
  return 'c_' + crypto.createHash('sha1').update(key).digest('hex').slice(0, 10);
}

function findConv(id) { return state.convs.find(c => c.id === id) || null; }

function ensureDirectConv(a, b) {
  const id = directConvId(a, b);
  let c = findConv(id);
  if (!c) {
    c = { id, type: 'direct', members: [a, b].sort(), createdAt: Date.now(), title: null };
    state.convs.push(c);
    touchState();
  }
  return c;
}

function convsOfUser(uid) {
  return state.convs.filter(c => c.members.indexOf(uid) >= 0);
}

function createGroup(ownerId, name, memberIds) {
  const id = shortId('g_', 5);

  const ids = [ownerId];
  for (const m of (memberIds || [])) {
    if (m && ids.indexOf(m) < 0 && findUserById(m)) ids.push(m);
  }

  const c = {
    id,
    type: 'group',
    title: (String(name || '').trim().slice(0, 24)) || '新群聊',
    avatar: null,
    owner: ownerId,
    members: ids,
    createdAt: Date.now(),
  };
  state.convs.push(c);
  touchState();
  return c;
}

function updateGroup(id, patch) {
  const c = findConv(id);
  if (!c || c.type !== 'group') return null;
  if (patch.title != null) c.title = String(patch.title).trim().slice(0, 24) || c.title;
  if (patch.avatar !== undefined) c.avatar = patch.avatar;
  touchState();
  return c;
}

function addGroupMembers(id, uids) {
  const c = findConv(id);
  if (!c || c.type !== 'group') return null;
  for (const u of (uids || [])) {
    if (u && c.members.indexOf(u) < 0 && findUserById(u)) c.members.push(u);
  }
  touchState();
  return c;
}

function removeGroupMember(id, uid) {
  const c = findConv(id);
  if (!c || c.type !== 'group') return null;
  const i = c.members.indexOf(uid);
  if (i >= 0) { c.members.splice(i, 1); touchState(); }
  return c;
}

function setRemark(userId, peerId, name) {
  if (!state.remarks) state.remarks = {};
  if (!state.remarks[userId]) state.remarks[userId] = {};
  const n = String(name == null ? '' : name).trim().slice(0, 16);
  if (n) state.remarks[userId][peerId] = n;
  else delete state.remarks[userId][peerId];
  touchState();
}

function getRemark(userId, peerId) {
  if (!state.remarks || !state.remarks[userId]) return null;
  return state.remarks[userId][peerId] || null;
}

function readKey(uid, conv) { return uid + '|' + conv; }

function getReadTs(uid, conv) { return state.reads[readKey(uid, conv)] || 0; }

function setReadTs(uid, conv, ts) {
  const k = readKey(uid, conv);
  if ((state.reads[k] || 0) < ts) { state.reads[k] = ts; touchState(); }
}

let msgFd = null;

function openMsgFile() {
  ensureDirs();
  if (msgFd === null) {
    msgFd = fs.openSync(cfg.MSG_FILE, 'a');
  }
}

function closeMsgFile() {
  if (msgFd !== null) { try { fs.closeSync(msgFd); } catch (e) {} msgFd = null; }
}

function appendMessage(rec) {
  openMsgFile();
  const seq = ++state.seq;
  const now = Date.now();
  const msg = {
    id:   'm' + seq.toString(36),
    seq,
    conv: rec.conv,
    from: rec.from,
    ts:   rec.ts || now,

    sts:  now,
    env:  rec.env,
  };
  fs.writeSync(msgFd, JSON.stringify(msg) + '\n');
  rollDay(msg.ts);
  todayCount++;
  bump(byUser, msg.from);
  bump(byConv, msg.conv);
  touchState();
  return msg;
}

let todayMark = -1;
let todayCount = 0;

function dayStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const byUser = new Map();
const byConv = new Map();

function bump(map, key) {
  if (!key) return;
  let r = map.get(key);
  if (!r) { r = { today: 0, total: 0 }; map.set(key, r); }
  r.today++; r.total++;
}

function resetTodayCounters() {
  todayCount = 0;
  for (const r of byUser.values()) r.today = 0;
  for (const r of byConv.values()) r.today = 0;
}

function rollDay(ts) {
  const m = dayStart(ts);
  if (m !== todayMark) { todayMark = m; resetTodayCounters(); }
}

function initToday() {
  rollDay(Date.now());
  byUser.clear();
  byConv.clear();
  todayCount = 0;

  try {
    const raw = since(0, 200000);
    for (const m of raw) {
      const isToday = m.ts >= todayMark;
      if (isToday) todayCount++;

      for (const [map, key] of [[byUser, m.from], [byConv, m.conv]]) {
        if (!key) continue;
        let r = map.get(key);
        if (!r) { r = { today: 0, total: 0 }; map.set(key, r); }
        r.total++;
        if (isToday) r.today++;
      }
    }
  } catch (e) {
    todayCount = 0;
  }
  return todayCount;
}

function msgStats() {
  const users = state.users.map(u => {
    const r = byUser.get(u.id) || { today: 0, total: 0 };
    return { id: u.id, name: u.name, role: u.role || 'member',
             today: r.today, total: r.total };
  }).sort((a, b) => b.today - a.today || b.total - a.total);

  const convs = state.convs.map(c => {
    const r = byConv.get(c.id) || { today: 0, total: 0 };

    let title;
    if (c.type === 'group') {
      title = c.title || '群聊';
    } else {
      title = (c.members || [])
        .map(id => (findUserById(id) || {}).name || '?')
        .join(' ↔ ') || '单聊';
    }
    return { id: c.id, type: c.type, title,
             memberCount: (c.members || []).length,
             today: r.today, total: r.total };
  }).sort((a, b) => b.today - a.today || b.total - a.total);

  return { today: todayCount, total: state.seq, users, convs };
}

function msgToday() {

  if (dayStart(Date.now()) !== todayMark) { rollDay(Date.now()); }
  return todayCount;
}

function tailLines(maxBytes) {
  if (!fs.existsSync(cfg.MSG_FILE)) return [];
  let fd;
  try {
    fd = fs.openSync(cfg.MSG_FILE, 'r');
    const size = fs.fstatSync(fd).size;
    if (size === 0) return [];
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    const buf = Buffer.allocUnsafe(len);
    fs.readSync(fd, buf, 0, len, start);
    let text = buf.toString('utf8');
    if (start > 0) {

      const nl = text.indexOf('\n');
      text = nl >= 0 ? text.slice(nl + 1) : '';
    }
    return text.split('\n').filter(l => l.length > 0);
  } catch (e) {
    log('[store] 读消息失败：' + e.message);
    return [];
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (e) {} }
  }
}

function scanBack(keep, limit) {
  let window = 128 * 1024;
  const MAXW = 8 * 1024 * 1024;
  let found = [];

  while (true) {
    const lines = tailLines(window);
    found = [];
    for (let i = lines.length - 1; i >= 0; i--) {
      let m;
      try { m = JSON.parse(lines[i]); } catch (e) { continue; }
      if (keep(m)) {
        found.push(m);
        if (found.length >= limit) return found.reverse();
      }
    }

    const size = fs.existsSync(cfg.MSG_FILE) ? fs.statSync(cfg.MSG_FILE).size : 0;
    if (window >= size || window >= MAXW) return found.reverse();
    window *= 2;
  }
}

function history(conv, before, limit) {
  const lim = limit || cfg.HISTORY_PAGE;
  const b = before || Number.MAX_SAFE_INTEGER;
  return scanBack(m => m.conv === conv && m.ts < b, lim);
}

function since(ts, limit) {
  return scanBack(m => m.ts > ts, limit || 500);
}

function sinceSeq(seq, limit, keep) {
  const lim = Math.max(1, Math.min(Number(limit) || 300, 1000));
  const from = Number(seq) || 0;

  let window = 256 * 1024;
  const MAXW = 32 * 1024 * 1024;

  for (;;) {
    const lines = tailLines(window);
    const size = fs.existsSync(cfg.MSG_FILE) ? fs.statSync(cfg.MSG_FILE).size : 0;

    let oldest = null;
    for (let i = 0; i < lines.length; i++) {
      try { oldest = JSON.parse(lines[i]); break; } catch (e) {}
    }
    const enough = window >= size || window >= MAXW || (oldest && oldest.seq <= from);

    if (!enough) { window *= 2; continue; }

    const out = [];
    for (let i = 0; i < lines.length; i++) {
      let m;
      try { m = JSON.parse(lines[i]); } catch (e) { continue; }
      if (m.seq > from) {
        if (keep && !keep(m)) continue;
        out.push(m);
        if (out.length > lim) break;
      }
    }

    const more = out.length > lim;
    if (more) out.length = lim;
    return { msgs: out, more, maxSeq: state.seq };
  }
}

function lastMessage(conv) {
  const r = scanBack(m => m.conv === conv, 1);
  return r.length ? r[0] : null;
}

function unreadCount(conv, uid, afterTs) {
  const r = scanBack(m => m.conv === conv && m.ts > afterTs && m.from !== uid, 500);
  return r.length;
}

function stats() {
  let bytes = 0;
  try { if (fs.existsSync(cfg.MSG_FILE)) bytes = fs.statSync(cfg.MSG_FILE).size; } catch (e) {}
  return {
    msgTotal: state.seq,
    msgBytes: bytes,
    users: state.users.length,
    convs: state.convs.length,
  };
}

function safeName(name) {
  const base = String(name || 'file').replace(/[\\/]/g, '_').replace(/^\.+/, '');
  const cleaned = base.replace(/[\x00-\x1f<>:"|?*]/g, '_').slice(0, 120);
  return cleaned || 'file';
}

function newFileId() { return 'f_' + crypto.randomBytes(5).toString('hex'); }

function revokeMessage(msgId, byUserId) {
  const id = String(msgId || '');
  if (!id) return { ok: false, why: 'NOMSG' };
  if (state.revoked[id]) return { ok: true, already: true };

  const raw = scanBack(m => m.id === id, 1);
  if (!raw.length) return { ok: false, why: 'NOMSG' };
  const m = raw[0];

  if (byUserId && m.from !== byUserId) return { ok: false, why: 'NOTMINE' };

  const age = Date.now() - (m.sts || m.ts || 0);
  if (age > REVOKE_WINDOW_MS) return { ok: false, why: 'TOOLATE' };

  state.revoked[id] = Date.now();
  touchState();

  scheduleCompact(3000);
  return { ok: true, msg: m };
}

const REVOKE_WINDOW_MS = 2 * 60 * 1000;

function isRevoked(msgId) { return !!state.revoked[msgId]; }

function addBurn(msgId, rec) {
  state.burns[msgId] = {
    conv: rec.conv,
    sec:  Math.max(1, Math.min(3600, Math.round(rec.sec))),
    ts:   rec.ts,
    from: rec.from,
    at:   0,
  };
  touchState();
}

function armBurns(convId, readerId, upToTs) {
  const now = Date.now();
  const armed = [];
  const c = state.convs.find(x => x.id === convId);
  const members = (c && c.members) ? c.members : [];

  let changed = false;

  for (const id of Object.keys(state.burns)) {
    const b = state.burns[id];
    if (b.at) continue;
    if (b.conv !== convId) continue;
    if (b.from === readerId) continue;
    if (b.ts > upToTs) continue;

    b.readBy = b.readBy || {};
    if (!b.readBy[readerId]) { b.readBy[readerId] = now; changed = true; }

    const need = members.filter(m => m !== b.from);
    const allRead = need.length > 0 && need.every(m => b.readBy[m] > 0);
    if (!allRead) continue;

    b.at = now + b.sec * 1000;
    armed.push({ msgId: id, conv: convId, burnAt: b.at });
  }

  if (armed.length || changed) touchState();
  return armed;
}

function burnWaitingFor(msgId) {
  const b = state.burns[msgId];
  if (!b || b.at) return 0;
  const c = state.convs.find(x => x.id === b.conv);
  if (!c) return 0;
  const need = c.members.filter(m => m !== b.from);
  return need.filter(m => !(b.readBy && b.readBy[m])).length;
}

function dueBurns(now) {
  const out = [];
  for (const id of Object.keys(state.burns)) {
    const b = state.burns[id];
    if (b.at && b.at <= now) out.push({ msgId: id, conv: b.conv });
  }
  return out;
}

function burnMessage(msgId) {
  if (state.revoked[msgId]) { delete state.burns[msgId]; return false; }
  state.revoked[msgId] = Date.now();
  delete state.burns[msgId];
  touchState();

  scheduleCompact();
  return true;
}

function getBurn(msgId) { return state.burns[msgId] || null; }

function pruneBurns(maxAgeMs) {
  const cut = Date.now() - (maxAgeMs || 7 * 24 * 3600 * 1000);
  let n = 0;
  for (const id of Object.keys(state.burns)) {
    if (!state.burns[id].at && state.burns[id].ts < cut) { delete state.burns[id]; n++; }
  }
  if (n) touchState();
  return n;
}

function burnStats() {
  let armed = 0, waiting = 0;
  for (const id of Object.keys(state.burns)) {
    if (state.burns[id].at) armed++; else waiting++;
  }
  return { waiting, armed, burned: Object.keys(state.revoked).length };
}

function dedupeUsers() {
  const byName = new Map();
  const pairs  = [];

  for (const u of state.users) {
    const key = String(u.name || '').trim().toLowerCase();
    if (!key) continue;

    const seen = byName.get(key);
    if (!seen) { byName.set(key, u); continue; }

    const keep = (seen.createdAt || 0) <= (u.createdAt || 0) ? seen : u;
    const drop = (keep === seen) ? u : seen;
    byName.set(key, keep);
    pairs.push([keep, drop]);
  }

  if (!pairs.length) return 0;

  for (const [keep, drop] of pairs) {

    for (const c of state.convs) {
      const i = (c.members || []).indexOf(drop.id);
      if (i < 0) continue;
      if (c.members.indexOf(keep.id) < 0) c.members[i] = keep.id;
      else c.members.splice(i, 1);
    }

    for (const k of Object.keys(state.reads)) {
      const bar = k.indexOf('|');
      if (bar < 0 || k.slice(0, bar) !== drop.id) continue;
      const nk = keep.id + k.slice(bar);
      if ((state.reads[nk] || 0) < state.reads[k]) state.reads[nk] = state.reads[k];
      delete state.reads[k];
    }

    if (state.remarks[drop.id]) {
      state.remarks[keep.id] = Object.assign({}, state.remarks[drop.id], state.remarks[keep.id] || {});
      delete state.remarks[drop.id];
    }
    for (const me of Object.keys(state.remarks)) {
      const r = state.remarks[me];
      if (r && r[drop.id] !== undefined) {
        if (r[keep.id] === undefined) r[keep.id] = r[drop.id];
        delete r[drop.id];
      }
    }

    for (const id of Object.keys(state.burns)) {
      if (state.burns[id] && state.burns[id].from === drop.id) state.burns[id].from = keep.id;
    }

    const idx = state.users.findIndex(u => u.id === drop.id);
    if (idx >= 0) state.users.splice(idx, 1);

    log(`[store] 同名账号去重：「${drop.name}」(${drop.id}) 合并进 ${keep.id}`);
  }

  touchState();
  return pairs.length;
}

let compactTimer = null;
let compacting = false;

function compactMessages() {
  if (compacting) return 0;
  const gone = Object.keys(state.revoked || {});
  if (!gone.length) return 0;
  if (!fs.existsSync(cfg.MSG_FILE)) return 0;

  compacting = true;
  const t0 = Date.now();
  const dead = new Set(gone);
  const tmp = cfg.MSG_FILE + '.compact';

  let kept = 0, dropped = 0;
  try {
    const raw = fs.readFileSync(cfg.MSG_FILE, 'utf8');
    const out = [];

    for (const line of raw.split('\n')) {
      if (!line) continue;
      let m = null;
      try { m = JSON.parse(line); } catch (e) { continue; }
      if (m && m.id && dead.has(m.id)) { dropped++; continue; }
      out.push(line);
      kept++;
    }

    if (dropped) {

      fs.writeFileSync(tmp, out.length ? out.join('\n') + '\n' : '');
      fs.renameSync(tmp, cfg.MSG_FILE);

      closeMsgFile();
      openMsgFile();

      log(`[store] 归档压缩：抹掉 ${dropped} 条已焚毁/已撤回的消息，` +
          `留下 ${kept} 条（${Date.now() - t0}ms）`);
    }
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (e2) {}
    log('[store] 归档压缩失败：' + e.message);
  } finally {
    compacting = false;
  }

  return dropped;
}

function compactOnBoot() {
  const n = Object.keys(state.revoked || {}).length;
  if (!n) return 0;
  try {
    const dropped = compactMessages();
    if (dropped) log(`[store] 启动清理：抹掉 ${dropped} 条已撤回的消息`);
    return dropped;
  } catch (e) { return 0; }
}

function scheduleCompact(delayMs) {
  const want = delayMs || 20000;
  const now = Date.now();

  if (compactTimer) {

    if (compactDueAt && compactDueAt - now <= want) return;
    clearTimeout(compactTimer);
  }

  compactDueAt = now + want;
  compactTimer = setTimeout(() => {
    compactTimer = null;
    compactDueAt = 0;
    try { compactMessages(); } catch (e) {}
  }, want);
  if (compactTimer.unref) compactTimer.unref();
}

let compactDueAt = 0;

const seenCids = new Set();
const cidQueue = [];

function isDuplicate(cid) {
  if (!cid) return false;
  if (seenCids.has(cid)) return true;
  seenCids.add(cid);
  cidQueue.push(cid);
  while (cidQueue.length > cfg.DEDUPE_SIZE) {
    seenCids.delete(cidQueue.shift());
  }
  return false;
}

function addPending(deviceId, name, ip) {
  if (state.pending.some(p => p.deviceId === deviceId)) return;
  state.pending.push({ deviceId, name: name || '一台新设备', ip: ip || '', at: Date.now() });
  touchState();
}

function removePending(deviceId) {
  const i = state.pending.findIndex(p => p.deviceId === deviceId);
  if (i >= 0) { state.pending.splice(i, 1); touchState(); return true; }
  return false;
}

module.exports = {
  ensureDirs, log, recentLogs,
  loadState, saveStateNow, touchState, flushState, getState,

  shortId,
  findUserById, findUserByDevice, findUserByIpName, findUserByName, createUser, updateUser, deleteUser,

  directConvId, findConv, ensureDirectConv, convsOfUser,
  createGroup, updateGroup, addGroupMembers, removeGroupMember,
  setRemark, getRemark,

  getReadTs, setReadTs,

  openMsgFile, closeMsgFile, appendMessage,
  history, since, sinceSeq, lastMessage, unreadCount, stats,
  initToday, msgToday, msgStats, compactMessages, compactOnBoot, scheduleCompact,
  dedupeUsers,

  safeName, newFileId,

  isDuplicate,
  revokeMessage, isRevoked, REVOKE_WINDOW_MS,
  addBurn, armBurns, dueBurns, burnMessage, getBurn, pruneBurns, burnStats, burnWaitingFor,
  addPending, removePending,
};
