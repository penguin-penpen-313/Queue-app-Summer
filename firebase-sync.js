/* =============================================================
 *  firebase-sync.js — Firestore で他の端末と順番待ちを共有する
 *
 *  config.js の sync.backend が 'firestore' のときだけ動きます。
 *  読み込み方（各HTMLの最後）:
 *    <script type="module" src="firebase-sync.js"></script>
 *
 *  状態はコレクション sync.collection の中の
 *  ドキュメント sync.roomId に、まとめて1件で保存されます。
 * ============================================================= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, doc, onSnapshot, setDoc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const CFG = window.APP_CONFIG;
const SY  = CFG && CFG.sync;

/* 状態は window.MatsuriSync に集約。画面はこれを見て表示する。 */
const S = window.MatsuriSync = window.MatsuriSync || {};
S.status = 'off';
S.detail = '';
S.readOk = null;       // true / false / null(未実施)
S.writeOk = null;
S.lastError = null;    // { op:'read'|'write', code, message }
S.path = '';

function mark(state, detail) {
  S.status = state;
  S.detail = detail || '';
  window.dispatchEvent(new CustomEvent('matsuri-sync', { detail: { status: state, detail: S.detail } }));
}

function errInfo(e) {
  return {
    code: (e && e.code) || '',
    message: (e && e.message) || String(e)
  };
}

/* エラーコードを日本語の説明に */
function explain(op, code) {
  const what = op === 'read' ? '読み取り' : '書き込み';
  if (/permission-denied/.test(code)) {
    return op === 'read'
      ? '読み取り拒否：ルールが未適用か、コレクション名が違います'
      : '書き込み拒否：ルールの条件に合っていません（部屋名 or データ形式）';
  }
  if (/unavailable|network/.test(code)) return what + '不可：ネットワークに繋がりません';
  if (/not-found/.test(code))           return what + '不可：データベースが見つかりません';
  if (/unauthenticated/.test(code))     return what + '不可：認証が必要な設定になっています';
  if (/invalid-argument/.test(code))    return what + '不可：送ったデータの形式が不正です';
  return what + 'エラー：' + code;
}

if (!SY || SY.backend !== 'firestore') {
  S.path = '(ローカルのみ)';
  mark('off', 'このブラウザ内のみ');
} else {
  const COL  = SY.collection || 'matsuri-rooms';
  const ROOM = SY.roomId || 'default';
  S.path = COL + '/' + ROOM;

  try {
    const app = initializeApp(SY.firebaseConfig);
    const db  = getFirestore(app);
    const ref = doc(db, COL, ROOM);

    let handler = null;
    let writeTimer = null;
    let latest = null;
    let everGot = false;

    /* 書き込む形（ルールの検証対象）をここで組み立てる */
    function payload(s) {
      return {
        queue:     Array.isArray(s.queue) ? s.queue : [],
        now:       Array.isArray(s.now)   ? s.now   : [],
        doneCount: Number(s.doneCount || 0),
        log:       (Array.isArray(s.log) ? s.log : []).slice(0, 40),
        fx:        s.fx || null,
        rev:       Number(s.rev || 0),
        updatedAt: Number(s.updatedAt || Date.now())
      };
    }

    const remote = {
      /* 書き込みは 250ms まとめて1回（連打対策） */
      write(state) {
        latest = state;
        if (writeTimer) return;
        writeTimer = setTimeout(async () => {
          writeTimer = null;
          if (!latest) return;
          try {
            await setDoc(ref, payload(latest));
            S.writeOk = true;
            if (S.readOk !== false) mark('ok', '同期中');
          } catch (e) {
            S.writeOk = false;
            S.lastError = Object.assign({ op: 'write' }, errInfo(e));
            console.error('[matsuri-sync] 書き込み失敗', e);
            mark('error', explain('write', S.lastError.code || S.lastError.message));
          }
        }, 250);
      },
      onRemote(cb) { handler = cb; }
    };

    window.QueueCore.Store.attachRemote(remote);
    mark('connecting', '接続中…');

    onSnapshot(ref, (snap) => {
      everGot = true;
      S.readOk = true;
      if (S.writeOk !== false) mark('ok', '同期中');
      if (handler) handler(snap.exists() ? snap.data() : null);
    }, (e) => {
      S.readOk = false;
      S.lastError = Object.assign({ op: 'read' }, errInfo(e));
      console.error('[matsuri-sync] 受信失敗', e);
      mark('error', explain('read', S.lastError.code || S.lastError.message));
    });

    setTimeout(() => {
      if (!everGot && S.status !== 'error') mark('error', '応答なし（設定/ルール/回線を確認）');
    }, 8000);

    /* ---------------------------------------------------------
     *  接続テスト：読み取りと書き込みを別々に試して結果を返す
     *  管理パネルの「同期をテスト」から呼ばれる
     * --------------------------------------------------------- */
    S.test = async function () {
      const r = { path: S.path, room: ROOM, collection: COL, read: '', write: '', hint: '' };
      let readCode = '', writeCode = '';

      try {
        const snap = await getDoc(ref);
        r.read = 'OK' + (snap.exists() ? '（データあり）' : '（まだ空）');
        S.readOk = true;
      } catch (e) {
        const i = errInfo(e);
        readCode = i.code || i.message;
        r.read = 'NG ' + readCode;
        S.readOk = false;
        S.lastError = Object.assign({ op: 'read' }, i);
      }

      try {
        await setDoc(ref, payload(window.QueueCore.Store.state));
        r.write = 'OK';
        S.writeOk = true;
      } catch (e) {
        const i = errInfo(e);
        writeCode = i.code || i.message;
        r.write = 'NG ' + writeCode;
        S.writeOk = false;
        S.lastError = Object.assign({ op: 'write' }, i);
      }

      if (S.readOk && S.writeOk) {
        r.hint = '正常です。';
        mark('ok', '同期中');
      } else if (!S.readOk && !S.writeOk) {
        r.hint = 'ルールがまったく適用されていない可能性が高いです。'
               + 'コレクション名が「' + COL + '」になっているか確認してください。';
        mark('error', explain('read', readCode));
      } else if (!S.writeOk) {
        r.hint = '読めるが書けない状態。ルールの書き込み条件（部屋名 '
               + ROOM + ' / データ形式）が合っていません。';
        mark('error', explain('write', writeCode));
      } else {
        r.hint = '書けるが読めない状態。ルールの read 条件を確認してください。';
        mark('error', explain('read', readCode));
      }
      return r;
    };

  } catch (e) {
    S.lastError = Object.assign({ op: 'init' }, errInfo(e));
    console.error('[matsuri-sync] 初期化失敗', e);
    mark('error', '初期化失敗: ' + (e.message || ''));
  }
}
