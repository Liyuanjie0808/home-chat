(function (global) {
  'use strict';

  var HC = global.HC = global.HC || {};

  var CH_ID   = 'homechat';
  var CH_NAME = '聊天消息';

  var state = 'unknown';

  function hasPlus() {
    try { return !!(global.plus && global.plus.android); } catch (e) { return false; }
  }

  function sdkInt() {

    try {
      var v = plus.android.invoke('android.os.Build$VERSION', 'getSdkInt');
      if (v && Number(v) > 0) return Number(v);
    } catch (e) {}

    try {
      var B = plus.android.importClass('android.os.Build');
      if (B && B.VERSION && Number(B.VERSION.SDK_INT) > 0) return Number(B.VERSION.SDK_INT);
    } catch (e) {}

    try {
      var sv = parseInt(global.plus.os && global.plus.os.version, 10);
      if (sv > 0) return sv + 20;
    } catch (e) {}

    return 0;
  }

  function notifManager() {
    var main = plus.android.runtimeMainActivity();

    var nm = main.getSystemService('notification');
    if (!nm) { try { nm = main.getSystemService(main.NOTIFICATION_SERVICE); } catch (e) {} }
    return nm;
  }

  function checkEnabled() {
    if (!hasPlus()) return 'noplatform';
    try {
      var nm = notifManager();
      if (!nm) return 'unknown';
      if (sdkInt() >= 24) {
        var on = plus.android.invoke(nm, 'areNotificationsEnabled');
        return on ? 'on' : 'off';
      }

      return 'on';
    } catch (e) { return 'unknown'; }
  }

  function ensureChannel() {
    if (!hasPlus()) return false;

    var NC = null;
    try { NC = plus.android.importClass('android.app.NotificationChannel'); } catch (e) {}
    if (!NC) {

      return sdkInt() < 26;
    }

    try {
      var nm = notifManager();
      if (!nm) return false;

      var ch = new NC(CH_ID, CH_NAME, 4);
      try { ch.setDescription('家里人发来的消息'); } catch (e) {}
      try { ch.enableVibration(true); } catch (e) {}
      try { ch.setShowBadge(true); } catch (e) {}
      nm.createNotificationChannel(ch);
      return true;
    } catch (e) {
      log('建通知渠道失败（通知可能不显示）：' + (e && e.message));
      return false;
    }
  }

  function log(msg) {
    try { console.warn('[HomeChat/notify] ' + msg); } catch (e) {}
  }

  function askPermission(done) {
    var sdk = sdkInt();

    if (sdk && sdk < 33) { done(checkEnabled()); return; }
    if (!plus.android.requestPermissions) { done('unknown'); return; }

    var settled = false;
    function once(st) { if (!settled) { settled = true; done(st); } }

    try {
      plus.android.requestPermissions(['android.permission.POST_NOTIFICATIONS'],
        function () {

          setTimeout(function () { once(checkEnabled()); }, 300);
        },
        function () { setTimeout(function () { once(checkEnabled()); }, 300); });
    } catch (e) {
      once(checkEnabled());
    }

    setTimeout(function () { once(checkEnabled()); }, 4000);
  }

  function setup(onState) {
    if (!hasPlus()) {
      state = 'noplatform';
      if (onState) onState(state);
      return;
    }

    ensureChannel();

    askPermission(function (st) {
      state = st;
      if (st === 'off') log('通知被系统关掉了 —— 收消息不会响');
      if (onState) onState(st);
    });
  }

  function refresh() {
    state = checkEnabled();
    return state;
  }

  function push(title, text, payload) {
    try {
      if (!global.plus || !global.plus.push) return false;
      global.plus.push.createMessage(String(text || ''), JSON.stringify(payload || {}), {
        title: String(title || 'Home Chat'),
        cover: false
      });

      return true;
    } catch (e) {
      log('弹通知失败：' + (e && e.message));
      return false;
    }
  }

  function openSettings() {
    if (!hasPlus()) return false;

    var main = null;
    try { main = plus.android.runtimeMainActivity(); } catch (e) { return false; }

    var Intent = null, Uri = null;
    try {
      Intent = plus.android.importClass('android.content.Intent');
      Uri    = plus.android.importClass('android.net.Uri');
    } catch (e) { return false; }

    var myPkg = '';
    try { myPkg = main.getPackageName(); } catch (e) {}

    var tries = [
      { a: 'android.settings.APP_NOTIFICATION_SETTINGS',     extra: true },
      { a: 'android.settings.CHANNEL_NOTIFICATION_SETTINGS', channel: true },
      { a: 'android.settings.APPLICATION_DETAILS_SETTINGS',  data: true }
    ];

    for (var i = 0; i < tries.length; i++) {
      var t = tries[i];
      try {
        var it = new Intent(t.a);
        if (t.extra) {
          it.putExtra('android.provider.extra.APP_PACKAGE', myPkg);
          it.putExtra('app_package', myPkg);
        }
        if (t.channel) {
          it.putExtra('android.provider.extra.APP_PACKAGE', myPkg);
          it.putExtra('android.provider.extra.CHANNEL_ID', CH_ID);
          it.putExtra('app_package', myPkg);
          it.putExtra('channel_id', CH_ID);
        }
        if (t.data) it.setData(Uri.parse('package:' + myPkg));
        it.addFlags(0x10000000);
        main.startActivity(it);
        return true;
      } catch (e) {  }
    }
    return false;
  }

  function onClick(fn) {
    try {
      if (!global.plus || !global.plus.push) return;
      global.plus.push.addEventListener('click', function (msg) {
        var payload = {};
        try { payload = JSON.parse(msg.payload || '{}'); } catch (e) {}
        fn(payload);
      }, false);
    } catch (e) {}
  }

  HC.notify = {
    setup: setup,
    push: push,
    refresh: refresh,
    openSettings: openSettings,
    onClick: onClick,
    checkEnabled: checkEnabled,
    ensureChannel: ensureChannel,
    sdkInt: sdkInt,
    channelId: CH_ID,
    getState: function () { return state; }
  };

})(typeof window !== 'undefined' ? window : this);
