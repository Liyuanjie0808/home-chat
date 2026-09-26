'use strict';

const DEFAULT_PASSWORD = '123456';

const path = require('path');
const os   = require('os');

const ROOT = path.resolve(__dirname, '..', '..');

module.exports = {

  PORT: Number(process.env.HC_PORT) || 8787,
  HOST: '0.0.0.0',
  LOCAL_ONLY: ['127.0.0.1', '::1', '::ffff:127.0.0.1'],

  VERSION: '2.6',

  DEVELOPER: 'tim-lyj',

  PASSWORD: (function () {
    if (process.env.HC_PASSWORD) return String(process.env.HC_PASSWORD);
    try {
      var f = require('path').join(
        process.env.HC_DATA_DIR || require('path').join(__dirname, '..', '..', 'data'),
        'config.local.json');
      var j = JSON.parse(require('fs').readFileSync(f, 'utf8'));
      if (j && typeof j.password === 'string' && j.password) return j.password;
    } catch (e) {  }
    return DEFAULT_PASSWORD;
  })(),

  DEFAULT_PASSWORD: DEFAULT_PASSWORD,

  get IS_DEFAULT_PASSWORD() { return this.PASSWORD === DEFAULT_PASSWORD; },

  ADMIN_PASSWORD: (function () {
    if (process.env.HC_ADMIN_PASSWORD) return String(process.env.HC_ADMIN_PASSWORD);
    try {
      var f = require('path').join(
        process.env.HC_DATA_DIR || require('path').join(__dirname, '..', '..', 'data'),
        'config.local.json');
      var j = JSON.parse(require('fs').readFileSync(f, 'utf8'));
      if (j && typeof j.adminPassword === 'string' && j.adminPassword) return j.adminPassword;
    } catch (e) {}
    return null;
  })(),

  PBKDF2_ITERATIONS: 300000,

  LOGIN_BY_NAME: true,

  AUTO_APPROVE: process.env.HC_AUTO_APPROVE === '1',

  FILE_TTL_MS: Number(process.env.HC_FILE_TTL_MS) || 5 * 60 * 1000,

  FILE_RAM_MAX: Number(process.env.HC_FILE_RAM_MAX) || 64 * 1024 * 1024,

  DL_TOKEN_TTL_MS: Number(process.env.HC_DL_TOKEN_TTL) || 24 * 3600 * 1000,

  PUSH_MISSED: process.env.HC_PUSH_MISSED === '1',

  FILE_SWEEP_INTERVAL: 30 * 1000,

  ROOT,
  DATA_DIR:  process.env.HC_DATA_DIR || path.join(ROOT, 'data'),
  KEY_FILE:  path.join(process.env.HC_DATA_DIR || path.join(ROOT, 'data'), 'master.key'),
  MSG_FILE:  path.join(process.env.HC_DATA_DIR || path.join(ROOT, 'data'), 'messages.jsonl'),
  STATE_FILE:path.join(process.env.HC_DATA_DIR || path.join(ROOT, 'data'), 'state.json'),

  MAX_CHUNK:  128 * 1024,

  MAX_FILE:   (Number(process.env.HC_MAX_FILE_MB) || 32) * 1024 * 1024,
  MAX_BODY:   2 * 1024 * 1024,

  PING_INTERVAL: 12000,
  DEAD_AFTER:    30000,
  SWEEP_INTERVAL: 5000,
  SWEEP_INTERVAL:30000,

  HISTORY_PAGE:  30,
  DEDUPE_SIZE:   2000,
  LOG_RING:      500,

  DISCOVER_MAGIC_REQ:  'HOMECHAT/DISCOVER',
  DISCOVER_MAGIC_RES:  'HOMECHAT/HERE',
  DISCOVER_TIMEOUT:    2000,

  AUTO_STOP_NO_NETWORK: false,
  NET_CHECK_INTERVAL:   15000,
  NET_GRACE:            3,

  USER_NAME: process.env.HC_USER_NAME || 'admin',

  SERVER_NAME: os.hostname().replace(/\.local$/i, '') || 'Home Chat 服务端',
};
