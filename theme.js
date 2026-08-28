/* =============================================================
 *  theme.js — config.theme の色を CSS 変数に流し込む＋花火エフェクト
 *
 *  花火はギフト連動。発数（コイン数×個数）に応じて
 *  「長さ・同時に上がる数・玉の大きさ」が変わり、順番に打ち上がります。
 *
 *  発数が非常に多いときは、玉を1つずつ全部描くのではなく
 *  「大きな玉を少なめに」置き換えて負荷を抑えます（config で調整可）。
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

  /* ---------- 花火エンジン ---------- */
  function Fireworks(canvas) {
    const F    = CFG.fireworks;
    const MAXS = (CFG.gift && CFG.gift.maxShells) || 10000;
    const MAXP = F.maxParticles || 1800;
    const ctx  = canvas.getContext('2d');
    let W = 0, H = 0;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const rockets = [], sparks = [];
    const COLORS = [CFG.theme.hanabiA, CFG.theme.hanabiB, CFG.theme.hanabiC,
                    CFG.theme.gold, CFG.theme.lantern, '#ffffff', '#7dff9b'];

    canvas.style.opacity = String(F.opacity == null ? 0.85 : F.opacity);

    function resize() {
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    addEventListener('resize', resize);

    /* ===== 打ち上げ計画 =====
     * 発数から「長さ・同時数・発射間隔・玉の大きさ」を決める。
     * 発数が増えるほど → 長く / 同時数が増え / 玉が大きくなる。 */
    function planFor(shells) {
      const n = clamp(Math.round(shells), 1, MAXS);
      const e = clamp(Math.log10(n) / Math.log10(Math.max(10, MAXS)), 0, 1);

      const duration = lerp(F.minDurationMs, F.maxDurationMs, e);
      const simul    = clamp(Math.round(lerp(1, F.maxSimul, Math.pow(e, 1.3))), 1, F.maxSimul);
      const render   = Math.min(n, F.maxRenderShells);      // 実際に描く玉の数
      const volleys  = Math.max(1, Math.ceil(render / simul));
      const gap      = clamp(duration / volleys, F.minGapMs, F.maxGapMs);

      return {
        simul, gap, e, render,
        perShell: Math.round(lerp(F.maxShellParticles, F.minShellParticles, e)),
        scale:    lerp(1, F.maxShellScale, e),
        spread:   lerp(1.5, 2.8, e)
      };
    }

    /* ===== 打ち上げキュー ===== */
    let remaining = 0, totalShells = 0, fired = 0, plan = null, timer = null, shellIdx = 0;
    const progressCbs = [];
    const emitProgress = () => {
      if (!progressCbs.length) return;
      const info = { total: totalShells, fired, remaining, running: remaining > 0 };
      progressCbs.forEach(fn => { try { fn(info); } catch (e) { console.error(e); } });
    };

    function enqueue(shells) {
      const p = planFor(shells);
      // 実際に打つのは render 玉（多発時は間引いて大玉にする）
      remaining += p.render;
      totalShells += p.render;
      plan = plan ? {
        simul:    Math.max(plan.simul, p.simul),
        gap:      Math.min(plan.gap, p.gap),
        e:        Math.max(plan.e, p.e),
        render:   p.render,
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
      if (remaining <= 0) {
        clearInterval(timer); timer = null; plan = null;
        totalShells = 0; fired = 0;
        emitProgress();
        return;
      }
      // 粒が飽和しているときはこの回を見送る（順番待ちの描画を止めないため）
      if (sparks.length > MAXP * 0.9) return;

      const n = Math.min(plan.simul, remaining);
      for (let i = 0; i < n; i++) {
        shellIdx++;
        const big = F.bigShellEvery > 0 && (shellIdx % F.bigShellEvery === 0);
        launch(null, null, null, plan.scale * (big ? 1.7 : 1));
      }
      remaining -= n;
      fired += n;
      emitProgress();
    }

    /* ===== 玉と粒 ===== */
    function launch(x, targetY, color, scale) {
      scale = scale || 1;
      rockets.push({
        x: x != null ? x : W * (0.08 + Math.random() * 0.84),
        y: H + 8,
        vy: -(H * 0.0115 + Math.random() * H * 0.0045),
        ty: targetY != null ? targetY : H * (0.08 + Math.random() * 0.42),
        color: color || COLORS[(Math.random() * COLORS.length) | 0],
        scale: scale
      });
    }

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
          color: alt && i % 2 ? alt : (Math.random() < 0.14 ? '#ffffff' : color),
          size: (1.1 + Math.random() * 1.5) * clamp(scale, 1, 2)
        });
      }
    }

    /* ===== 描画ループ ===== */
    function frame() {
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
        if (r.y <= r.ty || r.vy >= 0) { burst(r.x, r.y, r.color, r.scale); rockets.splice(i, 1); }
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.x += p.vx; p.y += p.vy;
        p.vy += 0.021; p.vx *= 0.988; p.vy *= 0.988;
        p.life -= p.decay;
        if (p.life <= 0) { sparks.splice(i, 1); continue; }
        ctx.globalAlpha = p.life;
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
      launch,
      celebrate(n) { if (n > 0) enqueue(n); },
      onProgress(fn) { progressCbs.push(fn); return this; },
      plan(shells) { return planFor(shells); },
      get remaining() { return remaining; },
      get particles() { return sparks.length; },
      destroy() { if (timer) clearInterval(timer); }
    };
  }

  global.Fireworks = Fireworks;
})(window);
