'use strict';

const crypto = require('crypto');

const SALT      = 'HomeChat/v1/local-salt';
const SALT_ADMIN = 'HomeChat/v1/admin-salt';
const INFO_ENC  = 'HomeChat/v1/enc';
const INFO_MAC  = 'HomeChat/v1/mac';
const NONCE_LEN = 16;
const TAG_LEN   = 32;
const BLOCK     = 32;

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

function xor(a, b) {
  const n = Math.min(a.length, b.length);
  const out = Buffer.allocUnsafe(n);
  for (let i = 0; i < n; i++) out[i] = a[i] ^ b[i];
  return out;
}

function deriveMaster(password, iterations) {
  return crypto.pbkdf2Sync(
    Buffer.from(String(password), 'utf8'),
    Buffer.from(SALT, 'utf8'),
    iterations,
    32,
    'sha256'
  );
}

function deriveMasterAsync(password, iterations, saltStr) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(
      Buffer.from(String(password), 'utf8'),
      Buffer.from(saltStr || SALT, 'utf8'),
      iterations,
      32,
      'sha256',
      (err, key) => (err ? reject(err) : resolve(key))
    );
  });
}

function deriveAdmin(password, iterations) {
  return crypto.pbkdf2Sync(
    Buffer.from(String(password), 'utf8'),
    Buffer.from(SALT_ADMIN, 'utf8'),
    iterations,
    32,
    'sha256'
  );
}

function deriveAdminAsync(password, iterations) {
  return deriveMasterAsync(password, iterations, SALT_ADMIN);
}

function subkeys(masterKey) {
  return {
    kEnc: hmac(masterKey, Buffer.from(INFO_ENC, 'utf8')),
    kMac: hmac(masterKey, Buffer.from(INFO_MAC, 'utf8')),
  };
}

function keystream(kEnc, nonce, len, offset) {
  const out = Buffer.allocUnsafe(len);
  const ctr = Buffer.allocUnsafe(4);
  let pos = 0;
  let n = (offset | 0) >>> 0;

  while (pos < len) {
    ctr.writeUInt32BE(n >>> 0, 0);
    const blk = hmac(kEnc, Buffer.concat([nonce, ctr], NONCE_LEN + 4));
    const take = Math.min(BLOCK, len - pos);
    blk.copy(out, pos, 0, take);
    pos += take;
    n = (n + 1) >>> 0;
  }
  return out;
}

function seal(kEnc, kMac, obj) {
  const nonce = crypto.randomBytes(NONCE_LEN);
  const pt = Buffer.from(JSON.stringify(obj), 'utf8');
  const ct = xor(pt, keystream(kEnc, nonce, pt.length, 0));
  const tag = hmac(kMac, Buffer.concat([nonce, ct], NONCE_LEN + ct.length));
  return {
    v: 1,
    n: nonce.toString('base64'),
    c: ct.toString('base64'),
    m: tag.toString('base64'),
  };
}

function open(kEnc, kMac, env) {
  const buf = openRaw(kEnc, kMac, env);
  if (buf === null) return null;
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch (e) {
    return null;
  }
}

function openRaw(kEnc, kMac, env) {
  if (!env || typeof env !== 'object') return null;
  if (env.v !== 1) return null;
  if (typeof env.n !== 'string' || typeof env.c !== 'string' || typeof env.m !== 'string') return null;

  let nonce, ct, tag;
  try {
    nonce = Buffer.from(env.n, 'base64');
    ct    = Buffer.from(env.c, 'base64');
    tag   = Buffer.from(env.m, 'base64');
  } catch (e) {
    return null;
  }
  if (nonce.length !== NONCE_LEN || tag.length !== TAG_LEN) return null;

  const expect = hmac(kMac, Buffer.concat([nonce, ct], NONCE_LEN + ct.length));

  if (!crypto.timingSafeEqual(expect, tag)) return null;

  return xor(ct, keystream(kEnc, nonce, ct.length, 0));
}

function sealBuf(kEnc, kMac, buf) {
  const nonce = crypto.randomBytes(NONCE_LEN);
  const ct = xor(buf, keystream(kEnc, nonce, buf.length, 0));
  const tag = hmac(kMac, Buffer.concat([nonce, ct], NONCE_LEN + ct.length));
  return {
    v: 1,
    n: nonce.toString('base64'),
    c: ct.toString('base64'),
    m: tag.toString('base64'),
  };
}

function challengeResponse(kMac, challenge) {
  return hmac(kMac, Buffer.from(String(challenge), 'utf8')).toString('hex');
}

function selfTest() {
  const fails = [];

  const shaVectors = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
     '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ];
  for (const [input, want] of shaVectors) {
    const got = sha256(Buffer.from(input, 'utf8')).toString('hex');
    if (got !== want) fails.push(`SHA-256("${input.slice(0, 12)}…") 期望 ${want.slice(0, 16)}… 实得 ${got.slice(0, 16)}…`);
  }

  const pbkVectors = [
    [1,    '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b'],
    [2,    'ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43'],
    [4096, 'c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a'],
  ];
  for (const [iters, want] of pbkVectors) {
    const got = crypto.pbkdf2Sync('password', 'salt', iters, 32, 'sha256').toString('hex');
    if (got !== want) fails.push(`PBKDF2(iter=${iters}) 期望 ${want.slice(0, 16)}… 实得 ${got.slice(0, 16)}…`);
  }

  {
    const got = hmac(Buffer.from('Jefe', 'utf8'), Buffer.from('what do ya want for nothing?', 'utf8')).toString('hex');
    const want = '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843';
    if (got !== want) fails.push(`HMAC-SHA256 期望 ${want.slice(0, 16)}… 实得 ${got.slice(0, 16)}…`);
  }

  try {
    const master = deriveMaster('123456', 1000);
    const { kEnc, kMac } = subkeys(master);
    for (let i = 0; i < 3; i++) {
      const obj = { t: 'send', cid: 'x' + i, body: '吃饭了 🍚'.repeat(i + 1), n: i };
      const env = seal(kEnc, kMac, obj);
      const back = open(kEnc, kMac, env);
      if (JSON.stringify(back) !== JSON.stringify(obj)) {
        fails.push(`回环测试第 ${i + 1} 轮失败`);
      }
    }

    const env = seal(kEnc, kMac, { hello: 'world' });
    const raw = Buffer.from(env.c, 'base64');
    raw[0] ^= 0x01;
    env.c = raw.toString('base64');
    if (open(kEnc, kMac, env) !== null) fails.push('篡改检测失败：改过的密文居然解开了');

    const other = subkeys(deriveMaster('000000', 1000));
    if (open(other.kEnc, other.kMac, seal(kEnc, kMac, { a: 1 })) !== null) {
      fails.push('错误密钥居然解开了密文');
    }
  } catch (e) {
    fails.push('回环测试抛异常：' + e.message);
  }

  return { ok: fails.length === 0, fails };
}

module.exports = {
  SALT, INFO_ENC, INFO_MAC, NONCE_LEN, TAG_LEN, BLOCK,
  sha256, hmac, xor, keystream,
  deriveMaster, deriveMasterAsync, deriveAdmin, deriveAdminAsync, subkeys,
  SALT, SALT_ADMIN,
  seal, open, sealBuf, openRaw,
  challengeResponse,
  selfTest,
};
