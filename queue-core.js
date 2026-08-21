/* =============================================================
 *  queue-core.js — 状態管理・コメント解析・取得アダプタ
 *  依存: config.js（先に読み込むこと）
 * ============================================================= */
(function (global) {
  'use strict';

  const CFG = global.APP_CONFIG;

  /* ============ 文字列ユーティリティ ============ */

  // 全角英数→半角、全角スペース→半角、前後トリム、連続空白圧縮
  function normalize(str) {
    if (str == null) return '';
    let s = String(str);
    if (CFG.keywords.normalize) {
      s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c =>
        String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
      s = s.replace(/　/g, ' ');
    }
    return s.replace(/\s+/g, ' ').trim();
  }

  function keyOf(name) {
    let s = normalize(name);
    if (CFG.keywords.ignoreCase) s = s.toLowerCase();
    return s;
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }

  // 名前の前後についたシステム表記っぽい飾りを落とす
  function cleanName(name) {
    return String(name || '')
      .replace(/^[\s　]*[\[【(（<＜]*[^\]】)）>＞]*[\]】)）>＞]\s*/, m =>
        /システム|system|info|お知らせ/i.test(m) ? '' : m)
      .replace(/^[\s　]+|[\s　]+$/g, '');
  }

  /* ============ コメント解析 ============ */

  function buildSystemRe(template) {
    const parts = template.split('{name}');
    const re = parts.map(escapeRe).join('(.+?)');
    return new RegExp(CFG.systemMessage.matchWholeLine ? '^' + re + '$' : re);
  }

  const RE_JOIN_SYS  = buildSystemRe(CFG.systemMessage.collabJoin);
  const RE_LEAVE_SYS = buildSystemRe(CFG.systemMessage.collabLeave);

  function isJoinKeyword(body) {
    const b = keyOf(body);
    if (!b) return false;
    return CFG.keywords.join.some(kw => {
      const k = keyOf(kw);
      return CFG.keywords.matchMode === 'includes' ? b.includes(k) : b === k;
    });
  }

  /**
   * 生コメント（1行目=ユーザー名 / 2行目以降=本文）を解釈する。
   * @returns {{type:'join'|'collab-join'|'collab-leave'|'none', name:string, body:string}}
   */
  function interpret(rawText) {
    const lines = String(rawText || '').replace(/\r/g, '').split('\n');
    const firstLine = (lines[0] || '').trim();
    const body = lines.slice(1).join('\n').trim();

    // ① 1行目にコラボ参加／退出のシステム文が含まれるか
    const mLeave = firstLine.match(RE_LEAVE_SYS);
    if (mLeave) return { type: 'collab-leave', name: cleanName(mLeave[1]), body: firstLine };

    const mJoin = firstLine.match(RE_JOIN_SYS);
    if (mJoin) return { type: 'collab-join', name: cleanName(mJoin[1]), body: firstLine };

    // ② 通常コメント：本文がキーワードなら列に追加
    if (isJoinKeyword(body)) return { type: 'join', name: cleanName(firstLine), body };

    return { type: 'none', name: cleanName(firstLine), body };
  }

  /* ============ 状態ストア（localStorage + BroadcastChannel） ============ */

  const KEY = CFG.storage.stateKey;
  const CH  = CFG.storage.queueChannel;

  function emptyState() {
    return { queue: [], now: [], doneCount: 0, log: [], updatedAt: 0, rev: 0 };
  }

  const Store = {
    _listeners: [],
    _bc: null,
    state: emptyState(),

    init() {
      this.state = this.read();
      try {
        this._bc = new BroadcastChannel(CH);
        this._bc.onmessage = (e) => {
          if (e.data && e.data.type === 'state') {
            this.state = e.data.state;
            this._emit('remote');
          }
        };
      } catch (_) { /* BroadcastChannel 非対応 */ }

      // 別タブ・別ウィンドウのフォールバック
      global.addEventListener('storage', (e) => {
        if (e.key === KEY) {
          this.state = this.read();
          this._emit('remote');
        }
      });
      return this;
    },

    read() {
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return emptyState();
        const s = JSON.parse(raw);
        return Object.assign(emptyState(), s);
      } catch (_) { return emptyState(); }
    },

    save(origin) {
      this.state.updatedAt = Date.now();
      this.state.rev = (this.state.rev || 0) + 1;
      try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch (_) {}
      if (this._bc) { try { this._bc.postMessage({ type: 'state', state: this.state }); } catch (_) {} }
      this._emit(origin || 'local');
    },

    onChange(fn) { this._listeners.push(fn); return this; },

    _emit(origin) {
      this._listeners.forEach(fn => { try { fn(this.state, origin); } catch (e) { console.error(e); } });
    },

    /* ---- 参照系 ---- */
    findInQueue(name) {
      const k = keyOf(name);
      return this.state.queue.findIndex(p => keyOf(p.name) === k);
    },
    findInNow(name) {
      const k = keyOf(name);
      return this.state.now.findIndex(p => keyOf(p.name) === k);
    },

    /* ---- 更新系 ---- */

    // 最後尾に追加（コメント「予約！」／admin手動）
    enqueue(name, opts) {
      name = cleanName(name);
      if (!name) return { ok: false, reason: 'empty' };
      if (CFG.rules.ignoreDuplicateJoin &&
          (this.findInQueue(name) >= 0 || this.findInNow(name) >= 0)) {
        return { ok: false, reason: 'duplicate' };
      }
      const entry = { id: uid(), name, addedAt: Date.now(), via: (opts && opts.via) || 'comment' };
      this.state.queue.push(entry);
      this.log(`「${name}」が列に並びました`);
      this.save();
      return { ok: true, entry, position: this.state.queue.length };
    },

    // 先頭に追加（admin）
    enqueueFront(name) {
      name = cleanName(name);
      if (!name) return { ok: false, reason: 'empty' };
      if (CFG.rules.ignoreDuplicateJoin &&
          (this.findInQueue(name) >= 0 || this.findInNow(name) >= 0)) {
        return { ok: false, reason: 'duplicate' };
      }
      this.state.queue.unshift({ id: uid(), name, addedAt: Date.now(), via: 'admin' });
      this.log(`「${name}」を先頭に追加`);
      this.save();
      return { ok: true };
    },

    // コラボ参加 → NOW へ
    collabJoin(name) {
      name = cleanName(name);
      if (!name) return { ok: false };
      if (this.findInNow(name) >= 0) return { ok: false, reason: 'already-now' };

      const qi = this.findInQueue(name);
      let entry;
      if (qi >= 0) {
        entry = this.state.queue.splice(qi, 1)[0];
      } else {
        if (!CFG.rules.addUnknownJoinerToNow) return { ok: false, reason: 'not-in-queue' };
        entry = { id: uid(), name, addedAt: Date.now(), via: 'guest' };
      }
      entry.startedAt = Date.now();
      this.state.now.push(entry);
      // 上限を超えたら古い方から押し出す（完了扱い）
      while (this.state.now.length > CFG.rules.maxNowSlots) {
        const out = this.state.now.shift();
        this.state.doneCount++;
        this.log(`「${out.name}」の出番が終了（自動）`);
      }
      this.log(`「${name}」がコラボ配信に参加`);
      this.save();
      return { ok: true, entry };
    },

    // コラボ退出 → NOW から外す
    collabLeave(name) {
      name = cleanName(name);
      const ni = this.findInNow(name);
      if (ni >= 0) {
        const out = this.state.now.splice(ni, 1)[0];
        this.state.doneCount++;
        this.log(`「${out.name}」がコラボ配信を退出`);
        if (!CFG.rules.removeOnLeave) this.state.queue.push(out);
        this.save();
        return { ok: true };
      }
      // NOW にいないが列にいる場合は列から外す
      const qi = this.findInQueue(name);
      if (qi >= 0) {
        const out = this.state.queue.splice(qi, 1)[0];
        this.state.doneCount++;
        this.log(`「${out.name}」が退出（列から削除）`);
        this.save();
        return { ok: true };
      }
      return { ok: false, reason: 'not-found' };
    },

    /* ---- admin 操作 ---- */
    removeAt(i)  { const e = this.state.queue.splice(i, 1)[0]; if (e) { this.log(`「${e.name}」を削除`); this.save(); } },
    removeNowAt(i){ const e = this.state.now.splice(i, 1)[0]; if (e) { this.state.doneCount++; this.log(`「${e.name}」の出番を終了`); this.save(); } },
    moveUp(i)    { if (i <= 0) return; const q = this.state.queue; [q[i-1], q[i]] = [q[i], q[i-1]]; this.save(); },
    moveDown(i)  { const q = this.state.queue; if (i >= q.length - 1) return; [q[i+1], q[i]] = [q[i], q[i+1]]; this.save(); },
    moveTo(from, to) {
      const q = this.state.queue;
      if (from === to || from < 0 || from >= q.length) return;
      const [m] = q.splice(from, 1);
      q.splice(to, 0, m);
      this.save();
    },
    // 先頭の人を NOW に上げる（admin の「呼ぶ」ボタン）
    callNext() {
      if (this.state.queue.length === 0) return { ok: false };
      return this.collabJoin(this.state.queue[0].name);
    },
    clearAll() { this.state = emptyState(); this.save(); },

    log(text) {
      this.state.log = this.state.log || [];
      this.state.log.unshift({ t: Date.now(), text });
      if (this.state.log.length > 60) this.state.log.length = 60;
    }
  };

  function uid() {
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ============ コメント取得アダプタ ============ */
  /* どのモードでも onComment(rawText) を呼ぶだけの共通インターフェース */

  const CommentSource = {
    _handlers: [],
    _seen: new Set(),
    _stop: null,
    status: 'stopped',
    onComment(fn) { this._handlers.push(fn); return this; },
    _fire(raw) {
      const text = String(raw || '').trim();
      if (!text) return;
      this._handlers.forEach(fn => { try { fn(text); } catch (e) { console.error(e); } });
    },

    start() {
      this.stop();
      const mode = CFG.comment.mode;
      if (mode === 'test')          this._startTest();
      else if (mode === 'fetch')    this._startFetch();
      else if (mode === 'iframe')   this._startIframe();
      else if (mode === 'onecomme') this._startOneComme();
      else { this.status = 'unknown-mode'; }
      return this;
    },

    stop() {
      if (this._stop) { try { this._stop(); } catch (_) {} this._stop = null; }
      this.status = 'stopped';
    },

    /* --- テストモード：test-comments.html から BroadcastChannel で受信 --- */
    _startTest() {
      let bc;
      try { bc = new BroadcastChannel(CFG.storage.commentChannel); } catch (_) { this.status = 'error'; return; }
      bc.onmessage = (e) => {
        if (e.data && e.data.type === 'comment') this._fire(e.data.text);
      };
      this.status = 'running (test)';
      this._stop = () => bc.close();
    },

    /* --- fetch モード：URL を定期取得して DOM を解析 --- */
    _startFetch() {
      const url = CFG.comment.url;
      if (!url) { this.status = 'error: url未設定'; return; }
      const parser = new DOMParser();
      let alive = true;

      const tick = async () => {
        if (!alive) return;
        try {
          const res  = await fetch(url, { cache: 'no-store' });
          const html = await res.text();
          const doc  = parser.parseFromString(html, 'text/html');
          this._scanDom(doc);
          this.status = 'running (fetch)';
        } catch (e) {
          this.status = 'error: ' + e.message;
        }
      };
      tick();
      const t = setInterval(tick, CFG.comment.pollIntervalMs);
      this._stop = () => { alive = false; clearInterval(t); };
    },

    /* --- iframe モード：iframe 内 DOM を MutationObserver で監視 --- */
    _startIframe() {
      const url = CFG.comment.url;
      if (!url) { this.status = 'error: url未設定'; return; }
      const f = document.createElement('iframe');
      f.src = url;
      f.style.cssText = 'position:absolute;width:1px;height:1px;left:-9999px;top:-9999px;border:0;';
      document.body.appendChild(f);
      let obs = null;
      f.onload = () => {
        try {
          const doc = f.contentDocument;
          this._scanDom(doc, true);   // 初回は既存分を既読扱い
          const root = doc.querySelector(CFG.comment.listSelector) || doc.body;
          obs = new MutationObserver(() => this._scanDom(doc));
          obs.observe(root, { childList: true, subtree: true });
          this.status = 'running (iframe)';
        } catch (e) {
          this.status = 'error: iframeを読めません（別オリジン）';
        }
      };
      this._stop = () => { if (obs) obs.disconnect(); f.remove(); };
    },

    /* --- わんコメ等の WebSocket --- */
    _startOneComme() {
      let ws;
      try { ws = new WebSocket(CFG.comment.onecommeWsUrl); } catch (e) { this.status = 'error'; return; }
      ws.onopen  = () => { this.status = 'running (onecomme)'; };
      ws.onerror = () => { this.status = 'error: WebSocket接続失敗'; };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          const arr = msg.data && msg.data.comments ? msg.data.comments
                    : (msg.data ? [msg.data] : []);
          arr.forEach(c => {
            const d = c.data || c;
            const name = d.displayName || d.name || d.userName || '';
            const body = d.comment || d.text || '';
            if (name || body) this._fire(name + '\n' + body);
          });
        } catch (_) {}
      };
      this._stop = () => ws.close();
    },

    /* --- DOM からコメントを抽出（fetch / iframe 共通） --- */
    _scanDom(doc, markOnly) {
      const items = doc.querySelectorAll(
        CFG.comment.listSelector + ' ' + CFG.comment.itemSelector
      );
      const list = items.length ? items : doc.querySelectorAll(CFG.comment.itemSelector);
      list.forEach((el, idx) => {
        let text;
        if (CFG.comment.nameSelector && CFG.comment.bodySelector) {
          const n = el.querySelector(CFG.comment.nameSelector);
          const b = el.querySelector(CFG.comment.bodySelector);
          text = (n ? n.textContent.trim() : '') + '\n' + (b ? b.textContent.trim() : '');
        } else {
          text = el.innerText !== undefined
            ? el.innerText
            : el.textContent.replace(/\n\s+/g, '\n');
        }
        text = String(text).split('\n').map(s => s.trim()).filter((s, i) => s || i === 0).join('\n');
        const sig = (el.id || el.dataset.id || '') + '|' + idx + '|' + text;
        if (this._seen.has(sig)) return;
        this._seen.add(sig);
        if (this._seen.size > 500) this._seen = new Set([...this._seen].slice(-300));
        if (!markOnly) this._fire(text);
      });
    }
  };

  /* ============ エンジン：コメント → キュー操作 ============ */

  const Engine = {
    start(onEvent) {
      CommentSource.onComment((raw) => {
        const r = interpret(raw);
        let result = null;
        if (r.type === 'join')              result = Store.enqueue(r.name, { via: 'comment' });
        else if (r.type === 'collab-join')  result = Store.collabJoin(r.name);
        else if (r.type === 'collab-leave') result = Store.collabLeave(r.name);
        if (onEvent) onEvent(r, result, raw);
      });
      CommentSource.start();
      return this;
    },
    stop() { CommentSource.stop(); }
  };

  /* ============ 公開 ============ */
  global.QueueCore = {
    Store, CommentSource, Engine,
    interpret, normalize, keyOf, escapeHtml, cleanName, isJoinKeyword, uid
  };

})(window);
