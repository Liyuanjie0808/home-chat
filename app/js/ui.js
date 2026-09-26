(function (global) {
  'use strict';

  var store = global.HC.store;
  var media = global.HC.media;
  var C     = global.HC.crypto;

  function S() { return store.S; }
  function $(id) { return document.getElementById(id); }

  function ico(name, cls) {
    return '<svg class="i' + (cls ? ' ' + cls : '') + '" aria-hidden="true">' +
           '<use href="#' + name + '"/></svg>';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var AV_COLORS = ['#FF9500', '#FF2D55', '#AF52DE', '#5856D6', '#007AFF', '#5AC8FA', '#34C759', '#FF3B30'];

  function renderBrand() {
    var nameEl = $('brandName');
    var stepsEl = $('brandSteps');
    if (!nameEl || !stepsEl) return;

    if (!global.HC.brand) { nameEl.textContent = '—'; stepsEl.innerHTML = ''; return; }

    var b = HC.brand.detect();

    if (b.web) {
      nameEl.textContent = '电脑不用设';
      stepsEl.innerHTML = '<div class="brand-tip ok">电脑一直开着就行，不用做任何设置。</div>';
      return;
    }

    nameEl.textContent = b.name;

    var h = '<div class="brand-tip">不设置的话，手机锁屏一会儿就收不到消息了。</div>';
    h += '<ol class="brand-ol">';
    for (var i = 0; i < b.steps.length; i++) h += '<li>' + esc(b.steps[i]) + '</li>';
    h += '</ol>';
    if (!(b.intents && b.intents.length)) {
      h += '<div class="brand-tip">这台手机认不出牌子，照着上面手动找一下就行。</div>';
    }
    stepsEl.innerHTML = h;
  }

  function brandJump() {
    if (!global.HC.brand) return;
    var b = HC.brand.detect();
    if (b.web) { toast('电脑上不用设置'); return; }
    if (!(b.intents && b.intents.length)) { toast('认不出牌子，请照着下面的步骤手动设置', 2600); return; }
    if (HC.brand.jump()) toast('已经跳到系统设置，照着下面的步骤开开关', 2600);
    else toast('跳不过去，请照着下面的步骤手动设置', 2600);
  }

  function avatarColor(key) {
    var h = 0, s = String(key || '?');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AV_COLORS[h % AV_COLORS.length];
  }

  function initial(name) {
    var s = String(name || '?').trim();
    return s ? s[0] : '?';
  }

  function avatarHTML(user, sizeCls, showDot) {
    if (!user) user = { id: '?', name: '?' };
    var bg = avatarColor(user.id || user.name);
    var dot = showDot
      ? '<span class="dot' + (user.online ? ' on' : '') + '"></span>'
      : '';
    var inner = user.avatar
      ? '<img src="' + esc(user.avatar) + '" alt="">'
      : esc(initial(user.name));
    return '<div class="hc-avatar ' + sizeCls + '" style="background:' + bg + '">' +
             '<span class="inner">' + inner + '</span>' + dot +
           '</div>';
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function listTime(ts) {
    if (!ts) return '';
    var d = new Date(ts), now = new Date();
    var a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var diff = Math.round((b - a) / 86400000);
    if (diff === 0) return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    if (diff === 1) return '昨天';
    if (diff < 7) return '周' + '日一二三四五六'[d.getDay()];
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function chatTime(ts) {
    var d = new Date(ts), now = new Date();
    var a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var diff = Math.round((b - a) / 86400000);
    var hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    if (diff === 0) return hm;
    if (diff === 1) return '昨天 ' + hm;
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
  }

  var toastTimer = null;
  function toast(msg, ms) {
    var t = $('toast');
    t.innerHTML = esc(msg).replace(/\n/g, '<br>');
    t.classList.add('on');
    clearTimeout(toastTimer);

    var auto = Math.min(6000, 1400 + String(msg || '').length * 95);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, ms || auto);
  }

  function vibrate(level) {
    var ms = level === 1 ? 100 : level === 3 ? 400 : 200;
    try {
      if (global.plus && plus.device) { plus.device.vibrate(ms); return; }
    } catch (e) {}
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {}
  }

  function shortVibrate() {
    try { if (global.plus && plus.device) { plus.device.vibrate(30); return; } } catch (e) {}
    try { if (navigator.vibrate) navigator.vibrate(30); } catch (e) {}
  }

  function openSheet(items) {
    var sheet = $('sheet');
    var html = '<div class="grp">';
    items.forEach(function (it, i) {
      var lead;
      if (it.icon)     lead = '<span class="e">' + ico(it.icon) + '</span>';
      else if (it.dot) lead = '<span class="e"><span class="sdot ' + it.dot + '"></span></span>';
      else if (it.e)   lead = '<span class="e txt">' + it.e + '</span>';
      else             lead = '<span class="e"></span>';
      html += '<div class="it" data-i="' + i + '">' + lead +
              '<span>' + esc(it.t) + '</span></div>';
    });
    html += '</div><div class="cancel" id="sheetCancel">取消</div>';
    sheet.innerHTML = html;

    sheet.querySelectorAll('.it').forEach(function (el) {
      el.onclick = function () {
        closeSheet();
        var it = items[+el.dataset.i];
        if (it && it.fn) setTimeout(it.fn, 180);
      };
    });
    var sc = $('sheetCancel');
    if (sc) sc.onclick = closeSheet;
    $('sheetMask').classList.add('on');
  }

  function inputSheet(o) {
    o = o || {};
    var sheet = $('sheet');
    sheet.innerHTML =
      '<div class="grp">' +
        '<div class="sh-title">' + esc(o.title || '') + '</div>' +
        '<div class="sh-input">' +
          (o.multiline
            ? '<textarea id="sheetIn" rows="' + (o.rows || 8) + '" maxlength="' + (o.max || 600) +
              '" placeholder="' + esc(o.placeholder || '') + '"' +
              ' autocomplete="off" autocorrect="off" spellcheck="false">' + esc(o.value || '') + '</textarea>'
            : '<input id="sheetIn" type="text" maxlength="' + (o.max || 24) +
              '" placeholder="' + esc(o.placeholder || '') + '" value="' + esc(o.value || '') +
              '" autocomplete="off" autocorrect="off" spellcheck="false">') +
        '</div>' +
      '</div>' +
      '<div class="ok" id="sheetOk">' + esc(o.okText || '确定') + '</div>' +
      '<div class="cancel" id="sheetCancel">取消</div>';

    $('sheetMask').classList.add('on');

    var inp = $('sheetIn');
    setTimeout(function () {
      try {
        inp.focus();

        inp.setSelectionRange(0, 99999);
      } catch (e) {}
    }, 60);

    function commit() {
      var v = String(inp.value || '').trim().slice(0, o.max || 24);
      closeSheet();
      if (o.onOk) setTimeout(function () { o.onOk(v); }, 160);
    }

    $('sheetOk').onclick = commit;
    $('sheetCancel').onclick = closeSheet;
    inp.addEventListener('keydown', function (e) {

      if (e.key === 'Enter' && !o.multiline) { e.preventDefault(); commit(); }
      if (e.key === 'Escape') closeSheet();
    });
  }

  function closeSheet() { $('sheetMask').classList.remove('on'); }

  function openDiag() {
    var body = $('diagBody');
    if (body) body.innerHTML = '';
    $('diagMask').classList.add('on');
  }

  function diagClose() { $('diagMask').classList.remove('on'); }

  function diagLine(text, ok) {
    var body = $('diagBody');
    if (!body) return;
    var d = document.createElement('div');
    d.className = 'hc-diag-ln ' + (ok === true ? 'ok' : ok === false ? 'bad' : 'wait');
    d.textContent = (ok === true ? '✔ ' : ok === false ? '✘ ' : '· ') + text;
    body.appendChild(d);
    body.scrollTop = body.scrollHeight;
  }

  function runVoiceDiag() {
    openDiag();
    if (!media.voiceDiag) { diagLine('这个版本没有自检功能', false); return; }
    diagLine('开始自检 —— 会录 2 秒，请对着手机说句话', null);
    media.voiceDiag(diagLine, function () {
      diagLine('自检结束。把这一屏截图发给开发者就行。', null);
    });
  }

  function connPillHTML() {
    var s = S();
    var red = '<span style="color:var(--hc-red)">●</span> ';
    var org = '<span style="color:var(--hc-orange)">●</span> ';

    if (global.HC.net && global.HC.net.netState && global.HC.net.netState() === 'neterr') {
      return red + '目前无网络可用';
    }

    switch (s.conn) {
      case 'on':      return '<span style="color:var(--hc-green)">●</span> 已连接';
      case 'connecting': return '<span class="hc-spin"></span> 正在连接…';
      case 'badkey':  return red + '密码不对，去设置里改';
      case 'nopair':  return org + '等待放行';
      case 'off':     return red + '服务端已断开 · 点击重连';
      case 'offline': return red + '服务端已断开 · 点击重试';
      case 'needaddr':return org + '还没填电脑地址';
      default:        return '';
    }
  }

  function renderPills() {
    var s = S();
    var show = s.conn !== 'on' && s.conn !== 'offline';
    [ 'pill1', 'pill2' ].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      if (show) { el.innerHTML = connPillHTML(); el.classList.add('on'); }
      else el.classList.remove('on');
      el.classList.toggle('err', s.conn === 'off' || s.conn === 'badkey');
    });
  }

  function groupAvatarHTML(c) {
    var ms = (c.members || []).slice(0, 4);
    if (ms.length <= 1) {
      var one = ms[0] || { id: c.id, name: c.title };
      return '<div class="gav single" style="background:' + avatarColor(c.id) + '">' +
             esc(initial(c.title)) + '</div>';
    }
    var cells = '';
    for (var i = 0; i < 4; i++) {
      var m = ms[i];
      if (!m) { cells += '<i style="background:' + 'rgba(120,120,128,.18)' + '"></i>'; continue; }
      if (m.avatar) cells += '<i><img src="' + esc(m.avatar) + '" alt=""></i>';
      else cells += '<i style="background:' + avatarColor(m.id) + '">' + esc(initial(m.name)) + '</i>';
    }
    return '<div class="gav">' + cells + '</div>';
  }

  function convRowHTML(c) {
    var isG = c.type === 'group';
    var lm = c.lastMsg;

    var title, avatarHTMLStr;
    if (isG) {
      title = c.title || '群聊';
      avatarHTMLStr = groupAvatarHTML(c);
    } else {
      var peer = c.peer || { id: '?', name: '?' };
      title = peer.name;
      avatarHTMLStr = avatarHTML(peer, 'hc-av-44', true);
    }

    var prev;
    if (!lm) prev = '还没有消息';
    else if (lm.from === S().cfg.userId) prev = '我：' + (lm.preview || '');
    else if (isG) prev = (lm.fromName || '') + '：' + (lm.preview || '');
    else prev = lm.preview || '';

    var unread = c.unread > 0;

    return '<div class="hc-conv" data-conv="' + esc(c.id) + '" data-peer="' + esc(isG ? '' : (c.peer && c.peer.id) || '') + '">' +
      avatarHTMLStr +
      '<div class="mid">' +
        '<div class="name">' + esc(title) +
          (isG ? ' <span style="font-size:12px;color:var(--hc-text-3);font-weight:400">(' + c.memberCount + ')</span>' : '') +
        '</div>' +
        '<div class="prev">' + esc(prev) + '</div>' +
      '</div>' +
      '<div class="right">' +
        '<div class="time">' + listTime(lm && lm.ts) + '</div>' +
        (unread ? '<div class="hc-badge">' + (c.unread > 99 ? '99+' : c.unread) + '</div>' : '') +
      '</div>' +
    '</div>';
  }

  function bindConvRows(box) {
    box.querySelectorAll('.hc-conv').forEach(function (el) {
      el.onclick = function () {
        global.HC.app.openChat(el.dataset.conv, el.dataset.peer || null);
      };
    });
  }

  function renderConvs() {
    var box = $('convList');
    if (!box) return;

    var convs = (S().convs || []).filter(function (c) { return c.type !== 'group'; });

    if (!convs.length) {
      box.innerHTML = '<div class="hc-empty"><span class="e">' + ico('i-chat', 'lg') + '</span>' +
        '<div class="t">还没有聊天</div>' +
        '<div class="s">点右上角的 ＋ 找人说话</div></div>';
    } else {
      box.innerHTML = convs.map(convRowHTML).join('');
      bindConvRows(box);
    }

    renderTabs('convs');
    updateTabDots();
  }

  function renderGroups() {
    var box = $('groupList');
    if (!box) return;
    var groups = (S().convs || []).filter(function (c) { return c.type === 'group'; });

    if (!groups.length) {
      box.innerHTML =
        '<div class="hc-empty"><span class="e">' + ico('i-group', 'lg') + '</span>' +
        '<div class="t">还没有群聊</div>' +
        '<div class="s">把家里人拉到一个群里<br>发消息大家都能看到</div>' +
        '<button class="hc-empty-btn" id="btnNewGroup2">＋ 新建群聊</button>' +
        '</div>';
      var b = $('btnNewGroup2');
      if (b) b.onclick = function () { global.HC.app.openNewGroup(); };
    } else {
      box.innerHTML = groups.map(convRowHTML).join('');
      bindConvRows(box);
    }

    renderTabs('groups');
    updateTabDots();
  }

  function renderTabs(active) {
    if (active) S().tab = active;
    var cur = S().tab || 'convs';
    document.querySelectorAll('.hc-tabbar .tb').forEach(function (el) {
      el.classList.toggle('on', el.dataset.tab === cur);
    });
  }

  function updateTabDots() {
    var convs = S().convs || [];
    var nChat = 0, nGroup = 0;
    convs.forEach(function (c) {
      if (c.type === 'group') nGroup += (c.unread || 0);
      else nChat += (c.unread || 0);
    });

    document.querySelectorAll('.hc-tabbar .tb').forEach(function (el) {
      var old = el.querySelector('.tbdot');
      var n = el.dataset.tab === 'convs' ? nChat : (el.dataset.tab === 'groups' ? nGroup : 0);
      if (n > 0) {
        if (!old) { old = document.createElement('span'); old.className = 'tbdot'; el.appendChild(old); }
        old.textContent = n > 99 ? '99+' : n;
      } else if (old) old.remove();
    });
  }

  function renderGroupPicker(selected) {
    var box = $('groupPicker');
    if (!box) return;
    selected = selected || {};

    var peers = (S().peers || []).filter(function (p) { return p.id !== S().cfg.userId; });
    if (!peers.length) {
      box.innerHTML = '<div class="hc-empty" style="padding:30px 16px">' +
        '<div class="s">还没有别的成员<br>先去「我的」把家里人拉进来</div></div>';
      return;
    }

    peers.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'zh'); });

    box.innerHTML = peers.map(function (p) {
      return '<div class="hc-pick' + (selected[p.id] ? ' on' : '') + '" data-uid="' + esc(p.id) + '">' +
        avatarHTML(p, 'hc-av-44', true) +
        '<span class="pn">' + esc(store.displayName(p.id)) + '</span>' +
        '<span class="ck">' + ico('i-check') + '</span>' +
      '</div>';
    }).join('');

    box.querySelectorAll('.hc-pick').forEach(function (el) {
      el.onclick = function () {
        el.classList.toggle('on');
        global.HC.app.onGroupPickChange();
      };
    });
  }

  function pickedMembers() {
    var out = [];
    document.querySelectorAll('#groupPicker .hc-pick.on').forEach(function (el) {
      out.push(el.dataset.uid);
    });
    return out;
  }

  function renderContacts() {
    var box = $('contactList');
    if (!box) return;
    var peers = (S().peers || []).filter(function (p) { return p.id !== S().cfg.userId; });

    if (!peers.length) {
      box.innerHTML = '<div class="hc-empty"><span class="e">' + ico('i-group', 'lg') + '</span>' +
        '<div class="t">还没有家庭成员</div>' +
        '<div class="s">' + esc(global.HC.whereApprove()) + '<br>放行之后就会出现在这里</div></div>';
      return;
    }

    peers.sort(function (a, b) {
      if (!!b.online - !!a.online) return (!!b.online) - (!!a.online);
      return String(a.name).localeCompare(String(b.name), 'zh');
    });

    box.innerHTML = peers.map(function (p) {
      var nm = store.displayName(p.id);
      return '<div class="hc-conv" data-peer="' + esc(p.id) + '" data-open="1">' +
        avatarHTML(p, 'hc-av-44', true) +
        '<div class="mid">' +
          '<div class="name">' + esc(nm) + '</div>' +
          '<div class="prev">' + (p.online ? '在线' : (p.lastSeen ? '最后在线 ' + listTime(p.lastSeen) : '离线')) + '</div>' +
        '</div>' +
        '<span class="chev-r"></span>' +
      '</div>';
    }).join('');

    box.querySelectorAll('.hc-conv').forEach(function (el) {
      el.onclick = function () {
        var peerId = el.dataset.peer;

        var conv = findConvWith(peerId);
        global.HC.app.openChat(conv ? conv.id : ('new:' + peerId), peerId);
      };
    });
  }

  function findConvWith(peerId) {
    var list = S().convs || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].peer && list[i].peer.id === peerId) return list[i];
    }
    return null;
  }

  var _chatRaf = null;

  function scheduleChat() {
    if (_chatRaf) return;
    var raf = global.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    _chatRaf = raf(function () {
      _chatRaf = null;
      renderChat();
    });
  }

  var _rtSig = '';

  function renderChat(force) {
    var convId = S().current;
    if (!convId) return;

    var box0 = $('chatScroll');
    var list0 = store.msgsOf(convId);
    var last0 = list0[list0.length - 1];
    var c0 = store.convOf(convId);

    var sig = convId + '|' + list0.length + '|' + ((c0 && c0.peerReadTs) || 0) + '|' +
              (last0 ? ((last0.id || last0.cid || '') + '|' + (last0.status || '')) : '');
    if (!force && sig === _rtSig) return;
    _rtSig = sig;

    var isG = c0 && c0.type === 'group';
    var nmEl  = $('chatTitleName');
    var subEl = $('chatSub');

    if (isG) {
      if (nmEl) nmEl.textContent = c0.title || '群聊';
      if (subEl) { subEl.textContent = c0.memberCount + ' 人'; subEl.className = ''; }
      return renderChatBody(convId, null);
    }

    var peer = peerForConv(convId);

    if (nmEl) nmEl.textContent = peer ? peer.name : '聊天';

    if (subEl) {
      if (peer) {
        subEl.textContent = peer.online ? '在线'
                         : (peer.lastSeen ? '最后在线 ' + listTime(peer.lastSeen) : '离线');
        subEl.className = peer.online ? 'online' : '';
      } else {
        subEl.textContent = '';
        subEl.className = '';
      }
    }

    return renderChatBody(convId, peer);
  }

  function currentConv() { return store.convOf(S().current); }

  function currentPeer() {
    var convId = S().current;
    if (!convId) return null;
    if (convId.indexOf('new:') === 0) return store.peerOf(convId.slice(4));
    return peerForConv(convId);
  }

  function renderProfile() {
    var convId = S().current;
    if (!convId) return;

    var peekId = S().peekPeer || null;
    var peek = peekId ? (store.userById(peekId) || store.peerOf(peekId)) : null;

    var c = store.convOf(convId);
    var isG = c && c.type === 'group';
    var peer = peek || (isG ? null : currentPeer());
    var isGroupProfile = isG && !peek;

    var av  = $('profAvatar');
    var nm  = $('profName');
    var sub = $('profSub');

    var remarkEl = $('profRemark');
    var clearRow = $('rowProfRemarkClear');
    var grpBox   = $('profGroupBox');

    if (isGroupProfile) {
      if (av) {
        av.style.background = avatarColor(c.id);
        av.innerHTML = '<span class="inner">' + esc(initial(c.title || '群')) + '</span>';
      }
      if (nm) nm.textContent = c.title || '群聊';
      if (sub) { sub.textContent = c.memberCount + ' 人'; sub.className = ''; }
      if (remarkEl) { remarkEl.textContent = '群聊不能备注'; remarkEl.style.color = 'var(--hc-text-3)'; }
      if (clearRow) clearRow.style.display = 'none';
      if (grpBox) grpBox.style.display = '';
      return;
    }

    if (grpBox) grpBox.style.display = 'none';

    var remark = (S().remarks && S().remarks[peer && peer.id]) || '';

    if (av) {
      av.style.background = avatarColor((peer && peer.id) || convId);
      av.innerHTML = (peer && peer.avatar)
        ? '<img src="' + esc(peer.avatar) + '" alt="">'
        : esc(initial((peer && peer.name) || '?'));
    }
    if (nm) nm.textContent = (peer && peer.name) || '聊天';
    if (sub) {
      if (peer) {
        sub.textContent = peer.online ? '在线'
                         : (peer.lastSeen ? '最后在线 ' + listTime(peer.lastSeen) : '离线');
        sub.className = peer.online ? 'online' : '';
      } else { sub.textContent = ''; sub.className = ''; }
    }

    if (remarkEl) {
      if (remark) {
        remarkEl.textContent = remark;
        remarkEl.style.color = 'var(--hc-text)';
      } else {
        remarkEl.textContent = peer && peer.realName
          ? ('未设置（原昵称 ' + peer.realName + '）')
          : '未设置';
        remarkEl.style.color = 'var(--hc-text-3)';
      }
    }
    if (clearRow) clearRow.style.display = remark ? '' : 'none';
  }

  function renderChatSet() {
    var convId = S().current;
    if (!convId) return;

    var c = store.convOf(convId);
    var isG = c && c.type === 'group';
    var peer = isG ? null : currentPeer();

    var title = $('csTitle');
    if (title) title.textContent = isG ? '群聊信息' : '聊天信息';

    var mBox = $('csMemberBox');
    var mWrap = $('csMembers');
    if (mBox) mBox.style.display = isG ? '' : 'none';

    if (isG && mWrap) {
      var mTitle = $('csMemberTitle');
      if (mTitle) mTitle.textContent = '群成员（' + c.memberCount + ' 人）';

      var rows = (c.members || []).map(function (m) {
        return '<div class="cs-m" data-peek="' + esc(m.id) + '">' +
          avatarHTML({ id: m.id, name: m.name, avatar: m.avatar, online: m.online }, 'hc-av-40', false)
            .replace('<span class="inner">', '<span class="inner">')
            .replace('</div>', (m.online ? '<span class="on-dot"></span>' : '') + '</div>') +
          '<span class="nm">' + esc(m.name) + '</span>' +
        '</div>';
      });

      rows.push('<div class="cs-m add" id="csAddMember">' +
                  '<div class="plusbox">' + ico('i-plus', 'sm') + '</div>' +
                  '<span class="nm">加人</span>' +
                '</div>');
      mWrap.innerHTML = rows.join('');
    }

    var pBox = $('csPeerBox');
    if (pBox) pBox.style.display = isG ? 'none' : '';

    if (!isG) {
      var pav = $('csPeerAv'), pnm = $('csPeerName'), psub = $('csPeerSub');
      if (pav) {
        pav.style.background = avatarColor((peer && peer.id) || convId);
        pav.innerHTML = (peer && peer.avatar)
          ? '<img src="' + esc(peer.avatar) + '" alt="">'
          : esc(initial((peer && peer.name) || '?'));
      }
      if (pnm) pnm.textContent = (peer && peer.name) || '聊天';
      if (psub) {
        psub.textContent = (S().remarks && S().remarks[peer && peer.id])
          ? ('原昵称 ' + ((peer && peer.realName) || '—'))
          : (peer && peer.online ? '在线' : '离线');
      }
    }

    var nameRow = $('csRowRename');
    if (nameRow) nameRow.style.display = isG ? '' : 'none';
    if (isG) {
      var gn = $('csGroupName');
      if (gn) gn.textContent = c.title || '群聊';
    }

  }

  var pag = { conv: null, loading: false, done: false };

  function pagStateFor(convId) {
    if (pag.conv !== convId) { pag = { conv: convId, loading: false, done: false }; }
    return pag;
  }

  function renderChatBody(convId, peer) {
    var box = $('chatScroll');
    var list = store.msgsOf(convId);
    var atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 100;

    var oldHeight = box.scrollHeight, oldTop = box.scrollTop;

    if (!list.length) {
      box.innerHTML = '<div class="hc-empty" style="padding-top:110px"><span class="e">' + ico('i-person', 'lg') + '</span>' +
        '<div class="t">打个招呼吧</div>' +
        '<div class="s">左边 ＋ 可以发照片和文件</div></div>';
      return;
    }

    var pg = pagStateFor(convId);
    var html = '';

    var lastTs = 0, lastFrom = null;
    var now = Date.now();
    var readTs = readTsOf(convId, peer);

    for (var i = 0; i < list.length; i++) {
      var m = list[i];

      if (!lastTs || m.ts - lastTs > 5 * 60 * 1000 ||
          new Date(m.ts).toDateString() !== new Date(lastTs).toDateString()) {
        html += '<div class="hc-time-divider">' + chatTime(m.ts) + '</div>';
        lastFrom = null;
      }

      var me = m.from === S().cfg.userId;
      var gap = (lastFrom !== m.from) ? ' gap' : '';
      var who = me ? { id: S().cfg.userId, name: S().cfg.name || '我' }
                   : (store.userById(m.from) || { id: m.from, name: '?' });

      var nx = list[i + 1];
      var endsGroup = (!nx ||
                  nx.from !== m.from ||
                  (nx.ts - m.ts) > 5 * 60 * 1000 ||
                  new Date(nx.ts).toDateString() !== new Date(m.ts).toDateString());
      var tail = endsGroup ? ' tail' : '';

      var fresh = (i === list.length - 1) ? ' fresh' : '';

      var isG2 = store.isGroup(convId);
      var senderTag = (isG2 && !me && gap)
        ? '<div class="hc-sender">' + esc(store.displayName(m.from)) + '</div>' : '';

      var failBadge = (me && m.status === 'fail')
        ? '<button class="hc-fail" data-retry="' + esc(m.cid || '') +
          '" aria-label="发送失败，点击重发">!</button>'
        : '';

      html += '<div class="hc-msg' + (me ? ' me' : '') + gap + (isG2 ? ' ingroup' : '') + '">' +
        avatarHTML(who, 'hc-av-30', false).replace('<div class="hc-avatar',
          '<div data-uid="' + esc(who.id || '') + '" class="hc-avatar') +
        '<div class="hc-msgcol">' + senderTag +
          bubbleHTML(m, me, tail, fresh).replace('<div class="hc-bubble', '<div data-mid="' + esc(m.id || '') + '" class="hc-bubble') +
        '</div>' + failBadge +
      '</div>';

      if (me && endsGroup) {
        html += statusHTML(m, readTs);
      }

      lastTs = m.ts;
      lastFrom = m.from;
    }

    box.innerHTML = html;

    paintVoicePlaying();

    box.querySelectorAll('.hc-msg .hc-avatar').forEach(function (el) {
      el.style.cursor = 'pointer';
      el.onclick = function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        global.HC.app.openProfileOf(el.dataset.uid || '');
      };
    });

    box.querySelectorAll('[data-voice]').forEach(function (el) {
      el.onclick = function () { toggleVoicePlay(el); };
    });
    box.querySelectorAll('[data-img]').forEach(function (el) {
      el.onclick = function () { openViewer(el.dataset.img, el.dataset.cap || ''); };
    });
    box.querySelectorAll('[data-dl]').forEach(function (el) {
      el.onclick = function () {
        media.download(el.dataset.dl, el.dataset.name);
      };
    });
    box.querySelectorAll('[data-retry]').forEach(function (el) {
      el.onclick = function () { global.HC.app.retrySend(el.dataset.retry); };
    });

    box.querySelectorAll('.hc-msg .hc-bubble').forEach(function (el) {
      var mid = el.dataset.mid;
      if (!mid) return;
      bindLongPress(el, function () { global.HC.app.msgMenu(mid); });
    });

    if (atBottom) {
      box.scrollTop = box.scrollHeight;
    } else if (box.scrollHeight !== oldHeight) {

      box.scrollTop = oldTop + (box.scrollHeight - oldHeight);
    }
  }

  function peerForConv(convId) {
    if (convId.indexOf('new:') === 0) {
      return store.peerOf(convId.slice(4));
    }
    var c = store.convOf(convId);
    return c ? c.peer : null;
  }

  function readTsOf(convId, peer) {
    var c = store.convOf(convId);
    return (c && c.peerReadTs) || 0;
  }

  var voicePlaying = null;

  function displayFileName(m) {
    var body = String((m && m.body) || '');
    if (media.isAutoName && media.isAutoName(body)) {
      if (m.kind === 'voice') return '语音';
      if (m.kind === 'image') return '图片';
      return '文件';
    }
    return body;
  }

  function bubbleHTML(m, me, tail, fresh) {
    tail = tail || '';
    fresh = fresh || '';

    if (m.revoked) {
      return '<div class="hc-bubble revoked' + tail + fresh + '">' +
             (me ? '你撤回了一条消息' : (esc(store.displayName(m.from)) + ' 撤回了一条消息')) +
             '</div>';
    }

    if (m.kind === 'image') {
      var mt = m.meta || {};
      var url = media.fileURL(mt.fileId, m.body);
      var w = mt.w || 200, h = mt.h || 150;

      var maxW = 200, maxH = 260;
      var sc = Math.min(maxW / w, maxH / h, 1);
      var dw = Math.round(w * sc), dh = Math.round(h * sc);

      return '<div class="hc-bubble img' + tail + fresh + '"><div class="ph" style="width:' + dw + 'px;height:' + dh + 'px">' +

        '<img src="' + esc(url) + '" data-img="' + esc(url) + '" data-cap="" ' +
        'style="width:' + dw + 'px;height:' + dh + 'px;object-fit:cover" alt="">' +
      '</div></div>';
    }

    if (m.kind === 'voice') {
      var mtv = m.meta || {};

      var dur = Math.max(1, Math.min(60, Math.round(Number(mtv.dur) || 1)));

      var vw = Math.round(80 + ((dur - 1) / 59) * 120);
      return '<div class="hc-bubble voice' + tail + fresh + '"' +
        ' data-voice="' + esc(mtv.fileId || '') + '"' +
        ' data-vname="' + esc(m.body || '') + '"' +
        ' style="width:' + vw + 'px">' +
        '<span class="spk">' + ico('i-speaker') + '</span>' +
        '<span class="vw"><i></i><i></i><i></i></span>' +
        '<span class="vd">' + dur + '″</span>' +
      '</div>';
    }

    if (m.kind === 'file') {
      var mt2 = m.meta || {};
      var fname = displayFileName(m);
      return '<div class="hc-bubble file' + tail + fresh + '" data-dl="' + esc(mt2.fileId || '') + '" data-name="' + esc(fname) + '">' +
        '<span class="ic">' + ico('i-file', 'lg') + '</span>' +
        '<span class="fi"><span class="fn">' + esc(fname) + '</span>' +
        '<span class="fs">' + media.sizeStr(mt2.size) + '</span></span>' +
        '<span class="dl">' + ico('i-download') + '</span>' +
      '</div>';
    }

    return '<div class="hc-bubble' + tail + fresh + '">' + esc(m.body) + '</div>';
  }

  function statusHTML(m, readTs) {
    if (m.status === 'sending') return '<div class="hc-status">发送中…</div>';
    if (m.status === 'fail') {
      var why = m.failReason === 'neterr'   ? '目前无网络可用'
              : m.failReason === 'toofast'  ? '发得太快了，等会儿再试'
              : '服务端已断开';
      return '<div class="hc-status fail" data-retry="' + esc(m.cid || '') + '">' +
             esc(why) + ' · 点击重发</div>';
    }
    if (m.status === 'read' || (readTs && m.ts <= readTs)) {
      return '<div class="hc-status read">已读</div>';
    }
    if (m.status === 'sent' || m.id) return '<div class="hc-status">已送达</div>';
    return '';
  }

  function paintVoicePlaying() {
    var box = $('chatScroll');
    if (!box) return;
    box.querySelectorAll('[data-voice]').forEach(function (el) {
      el.classList.toggle('playing', !!voicePlaying && el.dataset.voice === voicePlaying);
    });
  }

  function toggleVoicePlay(el) {
    var fid = el.dataset.voice;
    if (!fid) return;

    var wasOn = (voicePlaying === fid);
    media.stopVoice();
    voicePlaying = wasOn ? null : fid;
    paintVoicePlaying();
    if (wasOn) return;

    media.playVoice(fid, el.dataset.vname || '', function (err, wasStop) {
      if (wasStop) return;
      voicePlaying = null;
      paintVoicePlaying();
      if (err) toast(err.message, 3000);
    }, function (state) {

      if (voicePlaying !== fid) return;
      el.classList.toggle('loading', state === 'loading');
      if (state === 'playing') el.classList.add('playing');
    });
  }

  function openViewer(url, caption) {
    $('viewerImg').src = url;
    var cap = $('viewerCap');
    if (cap) cap.textContent = caption || '';
    $('viewer').classList.add('on');
  }

  function renderQuick() {
    var box = $('quickPanel');
    var list = store.quickPhrases();
    box.innerHTML = '<div class="qt">点一下直接发出去</div><div class="qs">' +
      list.map(function (q, i) { return '<div class="q" data-i="' + i + '">' + esc(q) + '</div>'; }).join('') +
      '</div>';
    box.querySelectorAll('.q').forEach(function (el) {
      el.onclick = function () {
        global.HC.app.sendQuick(list[+el.dataset.i]);
      };
    });
  }

  function toggleQuick(on) {
    var box = $('quickPanel');
    var want = on == null ? !box.classList.contains('on') : !!on;
    if (want) renderQuick();
    box.classList.toggle('on', want);
  }

  function renderSettings() {
    var cfg = S().cfg;
    $('setAddr').value = cfg.serverAddr || '';
    $('setName').textContent = cfg.name || '未设置';
    $('setSub').textContent = cfg.userId ? ('ID ' + cfg.userId) : '点上面改昵称';
    $('setConn').textContent = ({
      on: '已连接', connecting: '连接中…', off: '已断开',
      badkey: '密码不对', nopair: '等待批准', needaddr: '未配置',
      idle: '未连接', nokey: '未生成密钥', offline: '连不上（已停用）'
    })[S().conn] || '—';

    var setAv = $('setAvatar');
    setAv.style.background = avatarColor(cfg.userId || cfg.name || '我');
    setAv.querySelector('.inner').textContent = initial(cfg.name || '我');

    $('swDark').classList.toggle('on', !!cfg.dark);
    $('swBig').classList.toggle('on', !!cfg.big);

    var swq = $('swAutoQuit');
    if (swq) swq.classList.toggle('on', !!cfg.autoQuit);

    var note = $('secureNote');
    if (note) {
      var sec = global.HC.secure;
      if (cfg.secure === false) {
        note.textContent = '已关闭';
        note.style.color = 'var(--hc-text-2)';
      } else {

        var st = sec && sec.screenshotState ? sec.screenshotState() : 'browser';
        if (st === 'on') {
          note.textContent = '防复制 + 已禁止截屏';
          note.style.color = 'var(--hc-green)';
        } else if (st === 'failed') {
          note.textContent = '防复制已开，但系统没拦住截屏';
          note.style.color = 'var(--hc-red)';
        } else if (st === 'ios') {
          note.textContent = '防复制（iOS 系统不给拦截屏）';
          note.style.color = 'var(--hc-orange)';
        } else {
          note.textContent = '防复制（浏览器拦不了截屏）';
          note.style.color = 'var(--hc-orange)';
        }
      }
    }

    var nf = $('setNotif');
    if (nf) {
      if (!global.plus) {
        nf.textContent = '浏览器没有系统通知';
        nf.style.color = 'var(--hc-text-2)';
      } else {

        var ns = S().notifyState ||
                 (global.HC.notify ? global.HC.notify.getState() : 'unknown');
        if (ns === 'on') {
          nf.textContent = '已开启';
          nf.style.color = 'var(--hc-green)';
        } else if (ns === 'off') {

          nf.textContent = '被系统关了 · 点这里去开';
          nf.style.color = 'var(--hc-red)';
        } else {
          nf.textContent = '不确定 · 点这里重查';
          nf.style.color = 'var(--hc-orange)';
        }
      }
    }

    renderBrand();

    var sr = $('setRetry');
    if (sr) {
      var left = global.HC.net ? global.HC.net.retryLeft() : 7;
      sr.textContent = S().conn === 'offline'
        ? '已用完（' + (global.HC.net ? global.HC.net.RETRY_MAX : 7) + ' 次）'
        : '还剩 ' + left + ' 次';
    }

    $('segVib').querySelectorAll('.s').forEach(function (el) {
      el.classList.toggle('on', +el.dataset.v === (cfg.vibrate || 2));
    });

    var q = store.quickPhrases();
    $('quickCount').textContent = q.length + ' 条';

    var ar = $('archiveSize');
    if (ar) {
      var arch = global.HC.archive;
      if (!arch) {
        ar.textContent = '—';
      } else {
        var inf = arch.info();
        var kb = Math.round(inf.bytes / 1024);
        ar.textContent = inf.inMemory + ' 条 · 本机 ' + (kb < 1024 ? (kb + ' KB') : ((kb / 1024).toFixed(1) + ' MB'));
        ar.style.color = inf.err ? 'var(--hc-orange)' : '';
      }
    }

    var cv = $('setVer');

    var _v = String(global.HC.CLIENT_VERSION || '—');
    if (/^\d+\.\d+$/.test(_v)) _v += '.0';
    if (cv) cv.textContent = 'Home Chat v' + _v;
    var dv = $('setDev');
    if (dv) dv.textContent = global.HC.DEVELOPER || 'tim-lyj';
    var sv = $('setSrvVer');
    if (sv) {
      sv.textContent = cfg.serverVer
        ? ('服务端 v' + cfg.serverVer + (S().conn === 'on' ? ' · 已连接' : ' · 未连接'))
        : '还没连上';
    }
  }

  var CHANGELOG = [
    {
      v: '2.6.0', d: '2025', t: '在线状态与消息可靠性的收尾', items: [
        '切到后台不再断开连接 —— 这是「锁屏一会儿就收不到消息」的真正原因',
        '心跳加了看门狗：连接半死不活时 30 秒内必然发现并重连',
        '发不出去的消息显示红色感叹号，并说清楚是「目前无网络可用」还是「服务端已断开」',
        '语音和照片的文件名不再带录制时间（那本身就是一条信息）',
        '别人主动发的文件，文件名原样保留',
        '补发加了防线：消息洪水不会把手机拉爆（一轮最多拉 2400 条，超了跳到最新）',
        '服务端加了发消息限流（每秒 10 条），从源头掐掉灌水',
        '侧滑返回改成两段式：第一下提示「再划一次退出软件」',
        '「改密码.command」—— 开源不能把密码写在代码里',
        '全部提示文案改成人话，去掉开发者腔'
      ]
    },
    {
      v: '2.5.0', d: '2025', t: '语音大修 + 消息一条不丢', items: [
        '语音整条链路重写：麦克风权限、录音、读文件、上传、下载、播放',
        '试听 / 重录 / 取消 / 发送 —— 发之前能先听一遍',
        '补发改成按「序号」，不再依赖手机时钟（以前手机快几秒就丢消息）',
        '往上翻历史不会再卡死',
        '侧滑、被系统回收、后台被杀 —— 回来都能回到原来的位置，草稿还在',
        '小米 / vivo / 华为 / OPPO / 三星 / 谷歌 六家的后台保活引导',
        '防截屏改成「设完读回来验一遍」，不再把「调用没报错」当成「拦住了」'
      ]
    },
    {
      v: '2.3.0', d: '', t: '手机端加密存档', items: [
        '聊天记录加密存在手机本地，离线也翻得到',
        '换设备重新登录就能把记录拉回来'
      ]
    },
    {
      v: '2.2.0', d: '', t: '细节打磨', items: [
        '已读状态用纯文字（不玩一个勾两个勾那种）',
        '每个聊天里都能搜自己的聊天记录',
        '快捷短语、消息撤回（2 分钟内，撤回后留一条记录）'
      ]
    },
    {
      v: '2.0.0', d: '', t: '语音与防护', items: [
        '按住说话，整屏录音界面',
        '系统级禁止截屏（安卓 FLAG_SECURE）、防复制、页面水印',
        '阅后即焚 —— 对方读完 30 秒后从服务器抹掉，界面上不作任何体现'
      ]
    },
    {
      v: '1.1.0', d: '', t: '群聊与身份', items: [
        '群聊、备注名、头像',
        '按名字登录：换个手机输一样的名字，还是同一个人'
      ]
    },
    {
      v: '1.0.0', d: '', t: '从零开始', items: [
        '局域网直连 —— 服务端跑在自己家的电脑上，不经过任何第三方',
        '端到端加密：HMAC-SHA256 流密码 + 先加密后签名，PBKDF2 30 万轮',
        '文字消息、会话列表',
        '图片和文件在内存里中转，一个字节都不写到硬盘上'
      ]
    }
  ];

  function renderChangelog() {
    var body = $('chgBody');
    if (!body) return;

    var v = String(global.HC.CLIENT_VERSION || '');
    if (/^\d+\.\d+$/.test(v)) v += '.0';
    var ve = $('chgVer');
    if (ve) ve.textContent = 'v' + (v || '—');

    var h = '';
    for (var i = 0; i < CHANGELOG.length; i++) {
      var r = CHANGELOG[i];
      h += '<div class="chg-rel' + (i === 0 ? ' now' : '') + '">' +
             '<div class="chg-dot"></div>' +
             '<div class="chg-card">' +
               '<div class="chg-card-hd">' +
                 '<span class="chg-v">v' + esc(r.v) + '</span>' +
                 (i === 0 ? '<span class="chg-badge">现在这版</span>' : '') +
               '</div>' +
               '<div class="chg-t">' + esc(r.t) + '</div>' +
               '<ul class="chg-ul">' +
                 r.items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') +
               '</ul>' +
             '</div>' +
           '</div>';
    }
    body.innerHTML = h;
  }

  function applyTheme() {
    var cfg = S().cfg;
    document.body.classList.toggle('hc-dark', !!cfg.dark);
    document.body.classList.toggle('hc-big', !!cfg.big);

    try {
      if (global.plus && plus.navigator) {
        plus.navigator.setStatusBarStyle(cfg.dark ? 'light' : 'dark');
        plus.navigator.setStatusBarBackground(cfg.dark ? '#000000' : '#FFFFFF');
      }
    } catch (e) {}
  }

  function showUpload(text, pct) {
    var el = $('uploading');
    $('uploadText').textContent = text + (pct != null ? ' ' + pct + '%' : '');
    $('uploadBar').style.width = (pct || 0) + '%';
    el.classList.add('on');
  }

  function hideUpload() { $('uploading').classList.remove('on'); }

  function showCryptoFail(fails) {
    var el = $('cryptofail');
    if (!el) { alert('安全检查没通过：' + (fails || []).join('；')); return; }
    el.innerHTML = '<span class="bfail">' + ico('i-warn') + '</span> <b>安全检查没通过</b>，为了不传错数据已停止使用。<br>' +
      '请把这个截图发给我：<br><span style="opacity:.85;font-size:11px">' +
      esc((fails || []).join('；')).slice(0, 300) + '</span>';
    el.classList.add('on');

    var b = $('boot');
    if (b) b.classList.add('gone');
  }

  function showBootError(what, detail) {
    var el = $('cryptofail');
    if (!el) { alert('启动出错：' + what); return; }
    el.innerHTML = '<span class="bfail">' + ico('i-warn') + '</span> <b>启动出错</b>，界面可能不完整。<br>' +
      '<span style="opacity:.9;font-size:12px">' + esc(String(what || '')) + '</span>' +
      (detail ? '<br><span style="opacity:.6;font-size:11px">' +
        esc(String(detail).slice(0, 260)) + '</span>' : '');
    el.classList.add('on');
    var b = $('boot');
    if (b) b.classList.add('gone');
  }

  function bindLongPress(el, fn) {
    var t = null, moved = false, fired = false;

    el.addEventListener('touchstart', function () {
      moved = false; fired = false;
      t = setTimeout(function () { fired = true; try { fn(); } catch (e) {} }, 480);
    }, { passive: true });

    el.addEventListener('touchmove', function () {
      moved = true;
      if (t) { clearTimeout(t); t = null; }
    }, { passive: true });

    function end() { if (t) { clearTimeout(t); t = null; } }
    el.addEventListener('touchend', end, { passive: true });
    el.addEventListener('touchcancel', end, { passive: true });

    el.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      try { fn(); } catch (err) {}
    });
  }

  function searchLocal(convId, q) {
    var list = store.msgsOf(convId) || [];
    var needle = String(q || '').toLowerCase();
    if (!needle) return [];

    var c = store.convOf(convId);
    var title = (c && (c.title || (c.peer && c.peer.name))) || '这个聊天';
    var out = [];

    for (var i = list.length - 1; i >= 0 && out.length < 300; i--) {
      var m = list[i];
      if (m.revoked) continue;

      if (m.kind === 'voice' || m.kind === 'image') continue;

      var body = String(m.body == null ? '' : m.body);
      if (!body || body.toLowerCase().indexOf(needle) < 0) continue;
      out.push({
        id: m.id, conv: convId, convTitle: title,
        from: m.from, fromName: store.displayName(m.from),
        kind: m.kind, body: body, ts: m.ts
      });
    }
    return out;
  }

  function searchNames(q) {
    var needle = String(q || '').trim().toLowerCase();
    if (!needle) return [];

    var seen = {};
    var out = [];

    function add(o) {
      if (!o || !o.id || seen[o.id]) return;
      seen[o.id] = 1;
      out.push(o);
    }

    (S().convs || []).forEach(function (c) {
      var title = c.title || (c.peer && c.peer.name) || '';
      var real  = (c.peer && c.peer.realName) || '';
      if (String(title).toLowerCase().indexOf(needle) < 0 &&
          String(real).toLowerCase().indexOf(needle) < 0) return;
      add({
        kind: 'conv', id: c.id, convId: c.id,
        title: title || '聊天',
        sub: c.type === 'group' ? (c.memberCount + ' 人') : '聊天',
        avatar: c.peer ? c.peer.avatar : null,
        avatarId: (c.peer && c.peer.id) || c.id,
        peerId: c.peer ? c.peer.id : null,
        isGroup: c.type === 'group'
      });
    });

    (S().peers || []).forEach(function (p) {
      if (!p || p.id === S().cfg.userId) return;
      var nm = String(p.name || '').toLowerCase();
      if (nm.indexOf(needle) < 0) return;
      var conv = null;
      for (var i = 0; i < (S().convs || []).length; i++) {
        if (S().convs[i].peer && S().convs[i].peer.id === p.id) { conv = S().convs[i]; break; }
      }
      if (conv) return;
      add({
        kind: 'peer', id: 'p_' + p.id, convId: 'new:' + p.id,
        title: store.displayName(p.id),
        sub: p.online ? '在线' : '还没聊过',
        avatar: p.avatar, avatarId: p.id, peerId: p.id, isGroup: false
      });
    });

    return out;
  }

  function renderSearch(res) {
    var box = $('searchResults');
    if (!box) return;

    var q     = (res && res.q) || '';
    var hits  = (res && res.hits) || [];
    var scope = (res && res.scopeName) || '';
    var local = !!(res && res.local);
    var names = res && res.names;

    if (names) {
      if (!q) {
        box.innerHTML = '<div class="hc-empty"><span class="e">' + ico('i-search', 'lg') + '</span>' +
          '<div class="t">搜个人或聊天</div>' +
          '<div class="s">按名字搜这里的会话和家庭成员<br>' +
          '想搜聊天记录，进那个聊天点右上角 ⋯</div></div>';
        return;
      }
      if (!hits.length) {
        box.innerHTML = '<div class="hc-empty"><span class="e">' + ico('i-person', 'lg') + '</span>' +
          '<div class="t">没找到「' + esc(q) + '」</div>' +
          '<div class="s">换个名字试试</div></div>';
        return;
      }
      box.innerHTML = '<div class="hc-searchcount">找到 ' + hits.length + ' 个</div>' +
        hits.map(function (h) {
          return '<div class="hc-row hc-hitname" data-ni="' + esc(h.id) + '">' +
            avatarHTML({ id: h.avatarId, name: h.title, avatar: h.avatar }, 'hc-av-40', false) +
            '<span class="fi"><span class="fn">' + esc(h.title) + '</span>' +
            '<span class="fs">' + esc(h.sub) + '</span></span>' +
            '<span class="chev-r"></span>' +
          '</div>';
        }).join('');

      box.querySelectorAll('[data-ni]').forEach(function (el) {
        el.onclick = function () {
          var hit = hits.filter(function (x) { return x.id === el.dataset.ni; })[0];
          if (hit) global.HC.app.openFromSearch(hit);
        };
      });
      return;
    }

    if (!q) {
      box.innerHTML = '<div class="hc-empty"><span class="e">' + ico('i-search', 'lg') + '</span>' +
        '<div class="t">' + (scope ? ('在「' + esc(scope) + '」里搜') : '搜点什么') + '</div>' +
        '<div class="s">' + (scope
          ? '就搜这一个聊天<br>本机上已经加载的记录，敲字就出结果'
          : '聊天记录是永久保存的<br>找得到才有意义') + '</div></div>';
      return;
    }

    if (!hits.length) {
      box.innerHTML = '<div class="hc-empty"><span class="e">' + ico('i-search', 'lg') + '</span>' +
        '<div class="t">没找到「' + esc(q) + '」</div>' +
        '<div class="s">' + (scope
          ? '这个聊天里本地已加载的记录中没有<br>往上多翻几屏再试试'
          : '只搜你自己参与的会话') + '</div></div>';
      return;
    }

    function hl(text) {
      var i = String(text).toLowerCase().indexOf(q.toLowerCase());
      if (i < 0) return esc(text);
      return esc(text.slice(0, i)) + '<em>' + esc(text.slice(i, i + q.length)) + '</em>' +
             esc(text.slice(i + q.length));
    }

    box.innerHTML = '<div class="hc-searchcount">' +
        (scope ? ('在「' + esc(scope) + '」里找到 ' + hits.length + ' 条')
               : ('找到 ' + hits.length + ' 条')) +
        (local ? '<span class="lcl">本机</span>' : '') +
      '</div>' +
      hits.map(function (h, i) {
        var d = new Date(h.ts);
        var time = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
                   (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' +
                   (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();

        var kt = (global.HC.net && global.HC.net.kindTag) ? global.HC.net.kindTag(h.kind) : '';
        var body = kt ? esc(kt) : hl(h.body);
        return '<div class="hc-hit" data-i="' + i + '">' +
          '<div class="htop">' +
            '<span class="hwho">' + esc(h.senderName) + '</span>' +
            '<span class="hconv">' + (h.isGroup ? '在「' + esc(h.convTitle) + '」' : '私聊') + '</span>' +
            '<span class="htime">' + time + '</span>' +
          '</div>' +
          '<div class="hbody">' + body + '</div>' +
        '</div>';
      }).join('');

    box.querySelectorAll('.hc-hit').forEach(function (el) {
      el.onclick = function () {
        var h = hits[+el.dataset.i];
        if (h) global.HC.app.jumpTo(h);
      };
    });
  }

  global.HC.ui = {
    esc: esc, ico: ico,
    avatarColor: avatarColor, initial: initial, avatarHTML: avatarHTML,
    listTime: listTime, chatTime: chatTime,
    toast: toast, vibrate: vibrate, shortVibrate: shortVibrate,
    openSheet: openSheet, closeSheet: closeSheet, inputSheet: inputSheet,
    renderPills: renderPills,
    renderConvs: renderConvs, renderGroups: renderGroups,
    renderTabs: renderTabs, updateTabDots: updateTabDots,
    renderGroupPicker: renderGroupPicker, pickedMembers: pickedMembers,
    groupAvatarHTML: groupAvatarHTML,
    renderContacts: renderContacts,
    renderChat: renderChat, scheduleChat: scheduleChat, findConvWith: findConvWith,
    renderProfile: renderProfile, renderChatSet: renderChatSet,
    currentPeer: currentPeer, currentConv: currentConv,
    renderQuick: renderQuick, toggleQuick: toggleQuick,
    renderSettings: renderSettings,
    renderChangelog: renderChangelog,
    brandJump: brandJump,
    retryNotif: function () { if (global.HC.app) global.HC.app.retryNotif(); },
    runVoiceDiag: runVoiceDiag,
    diagClose: diagClose,
    applyTheme: applyTheme,
    showUpload: showUpload, hideUpload: hideUpload,
    showCryptoFail: showCryptoFail,
    showBootError: showBootError,
    openViewer: openViewer,
    bindLongPress: bindLongPress, renderSearch: renderSearch,
    searchLocal: searchLocal, searchNames: searchNames,
    pagStateFor: pagStateFor,
    pag: function () { return pag; }
  };
})(typeof window !== 'undefined' ? window : this);
