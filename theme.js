/* =============================================================
 *  theme.js — config.theme の色を CSS 変数に流し込む＋花火エフェクト
 *
 *  花火はギフト連動。発数（コイン数 ÷ coinsPerShell）に応じて
 *  「長さ・同時に上がる数・玉の大きさ」が変わり、順番に打ち上がります。
 *
 *  発数が多いときは「10発ぶん＝スペシャル1発」に置き換えます。
 *    ・特大花火（大きな二重の花）
 *    ・ペンギン柄（6種類のペンギンからランダム）
 *  打ち上げ回数が減るので、長さが config の maxDurationMs に収まり、
 *  画面のごちゃごちゃも減ります。
 * ============================================================= */
(function (global) {
  'use strict';
  const CFG = global.APP_CONFIG;

  /* ---------- CSS 変数の適用 ---------- */
  function applyTheme() {
    const t = CFG.theme, r = document.documentElement.style;
    r.setProperty('--bg-top',    t.bgTop);
    r.setProperty('--bg-bottom', t.bgBottom);
    r.setProperty('--surface',   t.surface);
    r.setProperty('--border',    t.border);
    r.setProperty('--lantern',   t.lantern);
    r.setProperty('--gold',      t.gold);
    r.setProperty('--hanabi-a',  t.hanabiA);
    r.setProperty('--hanabi-b',  t.hanabiB);
    r.setProperty('--hanabi-c',  t.hanabiC);
    r.setProperty('--text',      t.text);
    r.setProperty('--muted',     t.textMuted);
  }
  applyTheme();
  document.addEventListener('DOMContentLoaded', applyTheme);

  const lerp  = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* =============================================================
   *  ペンギン柄のかたち
   *  正規化座標（中心0,0／おおむね ±1）の点の集まり。
   *  粒をこの位置めがけて飛ばすと、空にペンギンの形が浮かびます。
   * ============================================================= */
  const PENGUIN_CACHE = {};

  function penguinShape(kind) {
    if (PENGUIN_CACHE[kind]) return PENGUIN_CACHE[kind];
    const P = [];
    const add = (x, y, c) => P.push({ x: x, y: y, c: c });
    /** 楕円の弧に沿って点を置く */
    const arc = (cx, cy, rx, ry, a0, a1, n, c) => {
      for (let i = 0; i < n; i++) {
        const a = a0 + (a1 - a0) * (n > 1 ? i / (n - 1) : 0);
        add(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, c);
      }
    };
    const T = Math.PI * 2;

    /* --- 共通の体つき --- */
    arc(0,  0.30, 0.42, 0.56, 0, T, 28, 'body');   // 体の輪郭
    arc(0, -0.60, 0.30, 0.28, 0, T, 18, 'body');   // 頭の輪郭
    arc(-0.44, 0.26, 0.09, 0.30, 0, T,  9, 'body'); // 左のヒレ
    arc( 0.44, 0.26, 0.09, 0.30, 0, T,  9, 'body'); // 右のヒレ

    arc(0, 0.34, 0.25, 0.38, 0, T, 18, 'belly');   // おなか（白）
    add(0, 0.12, 'belly'); add(0, 0.34, 'belly'); add(0, 0.56, 'belly');
    add(-0.11, 0.24, 'belly'); add(0.11, 0.24, 'belly');
    add(-0.11, 0.46, 'belly'); add(0.11, 0.46, 'belly');

    arc(0, -0.58, 0.16, 0.15, 0, T, 10, 'belly');  // 顔（白）
    add(0, -0.58, 'belly');
    add(-0.10, -0.64, 'eye'); add(0.10, -0.64, 'eye');           // 目
    add(0, -0.45, 'beak'); add(-0.06, -0.41, 'beak');
    add(0.06, -0.41, 'beak'); add(0, -0.37, 'beak');             // くちばし
    add(-0.15, 0.88, 'beak'); add(-0.25, 0.93, 'beak');
    add( 0.15, 0.88, 'beak'); add( 0.25, 0.93, 'beak');          // 足

    /* --- 種類ごとの特徴 --- */
    switch (kind) {
      case 'emperor':     // コウテイ：耳のオレンジ斑と胸の黄色
        arc(-0.30, -0.58, 0.10, 0.12, 0, T, 9, 'accent');
        arc( 0.30, -0.58, 0.10, 0.12, 0, T, 9, 'accent');
        arc(0, -0.20, 0.19, 0.10, Math.PI * 0.05, Math.PI * 0.95, 7, 'accent');
        break;
      case 'adelie':      // アデリー：白いアイリング（顔は黒いまま）
        arc(-0.11, -0.64, 0.08, 0.08, 0, T, 8, 'belly');
        arc( 0.11, -0.64, 0.08, 0.08, 0, T, 8, 'belly');
        break;
      case 'rockhopper':  // イワトビ：黄色い冠羽
        for (let i = 0; i < 4; i++) {
          const x = -0.24 + (i / 3) * 0.48;
          add(x,        -0.86, 'accent');
          add(x * 1.45, -1.04, 'accent');
          add(x * 1.75, -1.18, 'accent');
        }
        break;
      case 'chinstrap':   // ヒゲ：あごをぐるりと回る線
        arc(0, -0.50, 0.29, 0.26, Math.PI * 0.10, Math.PI * 0.90, 11, 'body');
        break;
      case 'gentoo':      // ジェンツー：目の上をつなぐ白い帯
        arc(0, -0.66, 0.27, 0.24, Math.PI * 1.10, Math.PI * 1.90, 11, 'belly');
        break;
      case 'african':     // ケープ：胸のU字の帯
      default:
        arc(0, 0.06, 0.32, 0.26, Math.PI * 0.08, Math.PI * 0.92, 11, 'body');
        arc(-0.12, -0.64, 0.07, 0.07, 0, T, 7, 'accent');
        arc( 0.12, -0.64, 0.07, 0.07, 0, T, 7, 'accent');
        break;
    }
    PENGUIN_CACHE[kind] = P;
    return P;
  }

  /* ---------- 花火エンジン ---------- */
  function Fireworks(canvas) {
    const F    = CFG.fireworks;
    const SP   = F.special || { enabled: false };
    const MAXS = (CFG.gift && CFG.gift.maxShells) || 1000;
    const MAXP = F.maxParticles || 2200;
    const ctx  = canvas.getContext('2d');
    let W = 0, H = 0;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const rockets = [], sparks = [];
    const COLORS = [CFG.theme.hanabiA, CFG.theme.hanabiB, CFG.theme.hanabiC,
                    CFG.theme.gold, CFG.theme.lantern, '#ffffff', '#7dff9b'];
    const PENGUIN_KINDS = (SP.penguins && SP.penguins.length)
      ? SP.penguins : ['emperor', 'adelie', 'rockhopper', 'chinstrap', 'gentoo', 'african'];

    canvas.style.opacity = String(F.opacity == null ? 0.85 : F.opacity);

    function resize() {
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    addEventListener('resize', resize);

    /* ===== 打ち上げ計画 =====
     * 発数から「スペシャルの数・通常玉の数・同時数・発射間隔」を決める。
     * 全体の長さは config の maxDurationMs を超えない。 */
    function planFor(shells) {
      const n = clamp(Math.round(shells), 1, MAXS);
      const e = clamp(Math.log10(n) / Math.log10(Math.max(10, MAXS)), 0, 1);

      /* --- スペシャルに置き換える --- */
      let special = 0, normal = n;
      if (SP.enabled && n >= (SP.from || 30)) {
        const worth = Math.max(2, SP.worth || 10);
        special = Math.floor(n * (SP.share || 0.55) / worth);
        special = Math.min(special, SP.max || 60);
        normal  = n - special * worth;
      }
      normal = Math.min(Math.max(normal, 0), F.maxRenderShells);

      const units    = Math.max(1, normal + special);
      const duration = lerp(F.minDurationMs, F.maxDurationMs, e);
      const simul    = clamp(Math.round(lerp(1, F.maxSimul, Math.pow(e, 1.3))), 1, F.maxSimul);
      const volleys  = Math.max(1, Math.ceil(units / simul));
      const gap      = clamp(duration / volleys, F.minGapMs, F.maxGapMs);

      return {
        n, e, simul, gap, special, normal, units,
        durationMs: Math.round(volleys * gap),
        perShell: Math.round(lerp(F.maxShellParticles, F.minShellParticles, e)),
        scale:    lerp(1, F.maxShellScale, e),
        spread:   lerp(1.5, 2.8, e)
      };
    }

    /** 計画から、打ち上げる玉の並びを作る（スペシャルは均等に散らす） */
    function buildShells(p) {
      const list = [];
      for (let i = 0; i < p.normal; i++) list.push({ kind: 'normal' });
      if (p.special > 0) {
        const step = Math.max(1, Math.floor(list.length / p.special) || 1);
        for (let i = 0; i < p.special; i++) {
          const isPenguin = Math.random() < (SP.penguinRate == null ? 0.6 : SP.penguinRate);
          const s = isPenguin
            ? { kind: 'penguin', species: PENGUIN_KINDS[(Math.random() * PENGUIN_KINDS.length) | 0] }
            : { kind: 'big' };
          const at = Math.min(list.length, (i + 1) * step);
          list.splice(at, 0, s);
        }
      }
      return list;
    }

    /* ===== 打ち上げキュー ===== */
    let queue = [], plan = null, timer = null;
    let totalShells = 0, fired = 0;
    const progressCbs = [];
    const emitProgress = () => {
      if (!progressCbs.length) return;
      const info = { total: totalShells, fired: fired, remaining: queue.length, running: queue.length > 0 };
      progressCbs.forEach(fn => { try { fn(info); } catch (e) { console.error(e); } });
    };

    function enqueue(shells) {
      const p = planFor(shells);
      queue = queue.concat(buildShells(p));
      totalShells += p.units;
      plan = plan ? {
        simul:    Math.max(plan.simul, p.simul),
        gap:      Math.min(plan.gap, p.gap),
        e:        Math.max(plan.e, p.e),
        perShell: Math.min(plan.perShell, p.perShell),
        scale:    Math.max(plan.scale, p.scale),
        spread:   Math.max(plan.spread, p.spread)
      } : p;
      restartTimer();
      emitProgress();
    }

    function restartTimer() {
      if (timer) clearInterval(timer);
      timer = setInterval(tick, Math.round(plan.gap));
    }

    function tick() {
      if (!queue.length) {
        clearInterval(timer); timer = null; plan = null;
        totalShells = 0; fired = 0;
        emitProgress();
        return;
      }
      /* 玉は必ず打つ（見送ると全体の長さが伸びてしまう）。
         粒が多いときは burst 側が粒数を絞って負荷を抑える。
         柄の玉は粒を多く使うので、1回の斉射につき1発までに抑える。 */
      const n = Math.min(plan.simul, queue.length);
      let patternUsed = false;
      for (let i = 0; i < n; i++) {
        const sh = queue.shift();
        if (sh.kind === 'penguin') {
          if (patternUsed || sparks.length > MAXP * 0.72) { launch({ kind: 'big' }); continue; }
          patternUsed = true;
        }
        launch(sh);
      }
      fired += n;
      emitProgress();
    }

    /* ===== 玉と粒 ===== */
    /** 打ち上げ位置。画面中央は順番待ちの表示があるので、
     *  ふだんは左右に寄せて上げる（config.fireworks.centerClear で調整）。 */
    function pickX(special) {
      const clear = F.centerClear == null ? 0.7 : F.centerClear;   // 中央を空ける確率
      if (!special && Math.random() < clear) {
        return Math.random() < 0.5
          ? W * (0.04 + Math.random() * 0.26)     // 左寄り
          : W * (0.70 + Math.random() * 0.26);    // 右寄り
      }
      return W * (special ? (0.14 + Math.random() * 0.72) : (0.06 + Math.random() * 0.88));
    }

    function launch(shell) {
      shell = shell || { kind: 'normal' };
      const special = shell.kind !== 'normal';
      const scale = (plan ? plan.scale : 1) * (shell.kind === 'big' ? 1.8 : 1);
      rockets.push({
        x: pickX(special),
        y: H + 8,
        vy: -(H * (special ? 0.0130 : 0.0118) + Math.random() * H * 0.0040),
        ty: H * (special ? (0.08 + Math.random() * 0.20) : (0.06 + Math.random() * 0.34)),
        color: COLORS[(Math.random() * COLORS.length) | 0],
        scale: scale,
        shell: shell
      });
    }

    /** 通常の玉：円形に散る */
    function burst(x, y, color, scale) {
      const room = MAXP - sparks.length;
      if (room < 8) return;
      const base   = plan ? plan.perShell : F.maxShellParticles;
      const spread = plan ? plan.spread : 2;
      let n = Math.round(base * Math.min(scale, 2.6));
      n = Math.min(n, room, 120);
      if (n < 6) return;

      const speed = spread * (0.85 + Math.random() * 0.5) * Math.min(scale, 2.6);
      const ring  = Math.random() < 0.4;
      const alt   = Math.random() < 0.22 ? COLORS[(Math.random() * COLORS.length) | 0] : null;

      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n + Math.random() * 0.14;
        const s = ring ? speed : speed * (0.35 + Math.random() * 0.95);
        sparks.push({
          x: x, y: y,
          vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          life: 1, decay: 0.010 + Math.random() * 0.014,
          grav: 0.021, drag: 0.988,
          color: alt && i % 2 ? alt : (Math.random() < 0.14 ? '#ffffff' : color),
          size: (1.1 + Math.random() * 1.5) * clamp(scale, 1, 2)
        });
      }
    }

    /** 特大の玉：二重の花＋芯 */
    function burstBig(x, y, color) {
      const room = MAXP - sparks.length;
      if (room < 40) { burst(x, y, color, 2); return; }
      const alt = COLORS[(Math.random() * COLORS.length) | 0];
      [[1.0, 46, color], [0.62, 34, alt], [0.3, 18, '#ffffff']].forEach(([r, n, c]) => {
        n = Math.min(n, MAXP - sparks.length);
        for (let i = 0; i < n; i++) {
          const a = (Math.PI * 2 * i) / n + Math.random() * 0.1;
          const s = 4.6 * r * (0.9 + Math.random() * 0.25);
          sparks.push({
            x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
            life: 1, decay: 0.0062 + Math.random() * 0.006,
            grav: 0.014, drag: 0.982,
            color: Math.random() < 0.12 ? '#ffffff' : c,
            size: 1.7 + Math.random() * 1.5
          });
        }
      });
    }

    /** ペンギン柄：粒を形の位置へ一気に開かせ、そこで静止させる。
     *  ふつうの粒と違い「目標位置へ寄せて止める」動きにしないと、
     *  尾を引いて形が読めなくなるため、専用の動き方(pat)を持たせる。 */
    function burstPenguin(x, y, color, species) {
      const shape = penguinShape(species);
      const room  = MAXP - sparks.length;
      if (room < shape.length) { burstBig(x, y, color); return; }

      const R = Math.min(W, H) * 0.17 * (0.92 + Math.random() * 0.22);
      const accent = COLORS[(Math.random() * COLORS.length) | 0];
      const paint = {
        body:   color,
        belly:  '#ffffff',
        beak:   '#ffb03a',
        eye:    color,
        accent: (accent === color ? CFG.theme.gold : accent)
      };
      for (let i = 0; i < shape.length; i++) {
        const q = shape[i];
        sparks.push({
          pat: true,
          cx: x, cy: y, x: x, y: y,
          tx: q.x * R, ty: q.y * R,
          t: 0, ts: 0.13 + Math.random() * 0.03,
          hold: 34, fall: 0, vfall: 0,
          life: 1, decay: 0.0062,
          vx: 0, vy: 0, grav: 0, drag: 1,
          color: paint[q.c] || color,
          size: (q.c === 'eye' || q.c === 'beak') ? 2.6 : 2.2
        });
      }
    }

    /* ===== 描画ループ ===== */
    function frame() {
      // 粒が上限を超えたら古いものから捨てる（描画がもたつかないように）
      if (sparks.length > MAXP) sparks.splice(0, sparks.length - MAXP);

      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';

      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.y += r.vy; r.vy += 0.06;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 1.9 * clamp(r.scale, 1, 2), 0, 7);
        ctx.fillStyle = r.color;
        ctx.fill();
        ctx.globalAlpha = 0.2;
        ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x, r.y + 13);
        ctx.strokeStyle = r.color; ctx.lineWidth = 1.3; ctx.stroke();
        ctx.globalAlpha = 1;

        if (r.y <= r.ty || r.vy >= 0) {
          const k = r.shell ? r.shell.kind : 'normal';
          if (k === 'penguin')   burstPenguin(r.x, r.y, r.color, r.shell.species);
          else if (k === 'big')  burstBig(r.x, r.y, r.color);
          else                   burst(r.x, r.y, r.color, r.scale);
          rockets.splice(i, 1);
        }
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        if (p.pat) {
          // 柄の粒：目標位置へ寄せて止め、しばらく形を保ってから落ちる
          if (p.t < 1) {
            p.t = Math.min(1, p.t + p.ts);
            const k = 1 - Math.pow(1 - p.t, 3);      // easeOutCubic
            p.x = p.cx + p.tx * k;
            p.y = p.cy + p.ty * k;
          } else if (p.hold > 0) {
            p.hold--;
          } else {
            p.vfall += 0.016;
            p.fall  += p.vfall;
            p.y = p.cy + p.ty + p.fall;
          }
          if (p.t >= 1) p.life -= p.decay;
        } else {
          p.x += p.vx; p.y += p.vy;
          p.vy += p.grav; p.vx *= p.drag; p.vy *= p.drag;
          p.life -= p.decay;
        }
        if (p.life <= 0) { sparks.splice(i, 1); continue; }
        ctx.globalAlpha = Math.min(1, p.life * 1.5);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, 7);
        ctx.fillStyle = p.color;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      requestAnimationFrame(frame);
    }
    frame();

    return {
      /** ギフト連動：shells 発ぶんの花火を順番に打ち上げる */
      gift(shells) { if (F.enabled) enqueue(shells); },
      launch(shell) { launch(shell); },
      celebrate(n) { if (n > 0) enqueue(n); },
      onProgress(fn) { progressCbs.push(fn); return this; },
      plan(shells) { return planFor(shells); },
      penguinKinds: PENGUIN_KINDS,
      get remaining() { return queue.length; },
      get particles() { return sparks.length; },
      destroy() { if (timer) clearInterval(timer); }
    };
  }

  global.Fireworks = Fireworks;
  global.penguinShape = penguinShape;
})(window);
