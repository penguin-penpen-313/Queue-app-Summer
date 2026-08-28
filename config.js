/* =============================================================
 *  夏祭り順番待ちアプリ — 設定ファイル
 *  ここだけを書き換えれば、文言・キーワード・色・演出を変更できます。
 * ============================================================= */
window.APP_CONFIG = {

  /* ---------- 0. バージョン ----------
   * 更新したらここを書き換え、各HTMLの ?v=... も同じ値に合わせる。
   * 管理パネルの「同期の状態」欄に表示されるので、
   * GitHub Pages に新しい版が反映されたか一目で分かる。 */
  appVersion: '20260827a',

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
     *                テストページからのコメントも同時に受け取れます
     *   'fetch'    … url を定期的に fetch して HTML を解析（同一オリジン or CORS許可が必要）
     *   'iframe'   … url を iframe で読み込んで DOM を監視（同一オリジンが必要）
     *   'onecomme' … わんコメ等のローカル WebSocket から取得
     */
    mode: 'bridge',

    // コメント画面のURLの初期値。配信ごとに変わるので、
    // 実際には管理パネルの入力欄に貼った値（ブラウザに保存）が優先されます。
    url: '',

    // bridge モードでコメントの送信を受け付けるオリジン（これ以外からは受け取らない）
    bridgeOrigins: ['https://reality.app'],

    pollIntervalMs: 1500,          // fetch モードの取得間隔(ms)

    /* --- fetch / iframe モードで使う DOM セレクタ --- */
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

  /* ---------- 4. コラボ参加／退出のシステムメッセージ ----------
   * REALITYの実際の表示（2026-08 時点）:
   *   〇〇さんがコラボ配信に参加しました
   *   〇〇さんがコラボ配信から退出しました   ← 「を」ではなく「から」
   * 表記が変わっても拾えるよう、複数パターンを並べられます（上から順に判定）。
   */
  systemMessage: {
    collabJoin: [
      '{name}さんがコラボ配信に参加'
    ],
    collabLeave: [
      '{name}さんがコラボ配信から退出',
      '{name}さんがコラボ配信を退出'
    ],
    matchWholeLine: false,  // true にすると1行目がテンプレートと完全一致した時だけ反応

    /* ユーザー名が本文と別のフィールドで届く場合に、本文だけで判定するための文字列。
     * システムメッセージと判定できた場合にのみ使われます。 */
    collabJoinBody:  ['コラボ配信に参加'],
    collabLeaveBody: ['コラボ配信から退出', 'コラボ配信を退出']
  },

  /* ---------- 4-b. ギフト（花火の打ち上げ数を決める） ----------
   * REALITY の実際の表示（2026-08 時点）:
   *   お中元 名前入りキャンプタワー(10000C)をあげました          → 10000 × 1 = 10000発
   *   ｴﾘｵｯﾄ&ｴﾝｼﾞｪﾙちゃん 🪽 👼 ⭐ 小さなアヒルさん(100C)×8をあげました → 100 × 8 = 800発
   */
  gift: {
    enabled: true,
    // コメント本文から「コイン数」と「個数」を取り出す正規表現
    //   グループ1 = コイン数 / グループ2 = 個数（省略時は1）
    pattern: '\\((\\d[\\d,]*)\\s*C\\)\\s*(?:[×xX*✕☓]\\s*(\\d+))?\\s*を?\\s*あげました',
    maxShells: 10000,   // 発数の上限（これ以上のギフトも同じ扱い）
    minShells: 1,       // 最低発数
    // 同じギフトが複数の経路から二重に届くのを防ぐ時間(ms)。
    // 「10000C×1 なのに30000発」のような多重カウントを防ぐ。
    dedupeMs: 8000
  },

  /* ---------- 5. 動作ルール ---------- */
  rules: {
    maxNowSlots: 4,             // NOW に並べて表示する人数の上限
    addUnknownJoinerToNow: true,// 順番待ちにいない人がコラボ参加した場合もNOWに出す
    ignoreDuplicateJoin: true,  // すでに並んでいる／出演中の人の再「予約！」は無視
    upcomingCount: 3,           // NEXT の後ろに小さく表示する人数
    removeOnLeave: true         // 退出した人は削除（再度「予約！」で並び直せる）
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

  /* ---------- 8. 花火エフェクト ----------
   * ギフトが来たときだけ打ち上がります（通常時は上げない）。
   *
   * ▼ 長さを変えたいとき
   *   maxDurationMs … 一番大きなギフト(=maxShells)のときの長さ。既定20秒
   *   minDurationMs … 1発のときの長さ
   *   その間は発数に応じて滑らかに変化します。
   *
   * ▼ 重いと感じるとき
   *   maxRenderShells を下げる（実際に描画する玉の数の上限）
   *   maxParticles を下げる（画面に同時に存在する粒の上限）
   *   発数が多い場合は「1玉を大きく」して迫力を出すので、
   *   玉数を減らしても見た目の派手さは保たれます。
   */
  fireworks: {
    enabled: true,

    minDurationMs:   1200,    // 1発のときの長さ
    maxDurationMs:  20000,    // 最大発数のときの長さ（★ここで全体の長さを調整）
    maxGapMs:         900,    // 発射間隔（1発のとき）
    minGapMs:          90,    // 発射間隔の下限（最大発数のとき）
    maxSimul:          10,    // 同時に上がる玉の数の上限

    maxRenderShells:  900,    // 実際に描画する玉の最大数（負荷対策）
    maxParticles:    1800,    // 同時に存在する粒の上限（負荷対策）
    minShellParticles: 18,    // 1玉あたりの粒（多発時）
    maxShellParticles: 40,    // 1玉あたりの粒（少発時）
    maxShellScale:    2.2,    // 多発時の玉の大きさ倍率
    bigShellEvery:     10,    // 何玉かに1回、特大を混ぜる
    opacity:          0.85    // 花火の濃さ（下げると順番待ちが読みやすい）
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

    /* ---------------------------------------------------------------
     *  ▼ Firebase の設定（apiKey は「秘密鍵」ではありません）
     *
     *  FirebaseのWeb APIキーは、プロジェクトを識別するための公開IDです。
     *  ブラウザで動く以上ソースに必ず含まれるもので、Googleも
     *  「コードや設定ファイルに含めても安全」と明記しています。
     *    https://firebase.google.com/docs/projects/api-keys
     *
     *  そのため GitHub の secret scanning が警告を出しますが、
     *  これは想定内です（アラートは "Won't fix" で閉じて構いません）。
     *
     *  データを守っているのはキーの秘匿ではなく、次の2つです：
     *    1. Firestore セキュリティルール … 同梱の firestore.rules を適用
     *    2. APIキーの制限 … Google Cloud Console で
     *       「ウェブサイトの制限」に自分のGitHub PagesのURLを設定
     *  詳しくは FIREBASE-セキュリティ.md を参照。
     * --------------------------------------------------------------- */
    firebaseConfig: {
      apiKey: "AIzaSyAcF1T6fX-eboI3Tx3JKZJV6aLcWI-vtoc",
      authDomain: "queue-summer.firebaseapp.com",
      projectId: "queue-summer",
      storageBucket: "queue-summer.firebasestorage.app",
      messagingSenderId: "692851933544",
      appId: "1:692851933544:web:6cfb37dc79c85e4ea6d6dd"
    }
  },

  /* ---------- 10. 内部設定（通常変更不要） ---------- */
  storage: {
    stateKey:       'matsuri-queue-state-v1',
    queueChannel:   'matsuri-queue',
    commentChannel: 'matsuri-comments'
  }
};
