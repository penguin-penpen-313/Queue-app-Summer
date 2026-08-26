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
  getFirestore, doc, onSnapshot, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const CFG = window.APP_CONFIG;
const SY  = CFG && CFG.sync;

function markStatus(state, detail) {
  window.MatsuriSync = window.MatsuriSync || {};
  window.MatsuriSync.status = state;
  window.MatsuriSync.detail = detail || '';
  window.dispatchEvent(new CustomEvent('matsuri-sync', { detail: { status: state, detail } }));
}

if (!SY || SY.backend !== 'firestore') {
  markStatus('off', 'このブラウザ内のみ');
} else {
  try {
    const app = initializeApp(SY.firebaseConfig);
    const db  = getFirestore(app);
    const ref = doc(db, SY.collection || 'matsuri-rooms', SY.roomId || 'default');

    let handler = null;
    let writeTimer = null;
    let latest = null;
    let everGot = false;

    const remote = {
      /* 書き込みは 250ms まとめて1回（連打対策） */
      write(state) {
        latest = state;
        if (writeTimer) return;
        writeTimer = setTimeout(async () => {
          writeTimer = null;
          const s = latest;
          if (!s) return;
          try {
            await setDoc(ref, {
              queue:     s.queue     || [],
              now:       s.now       || [],
              doneCount: s.doneCount || 0,
              log:       (s.log || []).slice(0, 40),
              fx:        s.fx        || null,
              rev:       s.rev       || 0,
              updatedAt: s.updatedAt || Date.now()
            });
            markStatus('ok', '同期中');
          } catch (e) {
            console.error('[matsuri-sync] 書き込み失敗', e);
            markStatus('error', e.code || e.message);
          }
        }, 250);
      },
      onRemote(cb) { handler = cb; }
    };

    window.QueueCore.Store.attachRemote(remote);
    markStatus('connecting', '接続中…');

    onSnapshot(ref, (snap) => {
      everGot = true;
      markStatus('ok', '同期中');
      if (handler) handler(snap.exists() ? snap.data() : null);
    }, (e) => {
      console.error('[matsuri-sync] 受信失敗', e);
      markStatus('error', e.code || e.message);
    });

    setTimeout(() => { if (!everGot) markStatus('error', '接続できません（設定/ルールを確認）'); }, 8000);

  } catch (e) {
    console.error('[matsuri-sync] 初期化失敗', e);
    markStatus('error', e.message);
  }
}
