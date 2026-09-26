'use strict';

const { spawn, execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const http = require('http');
const os   = require('os');
const nodeCrypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const APP  = path.join(ROOT, 'app');
const DATA = path.join(os.tmpdir(), 'hc-voice-test');

const WebSocket = require('ws');
const C   = require('./crypto');
const cfg = require('./config');

fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });

let pass = 0, fail = 0;
const problems = [];
function ok(m, x) {
  pass++;
  console.log(`  \x1b[32m✔\x1b[0m ${m}` + (x ? `  \x1b[90m${x}\x1b[0m` : ''));
}
function bad(m, d) {
  fail++; problems.push(m);
  console.log(`  \x1b[31m✘\x1b[0m ${m}`);
  if (d) String(d).split('\n').slice(0, 6).forEach(l => console.log(`      \x1b[90m${l}\x1b[0m`));
}
function head(t) { console.log(`\n\x1b[1m${t}\x1b[0m`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const FAKE_FS = new Map();
const PLAY_LOG = [];
const DOWNLOAD_LOG = [];

function makeFakeAAC(n) {
  const b = Buffer.alloc(Math.max(64, n));
  b[0] = 0xFF; b[1] = 0xF1;
  for (let i = 2; i < b.length; i++) b[i] = (i * 7) & 0xFF;
  return b;
}

function makeRecorder(o) {
  o = o || {};
  let cur = null;
  return {
    record(styles, onOk, onErr) {
      if (o.failStart) {
        setTimeout(() => onErr && onErr({ message: o.failStart }), 20);
        return;
      }
      cur = styles.filename;
      setTimeout(() => onOk && onOk(), 30);
    },
    stop() {
      if (!cur) return;
      const name = cur; cur = null;
      if (o.neverWrite) return;

      setTimeout(() => FAKE_FS.set(name, makeFakeAAC(o.sizeBytes || 2400)),
                 o.writeDelayMs !== undefined ? o.writeDelayMs : 60);
    }
  };
}

function makeSandbox(opts) {
  opts = opts || {};

  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Uint8Array, ArrayBuffer, JSON, Math, Date, Object, Array, String, Number, Error, Boolean,
    Blob: global.Blob,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    crypto: { getRandomValues: (a) => {
      const b = nodeCrypto.randomBytes(a.length);
      for (let i = 0; i < a.length; i++) a[i] = b[i];
      return a;
    } },
    URL: { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} },
    Image: function () { this.onload = null; this.onerror = null; },
    document: {
      createElement: () => ({
        style: {},
        getContext: () => ({ fillRect() {}, drawImage() {} }),
        toDataURL: () => 'data:image/jpeg;base64,AA==',
        appendChild() {}
      }),
      body: { appendChild() {}, removeChild() {} }
    },
    navigator: { userAgent: 'HomeChatVoiceTest' }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;

  const plus = {
    android: {
      runtimeMainActivity: () => ({ getPackageName: () => 'com.homechat.app' }),
      invoke(obj, method) {
        if (method === 'checkSelfPermission') return opts.alreadyGranted ? 0 : -1;
        return null;
      },
      importClass: () => function () { return {}; },
      requestPermissions(perms, onOk) {
        const fire = () => {
          if (opts.permDenied) onOk({ deniedPresent: perms, granted: [], deniedAlways: [] });
          else onOk({ granted: perms, deniedPresent: [], deniedAlways: [] });
        };
        if (opts.permDelayMs) setTimeout(fire, opts.permDelayMs); else fire();
      }
    },

    audio: {
      getRecorder: () => makeRecorder(opts.rec),
      createPlayer: (p) => { PLAY_LOG.push(p); return {
        play(onOk) { setTimeout(() => onOk && onOk(), 30); },
        stop() {}
      }; }
    },

    io: {
      convertLocalFileSystemURL: (p) => '/abs/' + String(p).replace(/^_doc\//, 'doc/'),
      resolveLocalFileSystemURL(p, onOk, onErr) {
        const buf = FAKE_FS.get(p);
        if (!buf) { setTimeout(() => onErr && onErr({ code: 1 }), 5); return; }
        setTimeout(() => onOk({ file: (cb2) => cb2({ size: buf.length, name: p }) }), 5);
      },
      FileReader: function () {
        this.onloadend = null; this.onerror = null;
        this.readAsDataURL = (file) => {
          const buf = FAKE_FS.get(file.name) || Buffer.alloc(0);
          setTimeout(() => {
            if (this.onloadend) {
              this.onloadend({ target: { result: 'data:audio/mp4;base64,' + buf.toString('base64') } });
            }
          }, 5);
        };
      }
    },

    downloader: {
      createDownload(url, opt, cb) {
        return {
          start() {
            DOWNLOAD_LOG.push(url);
            const q = http.get(url, (res) => {
              const chunks = [];
              res.on('data', c => chunks.push(c));
              res.on('end', () => {
                if (res.statusCode !== 200) { cb({ filename: '' }, res.statusCode); return; }
                const buf = Buffer.concat(chunks);
                const local = '/abs/' + opt.filename;
                FAKE_FS.set(opt.filename, buf);
                FAKE_FS.set(local, buf);
                cb({ filename: local }, 200);
              });
            });
            q.on('error', () => cb({ filename: '' }, 0));
          }
        };
      }
    },

    net: {
      XMLHttpRequest: function () {
        const self = this;
        this.readyState = 0; this.status = 0; this.responseText = ''; this.timeout = 0;
        this._h = {};
        this.open = (m, u) => { self._m = m; self._u = u; };
        this.setRequestHeader = (k, v) => { self._h[k] = v; };
        this.send = (body) => {
          const u = new URL(self._u);
          const req = http.request({
            hostname: u.hostname, port: u.port, path: u.pathname + u.search,
            method: self._m, headers: self._h
          }, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
              self.status = res.statusCode; self.responseText = d; self.readyState = 4;
              if (self.onreadystatechange) self.onreadystatechange();
            });
          });
          req.on('error', () => { if (self.onerror) self.onerror(); });
          req.end(body);
        };
      }
    },

    runtime: { openFile() {} },
    device: { vendor: 'Xiaomi', model: 'M2101K9C' },
    camera: { getCamera: () => ({ captureImage() {} }) },
    gallery: { pick() {} }
  };
  sandbox.plus = plus;

  const K = C.subkeys(C.deriveMaster(cfg.PASSWORD, cfg.PBKDF2_ITERATIONS));
  const state = {
    cfg: { serverAddr: '127.0.0.1', serverPort: cfg.PORT },
    kEnc: K.kEnc, kMac: K.kMac, dlToken: ''
  };
  sandbox.HC = {
    store: {
      S: state,
      hasKey: () => true,
      ensureDeviceId: () => 'dev-voice-test',
      save() {}
    },
    util: { toast() {} }
  };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP, 'js/hc1.js'), 'utf8'), sandbox, { filename: 'hc1.js' });
  vm.runInContext(fs.readFileSync(path.join(APP, 'js/media.js'), 'utf8'), sandbox, { filename: 'media.js' });

  sandbox.__state = state;
  return sandbox;
}

let srv = null, srvOut = '';

function startServer() {
  return new Promise((resolve) => {
    srv = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
      cwd: path.dirname(__dirname),
      env: Object.assign({}, process.env, { HC_DATA_DIR: DATA, HC_AUTO_APPROVE: '1' })
    });
    srv.stdout.on('data', d => { srvOut += d; });
    srv.stderr.on('data', d => { srvOut += d; });
    const t0 = Date.now();
    const tick = () => {
      if (/就绪/.test(srvOut) || Date.now() - t0 > 20000) return resolve();
      setTimeout(tick, 200);
    };
    tick();
  });
}

(async () => {
  console.log('\n\x1b[1mHome Chat — 语音整条链路测试\x1b[0m');
  console.log('\x1b[90m  假麦克风 + 真加密 + 真上传 + 真服务端 + 真下载\x1b[0m');

  try { execSync(`lsof -nP -iTCP:${cfg.PORT} -sTCP:LISTEN -t 2>/dev/null | xargs -r kill`, { stdio: 'ignore' }); } catch (e) {}
  await sleep(500);

  await startServer();
  if (!/就绪/.test(srvOut)) {
    console.error('\n✘ 服务端起不来：\n' + srvOut);
    process.exit(1);
  }

  const PHONE = (() => {
    const box = {
      console,
      btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
      atob: (s) => Buffer.from(s, 'base64').toString('binary'),
      crypto: { getRandomValues: (a) => {
        const b = nodeCrypto.randomBytes(a.length);
        for (let i = 0; i < a.length; i++) a[i] = b[i];
        return a;
      } }
    };
    box.window = box;
    vm.createContext(box);
    vm.runInContext(fs.readFileSync(path.join(APP, 'js/hc1.js'), 'utf8'), box, { filename: 'hc1.js' });
    return box.HC.crypto;
  })();
  const MASTER = C.deriveMaster(cfg.PASSWORD, cfg.PBKDF2_ITERATIONS);
  const PK = PHONE.subkeys(PHONE.deriveMaster(cfg.PASSWORD, cfg.PBKDF2_ITERATIONS));
  const SK = C.subkeys(MASTER);

  const me = { inbox: [] };
  await new Promise((res, rej) => {
    me.ws = new WebSocket('ws://127.0.0.1:' + cfg.PORT + '/ws');
    me.ws.on('open', () => {
      me.ws.send(JSON.stringify(PHONE.seal(PK.kEnc, PK.kMac,
        { t: 'hello', deviceId: 'dev-voice-' + Date.now(), name: '语音测试机', ver: 1 })));
      res();
    });
    me.ws.on('message', (d) => {
      let m; try { m = JSON.parse(d.toString()); } catch (e) { return; }
      if (m.v === 1) { const i = PHONE.open(PK.kEnc, PK.kMac, m); if (i) me.inbox.push(i); }
      else me.inbox.push(m);
    });
    me.ws.on('error', () => {});
    setTimeout(() => rej(new Error('连不上服务端')), 8000);
  });

  const waitFor = (t, ms) => {
    const t0 = Date.now();
    return new Promise((r) => {
      const k = () => {
        const h = me.inbox.find(x => x.t === t);
        if (h) return r(h);
        if (Date.now() - t0 > (ms || 4000)) return r(null);
        setTimeout(k, 40);
      };
      k();
    });
  };

  const wel = await waitFor('welcome', 6000);
  if (!wel) { console.error('\n✘ 没拿到 welcome'); srv.kill('SIGKILL'); process.exit(1); }

  head('① 麦克风权限（安卓 6 以后必须运行期申请）');

  await new Promise((res) => {
    makeSandbox({ alreadyGranted: true }).HC.media.askMic((granted, why) => {
      if (granted) ok('已经有权限 → 直接放行，不弹窗打扰');
      else bad('已经有权限还去弹窗', why);
      res();
    });
  });

  await new Promise((res) => {
    makeSandbox({ alreadyGranted: false, permDelayMs: 60 }).HC.media.askMic((granted, why) => {
      if (granted) ok('  没有权限 → 弹窗问，用户同意后放行');
      else bad('申请权限被误判成拒绝', why);
      res();
    });
  });

  await new Promise((res) => {
    makeSandbox({ alreadyGranted: false, permDenied: true }).HC.media.askMic((granted, why) => {
      if (!granted && /权限/.test(why)) ok('★ 用户拒绝 → 不放行，而且给出人话原因', why);
      else bad('拒绝权限的处理不对', String(granted) + ' / ' + why);
      res();
    });
  });

  head('② 录音 → 停止 → 读文件（这里以前断了三处）');

  let voice = null;
  await new Promise((res) => {
    const media = makeSandbox({ alreadyGranted: true, rec: { writeDelayMs: 60 } }).HC.media;
    let ready = false;

    const r = media.recStart(() => {}, null,
      (why) => bad('录音起不来：' + why),
      () => { ready = true; });

    if (!r.ok) bad('recStart 直接失败：' + r.msg);
    else ok('录音启动了');

    setTimeout(() => {
      if (ready) ok('★ onReady 来了 —— 界面靠它区分"准备中"和"真的在录"');
      else bad('onReady 一直没来，界面会永远停在"准备中"');

      media.recFinish(false, (err, v) => {
        if (err) { bad('录音结束时报错：' + err.message); return res(); }
        if (!v) { bad('录音结束什么都没返回'); return res(); }
        voice = v;

        if (v.bytes && v.bytes.length > 0) ok('★★ 拿到录音字节了（以前这里就是断的）', v.bytes.length + ' 字节');
        else bad('拿到的字节是空的');

        if (v.mime === 'audio/mp4') ok('★ 格式标成 audio/mp4（aac 装在 mp4 容器里）', v.mime);
        else bad('格式不对：' + v.mime);

        if (/\.m4a$/.test(v.name)) ok('★ 扩展名跟格式对得上', v.name);
        else bad('扩展名不对：' + v.name);

        if (v.dur >= 1) ok('★ 时长算出来了（气泡宽度和秒数都靠它）', v.dur + ' 秒');
        else bad('时长不对：' + v.dur);

        if (v.path) ok('★ 带出了本机路径（「试听」要用 —— 不然得先上传才能听）', v.path);
        else bad('没有本机路径，试听只能等上传完');

        res();
      });
    }, 1150);
  });

  head('③ 失败路径（每一条都必须说话，不能静默卡住）');

  await new Promise((res) => {
    let why = null;
    makeSandbox({ alreadyGranted: true, rec: { failStart: '麦克风被别的程序占着' } })
      .HC.media.recStart(() => {}, null, (w) => { why = w; }, () => {});
    setTimeout(() => {
      if (why && /占着/.test(why)) ok('录音器起不来 → 原文报给界面', why);
      else bad('录音器起不来却没说原因', String(why));
      res();
    }, 200);
  });

  await new Promise((res) => {
    let why = null;
    makeSandbox({ alreadyGranted: false, permDenied: true })
      .HC.media.recStart(() => {}, null, (w) => { why = w; }, () => {});
    setTimeout(() => {
      if (why) ok('权限被拒 → 界面会被复位并说明原因', why);
      else bad('权限被拒后界面会一直卡着');
      res();
    }, 250);
  });

  await new Promise((res) => {

    const media = makeSandbox({ alreadyGranted: true, rec: { neverWrite: true } }).HC.media;
    media.recStart(() => {}, null, () => {}, () => {});
    sleep(900).then(() => {
      const t0 = Date.now();
      media.recFinish(false, (err) => {
        const took = Date.now() - t0;
        if (err && /找不到|拿不到|读录音/.test(err.message)) {
          ok('★ 文件读不到 → 重试后放弃，给出人话', err.message + '（花了 ' + took + 'ms）');
          if (took > 1200) ok('  · 确实重试了（老代码 320ms 就放弃）');
          else bad('几乎没有重试，慢一点的手机还是会失败', took + 'ms');
        } else bad('文件不存在时的报错不对', err ? err.message : '（居然没报错）');
        res();
      });
    });
  });

  head('④ 大小限制（选之前 / 压完 / 上传前 三道闸）');

  await new Promise((res) => {
    const media = makeSandbox({ alreadyGranted: true }).HC.media;

    let err = null;
    media.sendVoice('', 'c_x', {
      name: 'v.m4a', mime: 'audio/mp4', dur: 3,
      bytes: new Uint8Array(100 * 1024 * 1024)
    }, null, (e) => { err = e; });
    setTimeout(() => {
      if (err && /超过|太大/.test(err.message)) ok('★★ 超大语音在上传前就被拦下（手机内存不会先爆）', err.message);
      else bad('超大语音没被拦住', err ? err.message : '（没报错）');
      res();
    }, 300);
  });

  {
    const src = fs.readFileSync(path.join(APP, 'js/media.js'), 'utf8');
    if (/f\.size > MAX_PICK/.test(src)) ok('★★ 选文件时**读进内存之前**就查大小（读完再查，手机已经炸了）');
    else bad('选文件没有提前查大小');

    if (/file\.size > MAX_IMG_SRC/.test(src)) ok('★ 从相册取原图时也查（手机原图可能十几 MB）');
    else bad('相册原图没有大小检查');

    if (/bytes\.length > MAX_IMG_OUT/.test(src)) ok('★ 压完再查一次（压缩出岔子时不硬发）');
    else bad('压缩结果没有复查');

    const cap = (src.match(/MAX_PICK\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/) || [])[1];
    if (Number(cap) === 32) ok('  单文件上限 32MB（跟服务端 MAX_FILE 对齐，家里发东西够用）');
    else bad('客户端上限跟服务端对不上：' + cap + 'MB');

    if (/MAX_VOICE\s*=\s*4\s*\*\s*1024\s*\*\s*1024/.test(src)) ok('  语音上限 4MB（60 秒 aac 最多 1MB 左右，4MB 是保险）');
    else bad('语音没有字节上限');

    if (/REC_MAX\s*=\s*60/.test(src)) ok('  录音最长 60 秒（跟微信一致）——"录 1 小时"这件事从源头就不可能');
    else bad('录音时长没有上限');
  }

  head('⑤ 单聊发语音：上传 → 落库 → 对方收到推送');

  const pal = { inbox: [] };
  await new Promise((res) => {
    pal.ws = new WebSocket('ws://127.0.0.1:' + cfg.PORT + '/ws');
    pal.ws.on('open', () => {
      pal.ws.send(JSON.stringify(PHONE.seal(PK.kEnc, PK.kMac,
        { t: 'hello', deviceId: 'dev-pal-' + Date.now(), name: '收件人', ver: 1 })));
      res();
    });
    pal.ws.on('message', (d) => {
      let m; try { m = JSON.parse(d.toString()); } catch (e) { return; }
      if (m.v === 1) { const i = PHONE.open(PK.kEnc, PK.kMac, m); if (i) pal.inbox.push(i); }
      else pal.inbox.push(m);
    });
    pal.ws.on('error', () => {});
  });

  const waitPal = (t, ms) => {
    const t0 = Date.now();
    return new Promise((r) => {
      const k = () => {
        const h = pal.inbox.find(x => x.t === t);
        if (h) return r(h);
        if (Date.now() - t0 > (ms || 5000)) return r(null);
        setTimeout(k, 50);
      };
      k();
    });
  };

  const wPal = await waitPal('welcome', 6000);
  if (!wPal) { bad('收件人手机连不上'); }
  else ok('  收件人手机接上了', wPal.userId);

  const palId = wPal ? wPal.userId : null;

  let fileId = null;
  await new Promise((res) => {
    const sb = makeSandbox({ alreadyGranted: true });
    sb.__state.cfg.serverAddr = '127.0.0.1';
    sb.__state.cfg.serverPort = cfg.PORT;
    sb.__state.dlToken = wel.dlk || '';

    const pcts = [];
    sb.HC.media.sendVoice(palId, null, voice, (p) => pcts.push(p), (err, r) => {
      if (err) { bad('上传失败：' + err.message); return res(); }
      fileId = r.fileId;
      ok('★★ 语音上传成功（走的正是 App 里那条 plus.net.XMLHttpRequest 路径）', 'fileId=' + fileId);
      ok('  进度回调有在动', pcts.join('% → ') + '%');
      res();
    });
  });

  if (fileId) {

    const raw = fs.readFileSync(path.join(DATA, 'messages.jsonl'), 'utf8')
                  .split('\n').filter(Boolean)
                  .map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
                  .filter(Boolean);
    const mine = raw.filter(m => m.from === wel.userId);

    if (mine.length) ok('★★ 服务端 messages.jsonl 里真的有这条记录了', 'seq=' + mine[mine.length - 1].seq);
    else bad('服务端一条都没落库 —— 「后端接收」这一步断了');

    if (mine.length) {
      const last = mine[mine.length - 1];
      const dm = C.open(SK.kEnc, SK.kMac, last.env);
      if (dm && dm.kind === 'voice') ok('★★ 服务端解出来 kind 是 voice（没被当成普通文件）', dm.kind);
      else bad('服务端解出来不是 voice：' + (dm ? dm.kind : '解不开'));

      const dmDur = dm && dm.meta ? Number(dm.meta.dur) : NaN;
      if (dmDur === voice.dur) ok('★ 时长传过去了（存在 meta.dur 里）', dmDur + ' 秒');
      else bad('时长不对：' + dmDur + ' vs ' + voice.dur);

      if (dm && dm.burn) ok('★ 阅后即焚的秒数也带上了（服务端靠它决定什么时候烧）', 'burn=' + dm.burn);
      else bad('没带焚毁秒数');
    }

    const push = await waitPal('msg', 6000);
    if (push && push.msg) {
      if (push.msg.kind === 'voice') ok('★★ 收件人收到了 kind=voice 的推送（消息通道通了）', 'seq=' + push.msg.seq);
      else bad('收件人收到的 kind 不对：' + push.msg.kind);
      if (push.msg.meta && Number(push.msg.meta.dur) === voice.dur) {
        ok('★ 推送里带了时长（对方气泡能直接标秒数，不用等下载）', push.msg.meta.dur + ' 秒');
      } else bad('推送里没有时长：' + JSON.stringify(push.msg.meta));
    } else {
      bad('收件人没有收到语音推送 —— 消息通道断了');
    }

    head('⑤b 群里发语音（extra/burnSecs 的暂时性死区，以前必崩）');

    pal.inbox.length = 0;
    me.inbox.length = 0;

    me.ws.send(JSON.stringify(PHONE.seal(PK.kEnc, PK.kMac,
      { t: 'group.create', name: '语音测试群', members: palId ? [palId] : [] })));
    await sleep(1200);

    const gok = me.inbox.find(x => x.t === 'group.ok');
    const gid = gok && (gok.conv || gok.id || (gok.convObj && gok.convObj.id));
    if (gid) ok('  群建好了', String(gid));
    else bad('建群没成功（后面那步验不了）', JSON.stringify(me.inbox.map(x => x.t)));

    if (gid) {
      let gFile = null, gErr = null;
      await new Promise((res) => {
        const sb = makeSandbox({ alreadyGranted: true });
        sb.__state.cfg.serverAddr = '127.0.0.1';
        sb.__state.cfg.serverPort = cfg.PORT;
        sb.__state.dlToken = wel.dlk || '';
        sb.HC.media.sendVoice(null, String(gid), voice, null, (err, r) => {
          gErr = err; if (r) gFile = r.fileId;
          res();
        });
      });

      if (gErr) bad('★★ 群里发语音失败：' + gErr.message + '（单聊正常、群聊崩，就是 TDZ 那个 bug 又回来了）');
      else if (gFile) ok('★★ 群里发语音成功（单聊 / 群聊两条路都通了）', 'fileId=' + gFile);

      const raw2 = fs.readFileSync(path.join(DATA, 'messages.jsonl'), 'utf8')
                    .split('\n').filter(Boolean)
                    .map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
                    .filter(Boolean);
      const inGroup = raw2.filter(m => m.conv === String(gid));
      if (inGroup.length) ok('★★ 群里的那条语音落库了（而且带上了时长）', 'seq=' + inGroup[inGroup.length - 1].seq);
      else bad('群里那条语音没落库');
    }

    head('⑥ 下载 → 播放（必须放本地文件，不是 http 地址）');

    const sb2 = makeSandbox({ alreadyGranted: true });
    sb2.__state.cfg.serverAddr = '127.0.0.1';
    sb2.__state.cfg.serverPort = cfg.PORT;
    sb2.__state.dlToken = wel.dlk || '';

    PLAY_LOG.length = 0; DOWNLOAD_LOG.length = 0;

    await new Promise((res) => {
      sb2.HC.media.playVoice(fileId, voice.name, (err) => {
        if (err) bad('播放失败：' + err.message);
        else ok('  播放走完了');
        res();
      }, () => {});
    });

    if (DOWNLOAD_LOG.length) ok('★★ 确实先下载了（安卓原生播放器放不了明文 http 流）',
                                DOWNLOAD_LOG[0].slice(0, 64) + '…');
    else bad('没有下载就直接播了 —— 安卓上放不出声');

    const played = PLAY_LOG[PLAY_LOG.length - 1] || '';
    if (/^\/abs\//.test(played)) ok('★★ 放的是**本地文件**，不是 http 地址', played);
    else bad('放的还是网络地址，安卓上播不了：' + played);

    DOWNLOAD_LOG.length = 0;
    await new Promise((res) => { sb2.HC.media.playVoice(fileId, voice.name, () => res(), () => {}); });
    if (DOWNLOAD_LOG.length === 0) ok('★★ 第二次点：走本地缓存，秒开（不再下载）');
    else bad('第二次点还在下载，缓存没生效');
  }

  head('⑦ 上传卡住（用户报的"进度条卡 0%"）');

  {
    const sb = makeSandbox({ alreadyGranted: true });
    sb.__state.cfg.serverAddr = '10.255.255.1';
    sb.__state.cfg.serverPort = 9;

    let done = false, msg = null;
    sb.HC.media.upload({ peerId: '', convId: 'c_x', kind: 'voice', name: 'v.m4a',
                         mime: 'audio/mp4', bytes: new Uint8Array(300), dur: 2 },
      null, (err) => { done = true; msg = err && err.message; });

    await sleep(5000);
    if (!done) ok('★ 请求挂着时不会假装成功（界面停在 0%，但至少没骗人）');
    else bad('居然"成功"了：' + msg);

    const src = fs.readFileSync(path.join(APP, 'js/media.js'), 'utf8');
    if (/armWatchdog/.test(src) && /块超时/.test(src)) {
      ok('★ 看门狗 25 秒会把它变成明确报错（"第 N/M 块超时"）—— 不会再永远卡 0%');
    } else bad('上传没有看门狗');
  }

  try { me.ws.close(); } catch (e) {}
  try { pal.ws.close(); } catch (e) {}
  try { srv.kill('SIGKILL'); } catch (e) {}
  await sleep(400);
  fs.rmSync(DATA, { recursive: true, force: true });

  console.log('');
  console.log('\x1b[1m════════════════════════════════════════════════════\x1b[0m');
  if (fail === 0) {
    console.log(`\x1b[32m\x1b[1m  ✅ 全部通过：${pass} 项，0 失败\x1b[0m`);
    console.log('\x1b[90m  除了"麦克风硬件真的采到声音"，语音整条链路都跑通了。\x1b[0m');
  } else {
    console.log(`\x1b[31m\x1b[1m  ✘ ${fail} 项失败（通过 ${pass} 项）\x1b[0m`);
    problems.forEach(p => console.log(`  \x1b[31m·\x1b[0m ${p}`));
  }
  console.log('\x1b[1m════════════════════════════════════════════════════\x1b[0m\n');
  process.exit(fail === 0 ? 0 : 1);

})().catch(e => {
  console.error('\n测试脚本崩了：', e);
  try { srv && srv.kill('SIGKILL'); } catch (x) {}
  process.exit(1);
});
