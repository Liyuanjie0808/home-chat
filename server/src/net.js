'use strict';

const os = require('os');

function lanAddresses() {
  const ifaces = os.networkInterfaces();
  const out = [];

  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.family !== 'IPv4' && info.family !== 4) continue;
      if (info.internal) continue;

      const ip = info.address;
      let score = 0;

      if (/^192\.168\./.test(ip)) score += 100;

      else if (/^10\./.test(ip)) score += 80;

      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) score += 60;

      if (/^(vboxnet|vmnet|docker|br-|veth|utun|llw|awdl|bridge)/i.test(name)) score -= 200;

      if (/^(en0|en1|eth0|wlan0|Wi-Fi)/i.test(name)) score += 30;

      out.push({ ip, iface: name, score });
    }
  }

  out.sort((a, b) => b.score - a.score);
  return out;
}

function primaryIP() {
  const list = lanAddresses();
  return list.length ? list[0].ip : '127.0.0.1';
}

function isLocal(addr) {
  if (!addr) return false;
  const a = String(addr).replace(/^::ffff:/, '');
  return a === '127.0.0.1' || a === '::1' || a === 'localhost';
}

module.exports = { lanAddresses, primaryIP, isLocal };
