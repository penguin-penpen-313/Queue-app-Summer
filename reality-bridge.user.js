// ==UserScript==
// @name         夏祭り順番待ち — REALITYコメント橋渡し
// @namespace    https://penguin-penpen-313.github.io/Queue-app-Summer/
// @version      1.2.0
// @description  REALITYのコメント画面で受信したコメントを、順番待ちアプリへ転送します（診断つき）
// @author       -
// @match        https://reality.app/*
// @match        https://*.reality.app/*
// @match        https://penguin-penpen-313.github.io/Queue-app-Summer/bridge-test.html*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '1.2.0';

  /* =============================================================
   *  設定：順番待ちアプリのURL（GitHub Pages）
   * ============================================================= */
  const QUEUE_URL    = 'https://penguin-penpen-313.github.io/Queue-app-Summer/';
  const QUEUE_ORIGIN = new URL(QUEUE_URL).origin;
  const SAME_SITE    = (location.origin === QUEUE_ORIGIN);   // アプリ自身のページ（動作確認ページ）
  const LS = 'matsuri-bridge-settings';

  console.log('[matsuri] 橋渡しスクリプト v' + VERSION + ' 起動 @ ' + location.href);

  const settings = Object.assign(
    { domSelector: '', domMode: false, hidden: false, openTab: 'main' },
    (() => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (_) { return {}; } })()
  );
  const saveSettings = () => { try { localStorage.setItem(LS, JSON.stringify(settings)); } catch (_) {} };

  const stats = { ws: 0, es: 0, xhr: 0, fetch: 0, worker: 0, recv: 0, sent: 0, queued: 0, lastRaw: '' };
  let connected = false, lastAck = 0, openedWin = null;
  const pending = [];

  /* =============================================================
   *  診断：ページが使っている通信を全部記録する
   * ============================================================= */
  const NET = [];
  function note(kind, url, sample) {
    url = String(url || '').slice(0, 200);
    let e = NET.find(x => x.kind === kind && x.url === url);
    if (!e) { e = { kind, url, count: 0, sample: '', at: Date.now() }; NET.push(e); }
    e.count++;
    if (sample != null && String(sample).trim()) e.sample = String(sample).slice(0, 600);
    if (NET.length > 40) NET.shift();
    render();
  }

  /* ---- WebSocket ---- */
  try {
    const NativeWS = window.WebSocket;
    function PatchedWS(url, protocols) {
      const ws = (protocols === undefined) ? new NativeWS(url) : new NativeWS(url, protocols);
      stats.ws++; note('WS', url, '');
      log('WebSocketを検出: ' + String(url).slice(0, 70));
      ws.addEventListener('message', (e) => {
        try { note('WS', url, typeof e.data === 'string' ? e.data : '[binary]'); handleData(e.data, 'WS'); }
        catch (err) { console.error('[matsuri]', err); }
      });
      return ws;
    }
    PatchedWS.prototype = NativeWS.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((k, i) => { PatchedWS[k] = i; });
    window.WebSocket = PatchedWS;
  } catch (e) { console.error('[matsuri] WSフック失敗', e); }

  /* ---- EventSource ---- */
  try {
    const NativeES = window.EventSource;
    if (NativeES) {
      function PatchedES(url, cfg) {
        const es = new NativeES(url, cfg);
        stats.es++; note('SSE', url, '');
        log('EventSourceを検出: ' + String(url).slice(0, 70));
        es.addEventListener('message', (e) => {
          try { note('SSE', url, e.data); handleData(e.data, 'SSE'); } catch (_) {}
        });
        return es;
      }
      PatchedES.prototype = NativeES.prototype;
      window.EventSource = PatchedES;
    }
  } catch (e) { console.error('[matsuri] SSEフック失敗', e); }

  /* ---- fetch ---- */
  try {
    const nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      return nativeFetch.apply(this, arguments).then((res) => {
        try {
          const ct = (res.headers.get('content-type') || '');
          if (/json|text/.test(ct) && !/event-stream/.test(ct)) {
            stats.fetch++;
            res.clone().text().then((t) => { note('fetch', url, t); handleData(t, 'fetch'); }).catch(() => {});
          } else { note('fetch', url, '[' + ct + ']'); }
        } catch (_) {}
        return res;
      });
    };
  } catch (e) { console.error('[matsuri] fetchフック失敗', e); }

  /* ---- XMLHttpRequest ---- */
  try {
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, url) {
      this.__matsuriUrl = url;
      this.addEventListener('load', () => {
        try {
          stats.xhr++;
          const t = (typeof this.responseText === 'string') ? this.responseText : '';
          note('XHR', this.__matsuriUrl, t);
          if (t) handleData(t, 'XHR');
        } catch (_) {}
      });
      return open.apply(this, arguments);
    };
  } catch (e) { console.error('[matsuri] XHRフック失敗', e); }

  /* ---- Worker ---- */
  try {
    const NativeWorker = window.Worker;
    if (NativeWorker) {
      function PatchedWorker(url, opts) {
        const w = new NativeWorker(url, opts);
        stats.worker++; note('Worker', url, '');
        log('Workerを検出: ' + String(url).slice(0, 70));
        w.addEventListener('message', (e) => {
          try {
            const d = typeof e.data === 'string' ? e.data : JSON.stringify(e.data);
            note('Worker', url, d); handleData(d, 'Worker');
          } catch (_) {}
        });
        return w;
      }
      PatchedWorker.prototype = NativeWorker.prototype;
      window.Worker = PatchedWorker;
    }
  } catch (e) { console.error('[matsuri] Workerフック失敗', e); }

  /* =============================================================
   *  受信データからコメントを取り出す
   * ============================================================= */
  function handleData(data, src) {
    if (data instanceof Blob) { data.text().then(t => handleData(t, src)).catch(() => {}); return; }
    if (typeof data !== 'string') return;
    const s = data.trim();
    if (!s || (s[0] !== '{' && s[0] !== '[')) return;
    let json;
    try { json = JSON.parse(s); } catch (_) { return; }
    stats.lastRaw = '[' + src + '] ' + s.slice(0, 400);
    collect(json).forEach(sendComment);
  }

  function collect(node, depth, out) {
    out = out || []; depth = depth || 0;
    if (depth > 5 || node == null) return out;
    if (Array.isArray(node)) { node.forEach(x => collect(x, depth + 1, out)); return out; }
    if (typeof node !== 'object') return out;

    const content = pick(node, ['content', 'comment', 'text', 'message', 'body']);
    if (typeof content === 'string' && content.trim()) {
      out.push({
        content: content,
        name: String(pick(node, ['nickname', 'name', 'displayName', 'userName', 'user_name', 'user']) || ''),
        ct: node.content_type !== undefined ? node.content_type : node.type,
        uid: pick(node, ['vlive_id', 'user_id', 'userId', 'uid'])
      });
    }
    Object.keys(node).forEach(k => {
      const v = node[k];
      if (v && typeof v === 'object') collect(v, depth + 1, out);
    });
    return out;
  }

  function pick(o, keys) {
    for (let i = 0; i < keys.length; i++) {
      const v = o[keys[i]];
      if (typeof v === 'string' && v) return v;
      if (typeof v === 'number') return String(v);
    }
    return '';
  }

  let seenComment = new Set();
  function sendComment(c) {
    const key = c.name + '|' + c.content + '|' + (c.ct === undefined ? '' : c.ct);
    if (seenComment.has(key)) return;
    seenComment.add(key);
    if (seenComment.size > 500) seenComment = new Set([...seenComment].slice(-250));

    const name = typeof c.name === 'string' ? c.name : '';
    const system = !name || !c.uid || c.ct === 8 || c.ct === 9 || c.ct === '8' || c.ct === '9';
    stats.recv++;
    send({ type: 'comment', name: name, content: String(c.content), system: system, contentType: c.ct });
  }

  /* =============================================================
   *  転送先ウィンドウ
   * ============================================================= */
  function targetWin() {
    if (SAME_SITE) return window;                 // 動作確認ページ：同じ窓に渡す
    if (openedWin && !openedWin.closed) return openedWin;
    try { if (window.opener && !window.opener.closed) return window.opener; } catch (_) {}
    return null;
  }

  function send(msg) {
    const t = targetWin();
    if (!t) {
      pending.push(msg);
      if (pending.length > 300) pending.shift();
      stats.queued = pending.length;
      render();
      return false;
    }
    try {
      t.postMessage(Object.assign({ __matsuri: 1 }, msg), QUEUE_ORIGIN);
      if (msg.type === 'comment') stats.sent++;
      render();
      return true;
    } catch (e) { log('送信エラー: ' + e.message); return false; }
  }

  function flushPending() {
    if (!targetWin()) return;
    while (pending.length) send(pending.shift());
    stats.queued = 0;
  }

  window.addEventListener('message', (e) => {
    if (e.origin !== QUEUE_ORIGIN) return;
    if (e.data && e.data.__matsuri === 1 && e.data.type === 'ack') {
      if (!connected) log('順番待ちアプリに接続しました');
      connected = true; lastAck = Date.now();
      flushPending(); render();
    }
  });

  setInterval(() => {
    if (targetWin()) send({ type: 'ping' });
    if (connected && Date.now() - lastAck > 9000) { connected = false; render(); }
  }, 3000);

  function openQueue() {
    openedWin = window.open(QUEUE_URL, 'matsuri-queue');
    if (!openedWin) log('⚠ ポップアップがブロックされました。アドレスバー右のアイコンから許可を');
    else log('順番待ちアプリを開きました');
    setTimeout(() => { send({ type: 'ping' }); flushPending(); }, 1500);
    render();
  }

  /* =============================================================
   *  DOMから拾うフォールバック
   * ============================================================= */
  let seenDom = new Set();
  let domObserver = null;

  function textOf(el) {
    return (el.innerText || el.textContent || '')
      .split('\n').map(s => s.trim()).filter((s, i) => s || i === 0).join('\n').trim();
  }

  function startDom() {
    stopDom();
    if (!settings.domSelector || !document.body) return;
    try { document.querySelectorAll(settings.domSelector).forEach(el => seenDom.add(textOf(el))); } catch (_) {}
    domObserver = new MutationObserver((muts) => {
      muts.forEach(m => m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        let els = [];
        try {
          if (node.matches && node.matches(settings.domSelector)) els = [node];
          else if (node.querySelectorAll) els = node.querySelectorAll(settings.domSelector);
        } catch (_) { return; }
        els.forEach(forwardDom);
      }));
    });
    domObserver.observe(document.body, { childList: true, subtree: true });
    log('DOM監視を開始: ' + settings.domSelector);
  }
  function stopDom() { if (domObserver) { domObserver.disconnect(); domObserver = null; } }

  function forwardDom(el) {
    const text = textOf(el);
    if (!text || seenDom.has(text)) return;
    seenDom.add(text);
    if (seenDom.size > 400) seenDom = new Set([...seenDom].slice(-200));
    stats.recv++;
    stats.lastRaw = '[DOM] ' + text.slice(0, 200);
    send({ type: 'comment', text: text });
  }

  function findCandidates() {
    const out = [];
    const parents = new Map();
    document.querySelectorAll('body *').forEach(el => {
      const p = el.parentElement;
      if (!p || (panel && panel.contains(el))) return;
      if (!parents.has(p)) parents.set(p, []);
      parents.get(p).push(el);
    });
    parents.forEach((kids) => {
      if (kids.length < 3) return;
      const byClass = {};
      kids.forEach(k => {
        const c = [...k.classList][0] || k.tagName.toLowerCase();
        (byClass[c] = byClass[c] || []).push(k);
      });
      Object.keys(byClass).forEach(c => {
        const group = byClass[c];
        if (group.length < 3) return;
        const texts = group.map(textOf).filter(Boolean);
        if (texts.length < 3) return;
        const avg = texts.reduce((a, b) => a + b.length, 0) / texts.length;
        if (avg < 2 || avg > 300) return;
        const el0 = group[0];
        const cls = [...el0.classList][0];
        const sel = cls ? el0.tagName.toLowerCase() + '.' + cssEscape(cls) : el0.tagName.toLowerCase();
        out.push({ sel, n: group.length, sample: texts[texts.length - 1].slice(0, 60) });
      });
    });
    out.sort((a, b) => b.n - a.n);
    return out.slice(0, 6);
  }
  function cssEscape(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/([^\w-])/g, '\\$1'); }

  /* ---- 要素ピッカー ---- */
  let picking = false, hl = null;
  function startPick() {
    picking = true;
    hl = document.createElement('div');
    st(hl, { position: 'fixed', zIndex: '2147483646', border: '2px solid #ffd24a',
             background: 'rgba(255,210,74,.18)', pointerEvents: 'none', borderRadius: '4px' });
    document.body.appendChild(hl);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onPick, true);
    document.addEventListener('keydown', onEsc, true);
    log('コメント1件の枠をクリックしてください（Escで中止）');
    render();
  }
  function stopPick() {
    picking = false;
    if (hl) { hl.remove(); hl = null; }
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onPick, true);
    document.removeEventListener('keydown', onEsc, true);
    render();
  }
  function onEsc(e) { if (e.key === 'Escape') { stopPick(); e.preventDefault(); } }
  function onMove(e) {
    const el = e.target;
    if (!el || !el.getBoundingClientRect || (panel && panel.contains(el))) return;
    const r = el.getBoundingClientRect();
    st(hl, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  }
  function onPick(e) {
    if (panel && panel.contains(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    applySelector(buildSelector(e.target));
    stopPick();
  }
  function applySelector(sel) {
    settings.domSelector = sel; settings.domMode = true; saveSettings();
    startDom(); log('セレクタを設定: ' + sel); render();
  }
  function buildSelector(el) {
    let node = el;
    for (let i = 0; i < 6 && node && node.parentElement; i++) {
      const cls = [...node.classList].filter(c => !/^(is-|has-)/.test(c));
      if (cls.length) {
        const sel = node.tagName.toLowerCase() + '.' + cssEscape(cls[0]);
        try { if (document.querySelectorAll(sel).length >= 2) return sel; } catch (_) {}
      }
      node = node.parentElement;
    }
    const c = [...el.classList];
    return c.length ? el.tagName.toLowerCase() + '.' + cssEscape(c[0]) : el.tagName.toLowerCase();
  }

  /* =============================================================
   *  診断レポート
   * ============================================================= */
  function report() {
    const L = [];
    L.push('=== 順番待ち 橋渡し 診断レポート ===');
    L.push('URL: ' + location.href.slice(0, 140));
    L.push('スクリプト: v' + VERSION);
    L.push('接続: ' + (connected ? '接続中' : targetWin() ? '応答待ち' : '未接続'));
    L.push('検出数: WS=' + stats.ws + ' SSE=' + stats.es + ' fetch=' + stats.fetch +
           ' XHR=' + stats.xhr + ' Worker=' + stats.worker);
    L.push('コメント: 受信=' + stats.recv + ' 転送=' + stats.sent + ' 保留=' + stats.queued);
    L.push('DOMモード: ' + (settings.domMode ? settings.domSelector : 'オフ'));
    L.push('');
    L.push('--- 通信の一覧 ---');
    if (!NET.length) L.push('(何も検出されていません)');
    NET.slice(-15).forEach(e => {
      L.push('[' + e.kind + '] ' + e.url + '  ×' + e.count);
      if (e.sample) L.push('    ' + e.sample.replace(/\s+/g, ' ').slice(0, 300));
    });
    L.push('');
    L.push('--- コメント欄の候補（DOM） ---');
    try {
      const cands = findCandidates();
      if (!cands.length) L.push('(候補なし)');
      cands.forEach(c => L.push(c.sel + '  (' + c.n + '件)  例: ' + c.sample));
    } catch (e) { L.push('検出エラー: ' + e.message); }
    return L.join('\n');
  }

  /* =============================================================
   *  パネル（CSPで<style>が拒否される環境でも見えるよう
   *          スタイルはすべてJSから直接あてる）
   * ============================================================= */
  let panel, mini, logLines = [], els = {};

  function st(el, s) { for (const k in s) { try { el.style[k] = s[k]; } catch (_) {} } return el; }
  function mk(tag, style, text) {
    const e = document.createElement(tag);
    if (style) st(e, style);
    if (text != null) e.textContent = text;
    return e;
  }

  const C = { bg: '#151a3d', bg2: '#0a0d24', line: '#2c356b', gold: '#ffd24a',
              text: '#fff6e5', muted: '#8a90c4', cyan: '#5ce1e6' };
  const FONT = '-apple-system,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif';
  const MONO = 'ui-monospace,Menlo,Consolas,monospace';

  function btn(label, style) {
    const b = mk('button', Object.assign({
      display: 'block', width: '100%', marginBottom: '6px', padding: '10px',
      borderRadius: '8px', cursor: 'pointer', border: '1px solid ' + C.line,
      background: 'rgba(255,255,255,.05)', color: C.text, font: '700 12px/1.4 ' + FONT
    }, style || {}), label);
    b.onmouseenter = () => { if (!b.dataset.p) st(b, { borderColor: C.gold, color: C.gold }); };
    b.onmouseleave = () => { if (!b.dataset.p) st(b, { borderColor: C.line, color: C.text }); };
    return b;
  }

  function log(msg) {
    const t = new Date();
    logLines.unshift(String(t.getHours()).padStart(2, '0') + ':' +
                     String(t.getMinutes()).padStart(2, '0') + ':' +
                     String(t.getSeconds()).padStart(2, '0') + '  ' + msg);
    if (logLines.length > 40) logLines.length = 40;
    console.log('[matsuri] ' + msg);
    render();
  }

  function buildPanel() {
    if (!document.body) return;
    panel = mk('div', {
      position: 'fixed', right: '12px', bottom: '12px', zIndex: '2147483647', width: '340px',
      background: 'linear-gradient(180deg,#151a3d,#0f1230)', border: '2px solid ' + C.gold,
      borderRadius: '12px', boxShadow: '0 10px 44px rgba(0,0,0,.6)', overflow: 'hidden',
      color: C.text, font: '12px/1.6 ' + FONT, boxSizing: 'border-box'
    });
    panel.id = 'matsuri-bridge-panel';

    /* ヘッダー */
    const head = mk('div', { display: 'flex', alignItems: 'center', gap: '8px',
      padding: '10px 12px', background: 'rgba(255,210,74,.12)', borderBottom: '1px solid ' + C.line });
    els.dot = mk('div', { width: '9px', height: '9px', borderRadius: '50%', background: '#666', flex: 'none' });
    const title = mk('b', { flex: '1', fontSize: '12px', letterSpacing: '.08em', color: C.gold }, '順番待ち 橋渡し');
    const hide = mk('button', { background: 'none', border: '1px solid ' + C.line, color: C.muted,
      borderRadius: '5px', cursor: 'pointer', padding: '2px 8px', fontSize: '11px', font: '11px ' + FONT }, '隠す');
    hide.onclick = () => { settings.hidden = true; saveSettings(); render(); };
    head.append(els.dot, title, hide);

    /* タブ */
    const tabs = mk('div', { display: 'flex', borderBottom: '1px solid ' + C.line });
    els.tabs = {};
    [['main', '接続'], ['diag', '診断'], ['dom', 'DOM']].forEach(([k, label]) => {
      const t = mk('button', { flex: '1', padding: '7px', textAlign: 'center', cursor: 'pointer',
        fontSize: '11px', color: C.muted, background: 'none', border: 'none',
        borderBottom: '2px solid transparent', font: '11px ' + FONT }, label);
      t.onclick = () => { settings.openTab = k; saveSettings(); render(); if (k === 'diag') refreshReport(); };
      t.dataset.tab = k;
      els.tabs[k] = t; tabs.appendChild(t);
    });

    const body = mk('div', { padding: '11px 12px', maxHeight: '62vh', overflow: 'auto' });
    els.stat = mk('div', { fontSize: '11px', color: C.muted, marginBottom: '9px', lineHeight: '1.8' });
    els.stat.id = 'mbStat';
    body.appendChild(els.stat);

    /* 接続タブ */
    els.paneMain = mk('div');
    const bOpen = btn('順番待ちアプリを開いて接続', {
      background: 'linear-gradient(100deg,#ffd24a,#ffab3d)', color: '#2a0d05', border: 'none' });
    bOpen.dataset.p = '1';
    bOpen.onclick = openQueue;
    const bTest = btn('テストコメントを送る');
    bTest.onclick = () => {
      send({ type: 'comment', name: 'テスト太郎', content: '予約！', system: false });
      stats.recv++; log('テストコメントを送信');
    };
    els.log = mk('div', { background: C.bg2, border: '1px solid ' + C.line, borderRadius: '6px',
      padding: '7px', font: '10px/1.5 ' + MONO, color: C.muted, whiteSpace: 'pre-wrap',
      wordBreak: 'break-all', maxHeight: '150px', overflow: 'auto' });
    els.log.id = 'mbLog';
    bOpen.id = 'mbOpen'; bTest.id = 'mbTest';
    els.paneMain.append(bOpen, bTest, els.log);
    if (SAME_SITE) {
      bOpen.style.display = 'none';
      const n = mk('div', { fontSize: '11px', color: C.cyan, marginBottom: '8px' },
        '※ このページはアプリ本体と同じサイトなので、そのまま繋がっています');
      els.paneMain.insertBefore(n, bTest);
    }

    /* 診断タブ */
    els.paneDiag = mk('div', { display: 'none' });
    const row = mk('div', { display: 'flex', gap: '6px' });
    const bCopy = btn('レポートをコピー'); const bRef = btn('更新');
    bCopy.onclick = async () => {
      const t = report();
      try { await navigator.clipboard.writeText(t); log('レポートをコピーしました'); }
      catch (_) {
        const ta = mk('textarea'); ta.value = t; document.body.appendChild(ta);
        ta.select(); document.execCommand('copy'); ta.remove(); log('レポートをコピーしました');
      }
    };
    bRef.onclick = refreshReport;
    row.append(bCopy, bRef);
    els.report = mk('div', { background: C.bg2, border: '1px solid ' + C.line, borderRadius: '6px',
      padding: '7px', font: '10px/1.5 ' + MONO, color: C.muted, whiteSpace: 'pre-wrap',
      wordBreak: 'break-all', maxHeight: '240px', overflow: 'auto' });
    els.report.id = 'mbReport';
    bCopy.id = 'mbCopy'; bRef.id = 'mbRefresh';
    els.paneDiag.append(row, els.report);

    /* DOMタブ */
    els.paneDom = mk('div', { display: 'none' });
    const bScan = btn('コメント欄の候補を探す');
    els.cands = mk('div');
    bScan.onclick = () => {
      els.cands.innerHTML = '';
      const cands = findCandidates();
      if (!cands.length) {
        els.cands.appendChild(mk('div', { color: C.muted, fontSize: '11px', marginBottom: '6px' },
          '候補が見つかりません。コメントが表示されている状態で試してください。'));
        return;
      }
      cands.forEach(c => {
        const b = mk('button', { display: 'block', width: '100%', textAlign: 'left', marginBottom: '5px',
          padding: '7px 9px', borderRadius: '6px', border: '1px solid ' + C.line,
          background: 'rgba(255,255,255,.04)', color: C.text, fontSize: '11px', cursor: 'pointer',
          font: '11px ' + FONT });
        b.appendChild(mk('b', { color: C.gold }, c.sel + ' (' + c.n + '件)'));
        b.appendChild(mk('div', { color: C.muted, fontSize: '10px', marginTop: '2px',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, '例: ' + c.sample));
        b.onclick = () => applySelector(c.sel);
        els.cands.appendChild(b);
      });
    };
    els.pick = btn('クリックして選ぶ');
    els.pick.onclick = () => picking ? stopPick() : startPick();
    els.sel = mk('input', { width: '100%', padding: '7px 8px', borderRadius: '6px',
      border: '1px solid ' + C.line, background: C.bg2, color: C.text,
      font: '11px ' + MONO, marginBottom: '6px', boxSizing: 'border-box' });
    els.sel.placeholder = 'CSSセレクタを直接入力';
    els.domBtn = btn('▶ DOM監視を開始');
    els.domBtn.onclick = () => {
      const v = els.sel.value.trim();
      if (v) settings.domSelector = v;
      settings.domMode = !settings.domMode && !!settings.domSelector;
      saveSettings();
      settings.domMode ? startDom() : stopDom();
      render();
    };
    bScan.id = 'mbScan'; els.cands.id = 'mbCands';
    els.pick.id = 'mbPick'; els.sel.id = 'mbSel'; els.domBtn.id = 'mbDom';
    els.paneDom.append(bScan, els.cands, els.pick, els.sel, els.domBtn);

    body.append(els.paneMain, els.paneDiag, els.paneDom);
    panel.append(head, tabs, body);
    document.body.appendChild(panel);

    mini = mk('div', { position: 'fixed', right: '12px', bottom: '12px', zIndex: '2147483647',
      padding: '8px 14px', borderRadius: '999px', background: C.bg, border: '2px solid ' + C.gold,
      color: C.gold, fontSize: '12px', cursor: 'pointer', fontWeight: '700', display: 'none',
      font: '700 12px ' + FONT }, '▲ 橋渡し');
    mini.onclick = () => { settings.hidden = false; saveSettings(); render(); };
    document.body.appendChild(mini);

    // ページ側が中身を作り直してもパネルが消えないよう見張る
    setInterval(() => {
      try {
        if (panel && document.body && !document.body.contains(panel)) {
          document.body.appendChild(panel);
          document.body.appendChild(mini);
        }
      } catch (_) {}
    }, 2000);

    render();
  }

  function refreshReport() { if (els.report) els.report.textContent = report(); }

  let renderTimer = null;
  function render() {
    if (!panel) return;
    if (renderTimer) return;
    renderTimer = setTimeout(() => { renderTimer = null; doRender(); }, 60);
  }

  function doRender() {
    panel.style.display = settings.hidden ? 'none' : '';
    mini.style.display = settings.hidden ? '' : 'none';
    els.dot.style.background = connected ? C.cyan : '#666';
    els.dot.style.boxShadow = connected ? '0 0 9px ' + C.cyan : 'none';

    Object.keys(els.tabs).forEach(k => {
      const on = (k === settings.openTab);
      st(els.tabs[k], { color: on ? C.gold : C.muted,
        borderBottom: '2px solid ' + (on ? C.gold : 'transparent'),
        background: on ? 'rgba(255,210,74,.06)' : 'none' });
    });
    els.paneMain.style.display = settings.openTab === 'main' ? '' : 'none';
    els.paneDiag.style.display = settings.openTab === 'diag' ? '' : 'none';
    els.paneDom.style.display  = settings.openTab === 'dom'  ? '' : 'none';

    els.stat.textContent =
      '状態：' + (connected ? '接続中' : (targetWin() ? '応答待ち…' : '未接続')) + '\n' +
      '通信：WS ' + stats.ws + ' / SSE ' + stats.es + ' / fetch ' + stats.fetch +
      ' / XHR ' + stats.xhr + ' / Worker ' + stats.worker + '\n' +
      'コメント：受信 ' + stats.recv + ' / 転送 ' + stats.sent +
      (stats.queued ? ' / 保留 ' + stats.queued : '');
    els.stat.style.whiteSpace = 'pre-line';

    els.domBtn.textContent = settings.domMode ? '■ DOM監視を停止' : '▶ DOM監視を開始';
    if (document.activeElement !== els.sel) els.sel.value = settings.domSelector || '';
    els.pick.textContent = picking ? '中止（Esc）' : 'クリックして選ぶ';
    els.log.textContent = logLines.join('\n');
  }

  /* =============================================================
   *  外部から使えるようにする（動作確認ページ用）
   * ============================================================= */
  window.__matsuriBridge = {
    version: VERSION,
    /** REALITY形式のJSONを流し込む（テスト用） */
    feed(obj) { handleData(typeof obj === 'string' ? obj : JSON.stringify(obj), 'テスト'); },
    stats, report, get connected() { return connected; },
    openQueue
  };

  /* =============================================================
   *  起動
   * ============================================================= */
  function boot() {
    try { buildPanel(); } catch (e) { console.error('[matsuri] パネル生成に失敗', e); }
    if (settings.domMode && settings.domSelector) startDom();
    log('スクリプト v' + VERSION + ' を起動しました');
    if (SAME_SITE) { log('動作確認ページとして起動（同じ窓に転送します）'); send({ type: 'ping' }); }
    else if (window.opener) { log('親ウィンドウを検出。接続します'); send({ type: 'ping' }); }
    else log('「順番待ちアプリを開いて接続」を押してください');
    if (settings.hidden) { settings.hidden = false; saveSettings(); }
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
