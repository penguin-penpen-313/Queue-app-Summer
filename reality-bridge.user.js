// ==UserScript==
// @name         夏祭り順番待ち — REALITYコメント橋渡し
// @namespace    https://penguin-penpen-313.github.io/Queue-app-Summer/
// @version      1.0.0
// @description  REALITYのコメント画面で受信したコメントを、順番待ちアプリへ転送します
// @author       —
// @match        https://reality.app/comments/*
// @match        https://reality.app/viewer/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* =============================================================
   *  設定：順番待ちアプリのURL（GitHub Pages）
   * ============================================================= */
  const QUEUE_URL    = 'https://penguin-penpen-313.github.io/Queue-app-Summer/';
  const QUEUE_ORIGIN = new URL(QUEUE_URL).origin;
  const LS = 'matsuri-bridge-settings';

  const settings = Object.assign(
    { domSelector: '', domMode: false, hidden: false },
    (() => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (_) { return {}; } })()
  );
  const saveSettings = () => { try { localStorage.setItem(LS, JSON.stringify(settings)); } catch (_) {} };

  const stats = { ws: 0, recv: 0, sent: 0, queued: 0, lastRaw: '', lastSent: '' };
  let connected = false, lastAck = 0, openedWin = null;
  const pending = [];

  /* =============================================================
   *  1. WebSocket をフックして生のコメントを捕まえる
   *     （REALITYのコメント画面は wss://comment.reality.app を使用）
   * ============================================================= */
  const NativeWS = window.WebSocket;
  function PatchedWS(url, protocols) {
    const ws = (protocols === undefined) ? new NativeWS(url) : new NativeWS(url, protocols);
    stats.ws++;
    log('WebSocket接続: ' + String(url).slice(0, 80));
    ws.addEventListener('message', (e) => {
      try { handleWsData(e.data); } catch (err) { console.error('[matsuri]', err); }
    });
    return ws;
  }
  PatchedWS.prototype = NativeWS.prototype;
  ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((k, i) => { PatchedWS[k] = i; });
  try { window.WebSocket = PatchedWS; } catch (_) {}

  function handleWsData(data) {
    if (typeof data !== 'string') {
      if (data instanceof Blob) { data.text().then(handleWsData).catch(() => {}); }
      return;
    }
    let json;
    try { json = JSON.parse(data); } catch (_) { return; }
    stats.lastRaw = data.slice(0, 400);

    const items = Array.isArray(json) ? json
                : Array.isArray(json.comments) ? json.comments
                : Array.isArray(json.data) ? json.data
                : [json];

    items.forEach((o) => {
      if (!o || typeof o !== 'object') return;
      const d = o.data && typeof o.data === 'object' ? o.data : o;

      const content = pick(d, ['content', 'comment', 'text', 'message', 'body']);
      if (typeof content !== 'string' || !content.trim()) return;

      const name = pick(d, ['nickname', 'name', 'displayName', 'userName', 'user_name']) || '';
      const ct   = d.content_type !== undefined ? d.content_type : d.type;
      const uidv = pick(d, ['vlive_id', 'user_id', 'userId']);

      // システムメッセージ判定：ユーザーIDや名前が空、または content_type が 8/9
      const system = !name || !uidv || ct === 8 || ct === 9 || ct === '8' || ct === '9';

      stats.recv++;
      send({ type: 'comment', name: String(name), content: String(content), system: system, contentType: ct });
    });
  }

  function pick(o, keys) {
    for (let i = 0; i < keys.length; i++) if (o[keys[i]] != null && o[keys[i]] !== '') return o[keys[i]];
    return '';
  }

  /* =============================================================
   *  2. 転送先ウィンドウの決定と送信
   * ============================================================= */
  function targetWin() {
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
      stats.sent++;
      stats.lastSent = (msg.name ? msg.name + ' / ' : '') + String(msg.content || msg.text || '').slice(0, 60);
      render();
      return true;
    } catch (e) {
      log('送信エラー: ' + e.message);
      return false;
    }
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
      flushPending();
      render();
    }
  });

  setInterval(() => {
    if (targetWin()) send({ type: 'ping' });
    if (connected && Date.now() - lastAck > 9000) { connected = false; render(); }
  }, 3000);

  function openQueue() {
    openedWin = window.open(QUEUE_URL, 'matsuri-queue');
    log('順番待ちアプリを開きました');
    setTimeout(() => { send({ type: 'ping' }); flushPending(); }, 1500);
    render();
  }

  /* =============================================================
   *  3. DOMから拾うフォールバック（WebSocketで取れない場合）
   * ============================================================= */
  const seenDom = new Set();
  let domObserver = null;

  function startDom() {
    stopDom();
    if (!settings.domSelector) return;
    domObserver = new MutationObserver((muts) => {
      muts.forEach((m) => {
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          let els = [];
          try {
            if (node.matches && node.matches(settings.domSelector)) els = [node];
            else if (node.querySelectorAll) els = node.querySelectorAll(settings.domSelector);
          } catch (_) { return; }
          els.forEach(forwardDom);
        });
      });
    });
    domObserver.observe(document.body, { childList: true, subtree: true });
    log('DOM監視を開始: ' + settings.domSelector);
  }
  function stopDom() { if (domObserver) { domObserver.disconnect(); domObserver = null; } }

  function forwardDom(el) {
    const text = (el.innerText || el.textContent || '')
      .split('\n').map(s => s.trim()).filter((s, i) => s || i === 0).join('\n').trim();
    if (!text) return;
    if (seenDom.has(text)) return;
    seenDom.add(text);
    if (seenDom.size > 400) seenDom = new Set([...seenDom].slice(-200));
    stats.recv++;
    stats.lastRaw = '[DOM] ' + text.slice(0, 200);
    send({ type: 'comment', text: text });   // 1行目=名前 / 2行目以降=本文 として送る
  }

  /* --- 要素ピッカー：クリックしてセレクタを自動生成 --- */
  let picking = false, hl = null;
  function startPick() {
    picking = true;
    hl = document.createElement('div');
    hl.style.cssText = 'position:fixed;z-index:2147483646;border:2px solid #ffd24a;background:rgba(255,210,74,.18);pointer-events:none;border-radius:4px;';
    document.body.appendChild(hl);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onPick, true);
    log('コメント1件の要素をクリックしてください（Escで中止）');
    document.addEventListener('keydown', onEsc, true);
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
    if (!el || !el.getBoundingClientRect || panel.contains(el)) return;
    const r = el.getBoundingClientRect();
    hl.style.left = r.left + 'px'; hl.style.top = r.top + 'px';
    hl.style.width = r.width + 'px'; hl.style.height = r.height + 'px';
  }
  function onPick(e) {
    if (panel.contains(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    const sel = buildSelector(e.target);
    settings.domSelector = sel;
    settings.domMode = true;
    saveSettings();
    stopPick();
    startDom();
    log('セレクタを設定: ' + sel);
  }
  function buildSelector(el) {
    // 兄弟に似た要素が2つ以上ある祖先まで遡る＝コメント1件の単位とみなす
    let node = el;
    for (let i = 0; i < 6 && node && node.parentElement; i++) {
      const cls = [...node.classList].filter(c => !/^(is-|has-)/.test(c));
      if (cls.length) {
        const sel = node.tagName.toLowerCase() + '.' + CSS.escape(cls[0]);
        try { if (document.querySelectorAll(sel).length >= 2) return sel; } catch (_) {}
      }
      node = node.parentElement;
    }
    const c = [...el.classList];
    return c.length ? el.tagName.toLowerCase() + '.' + CSS.escape(c[0]) : el.tagName.toLowerCase();
  }

  /* =============================================================
   *  4. 操作パネル
   * ============================================================= */
  let panel, logLines = [];
  function log(msg) {
    const t = new Date();
    logLines.unshift(String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ':' +
                     String(t.getSeconds()).padStart(2, '0') + '  ' + msg);
    if (logLines.length > 30) logLines.length = 30;
    render();
  }

  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'matsuri-bridge-panel';
    panel.innerHTML = `
      <style>
        #matsuri-bridge-panel{position:fixed;right:12px;bottom:12px;z-index:2147483647;width:310px;
          font:12px/1.6 -apple-system,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;color:#fff6e5;
          background:linear-gradient(180deg,#151a3d,#0f1230);border:1px solid #2c356b;border-radius:12px;
          box-shadow:0 10px 40px rgba(0,0,0,.5);overflow:hidden}
        #matsuri-bridge-panel *{box-sizing:border-box}
        .mb-h{display:flex;align-items:center;gap:8px;padding:9px 12px;background:rgba(255,210,74,.08);
          border-bottom:1px solid #2c356b;cursor:default}
        .mb-h b{font-size:11px;letter-spacing:.12em;color:#ffd24a;font-weight:700;flex:1}
        .mb-dot{width:8px;height:8px;border-radius:50%;background:#666;flex:none}
        .mb-dot.on{background:#5ce1e6;box-shadow:0 0 8px #5ce1e6}
        .mb-x{background:none;border:1px solid #2c356b;color:#8a90c4;border-radius:5px;cursor:pointer;
          padding:1px 7px;font-size:11px}
        .mb-b{padding:10px 12px}
        .mb-st{font-size:11px;color:#8a90c4;margin-bottom:8px}
        .mb-st span{color:#fff6e5;font-weight:700}
        .mb-btn{display:block;width:100%;margin-bottom:6px;padding:9px;border-radius:8px;cursor:pointer;
          border:1px solid #2c356b;background:rgba(255,255,255,.05);color:#fff6e5;font-size:12px;font-weight:700}
        .mb-btn:hover{border-color:#ffd24a;color:#ffd24a}
        .mb-btn.p{background:linear-gradient(100deg,#ffd24a,#ffab3d);color:#2a0d05;border:none}
        .mb-row{display:flex;gap:6px}.mb-row .mb-btn{margin-bottom:6px}
        .mb-in{width:100%;padding:6px 8px;border-radius:6px;border:1px solid #2c356b;background:#0a0d24;
          color:#fff6e5;font-size:11px;font-family:ui-monospace,monospace;margin-bottom:6px}
        .mb-log{max-height:110px;overflow:auto;background:#0a0d24;border:1px solid #2c356b;border-radius:6px;
          padding:6px;font-family:ui-monospace,monospace;font-size:10px;color:#8a90c4;white-space:pre-wrap;word-break:break-all}
        .mb-raw{margin-top:6px;font-family:ui-monospace,monospace;font-size:10px;color:#6f76a8;
          max-height:56px;overflow:auto;word-break:break-all}
        .mb-mini{position:fixed;right:12px;bottom:12px;z-index:2147483647;padding:7px 12px;border-radius:999px;
          background:#151a3d;border:1px solid #2c356b;color:#ffd24a;font-size:11px;cursor:pointer}
        details summary{cursor:pointer;color:#8a90c4;font-size:11px;margin:6px 0 4px}
      </style>
      <div class="mb-h">
        <span class="mb-dot" id="mbDot"></span>
        <b>順番待ち 橋渡し</b>
        <button class="mb-x" id="mbHide">隠す</button>
      </div>
      <div class="mb-b">
        <div class="mb-st" id="mbStat"></div>
        <button class="mb-btn p" id="mbOpen">順番待ちアプリを開いて接続</button>
        <div class="mb-row">
          <button class="mb-btn" id="mbTest">テスト送信</button>
          <button class="mb-btn" id="mbPick">要素を選ぶ</button>
        </div>
        <details>
          <summary>詳細設定・ログ</summary>
          <input class="mb-in" id="mbSel" placeholder="DOMセレクタ（例: div.comment-item）">
          <button class="mb-btn" id="mbDom"></button>
          <div class="mb-log" id="mbLog"></div>
          <div class="mb-raw" id="mbRaw"></div>
        </details>
      </div>`;
    document.body.appendChild(panel);

    panel.querySelector('#mbOpen').onclick = openQueue;
    panel.querySelector('#mbHide').onclick = () => { settings.hidden = true; saveSettings(); render(); };
    panel.querySelector('#mbPick').onclick = () => picking ? stopPick() : startPick();
    panel.querySelector('#mbTest').onclick = () => {
      send({ type: 'comment', name: 'テスト太郎', content: '予約！', system: false });
      log('テストコメントを送信');
    };
    panel.querySelector('#mbDom').onclick = () => {
      settings.domSelector = panel.querySelector('#mbSel').value.trim();
      settings.domMode = !settings.domMode && !!settings.domSelector;
      saveSettings();
      settings.domMode ? startDom() : stopDom();
      render();
    };

    const mini = document.createElement('div');
    mini.className = 'mb-mini';
    mini.textContent = '順番待ち 橋渡し';
    mini.style.display = 'none';
    mini.onclick = () => { settings.hidden = false; saveSettings(); render(); };
    document.body.appendChild(mini);
    panel._mini = mini;

    render();
  }

  function render() {
    if (!panel) return;
    panel.style.display = settings.hidden ? 'none' : '';
    panel._mini.style.display = settings.hidden ? '' : 'none';
    panel.querySelector('#mbDot').className = 'mb-dot' + (connected ? ' on' : '');
    panel.querySelector('#mbStat').innerHTML =
      (connected ? '接続中' : (targetWin() ? '応答待ち…' : '未接続')) +
      ' ／ WS <span>' + stats.ws + '</span>' +
      ' ／ 受信 <span>' + stats.recv + '</span>' +
      ' ／ 転送 <span>' + stats.sent + '</span>' +
      (stats.queued ? ' ／ 保留 <span>' + stats.queued + '</span>' : '');
    const dom = panel.querySelector('#mbDom');
    if (dom) dom.textContent = settings.domMode ? '■ DOM監視を停止' : '▶ DOM監視を開始';
    const sel = panel.querySelector('#mbSel');
    if (sel && document.activeElement !== sel) sel.value = settings.domSelector || '';
    const pick = panel.querySelector('#mbPick');
    if (pick) pick.textContent = picking ? '中止' : '要素を選ぶ';
    panel.querySelector('#mbLog').textContent = logLines.join('\n');
    panel.querySelector('#mbRaw').textContent = stats.lastRaw ? '直近の生データ:\n' + stats.lastRaw : '';
  }

  /* =============================================================
   *  5. 起動
   * ============================================================= */
  function boot() {
    buildPanel();
    if (settings.domMode && settings.domSelector) startDom();
    if (window.opener) { log('親ウィンドウを検出。接続を試みます'); send({ type: 'ping' }); }
    else log('「順番待ちアプリを開いて接続」を押してください');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
