(function (global) {
  'use strict';

  var HC = global.HC = global.HC || {};

  var BRANDS = [
    {
      key: 'xiaomi',
      name: '小米 / 红米',
      match: /xiaomi|redmi|mi\b|poco/i,
      steps: [
        '在"设置"里找到「应用设置」→「应用管理」',
        '找到「家庭聊天」→ 点「省电策略」→ 选「无限制」',
        '再点「自启动」→ 打开开关',
        '回到"设置"→「省电与电池」→「电池」→ 关掉「神隐模式」'
      ],
      intents: [

        { a: 'com.miui.securitycenter', c: 'com.miui.permcenter.autostart.AutoStartManagementActivity' },

        { a: 'com.miui.powerkeeper', c: 'com.miui.powerkeeper.ui.HiddenAppsConfigActivity' },
        { a: 'com.android.settings', c: 'com.android.settings.applications.InstalledAppDetails' }
      ]
    },
    {
      key: 'vivo',
      name: 'vivo / iQOO',
      match: /vivo|iqoo/i,
      steps: [
        '在"设置"里找到「电池」→「后台高耗电」',
        '把「家庭聊天」的开关打开',
        '再找「应用与权限」→「权限管理」→「自启动」→ 打开',
        '最后「设置」→「电池」→ 关掉「睡眠模式」'
      ],
      intents: [
        { a: 'com.vivo.permissionmanager', c: 'com.vivo.permissionmanager.activity.BgStartUpManagerActivity' },
        { a: 'com.iqoo.secure', c: 'com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity' },
        { a: 'com.vivo.permissionmanager', c: 'com.vivo.permissionmanager.activity.PurviewTabActivity' }
      ]
    },
    {
      key: 'huawei',
      name: '华为 / 荣耀',
      match: /huawei|honor|hwa|nova/i,
      steps: [
        '在"设置"里找到「应用」→「应用启动管理」',
        '找到「家庭聊天」→ 关掉「自动管理」',
        '弹出的三个开关全打开：自启动、关联启动、后台活动',
        '再「设置」→「电池」→ 关掉「省电模式」'
      ],
      intents: [
        { a: 'com.huawei.systemmanager', c: 'com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity' },
        { a: 'com.huawei.systemmanager', c: 'com.huawei.systemmanager.optimize.process.ProtectActivity' },
        { a: 'com.huawei.systemmanager', c: 'com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity' }
      ]
    },
    {
      key: 'oppo',
      name: 'OPPO / 一加 / realme',
      match: /oppo|oneplus|realme|heytap/i,
      steps: [
        '在"设置"里找到「电池」→「应用耗电管理」',
        '找到「家庭聊天」→ 打开「允许完全后台行为」',
        '再「设置」→「应用管理」→「自启动」→ 打开',
        '最后「设置」→「电池」→ 关掉「智能省电」'
      ],
      intents: [
        { a: 'com.coloros.safecenter', c: 'com.coloros.safecenter.permission.startup.StartupAppListActivity' },
        { a: 'com.coloros.safecenter', c: 'com.coloros.safecenter.startupapp.StartupAppListActivity' },
        { a: 'com.oppo.safe', c: 'com.oppo.safe.permission.startup.StartupAppListActivity' },
        { a: 'com.oneplus.security', c: 'com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity' }
      ]
    },
    {
      key: 'samsung',
      name: '三星',
      match: /samsung|sm-/i,
      steps: [
        '在"设置"里找到「电池和设备维护」→「电池」',
        '点「后台使用限制」→ 把「家庭聊天」从"休眠应用"里移出来',
        '再「设置」→「应用程序」→「家庭聊天」→「电池」→ 选「不受限制」'
      ],
      intents: [
        { a: 'com.samsung.android.lool', c: 'com.samsung.android.sm.ui.battery.BatteryActivity' },
        { a: 'com.samsung.android.sm', c: 'com.samsung.android.sm.ui.battery.BatteryActivity' }
      ]
    },
    {
      key: 'google',
      name: '谷歌 / 原生安卓',
      match: /google|android|pixel|nexus/i,
      steps: [
        '在"设置"里找到「应用」→「家庭聊天」→「电池」',
        '选「不受限制」（不要选"已优化"）',
        '如果手机有「自适应电池」，把它也关掉'
      ],
      intents: [

        { a: 'com.android.settings', c: 'com.android.settings.Settings$HighPowerApplicationsActivity' },
        { a: 'com.android.settings', c: 'com.android.settings.fuelgauge.batterysaver.BatterySaverSettingsActivity' }
      ]
    }
  ];

  function extend(dst, src) {
    for (var k in src) { if (Object.prototype.hasOwnProperty.call(src, k)) dst[k] = src[k]; }
    return dst;
  }

  var GENERIC = {
    key: 'other',
    name: '安卓手机',
    steps: [
      '在"设置"里搜「电池」→ 找到「家庭聊天」',
      '把省电限制改成「不受限制」或「允许后台运行」',
      '再搜「自启动」→ 允许「家庭聊天」自启动'
    ],
    intents: []
  };

  function detect() {
    var hay = '';
    try {
      if (global.plus && plus.device) {
        hay = String(plus.device.vendor || '') + ' ' + String(plus.device.model || '');
      }
    } catch (e) {}

    if (!global.plus) {
      return { key: 'web', name: '电脑 / 浏览器', web: true, steps: [], intents: [] };
    }

    for (var i = 0; i < BRANDS.length; i++) {
      if (BRANDS[i].match.test(hay)) {
        return extend(extend({}, BRANDS[i]), { raw: hay.trim() });
      }
    }
    return extend(extend({}, GENERIC), { raw: hay.trim() });
  }

  function jump() {
    var b = detect();
    if (b.web || !b.intents.length) return false;

    var main = null;
    try { main = plus.android.runtimeMainActivity(); } catch (e) {}
    if (!main) return false;

    var Intent = null, Uri = null;
    try {
      Intent = plus.android.importClass('android.content.Intent');
      Uri = plus.android.importClass('android.net.Uri');
    } catch (e) { return false; }

    var myPkg = '';
    try { myPkg = main.getPackageName(); } catch (e) {}

    for (var i = 0; i < b.intents.length; i++) {
      var t = b.intents[i];
      try {
        var it = new Intent();
        it.setClassName(t.a, t.c);

        it.addFlags(0x10000000);
        main.startActivity(it);
        return true;
      } catch (e) {

      }
    }

    try {
      var it2 = new Intent('android.settings.APPLICATION_DETAILS_SETTINGS');
      it2.setData(Uri.parse('package:' + myPkg));
      it2.addFlags(0x10000000);
      main.startActivity(it2);
      return true;
    } catch (e) {}

    return false;
  }

  HC.brand = {
    list: BRANDS,
    detect: detect,
    jump: jump
  };

})(window);
