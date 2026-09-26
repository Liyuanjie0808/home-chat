(function (global) {
  'use strict';

  var S = null;
  function store() { return global.HC && global.HC.store; }

  var FLAG_SECURE = 0x00002000;

  var secureOn = false;
  var secureOk = false;
  var secureTimer = null;

  function applyFlags(win, on) {
    if (!win) return false;

    if (typeof FLAG_SECURE !== 'number' || FLAG_SECURE !== 0x00002000) {
      console.error('[HomeChat] FLAG_SECURE 丢了！防截屏会静默失效');
      return false;
    }

    var called = false;

    try {
      if (on) { win.addFlags(FLAG_SECURE); called = true; }
      else    { win.clearFlags(FLAG_SECURE); called = true; }
    } catch (e) {}

    if (!called) {
      try {
        plus.android.invoke(win, on ? 'addFlags' : 'clearFlags', FLAG_SECURE);
        called = true;
      } catch (e) {}
    }

    if (!called) return false;

    var read = readFlag(win);
    if (read === null) return true;
    return read === !!on;
  }

  function readFlag(win) {
    try {
      var attrs = win.getAttributes();
      if (!attrs) return null;
      var flags = plus.android.getAttribute(attrs, 'flags');
      if (flags === null || flags === undefined) return null;
      return (Number(flags) & FLAG_SECURE) !== 0;
    } catch (e) { return null; }
  }

  function setAndroidSecure(on) {
    secureOn = !!on;

    if (!(global.plus && plus.android && plus.android.runtimeMainActivity)) {
      secureOk = false;
      return false;
    }

    var ok = false;
    try {
      var main = plus.android.runtimeMainActivity();

      try { ok = applyFlags(main.getWindow(), on) || ok; } catch (e) {}

      try {
        if (!ok && plus.webview && plus.webview.currentWebview) {
          var wv = plus.webview.currentWebview();
          if (wv && wv.getWindow) ok = applyFlags(wv.getWindow(), on) || ok;
        }
      } catch (e) {}

      try {
        if (!ok && plus.webview && plus.webview.all) {
          var all = plus.webview.all() || [];
          for (var i = 0; i < all.length; i++) {
            try {
              var w2 = all[i].getWindow && all[i].getWindow();
              if (w2) ok = applyFlags(w2, on) || ok;
            } catch (e2) {}
          }
        }
      } catch (e) {}

    } catch (e) {
      console.warn('[HomeChat] 防截屏设置失败：' + (e && e.message));
    }

    secureOk = ok;

    if (on && global.plus && plus.android) {
      if (!secureTimer) {
        secureTimer = setInterval(function () {
          if (!secureOn) return;
          try {
            var w = plus.android.runtimeMainActivity().getWindow();

            if (readFlag(w) !== true) applyFlags(w, true);
          } catch (e) {}
        }, 2500);
      }
    } else if (secureTimer) {
      clearInterval(secureTimer);
      secureTimer = null;
    }

    return ok;
  }

  function screenshotState() {
    if (!global.plus) return 'browser';
    if (global.plus.android) return secureOk ? 'on' : 'failed';
    return 'ios';
  }

  function iosCanSecure() { return false; }

  function isEditable(el) {
    if (!el) return false;
    var t = (el.tagName || '').toLowerCase();
    return t === 'input' || t === 'textarea' || el.isContentEditable;
  }

  function blockUnlessEditable(e) {
    var el = e.target;
    if (isEditable(el)) return;
    e.preventDefault();
    e.stopPropagation();
    return false;
  }

  var bound = false;

  var COPY_EVENTS = ['copy', 'cut', 'paste', 'contextmenu', 'dragstart'];

  function onSelectStart(e) {
    if (isEditable(e.target)) return;
    e.preventDefault();
    return false;
  }
  function onSelectStartProp(e) {
    if (isEditable(e && e.target)) return true;
    return false;
  }
  function onCopyProp(e) {
    if (isEditable(e && e.target)) return true;
    if (e) e.preventDefault();
    return false;
  }

  function bindCopyBlock() {
    if (bound) return;
    bound = true;

    COPY_EVENTS.forEach(function (ev) {
      document.addEventListener(ev, blockUnlessEditable, true);
    });

    document.addEventListener('selectstart', onSelectStart, true);

    document.onselectstart = onSelectStartProp;
    document.oncopy = onCopyProp;
    document.oncut = onCopyProp;
  }

  function unbindCopyBlock() {
    if (!bound) return;
    bound = false;

    COPY_EVENTS.forEach(function (ev) {
      try { document.removeEventListener(ev, blockUnlessEditable, true); } catch (e) {}
    });
    try { document.removeEventListener('selectstart', onSelectStart, true); } catch (e) {}

    document.onselectstart = null;
    document.oncopy = null;
    document.oncut = null;
  }

  var wmTimer = null;

  function paintWatermark(on) {
    var el = document.getElementById('watermark');
    if (!el) return;

    if (!on) {
      el.classList.remove('on');
      el.style.backgroundImage = '';
      if (wmTimer) { clearInterval(wmTimer); wmTimer = null; }
      return;
    }

    var st = store();
    var who = (st && st.S.cfg.name) || 'Home Chat';

    var TW = 152, TH = 94, FS = 9;

    function tile() {
      var d = new Date();
      function p2(n) { return n < 10 ? '0' + n : '' + n; }

      var stamp = p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
      var text = who + '  ' + stamp;

      var svg = "<svg xmlns='http://www.w3.org/2000/svg' width='" + TW + "' height='" + TH + "'>" +
        "<text x='" + (TW / 2) + "' y='" + (TH / 2) + "' " +
        "font-family='-apple-system,PingFang SC,sans-serif' font-size='" + FS + "' " +
        "fill='%23000' text-anchor='middle' dominant-baseline='middle' " +
        "transform='rotate(-22 " + (TW / 2) + " " + (TH / 2) + ")'>" +

        text.replace(/[<>&'"]/g, '') + "</text></svg>";
      el.style.backgroundImage = 'url("data:image/svg+xml,' + svg.replace(/#/g, '%23') + '")';
    }

    tile();
    el.classList.add('on');

    if (!wmTimer) wmTimer = setInterval(tile, 1000);
  }

  function apply(on) {
    if (on == null) on = true;

    var st = store();
    var cfg = st ? st.S.cfg : {};

    if (on) bindCopyBlock();
    else unbindCopyBlock();
    document.documentElement.classList.toggle('hc-nocopy', !!on);

    paintWatermark(!!on);

    if (on) setAndroidSecure(true);
    else setAndroidSecure(false);

    return { copy: !!on, shot: screenshotState() === 'on', state: screenshotState() };
  }

  function isBrowser() { return !global.plus; }

  global.HC = global.HC || {};
  global.HC.secure = {
    apply: apply,
    screenshotState: screenshotState,
    reapplyFlags: function () { try { return setAndroidSecure(secureOn); } catch (e) { return false; } },
    isBrowser: isBrowser,
    canBlockScreenshot: function () { return !!(global.plus && plus.android); },
    FLAG_SECURE: FLAG_SECURE,
  };
})(typeof window !== 'undefined' ? window : this);
