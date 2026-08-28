/* =============================================================
 *  queue-core.js — 状態管理・コメント解析・取得アダプタ
 *  依存: config.js（先に読み込むこと）
 *
 *  v2 変更点:
 *   - コメント伝送を BroadcastChannel + localStorage の二重経路に（Safari等の保険）
 *   - どのページでもエンジンを起動可能に。リーダー選出で二重処理を防止
 *   - コメントIDによる冪等処理（保険）
 * ============================================================= */
(function (global) {
  'use strict';

  const CFG = global.APP_CONFIG;

  function uid() {
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  const TAB_ID = uid();

  /* ============ 文字列ユーティリティ ============ */

  function normalize(str) {
    if (str == null) return '';
    let s = String(str);
    if (CFG.keywords.normalize) {
      s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c =>
        String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
      s = s.replace(/　/g, ' ');
      // 記号のゆらぎ（！？の全角半角）も吸収
      s = s.replace(/！/g, '!').replace(/？/g, '?');
    }
    return s.replace(/\s+/g, ' ').trim();
  }

  function keyOf(name) {
    let s = normalize(name);
    if (CFG.keywords.ignoreCase) s = s.toLowerCase();
    return s;
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }

  function cleanName(name) {
    return String(name || '')
      .replace(/^[\s　]*[\[【(（<＜][^\]】)）>＞]*[\]】)）>＞]\s*/, m =>
        /システム|system|info|お知らせ/i.test(m) ? '' : m)
      .replace(/^[\s　]+|[\s　]+$/g, '');
  }

  /* ============ コメント解析 ============ */

  function buildSystemRe(template) {
    const parts = String(template).split('{name}');
    const re = parts.map(escapeRe).join('(.+?)');
    return new RegExp(CFG.systemMessage.matchWholeLine ? '^' + re + '$' : re);
  }

  const asList = (v) => Array.isArray(v) ? v : (v == null ? [] : [v]);

  // 参加／退出の文言は複数パターンを許容する（「を退出」「から退出」など）
  const RE_JOIN_SYS  = asList(CFG.systemMessage.collabJoin).map(buildSystemRe);
  const RE_LEAVE_SYS = asList(CFG.systemMessage.collabLeave).map(buildSystemRe);

  function matchAny(reList, line) {
    for (let i = 0; i < reList.length; i++) {
      const m = line.match(reList[i]);
      if (m) return m;
    }
    return null;
  }
  function includesAny(list, text) {
    return asList(list).some(s => s && text.indexOf(s) >= 0);
  }

  function isJoinKeyword(body) {
    const b = keyOf(body);
    if (!b) return false;
    return CFG.keywords.join.some(kw => {
      const k = keyOf(kw);
      if (!k) return false;
      return CFG.keywords.matchMode === 'includes' ? b.includes(k) : b === k;
    });
  }

  /**
   * ユーザー名と本文が別々に届く場合（REALITYのWebSocket等）に、
   * 「1行目＝ユーザー名 / 2行目以降＝本文」の生テキストへ組み立てる。
   * システムメッセージなら、参加／退出の判定ができる1行の文にする。
   */
  function composeRaw(name, content, isSystem) {
    const c = String(content == null ? '' : content);
    const n = cleanName(name);
    if (!n) return c;                       // 名前なし＝システム文がそのまま入っている
    if (isSystem) {
      const SM = CFG.systemMessage;
      if (includesAny(SM.collabLeaveBody, c))
        return asList(SM.collabLeave)[0].replace('{name}', n);
      if (includesAny(SM.collabJoinBody, c))
        return asList(SM.collabJoin)[0].replace('{name}', n);
    }
    return n + '\n' + c;
  }

  /* ---- ギフト判定 ----
   * 「ハイビスカスの花冠(1000C)×3をあげました」→ { coins:1000, count:3, shells:3000 }
   * 「ハイビスカスの花冠(1000C)をあげました」  → { coins:1000, count:1, shells:1000 }
   */
  let RE_GIFT = null;
  try { RE_GIFT = new RegExp(CFG.gift.pattern); } catch (e) { console.error('gift.pattern が不正:', e); }

  function parseGift(text) {
    if (!CFG.gift || !CFG.gift.enabled || !RE_GIFT) return null;
    const m = normalize(text).match(RE_GIFT);
    if (!m) return null;
    const coins = parseInt(String(m[1]).replace(/,/g, ''), 10);
    const count = m[2] ? parseInt(m[2], 10) : 1;
    if (!isFinite(coins) || coins <= 0 || !isFinite(count) || count <= 0) return null;
    const raw = coins * count;
    const shells = Math.max(CFG.gift.minShells || 1,
                   Math.min(CFG.gift.maxShells || 10000, raw));
    return { coins, count, rawShells: raw, shells };
  }

  /* ---- ギフト文から「贈り主」と「ギフト名」を切り出す ----
   * REALITY のギフト行は名前欄が空で、本文が
   *   「<贈り主> <ギフト名>(1000C)×3をあげました」
   * の1行だけで届く。ギフト名は (1000C) の直前の1語なので、
   * 「(数字C)」の手前を最後の空白で割れば贈り主が取れる。
   *   お中元 名前入りキャンプタワー(10000C)をあげました
   *     → 贈り主「お中元」／ギフト名「名前入りキャンプタワー」
   *   ｴﾘｵｯﾄ&ｴﾝｼﾞｪﾙちゃん🪽👼⭐️ 小さなアヒルさん(100C)×8をあげました
   *     → 贈り主「ｴﾘｵｯﾄ&ｴﾝｼﾞｪﾙちゃん🪽👼⭐️」／ギフト名「小さなアヒルさん」
   */
  function splitGiftLine(text) {
    const t = normalize(text);
    const i = t.search(/[(（]\s*\d[\d,]*\s*[CcＣ]/);
    if (i <= 0) return { giver: '', item: '' };
    const head = t.slice(0, i).replace(/[\s　]+$/, '');
    const m = head.match(/^(.*?)[\s　]([^\s　]+)$/);
    if (m) return { giver: m[1].trim(), item: m[2] };
    return { giver: '', item: head };   // 空白が無い＝ギフト名だけ
  }

  function interpret(rawText) {
    const lines = String(rawText || '').replace(/\r/g, '').split('\n');
    const firstLine = (lines[0] || '').trim();
    const body = lines.slice(1).join('\n').trim();

    const mLeave = matchAny(RE_LEAVE_SYS, firstLine);
    if (mLeave) return { type: 'collab-leave', name: cleanName(mLeave[1]), body: firstLine };

    const mJoin = matchAny(RE_JOIN_SYS, firstLine);
    if (mJoin) return { type: 'collab-join', name: cleanName(mJoin[1]), body: firstLine };

    /* ---- ギフト ----
     * 通常は「1行目＝ユーザー名 / 2行目＝<名前> <ギフト名>(1000C)×3をあげました」。
     * 1行しか無い場合、その行はギフト文そのものなので
     * 名前として採用してはいけない（文章まるごとが名前になってしまう）。 */
    const giftInBody = parseGift(body);
    if (giftInBody) {
      const sp = splitGiftLine(body);
      return { type: 'gift', name: cleanName(firstLine) || cleanName(sp.giver),
               giftName: sp.item, body: body, gift: giftInBody };
    }
    const giftInLine1 = parseGift(firstLine);
    if (giftInLine1) {
      const sp = splitGiftLine(firstLine);
      return { type: 'gift', name: cleanName(sp.giver),
               giftName: sp.item, body: firstLine, gift: giftInLine1 };
    }

    if (isJoinKeyword(body)) return { type: 'join', name: cleanName(firstLine), body };

    return { type: 'none', name: cleanName(firstLine), body };
  }

  /* ============ 状態ストア ============ */

  const KEY = CFG.storage.stateKey;
  const CH  = CFG.storage.queueChannel;

  function emptyState() {
    return { queue: [], now: [], doneCount: 0, log: [], processed: [], fx: null, updatedAt: 0, rev: 0 };
  }

  const Store = {
    _listeners: [],
    _bc: null,
    _remote: null,
    _remoteFirst: true,
    state: emptyState(),

    init() {
      this.state = this.read();
      try {
        this._bc = new BroadcastChannel(CH);
        this._bc.onmessage = (e) => {
          if (e.data && e.data.type === 'state' && (e.data.state.rev || 0) >= (this.state.rev || 0)) {
            this.state = e.data.state;
            this._emit('remote');
          }
        };
      } catch (_) {}

      global.addEventListener('storage', (e) => {
        if (e.key === KEY) { this.state = this.read(); this._emit('remote'); }
      });

      // 保険：他タブの更新を取りこぼしても数秒で追いつく
      setInterval(() => {
        const s = this.read();
        if ((s.rev || 0) > (this.state.rev || 0)) { this.state = s; this._emit('poll'); }
      }, 2000);

      return this;
    },

    read() {
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return emptyState();
        return Object.assign(emptyState(), JSON.parse(raw));
      } catch (_) { return emptyState(); }
    },

    // 書き込み前に最新版を取り込む（他タブの更新を消さないため）
    _fresh() {
      const s = this.read();
      if ((s.rev || 0) > (this.state.rev || 0)) this.state = s;
      return this.state;
    },

    save(origin) {
      this.state.updatedAt = Date.now();
      this.state.rev = (this.state.rev || 0) + 1;
      try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch (_) {}
      if (this._bc) { try { this._bc.postMessage({ type: 'state', state: this.state }); } catch (_) {} }
      if (this._remote) { try { this._remote.write(this.state); } catch (e) { console.error(e); } }
      this._emit(origin || 'local');
    },

    /* ---- サーバー同期（Firestore等）の接続 ----
     * remote = { write(state), onRemote(cb) }
     * 他の端末からも同じ順番待ちが見えるようになります。 */
    attachRemote(remote) {
      this._remote = remote;
      remote.onRemote((s) => {
        if (!s) {
          // サーバーにまだ何も無い＝手元の内容を初期値として送る
          if (this._remoteFirst && (this.state.queue.length || this.state.now.length)) {
            this._remoteFirst = false;
            this.save('seed');
          }
          this._remoteFirst = false;
          return;
        }
        const incoming = Object.assign(emptyState(), s);
        // 最初の1回はサーバーを正とする。以降は新しい版だけ採用
        if (this._remoteFirst || (incoming.rev || 0) > (this.state.rev || 0)
            || (incoming.updatedAt || 0) > (this.state.updatedAt || 0)) {
          const first = this._remoteFirst;
          this._remoteFirst = false;
          this.state = incoming;
          try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch (_) {}
          // 初回の受信は「今の状態を読み込んだだけ」なので、
          // 途中から開いた端末で過去の花火が再生されないよう区別する
          this._emit(first ? 'remote-init' : 'remote');
        }
      });
      // 手元にデータがあり、サーバーが空だった場合に備えて少し待ってから送る
      return this;
    },

    onChange(fn) { this._listeners.push(fn); return this; },

    _emit(origin) {
      this._listeners.forEach(fn => { try { fn(this.state, origin); } catch (e) { console.error(e); } });
    },

    /* ---- 参照 ---- */
    findInQueue(name) {
      const k = keyOf(name);
      return this.state.queue.findIndex(p => keyOf(p.name) === k);
    },
    findInNow(name) {
      const k = keyOf(name);
      return this.state.now.findIndex(p => keyOf(p.name) === k);
    },

    /* ---- 冪等処理：このコメントIDを自分が処理してよいか ---- */
    claim(commentId) {
      if (!commentId) return true;
      this._fresh();
      const p = this.state.processed || [];
      if (p.indexOf(commentId) >= 0) return false;
      this.state.processed = p.concat(commentId).slice(-300);
      return true;
    },

    /* ---- 更新 ---- */
    enqueue(name, opts) {
      this._fresh();
      name = cleanName(name);
      if (!name) return { ok: false, reason: 'empty' };
      if (CFG.rules.ignoreDuplicateJoin &&
          (this.findInQueue(name) >= 0 || this.findInNow(name) >= 0)) {
        this.save(); // processed の記録だけ確定させる
        return { ok: false, reason: 'duplicate' };
      }
      const entry = { id: uid(), name, addedAt: Date.now(), via: (opts && opts.via) || 'comment' };
      this.state.queue.push(entry);
      this.log(`「${name}」が列に並びました`);
      this.save();
      return { ok: true, entry, position: this.state.queue.length };
    },

    enqueueFront(name) {
      this._fresh();
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

    collabJoin(name) {
      this._fresh();
      name = cleanName(name);
      if (!name) return { ok: false };
      if (this.findInNow(name) >= 0) { this.save(); return { ok: false, reason: 'already-now' }; }

      const qi = this.findInQueue(name);
      let entry;
      if (qi >= 0) entry = this.state.queue.splice(qi, 1)[0];
      else {
        if (!CFG.rules.addUnknownJoinerToNow) { this.save(); return { ok: false, reason: 'not-in-queue' }; }
        entry = { id: uid(), name, addedAt: Date.now(), via: 'guest' };
      }
      entry.startedAt = Date.now();
      this.state.now.push(entry);
      while (this.state.now.length > CFG.rules.maxNowSlots) {
        const out = this.state.now.shift();
        this.state.doneCount++;
        this.log(`「${out.name}」の出番が終了（自動）`);
      }
      this.log(`「${name}」がコラボ配信に参加`);
      this.save();
      return { ok: true, entry };
    },

    collabLeave(name) {
      this._fresh();
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
      const qi = this.findInQueue(name);
      if (qi >= 0) {
        const out = this.state.queue.splice(qi, 1)[0];
        this.state.doneCount++;
        this.log(`「${out.name}」が退出（列から削除）`);
        this.save();
        return { ok: true };
      }
      this.save();
      return { ok: false, reason: 'not-found' };
    },

    /* ---- ギフト＝花火の打ち上げ指示（全端末に伝わる） ----
     * 同じギフトが複数の経路（WebSocket＋DOM監視など）から届いても
     * 二重に数えないよう、短時間の同一ギフトは弾く。 */
    _giftSeen: {},
    gift(g, fromName) {
      this._fresh();
      const shells = Math.max(1, Math.round(g && g.shells ? g.shells : g));

      const win = (CFG.gift && CFG.gift.dedupeMs) || 0;
      if (win > 0) {
        const sig = keyOf(fromName || '') + '|' + shells + '|' +
                    ((g && g.coins) || 0) + 'x' + ((g && g.count) || 1);
        const now = Date.now();
        // 古い記録を掃除
        Object.keys(this._giftSeen).forEach(k => {
          if (now - this._giftSeen[k] > win) delete this._giftSeen[k];
        });
        if (this._giftSeen[sig] && now - this._giftSeen[sig] < win) {
          return { ok: false, reason: 'duplicate', shells };
        }
        this._giftSeen[sig] = now;
      }

      this.state.fx = {
        id: uid(),
        kind: 'gift',
        shells: shells,
        coins: g && g.coins || 0,
        count: g && g.count || 1,
        name: cleanName(fromName || ''),
        at: Date.now()
      };
      this.log(`${fromName ? '「' + cleanName(fromName) + '」の' : ''}ギフト → 花火 ${shells}発`);
      this.save();
      return { ok: true, shells };
    },

    removeAt(i)    { this._fresh(); const e = this.state.queue.splice(i, 1)[0]; if (e) { this.log(`「${e.name}」を削除`); this.save(); } },
    removeNowAt(i) { this._fresh(); const e = this.state.now.splice(i, 1)[0];   if (e) { this.state.doneCount++; this.log(`「${e.name}」の出番を終了`); this.save(); } },
    moveUp(i)      { this._fresh(); if (i <= 0) return; const q = this.state.queue; [q[i-1], q[i]] = [q[i], q[i-1]]; this.save(); },
    moveDown(i)    { this._fresh(); const q = this.state.queue; if (i >= q.length - 1) return; [q[i+1], q[i]] = [q[i], q[i+1]]; this.save(); },
    moveTo(from, to) {
      this._fresh();
      const q = this.state.queue;
      if (from === to || from < 0 || from >= q.length) return;
      const [m] = q.splice(from, 1);
      q.splice(to, 0, m);
      this.save();
    },
    callNext() {
      this._fresh();
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

  /* ============ リーダー選出 ============
   * 複数タブを開いても、コメントを処理するのは1タブだけにする。
   * priority が大きいタブが優先（admin=10 / test=5 / display=1）。
   * リーダーのタブが閉じても約3秒で他タブが引き継ぐ。 */

  const LEADER_KEY = KEY + '-leader';
  const LEASE_MS   = 3200;

  const Leader = {
    priority: 1,
    isLeader: false,
    _timer: null,
    onChange: null,

    start(priority, onChange) {
      this.priority = priority || 1;
      this.onChange = onChange || null;
      const tick = () => {
        let cur = null;
        try { cur = JSON.parse(localStorage.getItem(LEADER_KEY) || 'null'); } catch (_) {}
        const now = Date.now();
        const expired = !cur || !cur.id || (now - (cur.t || 0) > LEASE_MS);
        const mine    = cur && cur.id === TAB_ID;
        const weaker  = cur && (cur.priority || 1) < this.priority;

        const was = this.isLeader;
        if (expired || mine || weaker) {
          try { localStorage.setItem(LEADER_KEY, JSON.stringify({ id: TAB_ID, t: now, priority: this.priority })); } catch (_) {}
          this.isLeader = true;
        } else {
          this.isLeader = false;
        }
        if (was !== this.isLeader && this.onChange) this.onChange(this.isLeader);
      };
      tick();
      this._timer = setInterval(tick, 1200);
      global.addEventListener('beforeunload', () => {
        try {
          const cur = JSON.parse(localStorage.getItem(LEADER_KEY) || 'null');
          if (cur && cur.id === TAB_ID) localStorage.removeItem(LEADER_KEY);
        } catch (_) {}
      });
      return this;
    }
  };

  /* ============ コメント伝送バス（テストモード用） ============
   * BroadcastChannel と localStorage の両方で配り、
   * 送信元タブ自身にもその場で配る（自タブがリーダーの場合に必要）。 */

  const BUS_KEY = CFG.storage.stateKey + '-bus';

  const CommentBus = {
    _handlers: [],
    _seen: new Set(),
    _bc: null,
    _listening: false,

    bridgeConnected: false,
    bridgeLastAt: 0,

    listen() {
      if (this._listening) return this;
      this._listening = true;
      try {
        this._bc = new BroadcastChannel(CFG.storage.commentChannel);
        this._bc.onmessage = (e) => {
          if (e.data && e.data.type === 'comment') this._deliver(e.data);
        };
      } catch (_) {}

      global.addEventListener('storage', (e) => {
        if (e.key === BUS_KEY && e.newValue) {
          try { this._deliver(JSON.parse(e.newValue)); } catch (_) {}
        }
      });

      /* --- 外部ページ（REALITYのコメント画面）からの橋渡しを受け付ける --- */
      const allow = CFG.comment.bridgeOrigins || [];
      global.addEventListener('message', (e) => {
        const d = e.data;
        if (!d || d.__matsuri !== 1) return;
        // 許可オリジン、または自分自身のページ（動作確認ページ）からのみ受け付ける
        if (allow.indexOf(e.origin) < 0 && e.origin !== global.location.origin) return;

        this.bridgeConnected = true;
        this.bridgeLastAt = Date.now();

        // 接続確認への応答
        if (d.type === 'ping') {
          try { e.source.postMessage({ __matsuri: 1, type: 'ack', app: 'matsuri-queue' }, e.origin); } catch (_) {}
          return;
        }

        if (d.type === 'comment') {
          const raw = (typeof d.text === 'string' && d.text)
            ? d.text
            : composeRaw(d.name, d.content, !!d.system);
          if (raw) this.post(raw);                 // 全タブへ再配信
          try { e.source.postMessage({ __matsuri: 1, type: 'ack', app: 'matsuri-queue' }, e.origin); } catch (_) {}
        }
      });

      return this;
    },

    on(fn) { this._handlers.push(fn); return this; },

    post(text) {
      const msg = { type: 'comment', id: uid(), text: String(text), t: Date.now() };
      this._deliver(msg);                                 // 自タブ
      if (!this._bc) { try { this._bc = new BroadcastChannel(CFG.storage.commentChannel); } catch (_) {} }
      if (this._bc) { try { this._bc.postMessage(msg); } catch (_) {} }
      try { localStorage.setItem(BUS_KEY, JSON.stringify(msg)); } catch (_) {}  // 他タブ
      return msg.id;
    },

    _deliver(msg) {
      if (!msg || !msg.id || this._seen.has(msg.id)) return;
      this._seen.add(msg.id);
      if (this._seen.size > 400) this._seen = new Set([...this._seen].slice(-200));
      this._handlers.forEach(fn => { try { fn(msg.text, msg.id); } catch (e) { console.error(e); } });
    }
  };

  /* ============ コメント取得アダプタ ============ */

  const CommentSource = {
    _handlers: [],
    _seenDom: new Set(),
    _stop: null,
    status: 'stopped',

    onComment(fn) { this._handlers.push(fn); return this; },

    _fire(raw, id) {
      const text = String(raw || '').trim();
      if (!text) return;
      this._handlers.forEach(fn => { try { fn(text, id || uid()); } catch (e) { console.error(e); } });
    },

    start() {
      this.stop();
      const mode = CFG.comment.mode;
      if (mode === 'test' || mode === 'bridge') this._startTest();
      else if (mode === 'fetch')    this._startFetch();
      else if (mode === 'iframe')   this._startIframe();
      else if (mode === 'onecomme') this._startOneComme();
      else this.status = 'unknown-mode';
      return this;
    },

    stop() {
      if (this._stop) { try { this._stop(); } catch (_) {} this._stop = null; }
      this.status = 'stopped';
    },

    _startTest() {
      CommentBus.listen().on((text, id) => this._fire(text, id));
      this.status = 'running (' + CFG.comment.mode + ')';
      this._stop = () => {};   // バスは常時接続のままで良い
    },

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
          this._scanDom(parser.parseFromString(html, 'text/html'));
          this.status = 'running (fetch)';
        } catch (e) { this.status = 'error: ' + e.message; }
      };
      tick();
      const t = setInterval(tick, CFG.comment.pollIntervalMs);
      this._stop = () => { alive = false; clearInterval(t); };
    },

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
          this._scanDom(doc, true);
          const root = doc.querySelector(CFG.comment.listSelector) || doc.body;
          obs = new MutationObserver(() => this._scanDom(doc));
          obs.observe(root, { childList: true, subtree: true });
          this.status = 'running (iframe)';
        } catch (e) { this.status = 'error: iframeを読めません（別オリジン）'; }
      };
      this._stop = () => { if (obs) obs.disconnect(); f.remove(); };
    },

    _startOneComme() {
      let ws;
      try { ws = new WebSocket(CFG.comment.onecommeWsUrl); } catch (e) { this.status = 'error'; return; }
      ws.onopen  = () => { this.status = 'running (onecomme)'; };
      ws.onerror = () => { this.status = 'error: WebSocket接続失敗'; };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          const arr = msg.data && msg.data.comments ? msg.data.comments : (msg.data ? [msg.data] : []);
          arr.forEach(c => {
            const d = c.data || c;
            const name = d.displayName || d.name || d.userName || '';
            const body = d.comment || d.text || '';
            const id   = d.id || d.commentId || null;
            if (name || body) this._fire(name + '\n' + body, id ? 'oc:' + id : null);
          });
        } catch (_) {}
      };
      this._stop = () => ws.close();
    },

    _scanDom(doc, markOnly) {
      let list = doc.querySelectorAll(CFG.comment.listSelector + ' ' + CFG.comment.itemSelector);
      if (!list.length) list = doc.querySelectorAll(CFG.comment.itemSelector);
      list.forEach((el, idx) => {
        let text;
        if (CFG.comment.nameSelector && CFG.comment.bodySelector) {
          const n = el.querySelector(CFG.comment.nameSelector);
          const b = el.querySelector(CFG.comment.bodySelector);
          text = (n ? n.textContent.trim() : '') + '\n' + (b ? b.textContent.trim() : '');
        } else {
          text = el.innerText !== undefined ? el.innerText
               : el.textContent.replace(/\n\s+/g, '\n');
        }
        text = String(text).split('\n').map(s => s.trim()).filter((s, i) => s || i === 0).join('\n');
        const sig = (el.id || el.dataset.id || '') + '|' + idx + '|' + text;
        if (this._seenDom.has(sig)) return;
        this._seenDom.add(sig);
        if (this._seenDom.size > 600) this._seenDom = new Set([...this._seenDom].slice(-300));
        if (!markOnly) this._fire(text, 'dom:' + sig);
      });
    }
  };

  /* ============ エンジン ============ */

  const Engine = {
    running: false,
    priority: 1,

    /**
     * @param {number} priority 10=admin / 5=test / 1=display
     * @param {function} onEvent (解析結果, 処理結果, 生テキスト)
     */
    start(priority, onEvent) {
      if (this.running) return this;
      this.priority = priority || 1;
      Leader.start(this.priority);

      CommentSource.onComment((raw, id) => {
        if (!Leader.isLeader) return;          // リーダーのタブだけが処理
        if (!Store.claim(id)) return;          // 冪等（保険）
        const r = interpret(raw);
        let result = null;
        if (r.type === 'join')              result = Store.enqueue(r.name, { via: 'comment' });
        else if (r.type === 'collab-join')  result = Store.collabJoin(r.name);
        else if (r.type === 'collab-leave') result = Store.collabLeave(r.name);
        else if (r.type === 'gift')         result = Store.gift(r.gift, r.name);
        else Store.save();                     // processed の記録を確定
        if (onEvent) onEvent(r, result, raw);
      });

      CommentSource.start();
      this.running = true;
      return this;
    },

    stop() { CommentSource.stop(); this.running = false; }
  };

  /* ============ 同期状態の初期化 ============
   * firebase-sync.js（module）が何らかの理由で読み込めない場合でも、
   * 画面に「同期できていない」と分かるようにしておく。 */
  if (CFG.sync && CFG.sync.backend === 'firestore') {
    if (!global.MatsuriSync) global.MatsuriSync = { status: 'connecting', detail: '' };
    setTimeout(() => {
      if (global.MatsuriSync && global.MatsuriSync.status === 'connecting') {
        global.MatsuriSync = { status: 'error', detail: 'Firebaseに接続できません' };
        global.dispatchEvent(new CustomEvent('matsuri-sync', { detail: global.MatsuriSync }));
      }
    }, 12000);
  }

  /* ============ 公開 ============ */
  global.QueueCore = {
    Store, CommentSource, CommentBus, Engine, Leader,
    interpret, composeRaw, parseGift, splitGiftLine, normalize, keyOf, escapeHtml, cleanName, isJoinKeyword, uid,
    TAB_ID
  };

})(window);
