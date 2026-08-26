/* =============================================================
 *  夏祭り順番待ちアプリ — 設定ファイル
 *  ここだけを書き換えれば、文言・キーワード・色・取得方式を変更できます。
 * ============================================================= */
window.APP_CONFIG = {

  /* ---------- 1. 基本情報 ---------- */
  app: {
    title:    '夏祭り 順番待ち',        // 画面上部のタイトル
    subtitle: '花火大会コラボ配信',      // サブタイトル
    // display 画面に出す並び方の案内文（{keyword} は下の keywords.join[0] に置換）
    howToJoin: 'コメントで 「{keyword}」 と入力すると列の最後尾に並べます',
    honorific: 'さん'                   // 名前のあとにつける敬称（不要なら '' ）
  },

  /* ---------- 2. 配信コメントの取得方式 ---------- */
  comment: {
    /*  mode:
     *   'bridge'   … REALITYのコメント画面からユーザースクリプト経由で受け取る（既定）
     *                テストページ(test-comments.html)からのコメントも同時に受け取れます
     *   'fetch'    … url を定期的に fetch して HTML を解析（同一オリジン or CORS許可が必要）
     *   'iframe'   … url を iframe で読み込んで DOM を監視（同一オリジンが必要）
     *   'onecomme' … わんコメ等のローカル WebSocket から取得
     *
     *  REALITYのコメント画面は別ドメインのSPAなので 'fetch' / 'iframe' では読めません。
     *  'bridge' ＋ reality-bridge.user.js（Tampermonkey）を使ってください。
     */
    mode: 'bridge',

    // ★ Config から指定する「特定のURL」＝ REALITYのコメント表示画面
    url: 'https://reality.app/comments/135107981.2195bf552090896d3cac9eea418d7bb158059854fea2a398fd75fc6baa5c1281',

    // bridge モードでコメントの送信を受け付けるオリジン（これ以外からは受け取らない）
    bridgeOrigins: ['https://reality.app'],

    pollIntervalMs: 1500,          // fetch モードの取得間隔(ms)

    /* --- fetch / iframe モードで使う DOM セレクタ ---
     *  listSelector : コメントが積まれる親要素
     *  itemSelector : コメント1件の要素（この中の1行目=ユーザー名、2行目以降=本文）
     *  nameSelector / bodySelector : 個別要素がある場合に指定。空なら行分割で判定。 */
    listSelector: '#commentList',
    itemSelector: '.comment-item',
    nameSelector: '',
    bodySelector: '',

    // onecomme モード用
    onecommeWsUrl: 'ws://127.0.0.1:11180/sub'
  },

  /* ---------- 3. 列に並ぶためのキーワード ---------- */
  keywords: {
    // このいずれかがコメント本体に入力されたら、最後尾に追加
    join: ['予約！', '予約!', 'join!', 'join！'],
    matchMode:  'exact',   // 'exact'=本文がキーワードと完全一致 / 'includes'=含まれていればOK
    ignoreCase: true,      // 大文字小文字を無視
    normalize:  true       // 全角/半角・前後空白のゆらぎを吸収
  },

  /* ---------- 4. コラボ参加／退出のシステムメッセージ ---------- */
  systemMessage: {
    // {name} の部分がユーザー名として取り出されます（コメント1行目を判定）
    collabJoin:  '{name}さんがコラボ配信に参加しました',
    collabLeave: '{name}さんがコラボ配信を退出しました',
    matchWholeLine: false,  // true にすると1行目がテンプレートと完全一致した時だけ反応

    /* ユーザー名が本文と別のフィールドで届く場合（REALITYのWebSocket等）に、
     * 本文だけで参加／退出を判定するための文字列。
     * システムメッセージと判定できた場合にのみ使われます。 */
    collabJoinBody:  'コラボ配信に参加',
    collabLeaveBody: 'コラボ配信を退出'
  },

  /* ---------- 4-b. ギフト（花火の打ち上げ数を決める） ----------
   * REALITY のギフトメッセージ例：
   *   ハイビスカスの花冠(1000C)×3をあげました   → 1000 × 3 = 3000発
   *   ハイビスカスの花冠(1000C)をあげました      → 1000 × 1 = 1000発
   */
  gift: {
    enabled: true,
    // コメント本文から「コイン数」と「個数」を取り出す正規表現
    //   グループ1 = コイン数 / グループ2 = 個数（省略時は1）
    pattern: '\\((\\d[\\d,]*)\\s*C\\)\\s*(?:[×xX*]\\s*(\\d+))?\\s*を?\\s*あげました',
    maxShells: 10000,   // 派手さの上限になる発数（これ以上は同じ演出）
    minShells: 1        // 最低発数
  },

  /* ---------- 5. 動作ルール ---------- */
  rules: {
    // NOW（出演中）の人がいる状態で別の人が参加 → NOW に並べて表示する人数の上限
    maxNowSlots: 4,
    // 順番待ちにいない人がコラボ参加した場合も NOW に表示する
    addUnknownJoinerToNow: true,
    // すでに並んでいる／出演中の人の再「予約！」は無視する
    ignoreDuplicateJoin: true,
    // display 画面で NEXT の後ろに小さく表示する人数
    upcomingCount: 3,
    // 退出した人は完全に削除（再度「予約！」で最後尾に並び直せる）
    removeOnLeave: true
  },

  /* ---------- 6. 画面の文言 ---------- */
  labels: {
    now:          'NOW',
    nowJa:        '出演中',
    next:         'NEXT',
    nextJa:       '次の方',
    waiting:      '順番待ち',
    upcoming:     'このあと',
    emptyTitle:   'まもなく開演',
    emptySub:     '現在、順番待ちはいません',
    waitingCount: '{n}人待ち',
    adminTitle:   '管理パネル'
  },

  /* ---------- 7. カラーテーマ（夏祭り＆花火） ---------- */
  theme: {
    bgTop:     '#0a0f2c',   // 夜空（上）
    bgBottom:  '#1a0e2e',   // 夜空（下）
    surface:   '#151a3d',   // カード
    border:    '#2c356b',   // 罫線
    lantern:   '#ff4d3d',   // 提灯の赤
    gold:      '#ffd24a',   // 提灯の灯り／金
    hanabiA:   '#ff7ac4',   // 花火ピンク
    hanabiB:   '#5ce1e6',   // 花火シアン
    hanabiC:   '#b18cff',   // 花火パープル
    text:      '#fff6e5',   // 生成り色の文字
    textMuted: '#8a90c4'
  },

  /* ---------- 8. 花火エフェクト ---------- */
  fireworks: {
    enabled: true,
    ambientIntervalMs: 0,     // 0 = 通常時は打ち上げない（ギフトの時だけ）
    celebrateBurst: 0,        // 0 = NOW が切り替わっても打ち上げない

    /* 打ち上げ発数に応じた演出。1発〜gift.maxShells発の間で滑らかに変化します。
     * 発数が多いほど「同時に上がる数が増え・間隔が詰まり・長く続く」＝派手になります。 */
    maxGapMs:      900,       // 発射間隔（1発だけのとき）— 発数が増えるほど短くなる
    minGapMs:      70,        // 発射間隔の下限（最大発数のとき）
    minSimul:      1,         // 同時に上がる玉の数（1発のとき）
    maxSimul:      10,        // 同時に上がる玉の数（最大発数のとき）
    simulCurve:    1.6,       // 同時数の増え方（大きいほど、後半で一気に増える）
    maxDurationMs: 60000,     // 打ち上げの最長時間（超えるなら同時数を自動で増やす）
    maxParticles:  2600,      // 描画負荷の上限（超えそうなら1発あたりの粒を減らす）
    bigShellEvery: 12,        // 何発かに1回、大玉を混ぜる
    showCounter:   true       // 打ち上げ中に「◯◯発」を表示
  },

  /* ---------- 9. 他の端末と共有する設定（Firestore） ----------
   * backend:
   *   'local'     … このブラウザ内だけで同期（サーバー不要）
   *   'firestore' … Firestoreで同期。別のPC・スマホからも順番待ち画面が見える
   */
  sync: {
    backend: 'firestore',
    roomId: 'summer-matsuri',        // 部屋の名前。変えると別の順番待ちになる
    collection: 'matsuri-rooms',     // Firestoreのコレクション名
    firebaseConfig: {
      apiKey: "AIzaSyAeNCee3BW4TvEs_OAr6HlK6aD7QOtGPiM",
      authDomain: "queue-app-3af79.firebaseapp.com",
      projectId: "queue-app-3af79",
      storageBucket: "queue-app-3af79.firebasestorage.app",
      messagingSenderId: "522447933389",
      appId: "1:522447933389:web:b7ae12e97691863a99fe84"
    }
  },

  /* ---------- 10. 内部設定（通常変更不要） ---------- */
  storage: {
    stateKey:       'matsuri-queue-state-v1',
    queueChannel:   'matsuri-queue',
    commentChannel: 'matsuri-comments'
  }
};
