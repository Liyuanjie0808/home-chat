'use strict';

const cfg = require('./config');

const items = new Map();
let total = 0;
let dropped = 0;
let served = 0;

function now() { return Date.now(); }

function create(id, meta) {
  drop(id);
  const rec = {
    id,
    name:    String((meta && meta.name) || 'file'),
    mime:    String((meta && meta.mime) || ''),
    kind:    (meta && meta.kind) || 'file',
    from:    (meta && meta.from) || '',
    conv:    (meta && meta.conv) || '',
    peer:    (meta && meta.peer) || '',
    bytes:   0,
    chunks:  [],
    buf:     null,
    done:    false,
    at:      now(),
  };
  items.set(id, rec);
  return rec;
}

function append(id, buf) {
  const rec = items.get(id);
  if (!rec) return null;

  if (rec.bytes + buf.length > cfg.MAX_FILE) {
    drop(id);
    return { tooLarge: true, id, why: 'file' };
  }

  rec.chunks.push(buf);
  rec.bytes += buf.length;
  total += buf.length;
  rec.at = now();

  if (total > cfg.FILE_RAM_MAX) enforce(true);

  return rec;
}

function finish(id) {
  const rec = items.get(id);
  if (!rec) return null;
  rec.buf = Buffer.concat(rec.chunks, rec.bytes);
  rec.chunks = null;
  rec.done = true;
  rec.at = now();
  enforce();
  return rec;
}

function get(id) {
  const rec = items.get(id);
  if (!rec) return null;
  if (!rec.done) return null;
  if (now() - rec.at > cfg.FILE_TTL_MS) { drop(id); return null; }
  rec.at = now();
  served++;
  return rec;
}

function ttlLeft(id) {
  const rec = items.get(id);
  if (!rec) return 0;
  return Math.max(0, Math.ceil((rec.at + cfg.FILE_TTL_MS - now()) / 1000));
}

function drop(id) {
  const rec = items.get(id);
  if (!rec) return false;
  total -= rec.bytes;
  if (total < 0) total = 0;
  items.delete(id);
  return true;
}

function enforce(keepNewest) {
  if (total <= cfg.FILE_RAM_MAX) return 0;
  let n = 0;
  const sorted = [...items.values()].sort((a, b) => a.at - b.at);
  for (const rec of sorted) {
    if (total <= cfg.FILE_RAM_MAX) break;

    if (keepNewest && rec === sorted[sorted.length - 1]) continue;
    drop(rec.id);
    dropped++; n++;
  }
  return n;
}

function sweep() {
  const t = now();
  let n = 0;
  for (const [id, rec] of [...items]) {
    if (t - rec.at > cfg.FILE_TTL_MS) { drop(id); dropped++; n++; }
  }
  n += enforce();
  return n;
}

function clear() {
  const n = items.size;
  items.clear();
  total = 0;
  return n;
}

function stats() {
  return {
    count:     items.size,
    bytes:     total,
    dropped,
    served,
    ttlMs:     cfg.FILE_TTL_MS,
    maxBytes:  cfg.FILE_RAM_MAX,
    diskBytes: 0,
  };
}

module.exports = {
  create, append, finish, get, drop, sweep, clear, stats, ttlLeft,
};
