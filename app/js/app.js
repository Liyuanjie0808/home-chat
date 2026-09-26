(function (global) {
  'use strict';

  var C     = global.HC.crypto;
  var store = global.HC.store;
  var net   = global.HC.net;
  var media = global.HC.media;
  var ui    = global.HC.ui;

  function S() { return store.S; }
  function $(id) { return document.getElementById(id); }

  function on(id, fn) {
    var el = $(id);
    if (!el) { console.warn('[HomeChat] 页面上找不到 #' + id + '，跳过绑定'); return null; }
    el.onclick = fn;
    return el;
  }

  var curPage = null;
  var history = [];

  var PAGES = ['connect', 'convs', 'groups', 'newgroup', 'chat', 'profile', 'chatset',
               'contacts', 'settings', 'search', 'offline', 'changelog'];

  var APP_PAGES = ['convs', 'groups', 'newgroup', 'chat', 'profile', 'chatset',
                   'contacts', 'settings', 'search'];

  function inApp() {
    if (APP_PAGES.indexOf(curPage) < 0) return false;
    return !!S().cfg.userId;
  }

  function syncSecure() {
    if (!global.HC.secure) return;
    var on = (S().cfg.secure !== false) && inApp();
    try { global.HC.secure.apply(on); } catch (e) {}
  }

  function go(name, opts) {

    try { if (typeof hideExitHint === 'function') hideExitHint(); } catch (e) {}

    opts = opts || {};
    if (curPage === name && !opts.force) return;

    if (curPage && !opts.noHistory) history.push(curPage);

    PAGES.forEach(function (p) {
      var el = $('page-' + p);
      if (el) el.classList.remove('on', 'anim-in', 'anim-back', 'desk-on');
    });

    var el = $('page-' + name);
    if (el) {
      el.classList.add('on');
      el.classList.add(opts.back ? 'anim-back' : 'anim-in');
      setTimeout(function () { el.classList.remove('anim-in', 'anim-back'); }, 300);
    }

    if (isWide() && name === 'chat') {
      var side = (S().tab === 'groups') ? 'groups' : 'convs';
      var se = $('page-' + side);
      if (se) { se.classList.add('on', 'desk-on'); se.classList.remove('anim-in', 'anim-back'); }
    }

    curPage = name;

    syncSecure();
    refreshPage(name);
  }

  function back() {
    var prev = history.pop() || 'convs';
    go(prev, { back: true, noHistory: true });
  }

  function refreshPage(name) {
    switch (name) {
      case 'convs':    ui.renderPills(); ui.renderConvs(); break;
      case 'contacts': ui.renderPills(); ui.renderContacts(); break;
      case 'chat':     ui.renderChat(); break;
      case 'profile':  ui.renderProfile(); break;
      case 'chatset':  ui.renderChatSet(); break;
      case 'groups':   ui.renderPills(); ui.renderGroups(); break;
      case 'newgroup': ui.renderGroupPicker({}); onGroupPickChange(); break;
      case 'settings': ui.renderSettings(); ui.renderTabs('me'); break;
      case 'offline':  renderOffline(); break;
    }
  }

  var quitTimer = null;

  function renderOffline() {
    var cfg = S().cfg;
    var why = $('offlineWhy');

    try {
      var ttl = document.querySelector('#page-offline .connect-title');
      if (ttl) ttl.textContent = (net.netState && net.netState() === 'neterr')
        ? '目前无网络可用' : '连不上那台电脑';
    } catch (e) {}

    var cd = $('offlineCountdown');

    if (why) {

      var st = (net.netState && net.netState()) || 'serverdown';
      if (st === 'neterr') {
        why.innerHTML =
          '手机现在没有网络。<br>' +
          '打开 <b>WiFi</b>（或者关掉飞行模式）再点下面的按钮。';
      } else {
        why.innerHTML =
          '连不上 <b>' + ui.esc(cfg.serverAddr || '') + ':' + (cfg.serverPort || 8787) + '</b>。<br>' +
          '看看那台电脑是不是关机了、上面的程序还在不在跑。<br>' +
          '<span style="color:var(--hc-text-3)">已经停止尝试了，不会一直耗电。</span>';
      }
    }

    clearInterval(quitTimer);
    quitTimer = null;

    if (!cfg.autoQuit) {
      if (cd) cd.textContent = '（设置里可以打开「连不上就自动退出」）';
      return;
    }

    var left = 8;
    function tick() {
      if (cd) cd.innerHTML = '<b>' + left + '</b> 秒后自动退出 App（不想退就点上面按钮）';
      if (left <= 0) {
        clearInterval(quitTimer);
        quitTimer = null;
        quitApp();
        return;
      }
      left--;
    }
    tick();
    quitTimer = setInterval(tick, 1000);
  }

  function stopQuitCountdown() {
    clearInterval(quitTimer);
    quitTimer = null;
    var cd = $('offlineCountdown');
    if (cd) cd.textContent = '';
  }

  function quitApp() {
    stopQuitCountdown();
    try {
      if (global.plus && plus.runtime) { plus.runtime.quit(); return; }
    } catch (e) {}

    ui.toast('（这个环境下不能自动退出，真机上会退出）', 2600);
  }

  function isWide() {
    try { return (global.innerWidth || 0) >= 860; } catch (e) { return false; }
  }

  function openChat(convId, peerId) {
    if (!convId && peerId) convId = 'new:' + peerId;
    S().current = convId;
    S().peekPeer = null;
    S().peekConv = null;

    if (!store.convOf(convId) && peerId) {
      S().convs.unshift({
        id: convId, type: 'direct',
        peer: store.peerOf(peerId) || { id: peerId, name: '聊天', online: false },
        lastMsg: null, unread: 0, lastReadTs: 0, peerReadTs: 0
      });
    }

    if (convId.indexOf('new:') !== 0) net.markRead(convId);

    if (ui.setVoiceMode) ui.setVoiceMode(false);

    if (global.HC.app && global.HC.app.dropVoiceDraft) global.HC.app.dropVoiceDraft();

    go('chat');
    ui.renderChat();
    setTimeout(scrollChatToBottom, 60);

    saveSession({ conv: convId, scroll: null });

    if (convId.indexOf('new:') !== 0 && net.isOn()) {
      var have = store.msgsOf(convId).length;
      if (have < 30) {
        var oldest = have ? store.msgsOf(convId)[0].ts : 0;
        net.pullHistory(convId, oldest || 0);
      }
    }

    var box = $('chatScroll');
    setTimeout(function () { box.scrollTop = box.scrollHeight; }, 30);
  }

  function currentPeerId() {
    var convId = S().current;
    if (!convId) return null;
    if (convId.indexOf('new:') === 0) return convId.slice(4);
    var c = store.convOf(convId);
    return c && c.peer ? c.peer.id : null;
  }

  function canSendHere() {
    var convId = S().current;
    if (!convId) return false;
    if (store.isGroup(convId)) return true;
    return !!currentPeerId();
  }

  function doSend(text) {
    var convId = S().current;
    if (!convId) return;
    if (!canSendHere()) { ui.toast('这里发不了消息'); return; }
    var peerId = currentPeerId();

    if (!net.isOn()) {
      ui.toast('还没连上，连上后会自动发出去');
    }

    var cid = net.sendText(convId, text, peerId, BURN_SECS);
    if (cid) {
      ui.shortVibrate();
      ui.renderChat();
      var box = $('chatScroll');
      setTimeout(function () { box.scrollTop = box.scrollHeight; }, 20);
    }
  }

  function sendQuick(text) {
    ui.toggleQuick(false);
    doSend(text);
  }

  function retrySend(cid) {
    var convId = S().current;
    if (!convId || !cid) return;

    var list = store.msgsOf(convId);
    for (var i = 0; i < list.length; i++) {
      if (list[i].cid === cid) {
        if (!net.retry) { ui.toast('这个版本不支持重发'); return; }
        if (!net.retry(convId, list[i])) {
          ui.toast('还是没连上，等连上会自动发出去');
        }
        ui.renderChat();
        return;
      }
    }
  }

  function sendImageFlow(source) {
    var convId = S().current, peerId = currentPeerId();
    if (!canSendHere()) { ui.toast('这里发不了图片'); return; }
    if (!net.isOn()) { ui.toast('还没连上'); return; }

    ui.showUpload(source === 'camera' ? '正在拍照…' : '正在读图…', 0);

    media.sendImage(peerId, convId, source, function (pct) {
      ui.showUpload('正在上传', pct);
    }, function (err, res) {
      ui.hideUpload();
      if (err) { ui.toast('发送失败：' + err.message, 2600); return; }
      if (!res) return;

      ui.toast('已发送');
      ui.shortVibrate();
    });
  }

  function sendFileFlow() {
    var convId = S().current, peerId = currentPeerId();
    if (!canSendHere()) { ui.toast('这里发不了文件'); return; }
    if (!net.isOn()) { ui.toast('还没连上'); return; }

    media.sendFile(peerId, convId, function (pct) {
      ui.showUpload('正在上传文件', pct);
    }, function (err, res) {
      ui.hideUpload();
      if (err) { ui.toast('发送失败：' + err.message, 2600); return; }
      if (!res) return;
      ui.toast('已发送 ' + res.name);
      ui.shortVibrate();
    });
  }

  var BURN_SECS = 30;

  function doSendVoice(voice) {
    var convId = S().current, peerId = currentPeerId();
    if (!canSendHere()) { ui.toast('这里发不了语音'); return; }
    if (!net.isOn()) { ui.toast('还没连上，发不出去'); return; }

    ui.showUpload('正在发送语音', 0);
    media.sendVoice(peerId, convId, voice, function (pct) {
      ui.showUpload('正在发送语音', pct);
    }, function (err, res) {
      ui.hideUpload();
      if (err) { ui.toast('发送失败：' + err.message, 2600); return; }
      if (!res) return;
      ui.toast('语音已发送');
      ui.shortVibrate();
    });
  }

  function isDesktop() {
    if (global.plus) return false;
    try {
      if ((navigator.maxTouchPoints || 0) > 0) return false;
    } catch (e) {}
    return true;
  }

  var voiceDraft = null;

  function showVoiceDraft(voice) {

    if (voiceDraft) media.releasePreview(voiceDraft);
    voiceDraft = voice;
    var bar = $('voiceDraft');
    var t = $('vdTime');
    if (t) t.textContent = (voice.dur || 1) + '″';
    if (bar) bar.classList.add('on');
    setVdPlaying(false);
  }

  function hideVoiceDraft() {
    var bar = $('voiceDraft');
    if (bar) bar.classList.remove('on');
    media.stopVoice();
    setVdPlaying(false);
    media.releasePreview(voiceDraft);
    voiceDraft = null;
  }

  function setVdPlaying(on) {
    var b = $('vdPlay');
    if (b) b.classList.toggle('playing', !!on);
    var lbl = b && b.querySelector('span');
    if (lbl) lbl.textContent = on ? '停止' : '试听';
  }

  function toggleDraftPreview() {
    if (!voiceDraft) return;

    if (media.isPreviewing && media.isPreviewing()) {
      media.stopVoice();
      setVdPlaying(false);
      return;
    }

    setVdPlaying(true);
    media.previewVoice(voiceDraft, function (err) {
      setVdPlaying(false);
      if (err) ui.toast(err.message, 2600);
    });
  }

  function sendDraftVoice() {
    var v = voiceDraft;
    if (!v) return;
    media.stopVoice();
    setVdPlaying(false);

    var bar = $('voiceDraft');
    if (bar) bar.classList.remove('on');

    var keep = v;
    voiceDraft = null;

    media.releasePreview(keep);
    ui.shortVibrate();
    doSendVoice(keep);
  }

  function redoDraftVoice() {
    hideVoiceDraft();
    var btn = $('holdTalk');
    if (btn) {
      btn.classList.remove('hint-pulse');
      void btn.offsetWidth;
      btn.classList.add('hint-pulse');
      setTimeout(function () { btn.classList.remove('hint-pulse'); }, 2400);
    }
    ui.toast('按住「按住 说话」重新录', 2200);
  }

  function saveSession(snap) {
    try {
      if (global.HC.session) global.HC.session.save(snap);
    } catch (e) {}
  }

  var pullLock = false;

  function flushSession() {
    try {
      var box = $('chatScroll');
      var ta = $('inputText');
      if (S().current) {
        saveSession({
          conv: S().current,
          text: ta ? ta.value : '',
          scroll: box ? box.scrollTop : 0
        });
      }
      if (global.HC.session) global.HC.session.flush();
    } catch (e) {}
  }

  function restoreSession() {
    var s = null;
    try { s = global.HC.session ? global.HC.session.peek() : null; } catch (e) {}
    if (!s) return false;

    var ta = $('inputText');

    if (s.voice && ui.setVoiceMode) ui.setVoiceMode(true);

    if (s.text && ta) {
      ta.value = s.text;

      try {
        var ev;
        try { ev = new Event('input'); }
        catch (e1) { ev = document.createEvent('Event'); ev.initEvent('input', true, true); }
        ta.dispatchEvent(ev);
      } catch (e2) {

        try { if (ui.syncSendBtn) ui.syncSendBtn(); } catch (e3) {}
      }

      try {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      } catch (e) {}
    }

    var convOk = s.conv && s.conv.indexOf('new:') !== 0 && store.convOf(s.conv);
    if (!convOk) return !!(s.text);

    ui.toast('回到刚才的聊天');
    openChat(s.conv);

    if (s.scroll != null) {
      setTimeout(function () {
        var box = $('chatScroll');
        if (!box) return;
        var max = Math.max(0, box.scrollHeight - box.clientHeight);
        var want = Math.min(s.scroll, max);

        if (Math.abs(max - want) > 40) box.scrollTop = want;
      }, 260);
    }

    return true;
  }

  var lastExitHint = 0;
  var EXIT_WINDOW_MS = 2500;

  function exitHint() {

    if (!global.plus) return;

    var now = Date.now();
    if (lastExitHint && now - lastExitHint < EXIT_WINDOW_MS) {
      hideExitHint();
      ui.shortVibrate();
      try { plus.runtime.quit(); } catch (e) {}
      return;
    }

    lastExitHint = now;
    showExitHint();
    ui.shortVibrate();
  }

  function showExitHint() {
    var el = $('exitHint');
    if (!el) { ui.toast('再划一次退出软件', 2500); return; }
    el.classList.add('on');
    clearTimeout(showExitHint._t);
    showExitHint._t = setTimeout(hideExitHint, EXIT_WINDOW_MS);
  }

  function hideExitHint() {
    var el = $('exitHint');
    if (el) el.classList.remove('on');
    clearTimeout(showExitHint._t);
    lastExitHint = 0;
  }

  function confirmExit() {
    var doQuit = function () {
      try { plus.runtime.quit(); } catch (e) {}
    };

    if (!global.plus) return;

    try {
      plus.nativeUI.confirm(
        '退出后收不到新消息，也不会响。',
        function (e) {
          if (e && e.index === 1) doQuit();
        },
        '要退出 Home Chat 吗？',
        ['再看看', '退出']
      );
      return;
    } catch (e) {}

    try { if (global.confirm('要退出 Home Chat 吗？')) doQuit(); } catch (e2) {}
  }

  function scrollChatToBottom() {
    var box = $('chatScroll');
    if (!box) return;
    box.scrollTop = box.scrollHeight;
  }

  function bindHoldTalk() {
    var btn = $('holdTalk');
    if (!btn) return;
    var txt  = $('holdTalkText');
    var box  = $('recUI');
    var ring = $('recRing');
    var tm   = $('recTime');
    var hint = $('recHint');
    var wave = $('recWave');

    var RING_LEN = 439.8;
    var pressing = false, cancelling = false, startY = 0;

    function fmt(sec) {
      var m = Math.floor(sec / 60), s = sec % 60;
      return m + ':' + (s < 10 ? '0' + s : s);
    }

    function paintBar() {
      btn.classList.toggle('holding', pressing && !cancelling);
      btn.classList.toggle('cancelling', pressing && cancelling);
      if (!txt) return;

      if (btn.classList.contains('nomic')) { txt.textContent = '麦克风不可用'; return; }
      txt.textContent = !pressing ? '按住 说话'
                                 : (cancelling ? '松开 取消' : '松开 发送');
    }

    function paintUI() {
      if (box) {
        box.classList.toggle('on', pressing);
        box.classList.toggle('cancelling', cancelling);
      }
      if (hint && box && !box.classList.contains('arming')) {
        hint.textContent = cancelling ? '松开手指，取消发送' : '松开发送，上滑取消';
      }

      if (wave) wave.classList.toggle('on',
        pressing && !cancelling && !(box && box.classList.contains('arming')));
    }

    function begin(y) {
      if (pressing) return;

      if (btn && btn.classList.contains('nomic')) {
        ui.toast(btn.dataset.why || '这个环境录不了音', 4200);
        ui.shortVibrate();
        return;
      }

      if (box) { box.classList.add('on', 'arming'); box.classList.remove('failed'); }
      if (hint) hint.textContent = '正在准备麦克风…';

      var readyYet = false;
      function goLive() {
        if (readyYet) return;
        readyYet = true;
        if (box) box.classList.remove('arming');
        if (hint) hint.textContent = cancelling ? '松开手指，取消发送' : '松开发送，上滑取消';
        if (wave) wave.classList.add('on');
      }

      var r = media.recStart(function (sec) {
        if (tm) tm.textContent = fmt(sec);

        if (ring) {
          var done = Math.min(1, sec / media.REC_MAX);
          ring.style.strokeDashoffset = String(RING_LEN * done);
        }
      }, function () {
        finish(false);
      }, function (why) {

        pressing = false; cancelling = false;
        media.recMarkCancel(true);
        if (box) { box.classList.remove('arming'); box.classList.add('failed'); }
        if (hint) hint.textContent = why || '录音起不来';
        paintBar();
        if (btn) { btn.classList.remove('holding'); }
        ui.toast(why || '录音起不来', 4200);
        setTimeout(function () { if (box) box.classList.remove('on', 'failed'); }, 1600);
      }, function () {
        goLive();
      });

      setTimeout(goLive, 1500);

      if (!r.ok) { ui.toast(r.msg, 4200); return; }

      pressing = true; cancelling = false; startY = y;
      media.recMarkCancel(false);
      if (tm) tm.textContent = '0:00';
      if (ring) ring.style.strokeDashoffset = '0';
      if (box) box.classList.remove('tooshort');
      paintBar(); paintUI();
      ui.shortVibrate();
    }

    function move(y) {
      if (!pressing) return;
      var want = (startY - y) > 70;
      if (want === cancelling) return;
      cancelling = want;
      media.recMarkCancel(want);
      if (want) ui.shortVibrate();
      paintBar(); paintUI();
    }

    function finish(cancel) {
      if (!pressing) return;
      pressing = false;
      var drop = !!cancel || cancelling;
      cancelling = false;
      paintBar(); paintUI();

      media.recFinish(drop, function (err, voice) {
        if (drop) return;
        if (err) { ui.toast('录音失败：' + err.message, 3000); return; }
        if (!voice) return;
        if (voice.dur < 1) { ui.toast('说话时间太短', 1800); return; }

        showVoiceDraft(voice);
      });
    }

    btn.addEventListener('touchstart', function (e) {
      e.preventDefault();
      begin(e.touches[0].clientY);
    }, { passive: false });

    btn.addEventListener('touchmove', function (e) {
      if (!pressing) return;
      e.preventDefault();
      move(e.touches[0].clientY);
    }, { passive: false });

    btn.addEventListener('touchend', function (e) { e.preventDefault(); finish(false); });
    btn.addEventListener('touchcancel', function () { finish(true); });

    btn.addEventListener('mousedown', function (e) { e.preventDefault(); begin(e.clientY); });
    if (global.addEventListener) {
      global.addEventListener('mousemove', function (e) { move(e.clientY); });
      global.addEventListener('mouseup', function () { finish(false); });
    }
  }

  function parseAddr(raw) {
    var s = String(raw || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    var port = 8787;
    var m = s.match(/^(.*?):(\d{1,5})$/);
    if (m) { s = m[1]; port = parseInt(m[2], 10); }
    return { addr: s, port: port };
  }

  function doConnect() {
    var raw = $('inAddr').value;
    var pwd = $('inPwd').value;
    var nick = ($('inName').value || '').trim().slice(0, 16);
    var p = parseAddr(raw);

    if (!p.addr) {
      $('inAddr').classList.add('hc-shake');
      setTimeout(function () { $('inAddr').classList.remove('hc-shake'); }, 450);
      ui.toast('请填电脑的地址，比如 192.168.1.23');
      return false;
    }
    if (!pwd) {
      $('inPwd').classList.add('hc-shake');
      setTimeout(function () { $('inPwd').classList.remove('hc-shake'); }, 450);
      ui.toast('请填密码');
      return false;
    }

    var cfg = S().cfg;
    var keyChanged = (cfg.serverAddr !== p.addr) || (cfg.pwd !== pwd);

    cfg.serverAddr = p.addr;
    cfg.serverPort = p.port;
    cfg.pwd = pwd;
    if (nick) cfg.name = nick;
    store.ensureDeviceId();

    if (keyChanged || !store.hasKey()) {
      setBtnBusy(true, '正在准备…');

      setTimeout(function () {
        try {
          var mk = C.deriveMaster(pwd, 300000);
          store.setMasterKey(mk);
        } catch (e) {
          setBtnBusy(false);
          ui.toast('准备失败：' + e.message, 3000);
          return;
        }
        store.save();
        setBtnBusy(false);
        boot2Go();
      }, 60);
      return true;
    }

    store.save();
    boot2Go();
    return true;
  }

  function setBtnBusy(busy, text) {
    var b = $('btnConnect');
    var t = $('btnConnectText');
    b.disabled = !!busy;
    t.innerHTML = busy ? '<span class="hc-spin"></span> ' + (text || '处理中…') : '连 接';
  }

  function renderConnectHint() {
    var el = $('connectHint');
    if (!el) return;

    var e = global.HC.env ? global.HC.env() : 'lan';
    var dim = '<span style="color:var(--hc-text-3)">填一次就行，以后自动连</span>';

    if (e === 'local') {

      el.innerHTML =
        '填 <b>127.0.0.1</b> 就行（就是这台电脑）<br>' + dim;
      return;
    }

    if (e === 'app') {
      el.innerHTML =
        '填<b>那台一直开着的电脑</b>的地址<br>' +
        '不知道的话，问一下家里管电脑的人<br>' + dim;
      return;
    }

    el.innerHTML =
      '填<b>那台一直开着的电脑</b>的地址，形如 192.168.1.x<br>' + dim;
  }

  function boot2Go() {
    var cfg = S().cfg;
    $('inAddr').value = cfg.serverAddr;
    $('inPwd').value = cfg.pwd;
    if ($('inName')) $('inName').value = cfg.name || '';
    net.connect();
    go('convs', { noHistory: true });
    history = ['convs'];
  }

  function testConn() {
    var p = parseAddr($('inAddr').value);
    if (!p.addr) { ui.toast('先填地址'); return; }
    ui.toast('正在测试…');

    var url = 'http://' + p.addr + ':' + p.port + '/ping';
    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      ui.toast('连不上。确认手机和电脑连的是同一个 WiFi', 3200);
    }, 4000);

    try {
      fetch(url).then(function (r) { return r.json(); }).then(function (j) {
        if (done) return;
        done = true; clearTimeout(timer);
        if (j && j.ok) ui.toast('通了！服务端名字：' + (j.name || 'Home Chat'), 2600);
        else ui.toast('有响应，但不太对', 2600);
      }).catch(function () {
        if (done) return;
        done = true; clearTimeout(timer);
        ui.toast('连不上。确认手机和电脑连的是同一个 WiFi', 3200);
      });
    } catch (e) {
      clearTimeout(timer);
      ui.toast('这个环境不支持测试，直接点连接试试');
    }
  }

  var searchTimer = null;

  var searchConv = null;

  var searchNames = false;

  function openSearch() {
    searchConv = null;
    searchNames = true;
    go('search');
    var box = $('searchResults');
    var inp = $('inSearch');
    if (inp) { inp.value = ''; inp.placeholder = '搜索名字'; }
    if (box) ui.renderSearch({ q: '', hits: [], names: true });
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 260);
  }

  function openProfileOf(peerId) {
    if (!peerId) return;

    if (peerId === S().cfg.userId) { go('settings'); return; }

    var conv = ui.findConvWith(peerId);
    S().peekPeer = peerId;
    S().peekConv = conv ? conv.id : null;
    go('profile');
  }

  function openFromSearch(hit) {
    if (!hit) return;
    S().current = null;
    openChat(hit.convId, hit.peerId || null);
  }

  function openChatSearch() {
    var convId = S().current;
    if (!convId) return;

    var c = store.convOf(convId);
    var name = (c && (c.title || (c.peer && c.peer.name))) || '这个聊天';

    searchConv = convId;
    searchNames = false;
    go('search');

    var inp = $('inSearch');
    if (inp) {
      inp.value = '';
      inp.placeholder = '在「' + name + '」里搜索';
    }
    ui.renderSearch({ q: '', hits: [], conv: convId, scopeName: name });
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 160);
  }

  function doSearch(q) {
    q = String(q || '').trim();
    var clr = $('btnSearchClear');
    if (clr) clr.classList.toggle('on', q.length > 0);

    if (searchNames) {
      ui.renderSearch({ q: q, hits: ui.searchNames(q), names: true });
      return;
    }

    if (!q) {
      ui.renderSearch({ q: '', hits: [], conv: searchConv });
      return;
    }

    if (searchConv) {
      var c = store.convOf(searchConv);
      var nm = (c && (c.title || (c.peer && c.peer.name))) || '这个聊天';
      ui.renderSearch({
        q: q,
        hits: ui.searchLocal(searchConv, q),
        conv: searchConv,
        scopeName: nm,
        local: true
      });
      return;
    }

    if (!net.isOn()) { ui.toast('还没连上'); return; }
    net.search(q);
  }

  function jumpTo(hit) {
    if (!hit) return;

    var sameConv = (S().current === hit.conv);

    if (!sameConv) {
      S().current = null;
      openChat(hit.conv, null);
    } else {
      go('chat');
    }

    setTimeout(function () {
      var box = $('chatScroll');
      if (!box || !hit.id) return;
      var el = null;
      try { el = box.querySelector('[data-mid="' + hit.id + '"]'); } catch (e) {}
      if (!el) { scrollChatToBottom(); return; }

      try {
        box.scrollTop = Math.max(0, el.offsetTop - box.clientHeight / 2);
      } catch (e) {}

      el.classList.remove('hc-flash');
      void el.offsetWidth;
      el.classList.add('hc-flash');
      setTimeout(function () { el.classList.remove('hc-flash'); }, 1800);
    }, 260);
  }

  function msgMenu(msgId) {
    var convId = S().current;
    var list = store.msgsOf(convId);
    var m = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === msgId) { m = list[i]; break; }
    if (!m) return;

    var mine = m.from === S().cfg.userId;
    var items = [];

    if (mine && !m.revoked && (Date.now() - (m.ts || 0)) < 2 * 60 * 1000) {
      items.push({ icon: 'i-clock-arrow', t: '撤回这条消息', fn: function () {
        net.recall(convId, msgId);
        ui.toast('已撤回');
      } });
    }

    if (m.kind === 'text' && !m.revoked) {
      items.push({ icon: 'i-copy', t: '复制文字', fn: function () {

        try {
          if (global.plus && plus.navigator && plus.navigator.setClipboard) {
            plus.navigator.setClipboard(m.body); ui.toast('已复制');
          } else {
            ui.toast('防复制开着，复制不了');
          }
        } catch (e) { ui.toast('复制失败'); }
      } });
    }

    if (!mine) {
      items.push({ icon: 'i-tag', t: '给他起个备注名', fn: function () { setPeerRemark(m.from); } });
      items.push({ icon: 'i-chat', t: '敲他一下', fn: function () { net.knock(m.from); } });
    }

    items.push({ icon: 'i-info', t: '消息时间：' + new Date(m.ts).toLocaleString('zh-CN'), fn: function () {} });

    if (items.length) ui.openSheet(items);
  }

  function openNewGroup() {
    $('inGroupName').value = '';
    go('newgroup');
    ui.renderGroupPicker({});
    onGroupPickChange();
  }

  function onGroupPickChange() {
    var n = ui.pickedMembers().length;
    var name = ($('inGroupName').value || '').trim();
    var btn = $('btnCreateGroup');
    if (!btn) return;

    btn.disabled = !(n >= 2);
    btn.textContent = n >= 2 ? ('创建(' + (n + 1) + ')') : '创建';
  }

  function doCreateGroup() {
    var name = ($('inGroupName').value || '').trim();
    var members = ui.pickedMembers();

    if (members.length < 2) { ui.toast('至少选 2 个人'); return; }
    if (!net.isOn()) { ui.toast('还没连上'); return; }

    net.createGroup(name || '新群聊', members);
    ui.toast('群聊「' + (name || '新群聊') + '」建好了', 2400);
    ui.vibrate(2);

    setTimeout(function () { go('groups', { noHistory: true }); }, 400);
  }

  function changeMyAvatar() {
    if (!global.HC.media) { ui.toast('这个环境换不了头像'); return; }

    global.HC.media.pickImage('gallery', function (err, dataURL) {
      if (err) { ui.toast('选图失败：' + err.message); return; }
      if (!dataURL) return;

      global.HC.media.compressTo(dataURL, 200, 0.82, function (cerr, c) {
        if (cerr) { ui.toast('处理失败：' + cerr.message); return; }
        S().cfg.avatar = c.dataURL;
        store.save();
        ui.renderSettings();
        net.setProfile(c.dataURL);
        ui.toast('头像已更新');
        ui.vibrate(1);
      });
    });
  }

  function setPeerRemark(peerId) {
    var cur = (S().remarks && S().remarks[peerId]) || '';
    var real = (store.peerOf(peerId) || {}).name || '';
    var v = prompt('给他起个备注名（只有你自己看得到）\n\n原昵称：' + real, cur);
    if (v == null) return;
    net.setRemark(peerId, String(v).trim().slice(0, 16));
    ui.toast(v.trim() ? ('备注已改成「' + v.trim() + '」') : '备注已清除');
  }

  function newChatPicker() {
    var peers = (S().peers || []).filter(function (p) { return p.id !== S().cfg.userId; });
    if (!peers.length) {
      ui.toast('还没有家庭成员。' + global.HC.whereApprove(), 3600);
      go('contacts');
      return;
    }
    ui.openSheet(peers.map(function (p) {
      return {
        dot: p.online ? 'on' : '',
        t: p.name,
        fn: function () {
          var c = ui.findConvWith(p.id);
          openChat(c ? c.id : ('new:' + p.id), p.id);
        }
      };
    }));
  }

  function bind() {

    on('btnConnect', doConnect);
    on('btnTest', testConn);
    $('inAddr').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('inName').focus(); });
    $('inName').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('inPwd').focus(); });
    $('inPwd').addEventListener('keydown', function (e) { if (e.key === 'Enter') doConnect(); });

    document.querySelectorAll('.hc-tabbar .tb').forEach(function (el) {
      el.onclick = function () {
        var t = el.dataset.tab;
        var page = t === 'groups' ? 'groups' : (t === 'me' ? 'settings' : 'convs');
        go(page, { noHistory: true });

        history = [page];
        ui.renderTabs(t);
      };
    });

    on('btnNewGroup', openNewGroup);
    on('btnNewGroupBack', back);
    on('btnCreateGroup', doCreateGroup);
    $('inGroupName').addEventListener('input', onGroupPickChange);

    on('btnNewChat', newChatPicker);
    if ($('btnSearch')) on('btnSearch', openSearch);
    on('pill1', function () { if (S().conn !== 'on') net.manualReconnect(); });

    on('btnSearchBack', function () { S().current = null; back(); });
    on('btnSearchClear', function () { $('inSearch').value = ''; doSearch(''); });
    $('inSearch').addEventListener('input', function () {
      clearTimeout(searchTimer);
      var v = $('inSearch').value;
      searchTimer = setTimeout(function () { doSearch(v); }, 320);
    });
    $('inSearch').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { clearTimeout(searchTimer); doSearch($('inSearch').value); }
    });

    on('btnChatBack', function () {
      S().current = null;
      ui.toggleQuick(false);
      back();
    });

    on('btnChatMore', function () {
      if (!S().current) return;
      ui.toggleQuick(false);
      go('chatset');
    });

    on('btnProfileBack', back);
    on('btnChatSetBack', back);

    function editRemark(peerId) {
      var peer = peerId ? store.peerOf(peerId) : ui.currentPeer();
      if (!peer && peerId) peer = { id: peerId, name: '' };
      if (!peer) return;

      var cur  = (S().remarks && S().remarks[peer.id]) || '';
      var real = peer.realName || peer.name || '';

      ui.inputSheet({
        title: '备注名（只有你自己看得到）',
        placeholder: real ? ('原昵称：' + real) : '给 TA 起个名字',
        value: cur,
        max: 16,
        okText: cur ? '保存' : '加上备注',
        onOk: function (v) {
          net.setRemark(peer.id, v);
          ui.toast(v ? ('备注已改成「' + v + '」') : '备注已清除');
          if (curPage === 'profile') ui.renderProfile();
          if (curPage === 'chat')    ui.renderChat(true);
        }
      });
    }

    on('rowProfRemark', function () { editRemark(); });

    on('rowProfRemarkClear', function () {
      var peer = ui.currentPeer();
      if (!peer) return;
      if (!confirm('清除给「' + (peer.name || '') + '」的备注？')) return;
      net.setRemark(peer.id, '');
      ui.toast('备注已清除');
      ui.renderProfile();
    });

    on('rowProfFind', function () { openChatSearch(); });
    on('rowProfSend', function () { back(); });
    on('rowProfGroupSet', function () { go('chatset'); });

    on('csRowPeer', function () { go('profile'); });
 on('csRowRename', function () {
      var c = ui.currentConv();
      if (!c) return;
      ui.inputSheet({
        title: '群名称',
        value: c.title || '',
        max: 24,
        placeholder: '给群起个名字，比如「一家人」',
        onOk: function (v) {
          if (!v) return;
          c.title = v;
          ui.renderChatSet();
          ui.renderChat(true);
          ui.toast('群名已改成「' + v + '」');
          net.renameGroup(c.id, v, null);
        }
      });
    });

    on('csRowFind', function () { openChatSearch(); });
    on('csRowClean', function () {
      var convId = S().current;
      if (!convId) return;
      if (!confirm('清空这个聊天的本机记录？\n\n' +
                   '· 只清你这台设备上的\n' +
                   '· 对方的记录不受影响\n' +
                   '· 清掉之后拉不回来了')) return;
      store.clearMsgs(convId);
      ui.renderChat(true);
      ui.renderChatSet();
      ui.toast('已清空本机记录');
    });

    on('csAddMember', function () {
      var c = ui.currentConv();
      if (!c) return;
      var inGroup = {};
      (c.members || []).forEach(function (m) { inGroup[m.id] = 1; });

      var rest = (S().peers || []).filter(function (p) {
        return p.id !== S().cfg.userId && !inGroup[p.id];
      });
      if (!rest.length) { ui.toast('家里人都已经在群里了'); return; }

      ui.openSheet(rest.map(function (p) {
        return {
          dot: p.online ? 'on' : '',
          t: p.name,
          fn: function () {
            net.addGroupMembers(c.id, [p.id]);
            ui.toast('已把「' + p.name + '」拉进群');
          }
        };
      }));
    });

    function showGroupMembers(c) {
      var list = c.members || [];
      ui.openSheet(list.map(function (m) {
        return {
          dot: m.online ? 'on' : '',
          t: m.name + (m.id === c.owner ? '（群主）' : ''),
          fn: function () {

            if (m.id === S().cfg.userId) { ui.toast('这是你自己'); return; }
            var conv = ui.findConvWith(m.id);
            openChat(conv ? conv.id : ('new:' + m.id), m.id);
          }
        };
      }));
    }

    function showGroupMembers(c) {
      var items = (c.members || []).map(function (m) {
        return {
          dot: m.online ? 'on' : '',
          t: m.name + (m.id === S().cfg.userId ? '（我）' : ''),
          fn: function () {
            if (m.id === S().cfg.userId) return;
            var cc = ui.findConvWith(m.id);
            S().current = null; back();
            setTimeout(function () { openChat(cc ? cc.id : ('new:' + m.id), m.id); }, 200);
          }
        };
      });
      items.push({ icon: 'i-info', t: '群主：' + ((c.members.filter(function(m){return m.id===c.owner;})[0]||{}).name || '?'), fn: function () {} });
      ui.openSheet(items);
    }
    on('pill2', function () { if (S().conn === 'off') net.connect(); });

    var ta = $('inputText');
    var chatPage = $('page-chat');

    function autoGrow() {
      ta.style.height = 'auto';
      var h = Math.min(ta.scrollHeight || 24, 108);
      ta.style.height = h + 'px';
    }

    function syncSendBtn() {
      var has = ta.value.trim().length > 0;
      var bar = $('barText');
      if (bar) bar.classList.toggle('has-text', has);
    }

    ta.addEventListener('input', function () {
      autoGrow(); syncSendBtn();

      saveSession({ text: ta.value });
    });

    ta.addEventListener('focus', function () {
      ui.toggleQuick(false);

      setTimeout(scrollChatToBottom, 140);
      setTimeout(scrollChatToBottom, 420);
    });

    ta.addEventListener('blur', function () {

      setTimeout(autoGrow, 80);
    });

    ta.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
      if (!isDesktop()) return;

      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      sendFromInput();
    });

    function sendFromInput() {
      var v = ta.value;
      if (!v.trim()) return;

      var btn = $('btnSend');
      if (btn) { btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); }
      ta.classList.remove('clearing'); void ta.offsetWidth; ta.classList.add('clearing');

      ta.value = '';
      ta.style.height = 'auto';
      autoGrow(); syncSendBtn();
      saveSession({ text: '' });
      doSend(v);
    }

    on('btnSend', sendFromInput);

    function openAttachSheet() {
      ui.closeSheet();
      ui.toggleQuick(false);
      ui.openSheet([
        { icon: 'i-camera', t: '拍照',     fn: function () { sendImageFlow('camera'); } },
        { icon: 'i-photo',  t: '相册',     fn: function () { sendImageFlow('gallery'); } },
        { icon: 'i-file',   t: '文件',     fn: sendFileFlow },
        { icon: 'i-bolt',   t: '快捷短语', fn: function () { ui.toggleQuick(true); } }
      ]);
    }

    on('btnPlus', openAttachSheet);
    on('btnPlusV', openAttachSheet);

    var voiceMode = false;

    function paintMicAbility() {
      var btn = $('holdTalk');
      var txt = $('holdTalkText');
      if (!btn) return;

      var ok = true, why = '';
      try {
        ok = !!media.recMode();
        if (!ok) why = media.recWhyNot();
      } catch (e) { ok = false; why = '录音模块没起来'; }

      btn.classList.toggle('nomic', !ok);
      if (txt) {
        if (!ok) txt.textContent = '麦克风不可用';
        else if (!btn.classList.contains('holding') && !btn.classList.contains('cancelling')) {
          txt.textContent = '按住 说话';
        }
      }
      btn.dataset.why = why;
    }
    ui.paintMicAbility = paintMicAbility;

    function setVoiceMode(on) {
      voiceMode = !!on;
      if (chatPage) chatPage.classList.toggle('mode-voice', voiceMode);
      if (voiceMode) {
        ui.toggleQuick(false);
        try { ta.blur(); } catch (e) {}
        paintMicAbility();
      } else {

        setTimeout(function () { try { ta.focus(); } catch (e) {} }, 90);
      }
    }

    on('btnToVoice', function () { setVoiceMode(true); });
    on('btnToText',  function () {

      setVoiceMode(false);
    });

    on('vdPlay',   toggleDraftPreview);
    on('vdRedo',   redoDraftVoice);
    on('vdCancel', function () { hideVoiceDraft(); ui.toast('已取消'); });
    on('vdSend',   sendDraftVoice);

    ui.setVoiceMode = setVoiceMode;
    ui.syncSendBtn  = syncSendBtn;

    bindHoldTalk();
    paintMicAbility();

    var chatScroll = $('chatScroll');

    var scrollSaveTimer = null;
    chatScroll.addEventListener('scroll', function () {
      if (curPage !== 'chat' || !S().current) return;
      if (scrollSaveTimer) return;
      scrollSaveTimer = setTimeout(function () {
        scrollSaveTimer = null;
        saveSession({ conv: S().current, scroll: chatScroll.scrollTop });
      }, 600);
    }, { passive: true });

    chatScroll.addEventListener('scroll', function () {
      if (curPage !== 'chat' || !S().current) return;
      if (chatScroll.scrollTop > 60) return;

      var pg = ui.pag();
      if (pg.loading || pg.done || pullLock) return;
      if (!net.isOn()) return;

      var list = store.msgsOf(S().current);
      if (!list.length) return;

      if (list.length >= 300) { pg.done = true; ui.renderChat(); return; }

      pg.loading = true;
      pullLock = true;
      ui.renderChat(true);
      net.pullHistory(S().current, list[0].ts);

      setTimeout(function () { pullLock = false; }, 4000);
    }, { passive: true });

    if ($('btnContactsBack')) on('btnContactsBack', back);

    $('setAddr').addEventListener('change', function () {
      var p = parseAddr($('setAddr').value);
      if (!p.addr) return;
      S().cfg.serverAddr = p.addr;
      S().cfg.serverPort = p.port;
      store.save();
      ui.toast('地址已改，正在重连…');

      net.manualReconnect();
      ui.renderSettings();
    });

    on('rowReconnect', function () {
      ui.toast('正在重连…');
      net.manualReconnect();
    });

    on('swAutoQuit', function () {
      S().cfg.autoQuit = !S().cfg.autoQuit;
      store.save();
      ui.renderSettings();
      ui.toast(S().cfg.autoQuit
        ? '开：连不上就自动退出 App'
        : '关：连不上就停在提示页等你处理');
    });

    on('btnRetryConnect', function () {
      stopQuitCountdown();
      $('btnRetryText').innerHTML = '<span class="hc-spin"></span> 正在连接…';
      net.manualReconnect();

      setTimeout(function () {
        var t = $('btnRetryText');
        if (t && S().conn !== 'on') t.textContent = '重新连接';
      }, 5000);
    });

    on('btnOfflineSettings', function () {
      stopQuitCountdown();
      go('settings');
    });

    on('rowBrandJump', function () {
      ui.brandJump();
    });

    on('rowNotif', function () {
      if (!global.plus) { ui.toast('浏览器没有系统通知'); return; }
      var nst = S().notifyState || (global.HC.notify ? global.HC.notify.getState() : 'unknown');
      if (nst === 'on') { ui.toast('通知是开着的'); return; }
      if (global.HC.app && global.HC.app.openNotifSettings && global.HC.app.openNotifSettings()) {
        ui.toast('已跳到系统通知设置，把开关打开', 3600);
        return;
      }
      ui.toast('请到「设置 → 应用 → Home Chat → 通知」里打开', 4600);
    });

    on('rowVoiceDiag', function () { ui.runVoiceDiag(); });

    on('rowChangelog', function () { ui.renderChangelog(); go('changelog'); });
    on('chgBack', function () { back(); });
    on('diagClose', function () { ui.diagClose(); });
    on('diagMask', function (e) {

      if (e.target && e.target.id === 'diagMask') ui.diagClose();
    });

    on('btnQuitApp', function () {

      confirmExit();
    });

    on('setAvatar', changeMyAvatar);

    on('setName', function () {
      var v = prompt('你的昵称', S().cfg.name || '');
      if (v == null) return;
      S().cfg.name = String(v).trim().slice(0, 16);
      store.save();
      syncSecure();
      ui.renderSettings();

      net.connect();
      ui.toast('昵称已改');
    });

    on('swDark', function () {
      S().cfg.dark = !S().cfg.dark;
      store.save();
      ui.applyTheme();
      ui.renderSettings();
    });

    on('swBig', function () {
      S().cfg.big = !S().cfg.big;
      store.save();
      ui.applyTheme();
      ui.renderSettings();
    });

    $('segVib').querySelectorAll('.s').forEach(function (el) {
      el.onclick = function () {
        S().cfg.vibrate = +el.dataset.v;
        store.save();
        ui.renderSettings();
        ui.vibrate(S().cfg.vibrate);
      };
    });

    on('rowQuick', function () {
      ui.inputSheet({
        title: '快捷短语（一行一条，最多 12 条）',
        placeholder: '吃饭了\n在忙，等会儿回\n收到',
        value: store.quickPhrases().join('\n'),
        multiline: true,
        rows: 8,
        max: 600,
        okText: '保存',
        onOk: function (v) {

          var list = String(v || '')
            .replace(/\r\n?/g, '\n')
            .split('\n')
            .map(function (x) { return x.trim(); })
            .filter(function (x) { return x.length; })
            .slice(0, 12);

          S().cfg.quick = list;
          store.save();
          if (curPage === 'settings') ui.renderSettings();
          ui.toast(list.length ? ('已保存 ' + list.length + ' 条快捷短语')
                               : '已清空快捷短语');
        }
      });
    });

    on('rowClear', function () {
      if (!confirm('清除本机数据？\n\n' +
                   '会清掉：电脑地址、密码、昵称、头像\n' +
                   '不会动：你的聊天记录（' + global.HC.whereArchive() + '），要单独清\n\n' +
                   '下次连上重新输密码就能拉回来。')) return;
      try { if (global.HC.session) global.HC.session.clear(); } catch (e) {}
      store.reset();
      location.reload();
    });

    on('sheetMask', function (e) {
      if (e.target === $('sheetMask')) ui.closeSheet();
    });

    on('viewerClose', function (e) {
      e.stopPropagation();
      $('viewer').classList.remove('on');
    });
    on('viewer', function () { $('viewer').classList.remove('on'); });

    global.addEventListener('resize', function () {
      if (curPage === 'chat' || curPage === 'convs' || curPage === 'groups') {
        refreshPage(curPage);
        if (isWide() && curPage !== 'chat') {
          PAGES.forEach(function (p) {
            var el = $('page-' + p);
            if (el && p !== curPage && p !== 'chat') el.classList.remove('desk-on');
          });
        }
      }
    }, { passive: true });

    document.addEventListener('backbutton', function () {

      flushSession();

      if ($('viewer').classList.contains('on')) { $('viewer').classList.remove('on'); return; }
      if ($('sheetMask').classList.contains('on')) { ui.closeSheet(); return; }
      if ($('quickPanel').classList.contains('on')) { ui.toggleQuick(false); return; }
      if (curPage === 'convs' || curPage === 'connect' || curPage === 'offline') {

        exitHint();
        return;
      }
      if (curPage === 'chat') {
        S().current = null;
        back();
        return;
      }
      if (curPage === 'search') { back(); return; }
      back();
    }, false);
  }

  var _readTimer = null;

  function markCurrentReadSoon() {
    if (_readTimer) return;
    _readTimer = setTimeout(function () {
      _readTimer = null;
      sendReadNow();
    }, 800);
  }

  function sendReadNow() {
    if (curPage !== 'chat') return;
    if (document.hidden) return;
    var id = S().current;
    if (!id || id.indexOf('new:') === 0) return;
    if (!net.isOn()) return;

    var list = store.msgsOf(id);
    var myRead = (store.convOf(id) || {}).lastReadTs || 0;
    var hasNew = false;
    for (var i = list.length - 1; i >= 0; i--) {
      var m = list[i];
      if (m.from === S().cfg.userId) continue;
      if ((m.ts || 0) > myRead) { hasNew = true; break; }
    }
    if (!hasNew) return;

    net.markRead(id);
    ui.updateTabDots();
  }

  function startReadTicker() {
    setInterval(function () {
      try { sendReadNow(); } catch (e) {}
    }, 4000);
  }

  function subscribe() {
    store.on(function (what) {
      switch (what) {
        case 'burned':

          break;

        case 'conn':
          ui.renderPills();
          if (curPage === 'settings') ui.renderSettings();

          if (S().conn === 'on') {
            stopQuitCountdown();

            if (global.HC.archive && !S().archiveLoaded) {
              S().archiveLoaded = true;
              var r = global.HC.archive.load();
              if (r.ok) {
                store.emit('convs');
                store.emit('msg');
              }
              if (r.err) ui.toast(r.err, 3200);
            }

            if (curPage === 'connect' || curPage === 'offline') {
              go('convs', { noHistory: true });
            }

            if (!S().sessionRestored) {
              S().sessionRestored = true;
              setTimeout(function () {
                try { restoreSession(); } catch (e) {}
              }, 180);
            }
          }

          if (S().conn === 'offline' && curPage !== 'offline') {
            go('offline', { noHistory: true });
          }
          break;

        case 'convs':
          if (curPage === 'convs') ui.renderConvs();
          if (curPage === 'groups') ui.renderGroups();
          ui.updateTabDots();

          if (curPage === 'chat' && S().current) {
            var c = store.convOf(S().current);
            var sub = $('chatSub');
            if (c && c.peer && sub) {
              sub.textContent = c.peer.online
                ? '在线'
                : (c.peer.lastSeen ? '最后在线 ' + ui.listTime(c.peer.lastSeen) : '离线');
              sub.className = c.peer.online ? 'online' : '';
            }
          }
          break;

        case 'peers':
          if (curPage === 'contacts') ui.renderContacts();
          if (curPage === 'convs') ui.renderConvs();
          if (curPage === 'groups') ui.renderGroups();
          if (curPage === 'chat') ui.scheduleChat();
          break;

        case 'msg':

          if (global.HC.archive) global.HC.archive.save();

          if (curPage === 'chat') {
            ui.scheduleChat();

            markCurrentReadSoon();
          } else {
            ui.updateTabDots();
          }
          break;

        case 'search':
          ui.renderSearch(store.lastSearch);
          break;

        case 'batch':

          pullLock = false;
          {
            var pg2 = ui.pag();
            pg2.loading = false;
            var got = store.lastBatch;
            if (got && got.hist) {

              if (!got.msgs || got.msgs.length === 0) pg2.done = true;
            }
            if (curPage === 'chat') ui.renderChat(true);
          }
          break;
      }
    });
  }

  function autoDetectServer() {
    try {
      var loc = global.location;
      if (!loc || !loc.protocol) return;
      if (loc.protocol !== 'http:' && loc.protocol !== 'https:') return;
      if (!loc.hostname) return;

      var cfg = S().cfg;
      var port = parseInt(loc.port, 10) || 8787;
      var changed = (cfg.serverAddr !== loc.hostname) || (cfg.serverPort !== port);

      if (changed) {
        cfg.serverAddr = loc.hostname;
        cfg.serverPort = port;
        store.save();
      }

      S().viaBrowser = true;
    } catch (e) {  }
  }

  var bootInfo = { cryptoMs: 0 };

  var BOOT_STEPS = ['crypto', 'store', 'net', 'ready'];

  var BOOT_TIPS = [

    '长按一条消息，可以撤回或者改备注',
    '点输入框左边的话筒切到语音，按住说话，上滑取消',
    '聊天记录只存在这台手机上，换设备看不到',
    '往上翻能看到更早的记录',
    '对方在线时，聊天页顶部会显示「在线」'
  ];

  var tipTimer = null, tipIdx = 0;

  function startBootTips() {
    var box = $('bootTip');
    if (!box) return;

    tipIdx = Math.floor(Math.random() * BOOT_TIPS.length);

    function show() {
      box.classList.remove('on');
      setTimeout(function () {
        box.textContent = BOOT_TIPS[tipIdx % BOOT_TIPS.length];
        tipIdx++;
        box.classList.add('on');
      }, 420);
    }

    show();
    tipTimer = setInterval(show, 2600);
  }

  function stopBootTips() {
    if (tipTimer) { clearInterval(tipTimer); tipTimer = null; }
  }

  function setBootStepDetail(key, detail) {
    var el = $('bsl-' + key);
    if (!el) return;
    el.textContent = detail || el.textContent;
  }

  function setBoot(pct, msg, doneKey) {
    var bar = $('bootBar');
    var m = $('bootMsg');
    if (bar) bar.style.width = pct + '%';
    if (m && msg != null) m.textContent = msg;

    if (!doneKey) return;
    var upto = BOOT_STEPS.indexOf(doneKey);
    if (upto < 0) return;

    for (var i = 0; i < BOOT_STEPS.length; i++) {
      var el = $('bs-' + BOOT_STEPS[i]);
      if (!el) continue;
      el.classList.toggle('done', i <= upto);
      el.classList.toggle('now', i === upto + 1);
    }
  }

  function chain(list) {
    var i = 0;
    function step() {
      if (i >= list.length) return;
      var it = list[i++];
      setTimeout(function () {
        try { it[1](); }
        catch (e) {

          console.error('[HomeChat] 启动步骤出错：', e);
          ui.showBootError('启动出错：' + (e && e.message), e && e.stack);
        }
        step();
      }, it[0]);
    }
    step();
  }

  var bootAborted = false;

  function boot() {
    setBoot(6, '正在启动…', null);
    startBootTips();
    var bv = $('bootVer');
    if (bv) bv.textContent = 'Home Chat v' + (global.HC.CLIENT_VERSION || '—');

    chain([

      [140, function () { setBoot(22, '正在检查安全设置…', null); }],

      [180, function () {
        var t0 = Date.now();
        var st;
        try {
          st = C.selfTest();
        } catch (e) {
          bootAborted = true;
          ui.showCryptoFail(['自检抛异常：' + (e && e.message)]);
          return;
        }
        if (!st.ok) {
          bootAborted = true;
          ui.showCryptoFail(st.fails);
          return;
        }

        bootInfo.cryptoMs = Date.now() - t0;
      }],

      [0, function () {
        if (bootAborted) return;
        setBoot(48, '安全检查通过', 'crypto');
        setBootStepDetail('crypto', '安全检查 · ' + (bootInfo.cryptoMs || 0) + 'ms 全过');
      }],

      [170, function () {
        if (bootAborted) return;
        setBoot(62, '正在打开聊天记录…', 'store');
      }],

      [140, function () {
        if (bootAborted) return;
        store.load();
        autoDetectServer();
        store.ensureDeviceId();

        syncSecure();

        ui.applyTheme();
        bind();
        subscribe();
        startViewportWatch();
        startReadTicker();
      }],

      [150, function () {
        if (bootAborted) return;
        var cfg = S().cfg;
        var hasKey = store.hasKey();

        var archN = 0;
        try {
          var ai = global.HC.archive ? global.HC.archive.info() : null;
          archN = ai ? ai.inMemory : 0;
        } catch (e) {}
        setBootStepDetail('store', archN
          ? ('聊天记录 · ' + archN + ' 条')
          : '聊天记录 · 还没有');

        if (cfg.serverAddr && cfg.pwd && hasKey) {
          $('inAddr').value = cfg.serverAddr;
          $('inPwd').value = cfg.pwd;
          if ($('inName')) $('inName').value = cfg.name || '';
          setBoot(88, '正在连接 ' + cfg.serverAddr + '…', 'net');
          setBootStepDetail('net', '连接 ' + cfg.serverAddr + ':' + (cfg.serverPort || 8787));
        } else {
          if (cfg.serverAddr) $('inAddr').value = cfg.serverAddr;
          setBoot(88, '准备就绪', 'net');
          setBootStepDetail('net', '还没填过地址');
        }
      }],

      [230, function () {
        if (bootAborted) return;
        setBoot(100, '', 'ready');
        setBootStepDetail('ready', '就绪 · ' + (S().convs || []).length + ' 个会话');
        stopBootTips();

        var cfg = S().cfg;
        var hasKey = store.hasKey();

        setTimeout(function () {
          $('boot').classList.add('gone');

          if (cfg.serverAddr && cfg.pwd && hasKey) {
            boot2Go();
          } else {
            renderConnectHint();
            go('connect', { noHistory: true, force: true });
            history = ['connect'];
            ui.toast('第一次用？填名字、密码，点连接', 3000);
          }

          setTimeout(function () {
            var b = $('boot');
            if (b && b.parentNode) b.parentNode.removeChild(b);
          }, 500);
        }, 190);
      }],

      [0, function () {
        if (bootAborted) return;
        if (global.plus) {
          onPlusReady();
        } else {
          document.addEventListener('plusready', onPlusReady, false);
        }
      }]
    ]);
  }

  function onPlusReady() {

    ui.applyTheme();

    try { plus.device.setWakelock(true); } catch (e) {}

    var NTF = global.HC.notify;
    if (NTF) {

      NTF.setup(function () {
        try {
          S().notifyState = NTF.getState();
          if (curPage === 'settings') ui.renderSettings();
        } catch (e) {}
      });

      NTF.onClick(function (payload) {
        if (payload && payload.conv) openChat(payload.conv, null);
      });
    }

    if (curPage === 'chat') markCurrentReadSoon();

    function onHiding() {
      flushSession();
      if (global.HC.archive) global.HC.archive.saveNow();
    }

    function onLeaving() {
      onHiding();
      if (net.sayBye) net.sayBye();
    }

    document.addEventListener('pause', function () {
      onHiding();
      stopQuitCountdown();
    }, false);

    if (global.addEventListener) {
      global.addEventListener('online', function () {
        setTimeout(function () { if (net.healthCheck) net.healthCheck(); }, 800);
      }, false);
    }

    document.addEventListener('resume', function () {

      if (net.healthCheck) net.healthCheck();
      else if (S().conn !== 'on' && net.manualReconnect) net.manualReconnect();

      try {
        if (global.HC.secure && global.HC.secure.reapplyFlags) global.HC.secure.reapplyFlags();
      } catch (e) {}

      try {
        if (global.HC.app && global.HC.app.retryNotif) global.HC.app.retryNotif();
      } catch (e) {}
    }, false);

    if (global.addEventListener) {
      global.addEventListener('pagehide', onLeaving, false);
      global.addEventListener('beforeunload', onLeaving, false);
    }
  }

  global.HC.app = {
    go: go, back: back,

    openNotifSettings: function () {
      return global.HC.notify ? global.HC.notify.openSettings() : false;
    },
    retryNotif: function () {
      if (!global.HC.notify) return;
      S().notifyState = global.HC.notify.refresh();
      ui.renderSettings();
    },
    dropVoiceDraft: function () {
      try { if (voiceDraft) hideVoiceDraft(); } catch (e) {}
    },
    openProfileOf: openProfileOf,
    openFromSearch: openFromSearch,
    msgMenu: msgMenu,
    jumpTo: jumpTo,
    openSearch: openSearch,
    openNewGroup: openNewGroup,
    onGroupPickChange: onGroupPickChange,
    setPeerRemark: setPeerRemark,
    changeMyAvatar: changeMyAvatar,
    openChat: openChat,
    sendQuick: sendQuick,
    retrySend: retrySend,
    newChatPicker: newChatPicker
  };

  function startViewportWatch() {
    var vv = global.visualViewport;
    if (!vv) return;

    var apply = function () {
      var kb = Math.max(0, (global.innerHeight || 0) - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--hc-vvh', Math.round(vv.height) + 'px');

      var open = kb > 80;
      var was = document.documentElement.classList.contains('hc-kb');
      document.documentElement.classList.toggle('hc-kb', open);

      if (open !== was && curPage === 'chat') {
        setTimeout(scrollChatToBottom, 60);
        setTimeout(scrollChatToBottom, 280);
      }
    };

    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    apply();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : this);
