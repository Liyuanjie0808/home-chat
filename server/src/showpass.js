const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const DATA = process.env.HC_DATA_DIR || path.join(ROOT, 'data');
let pwd = '', admin = '';
try {
  const j = JSON.parse(fs.readFileSync(path.join(DATA, 'config.local.json'), 'utf8'));
  pwd = j.password || '';
  admin = j.adminPassword || '';
} catch (e) {}
if (!pwd) {
  try {
    const s = fs.readFileSync(path.join(__dirname, 'config.js'), 'utf8');
    const m = /DEFAULT_PASSWORD = '([^']+)'/.exec(s);
    if (m) pwd = m[1];
  } catch (e) {}
}
if (!pwd) pwd = '(没找到，可能改过密码)';
process.stdout.write((admin ? (pwd + '\n后台密码：' + admin) : pwd) + '\n');
