(function (global) {
  'use strict';

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  function utf8Encode(str) {
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var c2 = str.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
          out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
          i++;
        } else {
          out.push(0xef, 0xbf, 0xbd);
        }
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return new Uint8Array(out);
  }

  function utf8Decode(bytes) {
    var out = '', i = 0, b, c, d, e, cp;
    while (i < bytes.length) {
      b = bytes[i++];
      if (b < 0x80) { out += String.fromCharCode(b); continue; }
      if (b >= 0xc0 && b < 0xe0) {
        c = bytes[i++]; cp = ((b & 31) << 6) | (c & 63);
      } else if (b >= 0xe0 && b < 0xf0) {
        c = bytes[i++]; d = bytes[i++];
        cp = ((b & 15) << 12) | ((c & 63) << 6) | (d & 63);
      } else if (b >= 0xf0) {
        c = bytes[i++]; d = bytes[i++]; e = bytes[i++];
        cp = ((b & 7) << 18) | ((c & 63) << 12) | ((d & 63) << 6) | (e & 63);
      } else { out += '\ufffd'; continue; }

      if (cp > 0xffff) {
        cp -= 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
      } else {
        out += String.fromCharCode(cp);
      }
    }
    return out;
  }

  function concat(a, b) {
    var out = new Uint8Array(a.length + b.length);
    out.set(a, 0); out.set(b, a.length);
    return out;
  }

  function toHex(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return s;
  }

  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length >> 1);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function b64enc(bytes) {
    var CH = 0x8000, s = '';
    for (var i = 0; i < bytes.length; i += CH) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length)));
    }
    return btoa(s);
  }

  function b64dec(str) {
    var bin = atob(str);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function randomBytes(n) {
    var out = new Uint8Array(n);
    if (global.crypto && global.crypto.getRandomValues) {
      global.crypto.getRandomValues(out);
      return out;
    }
    for (var i = 0; i < n; i++) out[i] = (Math.random() * 256) | 0;
    randomBytes.weak = true;
    return out;
  }

  var K = new Int32Array([
    0x428a2f98 | 0, 0x71374491 | 0, 0xb5c0fbcf | 0, 0xe9b5dba5 | 0,
    0x3956c25b | 0, 0x59f111f1 | 0, 0x923f82a4 | 0, 0xab1c5ed5 | 0,
    0xd807aa98 | 0, 0x12835b01 | 0, 0x243185be | 0, 0x550c7dc3 | 0,
    0x72be5d74 | 0, 0x80deb1fe | 0, 0x9bdc06a7 | 0, 0xc19bf174 | 0,
    0xe49b69c1 | 0, 0xefbe4786 | 0, 0x0fc19dc6 | 0, 0x240ca1cc | 0,
    0x2de92c6f | 0, 0x4a7484aa | 0, 0x5cb0a9dc | 0, 0x76f988da | 0,
    0x983e5152 | 0, 0xa831c66d | 0, 0xb00327c8 | 0, 0xbf597fc7 | 0,
    0xc6e00bf3 | 0, 0xd5a79147 | 0, 0x06ca6351 | 0, 0x14292967 | 0,
    0x27b70a85 | 0, 0x2e1b2138 | 0, 0x4d2c6dfc | 0, 0x53380d13 | 0,
    0x650a7354 | 0, 0x766a0abb | 0, 0x81c2c92e | 0, 0x92722c85 | 0,
    0xa2bfe8a1 | 0, 0xa81a664b | 0, 0xc24b8b70 | 0, 0xc76c51a3 | 0,
    0xd192e819 | 0, 0xd6990624 | 0, 0xf40e3585 | 0, 0x106aa070 | 0,
    0x19a4c116 | 0, 0x1e376c08 | 0, 0x2748774c | 0, 0x34b0bcb5 | 0,
    0x391c0cb3 | 0, 0x4ed8aa4a | 0, 0x5b9cca4f | 0, 0x682e6ff3 | 0,
    0x748f82ee | 0, 0x78a5636f | 0, 0x84c87814 | 0, 0x8cc70208 | 0,
    0x90befffa | 0, 0xa4506ceb | 0, 0xbef9a3f7 | 0, 0xc67178f2 | 0
  ]);

  var H_INIT = [0x6a09e667 | 0, 0xbb67ae85 | 0, 0x3c6ef372 | 0, 0xa54ff53a | 0,
                0x510e527f | 0, 0x9b05688c | 0, 0x1f83d9ab | 0, 0x5be0cd19 | 0];

  function compress(H, m, off, W) {
    var i, j, t1, t2, S0, S1, ch, maj, x, y, s0, s1;

    for (i = 0; i < 16; i++) {
      j = off + i * 4;
      W[i] = ((m[j] << 24) | (m[j + 1] << 16) | (m[j + 2] << 8) | m[j + 3]) | 0;
    }
    for (i = 16; i < 64; i++) {
      x = W[i - 15]; y = W[i - 2];
      s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) | 0;
      s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) | 0;
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }

    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];

    for (i = 0; i < 64; i++) {
      S1  = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) | 0;
      ch  = ((e & f) ^ (~e & g)) | 0;
      t1  = (h + S1 + ch + K[i] + W[i]) | 0;
      S0  = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) | 0;
      maj = ((a & b) ^ (a & c) ^ (b & c)) | 0;
      t2  = (S0 + maj) | 0;

      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }

    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }

  function resetH(H) {
    for (var i = 0; i < 8; i++) H[i] = H_INIT[i];
    return H;
  }

  function stateToBytes(H, out) {
    for (var i = 0; i < 8; i++) {
      out[i * 4]     = (H[i] >>> 24) & 0xff;
      out[i * 4 + 1] = (H[i] >>> 16) & 0xff;
      out[i * 4 + 2] = (H[i] >>> 8) & 0xff;
      out[i * 4 + 3] = H[i] & 0xff;
    }
    return out;
  }

  function sha256(bytes) {
    var len = bytes.length;
    var padLen = ((len + 9 + 63) >> 6) << 6;
    var m = new Uint8Array(padLen);
    m.set(bytes);
    m[len] = 0x80;

    var bitLen = len * 8;
    var hi = Math.floor(bitLen / 4294967296);
    var lo = bitLen >>> 0;
    m[padLen - 8] = (hi >>> 24) & 0xff; m[padLen - 7] = (hi >>> 16) & 0xff;
    m[padLen - 6] = (hi >>> 8) & 0xff;  m[padLen - 5] = hi & 0xff;
    m[padLen - 4] = (lo >>> 24) & 0xff; m[padLen - 3] = (lo >>> 16) & 0xff;
    m[padLen - 2] = (lo >>> 8) & 0xff;  m[padLen - 1] = lo & 0xff;

    var H = new Int32Array(8);
    var W = new Int32Array(64);
    resetH(H);
    for (var off = 0; off < padLen; off += 64) compress(H, m, off, W);

    return stateToBytes(H, new Uint8Array(32));
  }

  var B = 64;

  function hmac(key, data) {
    var k = key.length > B ? sha256(key) : key;
    var kpad = new Uint8Array(B);
    kpad.set(k);

    var ipad = new Uint8Array(B), opad = new Uint8Array(B);
    for (var i = 0; i < B; i++) {
      ipad[i] = kpad[i] ^ 0x36;
      opad[i] = kpad[i] ^ 0x5c;
    }
    return sha256(concat(opad, sha256(concat(ipad, data))));
  }

  function makeHmacBlocks(key, dataLen) {
    var k = key.length > 64 ? sha256(key) : key;

    function mk(xorByte, totalLen) {
      var padLen = ((totalLen + 9 + 63) >> 6) << 6;
      var b = new Uint8Array(padLen);
      for (var i = 0; i < 64; i++) {
        var kb = i < k.length ? k[i] : 0;
        b[i] = kb ^ xorByte;
      }
      b[totalLen] = 0x80;
      var lo = (totalLen * 8) >>> 0;
      b[padLen - 4] = (lo >>> 24) & 0xff;
      b[padLen - 3] = (lo >>> 16) & 0xff;
      b[padLen - 2] = (lo >>> 8) & 0xff;
      b[padLen - 1] = lo & 0xff;
      return b;
    }

    var inBlk  = mk(0x36, 64 + dataLen);
    var outBlk = mk(0x5c, 96);

    return {
      inBlk: inBlk, outBlk: outBlk,
      inBlocks: inBlk.length / 64,
      outBlocks: outBlk.length / 64
    };
  }

  function hmacBlocks(blks, data, out, H, W, inner) {
    blks.inBlk.set(data, 64);

    var i;
    resetH(H);
    for (i = 0; i < blks.inBlocks; i++) compress(H, blks.inBlk, i * 64, W);
    stateToBytes(H, inner);

    blks.outBlk.set(inner, 64);
    resetH(H);
    for (i = 0; i < blks.outBlocks; i++) compress(H, blks.outBlk, i * 64, W);

    return stateToBytes(H, out);
  }

  function pbkdf2(passwordBytes, saltBytes, iters, dkLen) {
    var hLen = 32;
    var blocks = Math.ceil(dkLen / hLen);
    var out = new Uint8Array(blocks * hLen);

    var key = passwordBytes.length > 64 ? sha256(passwordBytes) : passwordBytes;

    var blks = makeHmacBlocks(key, 32);
    var H = new Int32Array(8);
    var W = new Int32Array(64);
    var inner = new Uint8Array(32);

    var u = new Uint8Array(32);
    var tmp = new Uint8Array(32);
    var t = new Uint8Array(32);

    var salt = new Uint8Array(saltBytes.length + 4);
    salt.set(saltBytes);
    var sLen = saltBytes.length;

    for (var b = 1; b <= blocks; b++) {
      salt[sLen]     = (b >>> 24) & 0xff;
      salt[sLen + 1] = (b >>> 16) & 0xff;
      salt[sLen + 2] = (b >>> 8) & 0xff;
      salt[sLen + 3] = b & 0xff;

      var u1 = hmac(key, salt);
      u.set(u1);
      t.set(u1);

      for (var j = 1; j < iters; j++) {
        hmacBlocks(blks, u, tmp, H, W, inner);
        var sw = u; u = tmp; tmp = sw;
        for (var k = 0; k < hLen; k++) t[k] ^= u[k];
      }

      out.set(t, (b - 1) * hLen);
    }

    return out.subarray(0, dkLen);
  }

  var SALT_STR  = 'HomeChat/v1/local-salt';
  var INFO_ENC  = 'HomeChat/v1/enc';
  var INFO_MAC  = 'HomeChat/v1/mac';
  var NONCE_LEN = 16;
  var TAG_LEN   = 32;
  var BLOCK     = 32;

  function deriveMaster(password, iterations) {
    return pbkdf2(utf8Encode(password), utf8Encode(SALT_STR), iterations, 32);
  }

  function subkeys(masterKey) {
    return {
      kEnc: hmac(masterKey, utf8Encode(INFO_ENC)),
      kMac: hmac(masterKey, utf8Encode(INFO_MAC))
    };
  }

  var ksCache = null;

  function keystream(kEnc, nonce, len, offset) {

    if (!ksCache || ksCache.key !== kEnc) {
      ksCache = {
        key: kEnc,
        blks: makeHmacBlocks(kEnc, 20),
        H: new Int32Array(8),
        W: new Int32Array(64),
        inner: new Uint8Array(32),
        input: new Uint8Array(20),
        block: new Uint8Array(32)
      };
    }
    var c = ksCache;
    c.input.set(nonce, 0);

    var out = new Uint8Array(len);
    var n = (offset | 0) >>> 0;
    var pos = 0;

    while (pos < len) {
      c.input[16] = (n >>> 24) & 0xff;
      c.input[17] = (n >>> 16) & 0xff;
      c.input[18] = (n >>> 8) & 0xff;
      c.input[19] = n & 0xff;

      hmacBlocks(c.blks, c.input, c.block, c.H, c.W, c.inner);

      var take = Math.min(BLOCK, len - pos);
      for (var i = 0; i < take; i++) out[pos + i] = c.block[i];
      pos += take;
      n = (n + 1) >>> 0;
    }
    return out;
  }

  function xorBytes(a, b) {
    var n = Math.min(a.length, b.length);
    var out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = a[i] ^ b[i];
    return out;
  }

  function sealBytes(kEnc, kMac, plain) {
    var nonce = randomBytes(NONCE_LEN);
    var ct = xorBytes(plain, keystream(kEnc, nonce, plain.length, 0));
    var tag = hmac(kMac, concat(nonce, ct));
    return { v: 1, n: b64enc(nonce), c: b64enc(ct), m: b64enc(tag) };
  }

  function openBytes(kEnc, kMac, env) {
    if (!env || typeof env !== 'object' || env.v !== 1) return null;
    if (typeof env.n !== 'string' || typeof env.c !== 'string' || typeof env.m !== 'string') return null;

    var nonce, ct, tag;
    try {
      nonce = b64dec(env.n); ct = b64dec(env.c); tag = b64dec(env.m);
    } catch (e) { return null; }

    if (nonce.length !== NONCE_LEN || tag.length !== TAG_LEN) return null;

    var expect = hmac(kMac, concat(nonce, ct));
    var diff = 0;
    for (var i = 0; i < TAG_LEN; i++) diff |= expect[i] ^ tag[i];
    if (diff !== 0) return null;

    return xorBytes(ct, keystream(kEnc, nonce, ct.length, 0));
  }

  function seal(kEnc, kMac, obj) {
    return sealBytes(kEnc, kMac, utf8Encode(JSON.stringify(obj)));
  }

  function open(kEnc, kMac, env) {
    var raw = openBytes(kEnc, kMac, env);
    if (!raw) return null;
    try { return JSON.parse(utf8Decode(raw)); }
    catch (e) { return null; }
  }

  function selfTest() {
    var fails = [];
    function check(cond, label) { if (!cond) fails.push(label); }

    var shaVec = [
      ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
      ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
      ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
       '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
      ['abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
       'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1']
    ];
    for (var i = 0; i < shaVec.length; i++) {
      var got = toHex(sha256(utf8Encode(shaVec[i][0])));
      check(got === shaVec[i][1], 'SHA-256 测试向量 ' + (i + 1) + ' 不通过');
    }

    var tc1key = new Uint8Array(20);
    for (var ki = 0; ki < 20; ki++) tc1key[ki] = 0x0b;
    check(
      toHex(hmac(tc1key, utf8Encode('Hi There'))) ===
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
      'HMAC 用例1 不通过'
    );
    check(
      toHex(hmac(utf8Encode('Jefe'), utf8Encode('what do ya want for nothing?'))) ===
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
      'HMAC 用例2 不通过'
    );

    check(
      toHex(pbkdf2(utf8Encode('password'), utf8Encode('salt'), 1, 32)) ===
      '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b',
      'PBKDF2 迭代 1 不通过'
    );
    check(
      toHex(pbkdf2(utf8Encode('password'), utf8Encode('salt'), 2, 32)) ===
      'ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43',
      'PBKDF2 迭代 2 不通过'
    );
    check(
      toHex(pbkdf2(utf8Encode('password'), utf8Encode('salt'), 4096, 32)) ===
      'c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a',
      'PBKDF2 迭代 4096 不通过'
    );

    check(
      toHex(pbkdf2(utf8Encode('passwordPASSWORDpassword'),
                   utf8Encode('saltSALTsaltSALTsaltSALTsaltSALTsalt'), 4096, 40)) ===
      '348c89dbcbd32b2f32d814b8116e84cf2b17347ebc1800181c4e2a1fb8dd53e1c635518c7dac47e9',
      'PBKDF2 多块输出不通过'
    );

    var sb1 = new Uint8Array(32);
    var sb2 = new Uint8Array(32);
    for (var q = 0; q < 32; q++) { sb1[q] = (q * 7) & 0xff; sb2[q] = (q * 13 + 1) & 0xff; }
    check(
      toHex(hmac(sb1, sb2)) ===
      toHex(hmacBlocks(makeHmacBlocks(sb1, 32), sb2, new Uint8Array(32),
                       new Int32Array(8), new Int32Array(64), new Uint8Array(32))),
      'HMAC 快路径与通用版结果不一致'
    );

    var strs = ['吃饭了', '今天回来吗？🍚', '👨‍👩‍👧‍👦', 'a', ''];
    for (var s = 0; s < strs.length; s++) {
      check(utf8Decode(utf8Encode(strs[s])) === strs[s], 'UTF-8 往返失败：' + strs[s]);
    }

    try {
      var rb = randomBytes(200);
      var back = b64dec(b64enc(rb));
      var same = rb.length === back.length;
      for (var w = 0; w < rb.length && same; w++) if (rb[w] !== back[w]) same = false;
      check(same, 'base64 往返失败');
    } catch (e) { fails.push('base64 抛异常：' + e.message); }

    try {
      var mk = deriveMaster('123456', 1000);
      var sk = subkeys(mk);
      check(sk.kEnc.length === 32 && sk.kMac.length === 32, '子密钥长度不对');
      check(toHex(sk.kEnc) !== toHex(sk.kMac), '两个子密钥相同（不应该）');

      var obj = { t: 'send', body: '吃饭了 🍚', n: 1 };
      var env = seal(sk.kEnc, sk.kMac, obj);
      var back2 = open(sk.kEnc, sk.kMac, env);
      check(back2 && back2.body === obj.body, 'hc1 加解密往返失败');

      var raw = b64dec(env.c);
      raw[0] ^= 0x01;
      env.c = b64enc(raw);
      check(open(sk.kEnc, sk.kMac, env) === null, '篡改没有被检测出来（严重）');

      var sk2 = subkeys(deriveMaster('000000', 1000));
      check(open(sk2.kEnc, sk2.kMac, seal(sk.kEnc, sk.kMac, { a: 1 })) === null, '错误密钥居然解开了');

      var bin = randomBytes(5000);
      var binBack = openBytes(sk.kEnc, sk.kMac, sealBytes(sk.kEnc, sk.kMac, bin));
      var okBin = binBack && binBack.length === bin.length;
      for (var z = 0; okBin && z < bin.length; z++) if (bin[z] !== binBack[z]) okBin = false;
      check(okBin, '二进制往返失败（5KB）');

      var emptyBack = openBytes(sk.kEnc, sk.kMac, sealBytes(sk.kEnc, sk.kMac, new Uint8Array(0)));
      check(emptyBack !== null && emptyBack.length === 0, '空数据往返失败');

      var zero16 = new Uint8Array(16);
      var ks1 = keystream(sk.kEnc, zero16, 96, 0);
      var ks2 = keystream(sk.kEnc, zero16, 32, 1);
      var okOff = true;
      for (var o = 0; o < 32; o++) if (ks1[32 + o] !== ks2[o]) okOff = false;
      check(okOff, '密钥流按块寻址不对（大文件分块会出事）');

      var n2 = new Uint8Array(16); n2[0] = 1;
      var ks3 = keystream(sk.kEnc, n2, 32, 0);
      var different = false;
      for (var p = 0; p < 32; p++) if (ks1[p] !== ks3[p]) different = true;
      check(different, '换 nonce 后密钥流没变（严重）');
    } catch (e) {
      fails.push('hc1 回环测试抛异常：' + e.message);
    }

    return { ok: fails.length === 0, fails: fails, weakRandom: !!randomBytes.weak };
  }

  global.HC = global.HC || {};
  global.HC.crypto = {
    sha256: sha256,
    hmac: hmac,
    pbkdf2: pbkdf2,
    utf8Encode: utf8Encode,
    utf8Decode: utf8Decode,
    toHex: toHex,
    hexToBytes: hexToBytes,
    b64enc: b64enc,
    b64dec: b64dec,
    randomBytes: randomBytes,
    concat: concat,
    xorBytes: xorBytes,
    SALT_STR: SALT_STR,
    NONCE_LEN: NONCE_LEN,
    deriveMaster: deriveMaster,
    subkeys: subkeys,
    keystream: keystream,
    seal: seal,
    open: open,
    sealBytes: sealBytes,
    openBytes: openBytes,
    selfTest: selfTest
  };
})(typeof window !== 'undefined' ? window : this);
