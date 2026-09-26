(function (global) {
  'use strict';

  var HC = global.HC = global.HC || {};

  var KEEP_MS = 24 * 3600 * 1000;

  var TEXT_MAX = 4000;

  var pending = null;
  var timer = null;

  function store() { return global.HC.store; }
  function cfg() { var st = store(); return st && st.S ? st.S.cfg : null; }

  function save(snap) {
    var c = cfg();
    if (!c) return;

    var old = c.session || {};
    var next = {
      conv:   snap.conv   !== undefined ? snap.conv   : old.conv,
      text:   snap.text   !== undefined ? String(snap.text || '').slice(0, TEXT_MAX) : old.text,
      scroll: snap.scroll !== undefined ? Math.max(0, Math.round(Number(snap.scroll) || 0)) : old.scroll,
      voice:  snap.voice  !== undefined ? !!snap.voice  : old.voice,
      tab:    snap.tab    !== undefined ? snap.tab    : old.tab,
      at:     Date.now()
    };

    if (old.conv === next.conv && old.text === next.text &&
        old.scroll === next.scroll && old.voice === next.voice &&
        old.tab === next.tab) return;

    c.session = next;
    schedule();
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      try { store().save(); } catch (e) {}
    }, 600);
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    try { store().save(); } catch (e) {}
  }

  function peek() {
    var c = cfg();
    if (!c || !c.session) return null;

    var s = c.session;
    if (!s.at || (Date.now() - s.at) > KEEP_MS) return null;
    if (!s.conv && !s.text) return null;

    return {
      conv:   s.conv || null,
      text:   s.text || '',
      scroll: typeof s.scroll === 'number' ? s.scroll : null,
      voice:  !!s.voice,
      tab:    s.tab || null
    };
  }

  function clear() {
    var c = cfg();
    if (!c) return;
    c.session = null;
    flush();
  }

  HC.session = {
    save: save,
    flush: flush,
    peek: peek,
    clear: clear,
    KEEP_MS: KEEP_MS
  };

})(typeof window !== 'undefined' ? window : this);
