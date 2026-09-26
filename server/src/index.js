'use strict';

const fs   = require('fs');
const http = require('http');
const C    = require('./crypto');
const cfg  = require('./config');
const store = require('./store');
const filecache = require('./filecache');
const net  = require('./net');
const { Hub }        = require('./hub');
const { createHandler } = require('./http');
const { startUDP }   = require('./discovery');

const C_ = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m', gray: '\x1b[90m',
};

function die(msg, hint) {
  console.error('\n' + C_.red + C_.bold + '  ✘ ' + msg + C_.reset);
  if (hint) console.error(C_.gray + '    ' + hint + C_.reset);
  console.error('');
  process.exit(1);
}

function banner(ip, keyIsNew) {
  const W = 62;
  const line = (s) => C_.gray + '  │ ' + C_.reset + s;
  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0)));

  console.log('');
  console.log(C_.cyan + C_.bold + '  ╭' + '─'.repeat(W) + '╮' + C_.reset);
  console.log(line(C_.bold + '🏠  Home Chat 服务端已启动' + C_.reset +
                   C_.yellow + '  v' + cfg.VERSION + C_.reset +
                   C_.gray + '  （改代码后必须重启才会生效）' + C_.reset));
  console.log(C_.gray + '  ├' + '─'.repeat(W) + '┤' + C_.reset);
  console.log(line(C_.dim + '局域网地址' + C_.reset + '   ' + C_.bold + C_.green + `http://${ip}:${cfg.PORT}` + C_.reset));
  console.log(line(C_.bold + C_.green + '★ 手机浏览器' + C_.reset + ' ' + C_.bold + C_.green + `http://${ip}:${cfg.PORT}/app` + C_.reset));
  console.log(line(C_.gray + '  ↑ 手机连上同一个 WiFi，用浏览器打开这个，就能聊天' + C_.reset));
  console.log(line(C_.gray + '    不用装 App、不用数据线、不用 HBuilderX。' + C_.reset));
  console.log(line(C_.gray + '    打开后点「添加到主屏幕」，桌面上就有图标了。' + C_.reset));
  console.log(C_.gray + '  ├' + '─'.repeat(W) + '┤' + C_.reset);
  console.log(line(C_.dim + '手机填这个' + C_.reset + '   ' + C_.bold + `${ip}:${cfg.PORT}` + C_.reset + C_.gray + '（只有装成 App 才需要）' + C_.reset));
  console.log(line(C_.dim + '电脑聊天端' + C_.reset + '   ' + C_.blue + `http://127.0.0.1:${cfg.PORT}` + C_.reset));
  console.log(line(C_.dim + '上帝视角' + C_.reset + '     ' + C_.blue + 'admin/HomeChat-监控.html' + C_.reset + C_.gray + '（双击打开）' + C_.reset));
  console.log(line(C_.dim + '密    码' + C_.reset + '     ' + C_.yellow + cfg.PASSWORD + C_.reset + C_.gray + '  （改 config.js）' + C_.reset));
  console.log(line(C_.dim + '本机名字' + C_.reset + '     ' + C_.cyan + (cfg.USER_NAME || cfg.SERVER_NAME) + C_.reset + C_.gray + '  （改 config.js 的 USER_NAME）' + C_.reset));
  console.log(C_.gray + '  ├' + '─'.repeat(W) + '┤' + C_.reset);

  if (keyIsNew) {
    console.log(line(C_.green + '✔ 首次启动，密钥已生成并保存' + C_.reset));
  } else {
    console.log(line(C_.dim + '✔ 密钥已从 data/master.key 载入（秒开）' + C_.reset));
  }

  const others = net.lanAddresses().slice(1, 3);
  if (others.length) {
    console.log(line(C_.gray + '其他网卡：' + others.map(o => `${o.ip} (${o.iface})`).join('  ') + C_.reset));
  }
  console.log(line(C_.gray + '手机和电脑必须在同一个 WiFi 下' + C_.reset));
  console.log(line(C_.gray + '连不上？先去路由器关掉「AP 隔离 / 客户端隔离」' + C_.reset));
  console.log(C_.gray + '  ├' + '─'.repeat(W) + '┤' + C_.reset);
  console.log(line(C_.gray + '按 Control + C 停止服务，或到后台端点【停止服务】' + C_.reset));
  console.log(C_.cyan + C_.bold + '  ╰' + '─'.repeat(W) + '╯' + C_.reset);
  console.log('');
}

function loadOrCreateKey() {
  try {
    if (fs.existsSync(cfg.KEY_FILE)) {
      const k = fs.readFileSync(cfg.KEY_FILE);
      if (k.length === 32) return { key: k, isNew: false };
      store.log(C_.yellow + '[key] master.key 长度不对，重新生成' + C_.reset);
    }
  } catch (e) {
    store.log('[key] 读 master.key 失败：' + e.message);
  }

  const t0 = Date.now();
  const key = C.deriveMaster(cfg.PASSWORD, cfg.PBKDF2_ITERATIONS);
  fs.writeFileSync(cfg.KEY_FILE, key, { mode: 0o600 });
  try { fs.chmodSync(cfg.KEY_FILE, 0o600); } catch (e) {}
  store.log(`[key] 密钥已生成，耗时 ${Date.now() - t0}ms`);
  return { key, isNew: true };
}

function startNetWatchdog(hub) {
  if (!cfg.AUTO_STOP_NO_NETWORK) {
    console.log(C_.gray + '  ○ 网络看门狗：已关闭（config.js 里 AUTO_STOP_NO_NETWORK）' + C_.reset);
    return null;
  }

  let misses = 0;
  let warned = false;

  const timer = setInterval(() => {
    if (hub.shuttingDown) return;

    const list = net.lanAddresses();

    if (list.length > 0) {
      if (warned) {
        console.log('');
        console.log(C_.green + `  ✔ 网络恢复了 (${list[0].ip})，服务继续。` + C_.reset);
        console.log('');
        warned = false;
      }
      misses = 0;
      return;
    }

    misses++;

    if (misses === 1) {
      warned = true;
      console.log('');
      console.log(C_.yellow + '  ⚠ 检测不到局域网了（WiFi 断了？网线拔了？）' + C_.reset);
      console.log(C_.gray + `    如果 ${cfg.NET_GRACE} 次检查（约 ${Math.round(cfg.NET_CHECK_INTERVAL * cfg.NET_GRACE / 1000)} 秒）后还没恢复，就自动停服。` + C_.reset);
    } else if (misses < cfg.NET_GRACE) {
      console.log(C_.gray + `    …还是没有网络（${misses}/${cfg.NET_GRACE}）` + C_.reset);
    }

    if (misses >= cfg.NET_GRACE) {
      console.log('');
      console.log(C_.yellow + '  ⏹ 没有网络，自动停止服务，端口已释放。' + C_.reset);
      console.log(C_.gray + '    等有网了，重新双击「启动HomeChat.command」就行。' + C_.reset);
      console.log(C_.gray + '    （不想要这个行为：把 config.js 里 AUTO_STOP_NO_NETWORK 改成 false）' + C_.reset);
      console.log('');
      clearInterval(timer);
      hub.shutdown(0);
    }
  }, cfg.NET_CHECK_INTERVAL);

  if (timer.unref) timer.unref();
  console.log(C_.green + '  ✔ 网络看门狗已开启' + C_.reset +
              C_.gray + `（每 ${cfg.NET_CHECK_INTERVAL / 1000} 秒查一次，断网 ${Math.round(cfg.NET_CHECK_INTERVAL * cfg.NET_GRACE / 1000)} 秒后自动停服）` + C_.reset);
  return timer;
}

function startTerminalApproval(hub) {
  if (!process.stdin.isTTY && !process.env.HC_FORCE_TTY) {
    console.log(C_.gray + '  ○ 终端批准：当前不是交互式终端，新设备请在后台页面点【同意】' + C_.reset);
    return;
  }

  const queue = [];
  let current = null;
  let lineBuf = '';

  function showPrompt() {
    console.log('');
    console.log(C_.yellow + C_.bold + '  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓' + C_.reset);
    console.log(C_.yellow + C_.bold + '  ┃  🔔  有新设备想加入                                ┃' + C_.reset);
    console.log(C_.yellow + C_.bold + '  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛' + C_.reset);
    console.log('');
    console.log('      设备名字：  ' + C_.bold + current.name + C_.reset);
    console.log('      来自地址：  ' + C_.gray + (current.ip || '?') + C_.reset);
    console.log('');
    console.log('      ' + C_.green + C_.bold + '允许就按 Y 再回车' + C_.reset +
                C_.gray + '      ' + C_.red + '拒绝就按 N 再回车' + C_.reset);
    console.log('');
    process.stdout.write('      ' + C_.cyan + '你的选择： ' + C_.reset);
  }

  function handleLine(raw) {
    const a = raw.trim().toLowerCase();

    if (!current) return;

    if (a === 'y' || a === 'yes' || a === '是' || a === '1') {
      const d = current;
      current = null;
      const u = hub.approveDevice(d.deviceId, d.name);
      console.log('');
      console.log('      ' + C_.green + C_.bold + '✔ 已放行「' + (u ? u.name : d.name) + '」' +
                  C_.reset + C_.gray + '  手机上应该马上就进去了' + C_.reset);
      console.log('');
      if (queue.length) { current = queue.shift(); showPrompt(); }
      else { console.log(C_.gray + '  ────────────────────────────────────────────' + C_.reset); console.log(''); }
      return;
    }

    if (a === 'n' || a === 'no' || a === '否' || a === '0') {
      const d = current;
      current = null;
      hub.rejectDevice(d.deviceId);
      console.log('');
      console.log('      ' + C_.red + '✘ 已拒绝「' + d.name + '」' + C_.reset);
      console.log('');
      if (queue.length) { current = queue.shift(); showPrompt(); }
      else { console.log(C_.gray + '  ────────────────────────────────────────────' + C_.reset); console.log(''); }
      return;
    }

    if (a === '') {
      process.stdout.write('      ' + C_.gray + '（直接回车不算，请按 Y 或 N）你的选择： ' + C_.reset);
      return;
    }

    process.stdout.write('      ' + C_.gray + '（只认 Y 或 N，别的都不算）你的选择： ' + C_.reset);
  }

  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  process.stdin.on('data', (chunk) => {
    lineBuf += String(chunk);
    let i;
    while ((i = lineBuf.indexOf('\n')) >= 0) {
      const line = lineBuf.slice(0, i).replace(/\r$/, '');
      lineBuf = lineBuf.slice(i + 1);
      handleLine(line);
    }
  });

  hub.onPending = function (d) {
    queue.push(d);
    if (!current) { current = queue.shift(); showPrompt(); }
    else {
      console.log(C_.gray + `      （还有 ${queue.length} 台在排队等确认）` + C_.reset);
    }
  };

  console.log(C_.green + '  ✔ 终端批准已开启' + C_.reset +
              C_.gray + '（新设备接入时，在这个窗口按 Y 或 N）' + C_.reset);
}

function startBurnTimer(hub) {
  const t = setInterval(() => {
    try {
      const n = hub.checkBurns();
      if (n > 0) {  }
    } catch (e) {
      console.error(C_.red + '  ✘ 焚毁扫描出错：' + e.message + C_.reset);
    }
  }, 1000);
  if (t.unref) t.unref();
  hub.timers.push(t);

  const t2 = setInterval(() => {
    try { store.pruneBurns(); } catch (e) {}
  }, 6 * 3600 * 1000);
  if (t2.unref) t2.unref();
  hub.timers.push(t2);

  console.log(C_.green + '  ✔ 阅后即焚：读完才开始倒计时（服务端每秒扫一次）' + C_.reset);
}

function startTerminalMonitor(hub) {
  let lastLine = '';

  const fmtUp = (sec) => {
    const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600);
    const m = Math.floor(sec % 3600 / 60);
    if (d) return d + ' 天 ' + h + ' 小时';
    if (h) return h + ' 小时 ' + m + ' 分';
    return m + ' 分';
  };

  const tick = () => {
    try {
      const st = hub.adminStats();
      const parts = [];
      parts.push('今日 ' + C_.bold + st.msgToday + C_.reset + C_.gray + ' 条');
      parts.push('累计 ' + st.msgTotal + ' 条');
      parts.push('会话 ' + st.convs + ' 个');
      parts.push('在线 ' + st.onlineUsers + ' 人' +
                 (st.adminOnline > 0 ? '（含本机监控）' : ''));
      if (st.pendingCount > 0) {
        parts.push(C_.yellow + '待批准 ' + st.pendingCount + ' 个' + C_.reset + C_.gray);
      }
      parts.push('已运行 ' + fmtUp(st.uptime));
      parts.push('焚毁中 ' + st.burnArmed);

      const line = C_.gray + '  📊 ' + parts.join(' · ') + C_.reset;

      const plain = line.replace(/\x1b\[[0-9;]*m/g, '');
      if (plain !== lastLine) {
        console.log(line);
        lastLine = plain;
      }

      const who = (st.msgByUser || [])
        .filter(u => u.today > 0)
        .map(u => u.name + ' ' + u.today)
        .join(' · ');
      if (who) console.log(C_.gray + '     ' + who + C_.reset);
    } catch (e) {}
  };

  const t = setInterval(tick, 30000);
  if (t.unref) t.unref();
  hub.timers.push(t);

  console.log(C_.green + '  ✔ 终端监控：每 30 秒刷一行消息统计（只看数量，看不到内容）' + C_.reset);
}

function startSampler(hub) {
  hub.takeSample();
  const t = setInterval(() => {
    try { hub.takeSample(); } catch (e) {}
  }, 5000);
  if (t.unref) t.unref();
  hub.timers.push(t);
}

function startFileSweep() {
  const mins = Math.round(cfg.FILE_TTL_MS / 60000);

  const run = () => {
    try {
      const n = filecache.sweep();
      if (n > 0) store.log(`[clean] 丢掉 ${n} 个过期的中转文件（内存里那些）`);
    } catch (e) {}
  };

  const t = setInterval(run, cfg.FILE_SWEEP_INTERVAL);
  if (t.unref) t.unref();

  console.log(C_.green + '  ✔ 照片/文件/语音只在内存里中转，不写盘' + C_.reset);
  console.log(C_.gray + `    最多留 ${mins} 分钟或 ${Math.round(cfg.FILE_RAM_MAX / 1024 / 1024)}MB，` +
              `到点自动丢` + C_.reset);
  console.log(C_.gray + '    代价：对方当时不在线就收不到了（消息还在，点开说"文件已不在"）' + C_.reset);
}

function main() {
  console.log('');
  console.log(C_.gray + '  Home Chat 正在启动…' + C_.reset);

  const st = C.selfTest();
  if (!st.ok) {
    console.error('');
    for (const f of st.fails) console.error(C_.red + '  ✘ ' + f + C_.reset);
    die('加密层自检没通过 —— 为了不传错数据，服务端拒绝启动。',
        '把上面几行红字发给我。');
  }
  console.log(C_.green + '  ✔ 加密层自检通过' + C_.reset);

  let WebSocketServer;
  try {
    WebSocketServer = require('ws').WebSocketServer;
  } catch (e) {
    die('缺少依赖 ws', '在这个目录下运行：  npm install');
  }

  store.ensureDirs();
  store.loadState();
  store.openMsgFile();
  store.initToday();

  store.compactOnBoot();

  const { key: masterKey, isNew } = loadOrCreateKey();
  const keys = Object.assign({ masterKey, password: cfg.PASSWORD }, C.subkeys(masterKey));

  if (cfg.ADMIN_PASSWORD) {
    keys.adminKey = C.deriveAdmin(cfg.ADMIN_PASSWORD, cfg.PBKDF2_ITERATIONS);
  } else {
    keys.adminKey = masterKey;
  }

  const hub = new Hub(keys);
  hub.registerServers({});

  {
    let mac = store.findUserByDevice('mac-local');
    if (!mac) {
      const macName = cfg.USER_NAME || (cfg.SERVER_NAME || '').slice(0, 16) || '我的 Mac';
      mac = store.createUser({ name: macName, deviceId: 'mac-local', role: 'admin' });
      store.log(`[srv] 已把本机登记为成员「${mac.name}」`);
    } else if (cfg.USER_NAME && mac.name !== cfg.USER_NAME) {

      store.updateUser(mac.id, { name: cfg.USER_NAME });
      store.log(`[srv] 本机名字已按 config.js 改成「${cfg.USER_NAME}」`);
      mac = store.findUserById(mac.id);
    }
    hub.macUserId = mac.id;
  }

  {
    const merged = store.dedupeUsers();
    if (merged > 0) {
      console.log(C_.yellow + '  ⚠ 发现 ' + merged + ' 组同名账号，已自动合并' + C_.reset);
    }
  }

  const server = http.createServer(createHandler(hub));

  server.on('clientError', (err, socket) => {
    try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (e) {}
  });

  server.on('error', (err) => {
    if (err.code !== 'EADDRINUSE') {
      die('HTTP 服务启动失败：' + err.message);
      return;
    }

    if (process.env.HC_PORT) {
      die(`端口 ${cfg.PORT} 被占用了`,
          `你指定了 HC_PORT=${process.env.HC_PORT}，但它已经在用了。\n    换个号：HC_PORT=8790 再跑一次。`);
      return;
    }

    if (portTry < 5) {
      portTry++;
      const next = cfg.PORT + portTry;
      console.log(C_.yellow + `  ! 端口 ${cfg.PORT} 被占用了（可能另一个副本在跑）` + C_.reset);
      console.log(C_.gray + `    这次改用 ${next}` + C_.reset);
      console.log('');
      cfg.PORT = next;
      try { server.listen(next, '0.0.0.0'); } catch (e) {}
      return;
    }

    die('8787 到 8792 全被占用了',
        `可能有好几个副本同时在跑。\n    先双击「停止HomeChat.command」把不用的停掉，\n    或者用 HC_PORT=9000 指定一个别的端口。`);
  });

  let portTry = 0;

  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  server.on('upgrade', (req, socket, head) => {
    let pathname = '/';
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch (e) {}

    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => hub.handleDevice(ws, req));
    } else if (pathname === '/admin') {

      wss.handleUpgrade(req, socket, head, (ws) => hub.handleAdmin(ws, req));
    } else {
      try { socket.destroy(); } catch (e) {}
    }
  });

  server.listen(cfg.PORT, cfg.HOST, () => {
    const ip = net.primaryIP();

    const udp = startUDP(hub, () => {});
    hub.registerServers({ http: server, wss, udp });

    hub.startTimers();
    banner(ip, isNew);

    startNetWatchdog(hub);

    startTerminalApproval(hub);
    startFileSweep();
    startBurnTimer(hub);
    startTerminalMonitor(hub);
    startSampler(hub);

    if (!isNew && keys.masterKey && !keys.masterKey.equals(
          C.deriveMaster(cfg.PASSWORD, cfg.PBKDF2_ITERATIONS))) {
      console.log('');
      console.log(C_.yellow + C_.bold + '  ⚠ 配置里的密码，跟 data/master.key 对不上' + C_.reset);
      console.log('');
      console.log(C_.gray + '    意思是：' + C_.reset);
      console.log(C_.gray + '      · 服务端真正认的是 data/master.key' + C_.reset);
      console.log(C_.gray + '      · 那份 key 是用**当初第一次启动时那个密码**算出来的' + C_.reset);
      console.log(C_.gray + '      · 所以现在能登录的，还是那个老密码' + C_.reset);
      console.log('');
      console.log(C_.bold + '    想换成新密码：双击项目根目录的「改密码.command」' + C_.reset);
      console.log(C_.gray + '    （它会先把已有聊天记录重新加密，历史一条都不会丢）' + C_.reset);
      console.log('');
    } else if (cfg.IS_DEFAULT_PASSWORD) {
      console.log('');
      console.log(C_.red + C_.bold + '  ╔══════════════════════════════════════════════════════╗' + C_.reset);
      console.log(C_.red + C_.bold + '  ║  ⚠  你还没设过自己的密码                              ║' + C_.reset);
      console.log(C_.red + C_.bold + '  ╚══════════════════════════════════════════════════════╝' + C_.reset);
      console.log(C_.yellow + '  现在用的是源码里那个默认密码 ' + C_.bold + cfg.DEFAULT_PASSWORD + C_.reset +
                  C_.yellow + '，' + C_.reset);
      console.log(C_.yellow + '  这个项目是开源的 —— 等于谁都知道你家密码。' + C_.reset);
      console.log('');
      console.log(C_.bold + '  怎么改：双击项目根目录的「改密码.command」' + C_.reset);
      console.log(C_.gray + '  （它会顺手把已有聊天记录重新加密，历史不会丢）' + C_.reset);
      console.log('');
    }

    if (!cfg.ADMIN_PASSWORD) {
      console.log('');
      console.log(C_.yellow + '  ⚠ 提醒：聊天密码和后台密码现在是同一个。' + C_.reset);
      console.log(C_.gray + '    意思是：知道聊天密码的人，只要能碰到这台电脑，' + C_.reset);
      console.log(C_.gray + '    就能打开后台看到全部聊天记录。' + C_.reset);
      console.log(C_.gray + '    想分开：改 server/src/config.js 里的 ADMIN_PASSWORD，' + C_.reset);
      console.log(C_.gray + '    或者启动前设个环境变量 HC_ADMIN_PASSWORD=你的密码' + C_.reset);
      console.log('');
    } else if (cfg.ADMIN_PASSWORD === cfg.PASSWORD) {
      console.log('');
      console.log(C_.yellow + '  ⚠ 提醒：ADMIN_PASSWORD 和 PASSWORD 填成一样的了，等于没分开。' + C_.reset);
      console.log('');
    }

    store.log(`[srv] 就绪  ${ip}:${cfg.PORT}   pid=${process.pid}`);
  });

  const bye = () => hub.shutdown(0);
  process.on('SIGINT',  bye);
  process.on('SIGTERM', bye);
  process.on('SIGHUP',  bye);

  process.on('uncaughtException', (err) => {
    console.error(C_.red + '\n  ✘ 未捕获异常：' + err.stack + C_.reset);
    try { store.log('[srv] 未捕获异常：' + err.message); } catch (e) {}
  });
  process.on('unhandledRejection', (err) => {
    console.error(C_.red + '\n  ✘ 未处理的 Promise 拒绝：' + err + C_.reset);
  });
}

main();
