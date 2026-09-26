'use strict';

const fs    = require('fs');
const path  = require('path');
const C     = require('./crypto');
const cfg   = require('./config');
const store = require('./store');
const filecache = require('./filecache');
const net   = require('./net');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
  '.woff2':'font/woff2',

  '.aac':  'audio/aac',
  '.m4a':  'audio/mp4',
  '.mp4':  'audio/mp4',
  '.mp3':  'audio/mpeg',
  '.webm': 'audio/webm',
  '.ogg':  'audio/ogg',
  '.oga':  'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav':  'audio/wav',
  '.amr':  'audio/amr',
};

function send(res, code, body, headers) {
  const h = Object.assign({

    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Cache-Control': 'no-store',
  }, headers || {});

  if (Buffer.isBuffer(body)) {
    res.writeHead(code, h);
    res.end(body);
  } else if (typeof body === 'object' && body !== null) {
    h['Content-Type'] = 'application/json; charset=utf-8';
    res.writeHead(code, h);
    res.end(JSON.stringify(body));
  } else {
    h['Content-Type'] = h['Content-Type'] || 'text/plain; charset=utf-8';
    res.writeHead(code, h);
    res.end(String(body == null ? '' : body));
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('TOOBIG'));
        try { req.destroy(); } catch (e) {}
        return;
      }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

function safeJoin(root, rel) {
  const p = path.normalize(path.join(root, rel));
  if (!p.startsWith(path.normalize(root))) return null;
  return p;
}

const uploads = new Map();
const UPLOAD_TTL = 30 * 60 * 1000;

function gcUploads() {
  const now = Date.now();
  for (const [k, v] of uploads) if (now - v.at > UPLOAD_TTL) uploads.delete(k);
}
setInterval(gcUploads, 5 * 60 * 1000).unref();

function createHandler(hub) {

  return async function handle(req, res) {
    const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const local = net.isLocal(ip);
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    if (pathname === '/ping') {
      send(res, 200, { ok: true, ver: 1, name: cfg.SERVER_NAME, port: cfg.PORT });
      return;
    }

    if (pathname === '/' || pathname === '/index.html') {
      const q = url.search || '';
      res.writeHead(302, { 'Location': '/app/' + q, 'Cache-Control': 'no-store' });
      res.end();
      if (local) store.log(`[http] 本机打开根地址 → 跳转到 /app/（和手机同一套界面）`);
      return;
    }

    if (pathname === '/admin' || pathname === '/admin/') {
      if (!local) {

        const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>后台只能在电脑上打开</title>
<style>
  body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
       background:#F2F2F7;font-family:-apple-system,"PingFang SC",sans-serif;color:#000;
       -webkit-font-smoothing:antialiased}
  .c{max-width:340px;padding:32px 26px;background:#fff;border-radius:16px;text-align:center;
     box-shadow:0 8px 28px rgba(0,0,0,.08)}
  .e{font-size:46px;margin-bottom:12px}
  h1{font-size:19px;font-weight:600;margin:0 0 8px}
  p{font-size:14px;line-height:1.7;color:rgba(60,60,67,.6);margin:0 0 18px}
  a{display:inline-block;background:#007AFF;color:#fff;text-decoration:none;
    padding:12px 26px;border-radius:10px;font-size:15px;font-weight:600}
  code{background:#F2F2F7;padding:2px 6px;border-radius:5px;font-size:13px}
  .tip{margin-top:16px;font-size:12px;color:rgba(60,60,67,.45);line-height:1.7}
</style></head><body><div class="c">
  <div class="e">🔒</div>
  <h1>后台只能在电脑上打开</h1>
  <p>这个页面是「上帝视角」，能看到全部聊天记录，<br>所以只允许在电脑本机访问。</p>
  <a href="/app">去聊天页面</a>
  <div class="tip">要在电脑上看监控：<br><code>admin/HomeChat-监控.html</code> 双击打开<br>
        <span style="opacity:.7">（或者双击项目根目录的「打开服务监控.command」）</span></div>
</div></body></html>`;
        send(res, 403, html, { 'Content-Type': 'text/html; charset=utf-8' });
        store.log(`[http] 拒绝非本机访问后台：${ip}`);
        return;
      }
      const p = path.join(cfg.ROOT, 'admin', 'HomeChat-监控.html');
      serveFile(res, p);
      return;
    }

    if (pathname === '/app') {
      res.writeHead(302, { 'Location': '/app/', 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    if (pathname === '/app/') {
      serveFile(res, path.join(cfg.ROOT, 'app', 'index.html'));
      return;
    }
    if (pathname.startsWith('/app/')) {
      const rel = pathname.slice('/app/'.length);
      const p = safeJoin(path.join(cfg.ROOT, 'app'), rel);
      if (!p) { send(res, 400, 'bad path'); return; }
      serveFile(res, p);
      return;
    }

    if (pathname.startsWith('/dl/')) {
      handleDownload(req, res, hub, pathname.slice(4), url, local, ip);
      return;
    }

    if (pathname === '/up' && req.method === 'POST') {
      const user = identifyDevice(hub, req, null);
      if (!user) { send(res, 403, { t: 'err', code: 'NOPAIR', msg: '设备还没入册' }); return; }
      await handleUpload(req, res, hub, user);
      return;
    }

    send(res, 404, { t: 'err', code: 'NOTFOUND', msg: '没有这个地址' });
  };
}

function identifyDevice(hub, req, url) {
  const token = String(
    (url && url.searchParams.get('k')) || req.headers['x-hc-token'] || ''
  ).slice(0, 64);
  if (token) {
    const devId = hub.resolveDlToken(token);
    const u = devId ? store.findUserByDevice(devId) : null;
    if (u) return u;
  }

  const deviceId = String(
    req.headers['x-hc-device'] || (url && url.searchParams.get('d')) || ''
  ).slice(0, 64);
  if (deviceId) return store.findUserByDevice(deviceId) || null;

  return null;
}

function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) { send(res, 404, '找不到文件：' + path.basename(file)); return; }
    const ext = path.extname(file).toLowerCase();
    send(res, 200, buf, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  });
}

function handleDownload(req, res, hub, fileIdRaw, url, local, ip) {
  const fileId = fileIdRaw.split('?')[0];

  if (!local) {
    const user = identifyDevice(hub, req, url);
    if (!user) {
      send(res, 403, { t: 'err', code: 'DENIED', msg: '没有权限（设备没入册）' });
      return;
    }
  }

  const rec = filecache.get(fileId);
  if (!rec || !rec.buf) {
    send(res, 404, {
      t: 'err', code: 'GONE',
      msg: '文件已经不在了 —— 服务端不保存照片和文件，只在内存里中转几分钟',
    });
    return;
  }

  const fname = store.safeName(rec.name || 'file');
  const ext   = path.extname(fname).toLowerCase();
  const mime  = MIME[ext] || rec.mime || 'application/octet-stream';

  const inlineOk = /^(image|audio)\//.test(mime) && mime !== 'image/svg+xml';

  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': rec.buf.length,
    'Content-Disposition': (inlineOk ? 'inline' : 'attachment') +
                           '; filename="' + encodeURIComponent(fname) + '"',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(rec.buf);
}

async function handleUpload(req, res, hub, user) {
  let body;
  try {
    body = await readBody(req, cfg.MAX_BODY);
  } catch (e) {
    send(res, 413, { t: 'err', code: 'TOOBIG', msg: '这一块太大了' });
    return;
  }

  let parsed;
  try { parsed = JSON.parse(body.toString('utf8')); }
  catch (e) { send(res, 400, { t: 'err', code: 'BADJSON', msg: '请求格式不对' }); return; }

  const meta = C.open(hub.kEnc, hub.kMac, parsed.meta);
  if (!meta) { send(res, 403, { t: 'err', code: 'BADKEY', msg: '元数据解不开' }); return; }

  const chunk = C.openRaw(hub.kEnc, hub.kMac, parsed.data);
  if (chunk === null) { send(res, 403, { t: 'err', code: 'BADKEY', msg: '数据块解不开' }); return; }

  const fileId = store.safeName(meta.fileId || '').replace(/[^A-Za-z0-9_]/g, '') || store.newFileId();
  const convId = meta.conv ? String(meta.conv).slice(0, 40) : '';
  const name   = store.safeName(meta.name || 'file');
  const total  = Math.max(1, Number(meta.total) || 1);
  const idx    = Math.max(0, Number(meta.idx) || 0);

  if ((Number(meta.size) || 0) > cfg.MAX_FILE) {
    send(res, 413, { t: 'err', code: 'TOOBIG', msg: '文件太大了' });
    return;
  }

  if (idx === 0) {

    filecache.create(fileId, {
      name, mime: String(meta.mime || ''),
      kind: (meta.kind === 'image' || meta.kind === 'voice') ? meta.kind : 'file',
      from: user.id, conv: convId, peer: String(meta.peer || ''),
    });

    uploads.set(fileId, {
      name, size: Number(meta.size) || 0, mime: String(meta.mime || ''),
      kind: (meta.kind === 'image' || meta.kind === 'voice') ? meta.kind : 'file',
      peer: String(meta.peer || ''), conv: convId, from: user.id,
      total, got: 0, bytes: 0, at: Date.now(),
      w: Number(meta.w) || 0, h: Number(meta.h) || 0,
      dur: Math.max(0, Math.round(Number(meta.dur) || 0)),
      burn: Math.max(0, Math.min(3600, Math.round(Number(meta.burn) || 0))),
    });
  }

  const job = uploads.get(fileId);
  if (!job) {
    send(res, 409, { t: 'err', code: 'NOSESSION', msg: '上传会话丢了，请重发第 0 块' });
    return;
  }
  if (job.from !== user.id) { send(res, 403, { t: 'err', code: 'DENIED', msg: '不是你的上传' }); return; }

  const appended = filecache.append(fileId, Buffer.from(chunk));

  if (!appended) {
    send(res, 409, { t: 'err', code: 'NOSESSION', msg: '中转缓存没了，请重发第 0 块' });
    return;
  }

  if (appended.tooLarge) {
    uploads.delete(fileId);
    const mb = Math.round(cfg.MAX_FILE / 1024 / 1024);
    store.log(`[up] 拒收：超过单文件上限 ${mb}MB（已经收了 ${Math.round(job.bytes / 1024 / 1024)}MB）`);
    send(res, 413, {
      t: 'err', code: 'TOOBIG',
      msg: '文件太大了，最多 ' + mb + 'MB'
    });
    return;
  }

  job.got++;
  job.bytes += chunk.length;
  job.at = Date.now();

  if (idx >= total - 1) {
    uploads.delete(fileId);
    filecache.finish(fileId);

    const extra = job.kind === 'image' && job.w && job.h ? { w: job.w, h: job.h }
                : job.kind === 'voice' ? { dur: job.dur || 0 }
                : null;

    const burnSecs = job.burn || 0;

    if (job.conv) {
      const c = store.findConv(job.conv);
      if (!c || c.members.indexOf(user.id) < 0) {
        send(res, 200, { ok: true, done: true, warn: '会话不存在，文件已存但没发消息' });
        return;
      }
      const r2 = hub.postFileToConv(job.conv, user.id, job.kind, fileId, job.name, job.bytes, job.mime, extra, burnSecs);
      store.log(`[http] ${user.name} 往群「${c.title}」发了${job.kind === 'image' ? '图片' : '文件'} ${job.name}`);
      send(res, 200, { ok: true, done: true, fileId, msgId: r2 ? r2.msg.id : null, bytes: job.bytes });
      return;
    }

    const peer = store.findUserById(job.peer);
    if (!peer) {
      send(res, 200, { ok: true, done: true, warn: '收件人不存在，文件已存但没发消息' });
      return;
    }

    const r = hub.postFileMessage(user.id, peer.id, job.kind, fileId, job.name, job.bytes, job.mime, extra, burnSecs);
    store.log(`[http] ${user.name} 发了${job.kind === 'image' ? '图片' : '文件'} ${job.name} (${(job.bytes / 1024).toFixed(0)}KB)`);
    send(res, 200, { ok: true, done: true, fileId, msgId: r.msg.id, bytes: job.bytes });
    return;
  }

  send(res, 200, { ok: true, idx, got: job.got, total });
}

module.exports = { createHandler };
