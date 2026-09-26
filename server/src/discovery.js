'use strict';

const dgram = require('dgram');
const cfg   = require('./config');
const store = require('./store');

function startUDP(hub, onError) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  sock.on('error', (err) => {
    store.log('[udp] 出错：' + err.message);
    if (onError) onError(err);
    try { sock.close(); } catch (e) {}
  });

  sock.on('listening', () => {
    try { sock.setBroadcast(true); } catch (e) {}
    store.log(`[udp] 设备发现已监听 ${cfg.PORT}/udp`);
  });

  sock.on('message', (buf, rinfo) => {
    if (buf.length > 512) return;
    let m;
    try { m = JSON.parse(buf.toString('utf8')); }
    catch (e) { return; }

    if (!m || m.magic !== cfg.DISCOVER_MAGIC_REQ) return;

    const info = hub.info();
    const reply = Buffer.from(JSON.stringify({
      magic:   cfg.DISCOVER_MAGIC_RES,
      v:       1,
      name:    cfg.SERVER_NAME,
      ip:      info.ip,
      port:    cfg.PORT,
      needPwd: true,
      users:   info.users.length,
    }), 'utf8');

    sock.send(reply, rinfo.port, rinfo.address, () => {});
  });

  sock.bind(cfg.PORT);
  return sock;
}

module.exports = { startUDP };
