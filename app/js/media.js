(function (global) {
  'use strict';

  var C = global.HC.crypto;
  var store = global.HC.store;

  var MAX_SIDE  = 1280;
  var QUALITY   = 0.80;
  var CHUNK     = 128 * 1024;

  var MAX_PICK      = 32 * 1024 * 1024;
  var MAX_IMG_SRC   = 40 * 1024 * 1024;
  var MAX_IMG_OUT   = 3 * 1024 * 1024;
  var MAX_VOICE     = 4 * 1024 * 1024;

  function mbStr(b) {
    var mb = b / 1024 / 1024;
    return (mb >= 10 ? Math.round(mb) : mb.toFixed(1)) + 'MB';
  }

  function S() { return store.S; }

  function httpPost(url, headers, bodyStr, cb) {

    if (global.plus && plus.net && plus.net.XMLHttpRequest) {
      try {
        var x = new plus.net.XMLHttpRequest();
        x.open('POST', url);
        x.timeout = 120000;
        Object.keys(headers).forEach(function (k) { x.setRequestHeader(k, headers[k]); });
        x.onreadystatechange = function () {
          if (x.readyState !== 4) return;
          var data = null;
          try { data = JSON.parse(x.responseText); } catch (e) {}
          cb(null, x.status, data, x.responseText);
        };
        x.onerror = function () { cb(new Error('网络错误')); };
        x.ontimeout = function () { cb(new Error('超时')); };
        x.send(bodyStr);
        return;
      } catch (e) {  }
    }

    try {
      fetch(url, { method: 'POST', headers: headers, body: bodyStr })
        .then(function (r) {
          return r.text().then(function (t) {
            var d = null;
            try { d = JSON.parse(t); } catch (e) {}
            cb(null, r.status, d, t);
          });
        })
        .catch(function (e) { cb(e); });
    } catch (e) { cb(e); }
  }

  function pickImage(source, cb) {

    if (!global.plus) {
      pickViaInput('image/*', source === 'camera', cb);
      return;
    }

    if (source === 'camera') {
      var cm = plus.camera.getCamera();
      cm.captureImage(function (path) {
        toDataURL(path, function (err, durl) { cb(err, durl); });
      }, function () { cb(null, null); }, { filename: '_doc/homechat_' + Date.now() + '.jpg' });
      return;
    }

    plus.gallery.pick(function (path) {
      toDataURL(path, function (err, durl) { cb(err, durl); });
    }, function () { cb(null, null); }, { filter: 'image', multiple: false });
  }

  function pickViaInput(accept, camera, cb) {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    if (camera) inp.capture = 'environment';
    inp.style.cssText = 'position:fixed;left:-9999px;';
    document.body.appendChild(inp);

    var done = false;
    function finish(err, res) {
      if (done) return;
      done = true;
      try { document.body.removeChild(inp); } catch (e) {}
      cb(err, res);
    }

    inp.onchange = function () {
      var f = inp.files && inp.files[0];
      if (!f) { finish(null, null); return; }

      if (f.size > MAX_IMG_SRC) {
        finish(new Error('这张图有 ' + mbStr(f.size) + '，太大了，最大 ' +
                         mbStr(MAX_IMG_SRC)));
        return;
      }

      var fr = new FileReader();
      fr.onload = function () { finish(null, fr.result); };
      fr.onerror = function () { finish(new Error('读图片失败')); };
      fr.readAsDataURL(f);
    };

    setTimeout(function () { finish(null, null); }, 120000);
    inp.click();
  }

  function toDataURL(path, cb) {
    plus.io.resolveLocalFileSystemURL(path, function (entry) {
      entry.file(function (file) {

        if (file.size > MAX_IMG_SRC) {
          cb(new Error('这张图有 ' + mbStr(file.size) + '，太大了，最大 ' +
                       mbStr(MAX_IMG_SRC)));
          return;
        }
        var fr = new plus.io.FileReader();
        fr.onloadend = function (e) { cb(null, e.target.result); };
        fr.onerror = function () { cb(new Error('读取图片失败')); };
        fr.readAsDataURL(file);
      }, function () { cb(new Error('拿不到文件')); });
    }, function () { cb(new Error('路径无效：' + path)); });
  }

  function compressTo(dataURL, maxSide, quality, cb) {
    var img = new Image();
    img.onload = function () {
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      if (!w || !h) { cb(new Error('图片尺寸读不到')); return; }

      var scale = Math.min(1, maxSide / Math.max(w, h));
      var nw = Math.max(1, Math.round(w * scale));
      var nh = Math.max(1, Math.round(h * scale));

      var cv = document.createElement('canvas');
      cv.width = nw; cv.height = nh;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, nw, nh);
      ctx.drawImage(img, 0, 0, nw, nh);

      var out;
      try { out = cv.toDataURL('image/jpeg', quality || 0.82); }
      catch (e) { cb(new Error('压缩失败：' + e.message)); return; }

      cb(null, { bytes: dataURLToBytes(out), w: nw, h: nh, dataURL: out });
    };
    img.onerror = function () { cb(new Error('图片解析失败')); };
    img.src = dataURL;
  }

  function compress(dataURL, cb) {
    var img = new Image();
    img.onload = function () {
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      if (!w || !h) { cb(new Error('图片尺寸读不到')); return; }

      var scale = Math.min(1, MAX_SIDE / Math.max(w, h));
      var nw = Math.max(1, Math.round(w * scale));
      var nh = Math.max(1, Math.round(h * scale));

      var cv = document.createElement('canvas');
      cv.width = nw; cv.height = nh;
      var ctx = cv.getContext('2d');

      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, nw, nh);
      ctx.drawImage(img, 0, 0, nw, nh);

      var out;
      try { out = cv.toDataURL('image/jpeg', QUALITY); }
      catch (e) { cb(new Error('压缩失败：' + e.message)); return; }

      var bytes = dataURLToBytes(out);
      if (!bytes || !bytes.length) { cb(new Error('压缩后是空的')); return; }

      if (bytes.length > MAX_IMG_OUT) {
        cb(new Error('压缩之后还有 ' + mbStr(bytes.length) + '，这张图太大了'));
        return;
      }

      cb(null, { bytes: bytes, w: nw, h: nh, dataURL: out });
    };
    img.onerror = function () { cb(new Error('图片解析失败')); };
    img.src = dataURL;
  }

  function dataURLToBytes(durl) {
    var i = durl.indexOf(',');
    if (i < 0) return null;
    var head = durl.slice(0, i);
    var data = durl.slice(i + 1);
    if (head.indexOf('base64') < 0) return null;
    return C.b64dec(data);
  }

  function pickFile(cb) {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.style.cssText = 'position:fixed;left:-9999px;';
    document.body.appendChild(inp);

    var done = false;
    function finish(err, res) {
      if (done) return;
      done = true;
      try { document.body.removeChild(inp); } catch (e) {}
      cb(err, res);
    }

    inp.onchange = function () {
      var f = inp.files && inp.files[0];
      if (!f) { finish(null, null); return; }

      if (f.size > MAX_PICK) {
        finish(new Error('这个文件有 ' + mbStr(f.size) + '，太大了，最大 ' +
                         mbStr(MAX_PICK)));
        return;
      }

      var fr = new FileReader();
      fr.onload = function () {
        finish(null, {
          name: f.name || 'file',
          size: f.size || 0,
          mime: f.type || '',
          bytes: new Uint8Array(fr.result)
        });
      };
      fr.onerror = function () { finish(new Error('读文件失败')); };
      fr.readAsArrayBuffer(f);
    };

    setTimeout(function () { finish(null, null); }, 120000);
    inp.click();
  }

  function upload(o, onPct, cb) {
    if (!store.hasKey()) { cb(new Error('还没生成密钥')); return; }

    var cap = o.kind === 'voice' ? MAX_VOICE : MAX_PICK;
    if (o.bytes && o.bytes.length > cap) {
      cb(new Error((o.kind === 'voice' ? '这段语音' : '这个文件') + '有 ' +
                   mbStr(o.bytes.length) + '，超过 ' + mbStr(cap) + ' 了'));
      return;
    }

    var cfg = S().cfg;
    var url = 'http://' + cfg.serverAddr + ':' + cfg.serverPort + '/up';
    var fileId = 'f_' + C.toHex(C.randomBytes(5));
    var bytes = o.bytes;
    var total = Math.max(1, Math.ceil(bytes.length / CHUNK));

    var idx = 0;
    var lastRes = null;
    var host = bytes.length + '/' + (1024 * 1024) + 'MB';

    var watchdog = null;
    var settled = false;

    function once(err, res) {
      if (settled) return;
      settled = true;
      if (watchdog) { clearTimeout(watchdog); watchdog = null; }
      cb(err, res);
    }

    function armWatchdog() {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(function () {
        watchdog = null;

        once(new Error('第 ' + (idx + 1) + '/' + total + ' 块超时（网络断了？）'));
      }, 25000);
    }

    function disarmWatchdog() { if (watchdog) { clearTimeout(watchdog); watchdog = null; } }

    function step() {
      if (idx >= total) {
        once(null, { fileId: fileId, chunks: total, last: lastRes });
        return;
      }

      var from = idx * CHUNK;
      var to = Math.min(from + CHUNK, bytes.length);
      var slice = bytes.subarray(from, to);

      var metaEnv, dataEnv;
      try {
        metaEnv = C.seal(S().kEnc, S().kMac, {
          fileId: fileId,
          name: o.name,
          size: bytes.length,
          mime: o.mime || '',
          kind: o.kind,
          peer: o.peerId || '',
          conv: o.convId || '',
          idx: idx,
          total: total,
          w: o.w || 0,
          h: o.h || 0,
          dur: o.dur || 0,
          burn: o.burn || 0
        });
        dataEnv = C.sealBytes(S().kEnc, S().kMac, slice);
      } catch (e) { once(new Error('加密失败：' + e.message)); return; }

      var body = JSON.stringify({ meta: metaEnv, data: dataEnv });

      var hdr = { 'Content-Type': 'application/json' };
      if (S().dlToken) hdr['X-HC-Token'] = S().dlToken;
      else hdr['X-HC-Device'] = store.ensureDeviceId();

      armWatchdog();
      httpPost(url, hdr, body, function (err, status, data, raw) {
        if (err) { once(new Error('上传中断：' + err.message)); return; }

        if (status !== 200) {
          var msg = (data && data.msg) || ('HTTP ' + status);
          once(new Error(msg));
          return;
        }

        lastRes = data;
        idx++;
        if (onPct) onPct(Math.round((idx / total) * 100));
        disarmWatchdog();
        step();
      });
    }

    if (onPct) onPct(0);
    step();
  }

  var BURN_SECS = 30;
  function burnSecs() { return BURN_SECS; }

  function sendImage(peerId, convId, source, onPct, cb) {
    pickImage(source, function (err, durl) {
      if (err) { cb(err); return; }
      if (!durl) { cb(null, null); return; }

      compress(durl, function (cerr, c) {
        if (cerr) { cb(cerr); return; }

        var name = autoName('p') + '.jpg';
        upload({
          peerId: peerId, convId: convId, kind: 'image',
          name: name, mime: 'image/jpeg',
          bytes: c.bytes, w: c.w, h: c.h, burn: burnSecs()
        }, onPct, function (uerr, res) {
          if (uerr) { cb(uerr); return; }
          cb(null, { kind: 'image', name: name, size: c.bytes.length, fileId: res.fileId });
        });
      });
    });
  }

  function sendFile(peerId, convId, onPct, cb) {
    pickFile(function (err, f) {
      if (err) { cb(err); return; }
      if (!f) { cb(null, null); return; }

      upload({
        peerId: peerId, convId: convId, kind: 'file',
        name: f.name, mime: f.mime, bytes: f.bytes, w: 0, h: 0, burn: burnSecs()
      }, onPct, function (uerr, res) {
        if (uerr) { cb(uerr); return; }
        cb(null, { kind: 'file', name: f.name, size: f.bytes.length, fileId: res.fileId });
      });
    });
  }

  function fileURL(fileId, name) {
    var cfg = S().cfg;
    var k = S().dlToken ? ('?k=' + encodeURIComponent(S().dlToken)) : '';
    return 'http://' + cfg.serverAddr + ':' + cfg.serverPort + '/dl/' +
           encodeURIComponent(fileId) + k;
  }

  function download(fileId, name, cb) {
    var url = fileURL(fileId, name);

    if (!global.plus || !plus.downloader) {
      try { window.open(url); } catch (e) {}
      if (cb) cb(null, null);
      return;
    }

    if (global.HC.util) global.HC.util.toast('正在下载 ' + name);

    var task = plus.downloader.createDownload(url, {
      filename: '_downloads/' + name
    }, function (t, status) {
      if (status === 200 && t.filename) {
        if (global.HC.util) global.HC.util.toast('下载完成，正在打开…');
        try { plus.runtime.openFile(t.filename); }
        catch (e) { if (cb) cb(e); }
        if (cb) cb(null, t.filename);
      } else {
        if (global.HC.util) global.HC.util.toast('下载失败（' + status + '）');
        if (cb) cb(new Error('下载失败 ' + status));
      }
    });

    try { task.start(); }
    catch (e) { if (cb) cb(e); }
  }

  function voiceDiag(emit, done) {
    var say = emit || function () {};
    var end = done || function () {};
    var t0 = Date.now();

    function ms() { return (Date.now() - t0) + 'ms'; }

    say('① 运行环境：' + (global.plus ? '手机 App' : '浏览器'), null);
    if (!global.plus) {
      say('  · 电脑浏览器测不了录音链路，请用手机 App 跑这个自检', false);
      end(); return;
    }

    var micOk = !!(plus.audio && plus.audio.getRecorder);
    say('② 录音模块 plus.audio：' + (micOk ? '有' : '没有'), micOk);
    if (!micOk) { say('  · manifest 里要勾 Audio 模块并重新打包', false); end(); return; }

    say('③ 正在检查麦克风权限…', null);
    askMic(function (granted, why) {
      say('③ 麦克风权限：' + (granted ? '已允许' : ('被拒绝 —— ' + why)), granted);
      if (!granted) { end(); return; }

      say('④ 正在录 2 秒测试音…', null);
      var got = { bytes: null };
      var r = recStart(function () {}, null, function (failWhy) {
        say('④ 录音起不来：' + failWhy, false);
        end();
      });
      if (!r.ok) { say('④ 录音起不来：' + r.msg, false); end(); return; }

      setTimeout(function () {
        recFinish(false, function (err, voice) {
          if (err) { say('④ 录音失败：' + err.message, false); end(); return; }
          if (!voice || !voice.bytes || !voice.bytes.length) {
            say('④ 录到的文件是空的（麦克风没采到声音？）', false);
            end(); return;
          }
          var kb = (voice.bytes.length / 1024).toFixed(1);
          say('④ 录音成功：' + kb + ' KB，' + voice.dur + ' 秒，' + voice.mime + '（' + ms() + '）', true);

          var enc = null;
          try {
            enc = C.sealBytes(S().kEnc, S().kMac, voice.bytes);
            say('⑤ 加密成功：' + voice.bytes.length + ' → ' + enc.c.length + ' 字节密文', true);
          } catch (e) {
            say('⑤ 加密失败：' + e.message, false); end(); return;
          }

          say('⑥ 正在上传到电脑…', null);
          var convId = null, peerId = null;
          try { convId = global.HC.store.S.current; } catch (e) {}
          sendVoice(peerId, convId, voice, null, function (uerr, res) {
            if (uerr) { say('⑥ 上传失败：' + uerr.message + '（' + ms() + '）', false); end(); return; }
            say('⑥ 上传成功：fileId=' + res.fileId + '（' + ms() + '）', true);

            say('⑦ 正在从电脑下载回来…', null);
            var url = fileURL(res.fileId, res.name);
            var rel = cachePathFor('diag_' + Date.now(), res.name);
            if (!plus.downloader) { say('⑦ 没有 downloader，跳过', null); end(); return; }

            var task = plus.downloader.createDownload(url, { filename: rel }, function (t, status) {
              if (status !== 200 || !t.filename) {
                say('⑦ 下载失败：HTTP ' + status + '（下载令牌可能过期了）', false);
                end(); return;
              }
              var abs = t.filename;
              try { abs = plus.io.convertLocalFileSystemURL(t.filename); } catch (e) {}
              say('⑦ 下载成功：' + abs + '（' + ms() + '）', true);

              say('⑧ 正在播这个文件…', null);
              var p2;
              try { p2 = plus.audio.createPlayer(abs); }
              catch (e) { say('⑧ 播放器起不来：' + (e && e.message), false); end(); return; }
              p2.play(function () {
                say('⑧ 播放成功 —— 你应该听到刚才录的那 2 秒', true);
                say('★ 整条链路通了（全程 ' + ms() + '）', true);
                end();
              }, function (e) {
                say('⑧ 播放失败：' + ((e && e.message) || '未知') + '（这个文件格式播放器不认）', false);
                end();
              });
            });
            try { task.start(); } catch (e) { say('⑦ 下载起不来：' + e.message, false); end(); }
          });
        });
      }, 2000);
    });
  }

  var REC_MAX = 60;
  var recSession = null;
  var player = null;
  var playingId = null;
  var playCache = {};

  function recMode() {
    if (global.plus && plus.audio && plus.audio.getRecorder) return 'app';
    if (global.MediaRecorder && global.navigator &&
        navigator.mediaDevices && navigator.mediaDevices.getUserMedia) return 'web';
    return null;
  }

  function recWhyNot() {
    if (recMode()) return '';

    if (global.HC.canRecord) {
      var r = global.HC.canRecord();
      if (!r.ok) return r.why;
    }
    if (!global.plus) {
      return '这个浏览器不给录音权限（需要 https 或本机地址）。';
    }
    return '这个设备不支持录音。';
  }

  function askMic(cb) {

    if (!global.plus || !plus.android) { cb(true, ''); return; }

    var PERM = 'android.permission.RECORD_AUDIO';
    var main = null;
    try { main = plus.android.runtimeMainActivity(); } catch (e) {}

    try {
      var got = plus.android.invoke(main, 'checkSelfPermission', PERM);
      if (got === 0) { cb(true, ''); return; }
    } catch (e) { cb(true, ''); return; }

    if (!plus.android.requestPermissions) { cb(true, ''); return; }

    var settled = false;
    function once(ok, why) {
      if (settled) return;
      settled = true;
      cb(ok, why || '');
    }

    try {
      plus.android.requestPermissions([PERM], function (res) {
        var granted = true;
        try {

          if (res && res.deniedAlways && res.deniedAlways.length) {
            return once(false, '麦克风权限被永久拒绝了，请到「设置 → 应用 → 家庭聊天 → 权限」里打开麦克风');
          }
          if (res && res.deniedPresent && res.deniedPresent.length) {
            return once(false, '没有麦克风权限，录不了音');
          }
          if (res && res.granted && !res.granted.length) granted = false;
        } catch (e) {}
        once(granted, granted ? '' : '没有麦克风权限，录不了音');
      }, function () {
        once(false, '麦克风权限申请失败');
      });
    } catch (e) {
      once(true, '');
    }

    setTimeout(function () { once(true, ''); }, 3000);
  }

  function recStart(onTick, onAuto, onFail, onReady) {
    if (recSession) recFinish(true, function () {});

    var mode = recMode();
    if (!mode) return { ok: false, msg: recWhyNot() };

    var s = { mode: mode, startedAt: Date.now(), cancelled: false, failed: '',
              timer: null, onAuto: onAuto, ready: false };

    recSession = s;

    function markReady() {
      if (s.ready) return;
      s.ready = true;

      s.startedAt = Date.now();
      if (onReady) onReady();
    }

    if (mode === 'app') {

      askMic(function (granted, why) {
        if (recSession !== s) return;
        if (!granted) {
          s.failed = why || '没有麦克风权限';
          if (onFail) onFail(s.failed);
          return;
        }
        try {
          s.part = plus.audio.getRecorder();

          s.path = '_doc/hc_voice_' + Date.now() + '.aac';
          try { s.absPath = plus.io.convertLocalFileSystemURL(s.path); }
          catch (e) { s.absPath = s.path; }

          s.part.record({ filename: s.path, format: 'aac' },
            function () { markReady(); },
            function (e) {
              s.failed = (e && e.message) || '录音起不来';
              if (onFail) onFail(s.failed);
            });
        } catch (e) {
          s.failed = '录音起不来：' + (e && e.message);
          if (onFail) onFail(s.failed);
        }
      });
    } else {
      s.pending = true;
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        if (recSession !== s) {
          try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
          return;
        }
        s.stream = stream;
        s.pending = false;
        markReady();
        var want = '';
        ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
          .some(function (t) {
            if (global.MediaRecorder.isTypeSupported &&
                MediaRecorder.isTypeSupported(t)) { want = t; return true; }
            return false;
          });
        try {
          s.mr = want ? new MediaRecorder(stream, { mimeType: want }) : new MediaRecorder(stream);
        } catch (e) {
          s.failed = '录音起不来：' + e.message;
          if (onFail) onFail(s.failed);
          return;
        }
        s.chunks = [];
        s.mr.ondataavailable = function (ev) {
          if (ev.data && ev.data.size) s.chunks.push(ev.data);
        };
        s.mr.start();
      }).catch(function (e) {
        s.pending = false;
        s.failed = (e && e.name === 'NotAllowedError')
          ? '麦克风权限被拒绝了'
          : ('录音起不来：' + ((e && e.message) || e));
        if (onFail) onFail(s.failed);
      });
    }

    s.timer = setInterval(function () {
      var sec = recElapsed();
      if (onTick) onTick(sec);
      if (sec >= REC_MAX && s.onAuto) { var f = s.onAuto; s.onAuto = null; f(); }
    }, 200);

    if (onTick) onTick(0);
    return { ok: true };
  }

  function recElapsed() {
    return recSession ? Math.max(0, Math.round((Date.now() - recSession.startedAt) / 1000)) : 0;
  }

  function recMarkCancel(on) {
    if (recSession) recSession.cancelled = !!on;
    return recSession ? recSession.cancelled : false;
  }

  function extOf(mime) {
    mime = String(mime || '');
    if (mime.indexOf('webm') >= 0) return 'webm';
    if (mime.indexOf('mp4') >= 0 || mime.indexOf('m4a') >= 0 || mime.indexOf('aac') >= 0) return 'm4a';
    if (mime.indexOf('ogg') >= 0 || mime.indexOf('opus') >= 0) return 'ogg';
    if (mime.indexOf('mpeg') >= 0 || mime.indexOf('mp3') >= 0) return 'mp3';
    if (mime.indexOf('wav') >= 0) return 'wav';
    return 'webm';
  }

  function extFromName(name) {
    var m = /\.([a-z0-9]{2,5})$/i.exec(String(name || ''));
    return m ? m[1].toLowerCase() : 'm4a';
  }

  function readRecFile(path, cb) {
    var tries = 0;

    function attempt() {
      tries++;
      plus.io.resolveLocalFileSystemURL(path, function (entry) {
        entry.file(function (file) {
          if (!file.size && tries < 8) { setTimeout(attempt, 200); return; }

          var fr = new plus.io.FileReader();
          fr.onloadend = function (ev) {
            var b64 = '';
            try { b64 = String(ev.target.result).split(',')[1] || ''; } catch (e) {}
            var bytes = b64 ? C.b64dec(b64) : null;
            if ((!bytes || !bytes.length) && tries < 8) { setTimeout(attempt, 200); return; }
            if (!bytes || !bytes.length) { cb(new Error('录到的文件是空的')); return; }
            cb(null, bytes, file.size);
          };
          fr.onerror = function () {
            if (tries < 8) { setTimeout(attempt, 200); return; }
            cb(new Error('读录音文件失败'));
          };
          fr.readAsDataURL(file);
        }, function () {
          if (tries < 8) { setTimeout(attempt, 200); return; }
          cb(new Error('拿不到录音文件'));
        });
      }, function () {
        if (tries < 8) { setTimeout(attempt, 200); return; }
        cb(new Error('找不到录音文件'));
      });
    }

    attempt();
  }

  function recFinish(cancel, cb) {
    var s = recSession;
    recSession = null;
    if (!s) { cb(null, null); return; }
    if (s.timer) clearInterval(s.timer);

    var dur  = Math.max(1, Math.round((Date.now() - s.startedAt) / 1000));

    var base = autoName('v') + '.';

    function done(err, bytes, mime, localPath) {
      if (err) { cb(err); return; }
      if (!bytes || !bytes.length) { cb(new Error('没录到声音')); return; }

      cb(null, { bytes: bytes, mime: mime, name: base + extOf(mime), dur: dur,
                 path: localPath || '' });
    }

    if (s.mode === 'app') {
      try { if (s.part) s.part.stop(); } catch (e) {}
      if (cancel) { cb(null, null); return; }
      if (s.failed) { cb(new Error(s.failed)); return; }
      if (!s.path) { cb(new Error('录音没有起来')); return; }

      setTimeout(function () {
        if (!global.plus || !plus.io) { cb(new Error('读不了录音文件')); return; }
        readRecFile(s.path, function (err, bytes) {
          if (err) { cb(err); return; }
          done(null, bytes, 'audio/mp4', s.path);
        });
      }, 260);
      return;
    }

    if (cancel) { cb(null, null); return; }
    if (s.pending) { cb(null, null); return; }
    if (!s.mr) { cb(new Error(s.failed || '录音没起来')); return; }

    s.mr.onstop = function () {
      try { s.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      var mime = s.mr.mimeType || 'audio/webm';
      var blob = new Blob(s.chunks, { type: mime });
      var fr = new FileReader();
      fr.onloadend = function () { done(null, new Uint8Array(fr.result), mime); };
      fr.onerror = function () { cb(new Error('读录音失败')); };
      fr.readAsArrayBuffer(blob);
    };
    try { s.mr.stop(); } catch (e) { done(new Error('停止录音失败：' + e.message)); }
  }

  function stopVoice() {
    if (player) { try { player.stop(); } catch (e) {} }
    player = null; playingId = null;
  }

  function nowPlaying() { return playingId; }

  function cachePathFor(fileId, name) {
    return VOICE_DIR + '/' + fileId + '.' + extFromName(name);
  }

  var VOICE_DIR = '_doc/hc_voice_play';

  function ensureVoiceDir(cb) {
    if (!global.plus || !plus.io) { cb(); return; }
    try {
      plus.io.resolveLocalFileSystemURL('_doc/', function (root) {
        try {
          root.getDirectory('hc_voice_play', { create: true, exclusive: false },
            function () { cb(); },
            function () { cb(); });
        } catch (e) { cb(); }
      }, function () { cb(); });
    } catch (e) { cb(); }
  }

  function findLocal(fileId, name, cb) {
    if (playCache[fileId]) { cb(playCache[fileId]); return; }
    if (!global.plus || !plus.io) { cb(null); return; }

    var rel = cachePathFor(fileId, name);
    plus.io.resolveLocalFileSystemURL(rel, function (entry) {
      entry.file(function (f) {
        if (f.size > 0) {
          var abs = rel;
          try { abs = plus.io.convertLocalFileSystemURL(rel); } catch (e) {}
          playCache[fileId] = abs;
          cb(abs);
        } else { cb(null); }
      }, function () { cb(null); });
    }, function () { cb(null); });
  }

  function playVoice(fileId, name, onEnd, onState) {
    var again = (playingId === fileId);
    stopVoice();
    if (again) { if (onEnd) onEnd(null, true); return; }

    var url = fileURL(fileId, name);

    function finish(err) {
      player = null; playingId = null;
      if (onState) onState('done');
      if (onEnd) onEnd(err, false);
    }

    function playLocal(localPath) {
      if (playingId !== fileId) return;

      if (global.plus && plus.audio && plus.audio.createPlayer) {
        var p;
        try { p = plus.audio.createPlayer(localPath); }
        catch (e) { finish(new Error('播放器起不来：' + (e && e.message))); return; }
        player = { stop: function () { try { p.stop(); } catch (e) {} } };
        if (onState) onState('playing');
        p.play(function () { finish(null); }, function (e) {
          finish(new Error('播放失败：' + ((e && e.message) || '')));
        });
        return;
      }

      if (typeof Audio === 'undefined') { finish(new Error('这个环境不能放声音')); return; }
      var a = new Audio(localPath);
      player = { stop: function () { try { a.pause(); a.currentTime = 0; } catch (e) {} } };
      if (onState) onState('playing');
      a.onended = function () { finish(null); };
      a.onerror = function () { finish(new Error('播放失败')); };
      var pr = a.play();
      if (pr && pr.catch) pr.catch(function (e) { finish(new Error('播放失败：' + e.message)); });
    }

    if (!global.plus || !plus.downloader) {
      playingId = fileId;
      if (onState) onState('playing');
      playLocal(url);
      return;
    }

    playingId = fileId;

    findLocal(fileId, name, function (localPath) {
      if (localPath) { playLocal(localPath); return; }

      if (onState) onState('loading');
      var rel = cachePathFor(fileId, name);

      ensureVoiceDir(function () {
      var task = plus.downloader.createDownload(url, { filename: rel }, function (t, status) {
        if (playingId !== fileId) return;
        if (status === 200 && t.filename) {
          var abs = t.filename;
          try { abs = plus.io.convertLocalFileSystemURL(t.filename); } catch (e) {}
          playCache[fileId] = abs;
          playLocal(abs);
        } else {
          finish(new Error('语音下载失败（' + status + '）'));
        }
      });
      try { task.start(); }
      catch (e) { finish(new Error('语音下载起不来')); }
      });
    });
  }

  function previewVoice(voice, onEnd) {
    stopVoice();
    if (!voice) { if (onEnd) onEnd(new Error('没有可试听的内容')); return; }
    playingId = PREVIEW_ID;

    function finish(err) {
      player = null; playingId = null;
      if (onEnd) onEnd(err);
    }

    if (global.plus && plus.audio && plus.audio.createPlayer && voice.path) {
      var path = voice.path;
      try { path = plus.io.convertLocalFileSystemURL(voice.path); } catch (e) {}
      var p;
      try { p = plus.audio.createPlayer(path); }
      catch (e) { finish(new Error('试听起不来：' + ((e && e.message) || ''))); return; }
      player = { stop: function () { try { p.stop(); } catch (e) {} } };
      p.play(function () { finish(null); }, function () { finish(new Error('试听失败')); });
      return;
    }

    if (typeof Audio === 'undefined') { finish(new Error('这个环境不能放声音')); return; }

    if (!global.URL || !global.URL.createObjectURL || typeof Blob === 'undefined') {
      finish(new Error('这个浏览器不支持试听（打包成 App 就能听）'));
      return;
    }

    var url = voice.blobURL;
    if (!url) {
      try {
        url = global.URL.createObjectURL(
          new Blob([voice.bytes], { type: voice.mime || 'audio/webm' }));
        voice.blobURL = url;
      } catch (e) { finish(new Error('试听起不来：' + ((e && e.message) || ''))); return; }
    }
    var a = new Audio(url);
    player = { stop: function () { try { a.pause(); a.currentTime = 0; } catch (e) {} } };
    a.onended = function () { finish(null); };
    a.onerror = function () { finish(new Error('试听失败')); };
    var pr = a.play();
    if (pr && pr.catch) pr.catch(function (e) { finish(new Error('试听失败：' + e.message)); });
  }

  var PREVIEW_ID = '__preview__';

  function releasePreview(voice) {
    if (!voice || !voice.blobURL) return;
    try {
      if (global.URL && global.URL.revokeObjectURL) global.URL.revokeObjectURL(voice.blobURL);
    } catch (e) {}
    voice.blobURL = '';
  }

  function isPreviewing() { return playingId === PREVIEW_ID; }

  function sendVoice(peerId, convId, voice, onPct, cb) {
    upload({
      peerId: peerId, convId: convId, kind: 'voice',
      name: voice.name, mime: voice.mime, bytes: voice.bytes,
      w: 0, h: 0, dur: voice.dur, burn: burnSecs()
    }, onPct, function (uerr, res) {
      if (uerr) { cb(uerr); return; }
      cb(null, { kind: 'voice', name: voice.name, size: voice.bytes.length,
                 fileId: res.fileId, dur: voice.dur });
    });
  }

  function autoName(prefix) {
    var hex = '';
    try {
      var b = C.randomBytes(6);
      for (var i = 0; i < b.length; i++) hex += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    } catch (e) {
      hex = String(Date.now()).slice(-8) + String(Math.random()).slice(2, 6);
    }
    return prefix + '_' + hex;
  }

  var OLD_AUTO_NAME = /^(voice|照片|图片|文件)_\d{8}_\d{6}(\.|$)/;

  function isAutoName(name) {
    return OLD_AUTO_NAME.test(String(name || '')) ||
           /^[vp]_[0-9a-f]{6,}$/.test(String(name || '').replace(/\.[a-z0-9]+$/i, ''));
  }

  function stamp() {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' +
           p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  function sizeStr(b) {
    b = Number(b) || 0;
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
    return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  global.HC.media = {
    pickImage: pickImage,
    pickFile: pickFile,
    compress: compress, compressTo: compressTo,
    upload: upload,
    sendImage: sendImage,
    sendFile: sendFile,
    sendVoice: sendVoice,
    recMode: recMode,
    recWhyNot: recWhyNot,
    recStart: recStart,
    recFinish: recFinish,
    recElapsed: recElapsed,
    recMarkCancel: recMarkCancel,
    playVoice: playVoice,
    previewVoice: previewVoice,
    releasePreview: releasePreview,
    isPreviewing: isPreviewing,
    stopVoice: stopVoice,
    nowPlaying: nowPlaying,
    voiceDiag: voiceDiag,
    askMic: askMic,
    REC_MAX: REC_MAX,
    fileURL: fileURL,
    download: download,
    sizeStr: sizeStr,
    stamp: stamp,
    autoName: autoName,
    isAutoName: isAutoName,
    MAX_SIDE: MAX_SIDE,
    QUALITY: QUALITY,
    CHUNK: CHUNK
  };
})(typeof window !== 'undefined' ? window : this);
