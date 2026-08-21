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
     *   'test'     … テスト用ページ(test-comments.html)からコメントを受け取る（既定）
     *   'fetch'    … url を定期的に fetch して HTML を解析（同一オリジン or CORS許可が必要）
     *   'iframe'   … url を iframe で読み込んで DOM を監視（同一オリジンが必要）
     *   'onecomme' … わんコメ等のローカル WebSocket から取得
     *
     *  ※配信を始めるまで URL が分からないので、URL が判明したら
     *    mode を 'fetch' か 'iframe' に変えて url とセレクタを埋めてください。
     *    どのモードでも、この下の判定ロジック（予約！／参加／退出）は共通です。
     */
    mode: 'test',

    // ★ Config から指定する「特定のURL」
    url: '',

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
    collabJoin:  '{name}さんがコラボ配信に参加',
    collabLeave: '{name}さんがコラボ配信を退出',
    matchWholeLine: false  // true にすると1行目がテンプレートと完全一致した時だけ反応
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
    ambientIntervalMs: 2600,  // 通常時に花火が上がる間隔
    celebrateBurst: 6         // 呼び出し時に一気に上げる花火の数
  },

  /* ---------- 9. 内部設定（通常変更不要） ---------- */
  storage: {
    stateKey:       'matsuri-queue-state-v1',
    queueChannel:   'matsuri-queue',
    commentChannel: 'matsuri-comments'
  }
};
